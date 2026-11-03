// Magazyn danych: Netlify Blobs (w chmurze) albo pliki JSON (test lokalny: FLYALERT_LOCAL_STORE=katalog)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

let _store;
async function store() {
  if (_store) return _store;
  const dir = process.env.FLYALERT_LOCAL_STORE;
  if (dir) {
    const f = (k) => path.join(dir, encodeURIComponent(k) + ".json");
    _store = {
      async get(k) { try { return JSON.parse(await fs.readFile(f(k), "utf8")); } catch { return null; } },
      async set(k, v) { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(f(k), JSON.stringify(v)); },
      async del(k) { await fs.rm(f(k), { force: true }); },
      async keys(prefix) {
        try { return (await fs.readdir(dir)).map((n) => decodeURIComponent(n.replace(/\.json$/, ""))).filter((k) => k.startsWith(prefix)); }
        catch { return []; }
      },
    };
  } else {
    const { getStore } = await import("@netlify/blobs");
    const s = getStore({ name: "flyalert", consistency: "strong" });
    _store = {
      get: (k) => s.get(k, { type: "json" }),
      set: (k, v) => s.setJSON(k, v),
      del: (k) => s.delete(k),
      async keys(prefix) { const { blobs } = await s.list({ prefix }); return blobs.map((b) => b.key); },
    };
  }
  return _store;
}

// ---- obserwacje (konfiguracja + stan) i historia
export async function listWatches() {
  const s = await store();
  const keys = await s.keys("w/");
  const ws = (await Promise.all(keys.map((k) => s.get(k)))).filter(Boolean);
  return ws.sort((a, b) => b.id - a.id);
}
export const getWatch = async (id) => (await store()).get(`w/${id}`);
export const saveWatch = async (w) => (await store()).set(`w/${w.id}`, w);
export async function deleteWatch(id) { const s = await store(); await s.del(`w/${id}`); await s.del(`h/${id}`); }
export async function getHistory(id) {
  return (await (await store()).get(`h/${id}`)) || { scans: [], ext: {}, last: null, alerts: [] };
}
export const saveHistory = async (id, h) => (await store()).set(`h/${id}`, h);

// ---- ustawienia (klucze API, Telegram)
export const SETTINGS_DEFAULT = { provider: "demo", travelpayoutsToken: "", serpapiKey: "", serpapiMaxQueries: 8,
  telegramToken: "", telegramChatId: "", currency: "PLN" };
export async function getSettings() { return { ...SETTINGS_DEFAULT, ...((await (await store()).get("settings")) || {}) }; }
export const saveSettings = async (s) => (await store()).set("settings", s);

// ---- hasło do panelu
const sha = (s) => createHash("sha256").update(s).digest("hex");
export async function authState() { return (await (await store()).get("auth")) || null; }
export async function setPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const auth = { salt, hash: sha(salt + pw), internal: randomBytes(24).toString("hex") };
  await (await store()).set("auth", auth);
  return auth;
}
export const tokenFor = (auth, pw) => sha(auth.salt + pw);
export function checkToken(auth, token) {
  if (!auth || !token) return false;
  const a = Buffer.from(auth.hash), b = Buffer.from(String(token));
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function nextId() {
  const s = await store();
  const n = ((await s.get("seq")) || 0) + 1;
  await s.set("seq", n);
  return n;
}

// ---- konta znajomych (właściciel = "auth" powyżej)
export const getUser = async (name) => (await store()).get(`u/${name}`);
export const saveUser = async (u) => (await store()).set(`u/${u.name}`, u);
export const deleteUser = async (name) => (await store()).del(`u/${name}`);
export async function listUsers() {
  const s = await store();
  return (await Promise.all((await s.keys("u/")).map((k) => s.get(k)))).filter(Boolean);
}
export function hashFor(salt, pw) { return sha(salt + pw); }
export function newSalt() { return randomBytes(16).toString("hex"); }
export function newCode() { return randomBytes(12).toString("hex"); }
export function safeEq(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
