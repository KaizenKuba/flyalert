// REST API panelu: /api/*
import { catalog, label, resolve } from "../../lib/airports.mjs";
import { PROVIDERS } from "../../lib/providers.mjs";
import { pairsFor } from "../../lib/scanner.mjs";
import * as db from "../../lib/store.mjs";
import { tgDetectChat, tgSend } from "../../lib/telegram.mjs";
import { triggerScan } from "../../lib/trigger.mjs";
import { validateWatch } from "../../lib/validate.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fail = (msg, status = 400) => json({ error: msg }, status);
const SECRET_KEYS = ["travelpayoutsToken", "serpapiKey", "telegramToken"];
const KEEP = "__keep__";

function stats(h) {
  const now = Date.now(), out = {};
  for (const d of [7, 30, 90, 180]) {
    const xs = h.scans.filter((s) => Date.parse(s.t) >= now - d * 86400000).map((s) => s.min);
    out[`d${d}`] = xs.length ? Math.min(...xs) : null;
  }
  const ext = Object.values(h.ext || {});
  out.google = ext.length ? Math.min(...ext) : null;
  return out;
}

async function detail(id) {
  const w = await db.getWatch(id);
  if (!w) return null;
  const h = await db.getHistory(id);
  const { o, d, total } = pairsFor(w);
  const lab = (arr, k) => arr.map((x) => ({ ...x, label: label(x[k]) }));
  const last = h.last && {
    ...h.last,
    offers: h.last.offers.map((x) => ({ ...x, originLabel: label(x.origin), destinationLabel: label(x.destination) })),
    byDest: lab(h.last.byDest, "code").sort((a, b) => a.p - b.p),
    byOrigin: lab(h.last.byOrigin, "code").sort((a, b) => a.p - b.p),
  };
  return { ...w, originAirports: o, destinationAirports: d, pairs: total, stats: stats(h),
    history: h.scans.slice(-500), ext: Object.entries(h.ext || {}).sort(), last, alerts: h.alerts };
}

const USER_RE = /^[a-z0-9_-]{2,20}$/;
const pause = () => new Promise((r) => setTimeout(r, 800));

// Kto wysłał zapytanie? Właściciel: token = hash; znajomy: token = "u:<login>:<hash>"
async function whoAmI(req, auth) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (token.startsWith("u:")) {
    const [, name, hash] = token.split(":");
    const u = name && (await db.getUser(name));
    if (u && db.safeEq(u.key, hash)) return { name, admin: false, user: u };
    return null;
  }
  return db.checkToken(auth, token) ? { name: "admin", admin: true } : null;
}
const ownerOf = (w) => w.owner || "admin";

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const m = req.method;
  const body = m === "GET" || m === "DELETE" ? {} : await req.json().catch(() => ({}));
  try {
    // ---- bez logowania
    let auth = await db.authState();
    // awaryjny reset hasła właściciela: zmienna środowiskowa FLYALERT_RESET=1 w Netlify (dane zostają)
    if (process.env.FLYALERT_RESET === "1" && (path === "/state" || path === "/setup")) auth = null;
    if (path === "/state") return json({ setup: !!auth, providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])) });
    if (path === "/setup" && m === "POST") {
      if (auth) return fail("Hasło jest już ustawione.", 409);
      if (!body.password || body.password.length < 6) return fail("Hasło musi mieć co najmniej 6 znaków.");
      const a = await db.setPassword(body.password);
      return json({ token: db.tokenFor(a, body.password), me: { name: "admin", admin: true } });
    }
    if (path === "/login" && m === "POST") {
      const login = String(body.user || "").trim().toLowerCase();
      if (login && login !== "admin") {
        const u = USER_RE.test(login) && (await db.getUser(login));
        if (!u || !u.hash || !db.safeEq(u.hash, db.hashFor(u.salt, body.password || ""))) { await pause(); return fail("Zły login lub hasło.", 401); }
        return json({ token: `u:${login}:${u.key}`, me: { name: login, admin: false } });
      }
      if (!auth) return fail("Najpierw ustaw hasło.", 409);
      const t = db.tokenFor(auth, body.password || "");
      if (!db.checkToken(auth, t)) { await pause(); return fail("Złe hasło.", 401); }
      return json({ token: t, me: { name: "admin", admin: true } });
    }
    // link-klucz od właściciela: #k=<login>.<klucz> loguje od razu, bez hasła
    if (path === "/invite" && m === "POST") {
      const u = await db.getUser(String(body.user || "").toLowerCase());
      if (!u || !u.key || !db.safeEq(u.key, body.code)) { await pause(); return fail("Ten link jest nieważny. Poproś o nowy.", 404); }
      if (!u.joinedAt) { u.joinedAt = new Date().toISOString(); await db.saveUser(u); }
      return json({ token: `u:${u.name}:${u.key}`, me: { name: u.name, admin: false } });
    }

    // ---- dalej tylko po zalogowaniu
    const me = await whoAmI(req, auth);
    if (!me) return fail("Zaloguj się.", 401);

    if (path === "/me") return json({ name: me.name, admin: me.admin });
    if (path === "/catalog") return json(catalog());
    if (path === "/resolve" && m === "POST") return json(resolve(body.tokens || []).map((c) => ({ code: c, label: label(c) })));

    if (path === "/settings") {
      const s = await db.getSettings();
      if (m === "GET") {
        if (!me.admin) {
          let bot = "";
          try { if (s.telegramToken) bot = (await (await fetch(`https://api.telegram.org/bot${s.telegramToken}/getMe`)).json()).result?.username || ""; } catch {}
          return json({ admin: false, name: me.name, telegramChatId: me.user.telegramChatId || "", telegramToken: me.user.telegramToken ? KEEP : "", sharedBot: bot, provider: s.provider });
        }
        const out = { ...s, admin: true };
        for (const k of SECRET_KEYS) out[k] = s[k] ? KEEP : "";
        return json(out);
      }
      if (m === "PUT") {
        if (!me.admin) {
          const u = me.user;
          if (body.telegramChatId !== undefined) u.telegramChatId = String(body.telegramChatId).trim();
          if (body.telegramToken !== undefined && body.telegramToken !== KEEP) u.telegramToken = String(body.telegramToken).trim();
          await db.saveUser(u);
          return json({ ok: true });
        }
        const n = { ...s };
        for (const k of Object.keys(db.SETTINGS_DEFAULT)) if (body[k] !== undefined && body[k] !== KEEP) n[k] = typeof body[k] === "string" ? body[k].trim() : body[k];
        if (!PROVIDERS[n.provider]) return fail("Nieznane źródło cen.");
        await db.saveSettings(n);
        return json({ ok: true });
      }
    }
    // dane Telegrama dla zalogowanej osoby (znajomy domyślnie używa bota właściciela)
    const tgFor = async () => {
      const s = await db.getSettings();
      if (me.admin) return s;
      return { telegramToken: me.user.telegramToken || s.telegramToken, telegramChatId: me.user.telegramChatId };
    };
    if (path === "/telegram/detect" && m === "POST") {
      const tok = body.token && body.token !== KEEP ? body.token.trim() : (await tgFor()).telegramToken;
      if (!tok) return fail(me.admin ? "Wpisz token bota." : "Właściciel strony nie podłączył jeszcze bota Telegram.");
      return json(await tgDetectChat(tok));
    }
    if (path === "/telegram/test" && m === "POST") {
      const r = await tgSend(await tgFor(), `✈️ FlyAlert: test powiadomień działa${me.admin ? "" : ` (konto: ${me.name})`}!`);
      return json({ delivered: r || "Telegram nie jest skonfigurowany" });
    }
    if (path === "/password" && m === "POST") {
      if (!body.password || body.password.length < 6) return fail("Hasło musi mieć co najmniej 6 znaków.");
      if (!me.admin) {
        const u = me.user; u.salt = db.newSalt(); u.hash = db.hashFor(u.salt, body.password); await db.saveUser(u);
        return json({ token: `u:${u.name}:${u.key}` });
      }
      const a = await db.setPassword(body.password);
      return json({ token: db.tokenFor(a, body.password) });
    }

    // ---- znajomi (tylko właściciel)
    if (path === "/users") {
      if (!me.admin) return fail("Tylko właściciel strony zarządza kontami.", 403);
      if (m === "GET") {
        const ws = await db.listWatches();
        return json((await db.listUsers()).map((u) => ({ name: u.name, createdAt: u.createdAt, joined: !!u.joinedAt,
          invite: `${url.origin}/#k=${u.name}.${u.key}`,
          watches: ws.filter((w) => ownerOf(w) === u.name).length, telegram: !!u.telegramChatId })));
      }
      if (m === "POST") {
        const name = String(body.name || "").trim().toLowerCase();
        if (!USER_RE.test(name) || name === "admin") return fail("Login: 2–20 znaków, tylko małe litery, cyfry, - i _ (np. marek).");
        const old = await db.getUser(name);
        if (old && !body.reset) return fail("Takie konto już istnieje.", 409);
        // reset = nowy link (stary przestaje działać), obserwacje zostają
        const u = { ...(old || {}), name, createdAt: old?.createdAt || new Date().toISOString(), key: db.newCode() };
        await db.saveUser(u);
        return json({ name, invite: `${url.origin}/#k=${name}.${u.key}` }, 201);
      }
    }
    const um = path.match(/^\/users\/([a-z0-9_-]+)$/);
    if (um && m === "DELETE") {
      if (!me.admin) return fail("Tylko właściciel strony zarządza kontami.", 403);
      for (const w of await db.listWatches()) if (ownerOf(w) === um[1]) await db.deleteWatch(w.id);
      await db.deleteUser(um[1]);
      return json({ ok: true });
    }

    // ---- obserwacje (każdy widzi tylko swoje)
    if (path === "/watches") {
      if (m === "GET") return json((await db.listWatches()).filter((w) => ownerOf(w) === me.name));
      if (m === "POST") {
        if (!me.admin && (await db.listWatches()).filter((w) => ownerOf(w) === me.name).length >= 10) return fail("Limit 10 obserwacji na konto.");
        const w = validateWatch(body);
        w.id = await db.nextId();
        w.owner = me.name;
        w.createdAt = new Date().toISOString();
        w.scanningSince = w.createdAt;
        await db.saveWatch(w);
        await triggerScan(url.origin, [w.id]);
        return json(w, 201);
      }
    }
    const mm = path.match(/^\/watches\/(\d+)(\/scan)?$/);
    if (mm) {
      const id = Number(mm[1]);
      const w = await db.getWatch(id);
      if (!w || ownerOf(w) !== me.name) return fail("Nie ma takiej obserwacji.", 404);
      if (mm[2] && m === "POST") {
        w.scanningSince = new Date().toISOString();
        await db.saveWatch(w);
        await triggerScan(url.origin, [id]);
        return json({ ok: true });
      }
      if (m === "GET") return json(await detail(id));
      if (m === "PUT") { const n = validateWatch(body, w); n.owner = ownerOf(w); await db.saveWatch(n); return json(n); }
      if (m === "DELETE") { await db.deleteWatch(id); return json({ ok: true }); }
    }
    return fail("Nie znaleziono.", 404);
  } catch (e) {
    console.error(e);
    return fail(e.message || String(e), 400);
  }
};

export const config = { path: "/api/*" };
