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

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const m = req.method;
  const body = m === "GET" || m === "DELETE" ? {} : await req.json().catch(() => ({}));
  try {
    // ---- bez logowania
    let auth = await db.authState();
    // awaryjny reset hasła: zmienna środowiskowa FLYALERT_RESET=1 w Netlify (obserwacje zostają)
    if (process.env.FLYALERT_RESET === "1" && (path === "/state" || path === "/setup")) auth = null;
    if (path === "/state") return json({ setup: !!auth, providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.label])) });
    if (path === "/setup" && m === "POST") {
      if (auth) return fail("Hasło jest już ustawione.", 409);
      if (!body.password || body.password.length < 6) return fail("Hasło musi mieć co najmniej 6 znaków.");
      const a = await db.setPassword(body.password);
      return json({ token: db.tokenFor(a, body.password) });
    }
    if (path === "/login" && m === "POST") {
      if (!auth) return fail("Najpierw ustaw hasło.", 409);
      const t = db.tokenFor(auth, body.password || "");
      if (!db.checkToken(auth, t)) { await new Promise((r) => setTimeout(r, 800)); return fail("Złe hasło.", 401); }
      return json({ token: t });
    }
    // ---- dalej tylko po zalogowaniu
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!db.checkToken(auth, token)) return fail("Zaloguj się.", 401);

    if (path === "/catalog") return json(catalog());
    if (path === "/resolve" && m === "POST") return json(resolve(body.tokens || []).map((c) => ({ code: c, label: label(c) })));

    if (path === "/settings") {
      const s = await db.getSettings();
      if (m === "GET") {
        const out = { ...s };
        for (const k of SECRET_KEYS) out[k] = s[k] ? KEEP : "";
        return json(out);
      }
      if (m === "PUT") {
        const n = { ...s };
        for (const k of Object.keys(db.SETTINGS_DEFAULT)) if (body[k] !== undefined && body[k] !== KEEP) n[k] = typeof body[k] === "string" ? body[k].trim() : body[k];
        if (!PROVIDERS[n.provider]) return fail("Nieznane źródło cen.");
        await db.saveSettings(n);
        return json({ ok: true });
      }
    }
    if (path === "/telegram/detect" && m === "POST") {
      const s = await db.getSettings();
      const tok = body.token && body.token !== KEEP ? body.token.trim() : s.telegramToken;
      if (!tok) return fail("Wpisz token bota.");
      return json(await tgDetectChat(tok));
    }
    if (path === "/telegram/test" && m === "POST") {
      const s = await db.getSettings();
      const r = await tgSend(s, "✈️ FlyAlert: test powiadomień działa!");
      return json({ delivered: r || "Telegram nie jest skonfigurowany" });
    }
    if (path === "/password" && m === "POST") {
      if (!body.password || body.password.length < 6) return fail("Hasło musi mieć co najmniej 6 znaków.");
      const a = await db.setPassword(body.password);
      return json({ token: db.tokenFor(a, body.password) });
    }

    if (path === "/watches") {
      if (m === "GET") return json(await db.listWatches());
      if (m === "POST") {
        const w = validateWatch(body);
        w.id = await db.nextId();
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
      if (!w) return fail("Nie ma takiej obserwacji.", 404);
      if (mm[2] && m === "POST") {
        w.scanningSince = new Date().toISOString();
        await db.saveWatch(w);
        await triggerScan(url.origin, [id]);
        return json({ ok: true });
      }
      if (m === "GET") return json(await detail(id));
      if (m === "PUT") { const n = validateWatch(body, w); await db.saveWatch(n); return json(n); }
      if (m === "DELETE") { await db.deleteWatch(id); return json({ ok: true }); }
    }
    return fail("Nie znaleziono.", 404);
  } catch (e) {
    console.error(e);
    return fail(e.message || String(e), 400);
  }
};

export const config = { path: "/api/*" };
