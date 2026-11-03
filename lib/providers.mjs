// Źródła cen. Każde zwraca { offers, hist, queries, errors }.
// oferta: { origin, destination, depart, ret, price, currency, airline, stops, link }
const D = (s) => new Date(s.slice(0, 10) + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const days = (a, b) => Math.round((D(b) - D(a)) / 86400000);

export function fits(o, w) {
  if (o.depart < w.dateFrom || o.depart > w.dateTo) return false;
  if (!w.oneWay) {
    if (!o.ret) return false;
    const n = days(o.depart, o.ret);
    if (n < w.nightsMin || n > w.nightsMax) return false;
  }
  if (w.directOnly && o.stops > 0) return false;
  return true;
}

async function getJSON(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Accept: "application/json", "User-Agent": "FlyAlert/1.0", ...(opts.headers || {}) } });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`HTTP ${r.status}: ${t.slice(0, 120)}`); }
  if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
  return j;
}

// pula równoległych zapytań
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ---------------- DEMO: ceny symulowane
function h(...parts) {
  let x = 2166136261;
  for (const ch of parts.join("|")) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; }
  return x / 0xffffffff;
}
async function demo(w, pairs) {
  const bucket = Math.floor(Date.now() / 3600000);
  const offers = [];
  for (const [a, b] of pairs) {
    const base = 250 + 1800 * h([a, b].sort().join());
    for (let d = D(w.dateFrom); iso(d) <= w.dateTo; d = addDays(d, 1)) {
      const ds = iso(d);
      if (h(a, b, ds) > 0.55) continue;
      const doy = (d - new Date(Date.UTC(d.getUTCFullYear(), 0, 0))) / 86400000;
      const season = 1 + 0.25 * Math.sin((doy / 365) * 2 * Math.PI);
      const drift = 0.8 + 0.4 * h(a, b, ds, bucket);
      const nights = w.nightsMin + Math.floor(h("n", a, ds) * (w.nightsMax - w.nightsMin + 1));
      offers.push({ origin: a, destination: b, depart: ds, ret: w.oneWay ? null : iso(addDays(d, nights)),
        price: Math.round(base * season * drift * (w.oneWay ? 1 : 1.8)), currency: w.currency,
        airline: ["LO", "FR", "W6", "A3", "LH", "U2"][Math.floor(h("a", a, b) * 6)],
        stops: h("s", a, b) < 0.5 ? 0 : 1, link: null });
    }
  }
  return { offers: offers.filter((o) => fits(o, w)), hist: [], queries: pairs.length, errors: [] };
}

// ---------------- Travelpayouts / Aviasales (darmowe, ceny z cache, całe miesiące)
function months(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  while (`${y}-${String(m).padStart(2, "0")}` <= end) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { y++; m = 1; } }
  return out;
}
async function travelpayouts(w, pairs, s) {
  if (!s.travelpayoutsToken) throw new Error("Brak tokenu Travelpayouts (Ustawienia)");
  const jobs = pairs.flatMap(([a, b]) => months(w.dateFrom, w.dateTo).map((m) => [a, b, m]));
  const offers = [], errors = [];
  await pool(jobs, 8, async ([a, b, m]) => {
    const p = new URLSearchParams({ origin: a, destination: b, departure_at: m, one_way: String(!!w.oneWay),
      direct: String(!!w.directOnly), currency: w.currency.toLowerCase(), sorting: "price", limit: "1000", token: s.travelpayoutsToken });
    try {
      const r = await getJSON(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${p}`);
      for (const x of r.data || []) offers.push({
        origin: x.origin_airport || a, destination: x.destination_airport || b, depart: x.departure_at.slice(0, 10),
        ret: x.return_at ? x.return_at.slice(0, 10) : null, price: Number(x.price), currency: w.currency, airline: x.airline,
        stops: Math.max(x.transfers || 0, x.return_transfers || 0), link: x.link ? "https://www.aviasales.com" + x.link : null });
    } catch (e) { errors.push(`${a}-${b} ${m}: ${e.message}`); }
  });
  return { offers: offers.filter((o) => fits(o, w)), hist: [], queries: jobs.length, errors };
}

// ---------------- Google Flights przez SerpApi (płatne, aktualne, + historia ceny ~60 dni)
function spreadDates(w, n) {
  const span = days(w.dateFrom, w.dateTo), stay = Math.floor((w.nightsMin + w.nightsMax) / 2), out = [];
  n = Math.max(1, Math.min(n, span + 1));
  for (let i = 0; i < n; i++) {
    const d = addDays(D(w.dateFrom), Math.round((i * span) / Math.max(n - 1, 1)));
    out.push([iso(d), w.oneWay ? null : iso(addDays(d, stay))]);
  }
  return [...new Map(out.map((x) => [x.join(), x])).values()];
}
async function serpapi(w, pairs, s, dates) {
  if (!s.serpapiKey) throw new Error("Brak klucza SerpApi (Ustawienia)");
  const maxQ = Number(s.serpapiMaxQueries) || 8, CH = 7;
  const os = [...new Set(pairs.map((p) => p[0]))], ds = [...new Set(pairs.map((p) => p[1]))];
  const chunks = [];
  for (let i = 0; i < os.length; i += CH) for (let j = 0; j < ds.length; j += CH) chunks.push([os.slice(i, i + CH), ds.slice(j, j + CH)]);
  const per = Math.max(1, Math.floor(maxQ / chunks.length));
  dates = (dates || spreadDates(w, per)).slice(0, per);
  const jobs = chunks.flatMap(([o, d]) => dates.map(([dep, ret]) => [o, d, dep, ret])).slice(0, maxQ);
  const offers = [], hist = [], errors = [];
  await pool(jobs, 4, async ([o, d, dep, ret]) => {
    const p = new URLSearchParams({ engine: "google_flights", departure_id: o.join(","), arrival_id: d.join(","),
      outbound_date: dep, type: ret ? "1" : "2", currency: w.currency, hl: "pl", gl: "pl", api_key: s.serpapiKey });
    if (ret) p.set("return_date", ret);
    if (w.directOnly) p.set("stops", "1");
    try {
      const r = await getJSON(`https://serpapi.com/search.json?${p}`);
      const link = r.search_metadata?.google_flights_url || null;
      for (const f of [...(r.best_flights || []), ...(r.other_flights || [])]) {
        const legs = f.flights || [];
        if (!legs.length || !f.price) continue;
        offers.push({ origin: legs[0].departure_airport.id, destination: legs.at(-1).arrival_airport.id, depart: dep, ret,
          price: Number(f.price), currency: w.currency, airline: legs[0].airline, stops: (f.layovers || []).length, link });
      }
      for (const [t, v] of r.price_insights?.price_history || []) hist.push([new Date(t * 1000).toISOString().slice(0, 10), Number(v)]);
    } catch (e) { errors.push(`Google Flights ${dep}: ${e.message}`); }
  });
  return { offers: offers.filter((o) => fits(o, w)), hist, queries: jobs.length, errors };
}

// ---------------- Hybryda: Travelpayouts szuka, Google Flights weryfikuje najtańsze terminy
async function hybrid(w, pairs, s) {
  const a = await travelpayouts(w, pairs, s);
  const best = [];
  for (const o of [...a.offers].sort((x, y) => x.price - y.price)) {
    if (!best.some(([d, r]) => d === o.depart && r === o.ret)) best.push([o.depart, o.ret]);
    if (best.length >= (Number(s.serpapiMaxQueries) || 8)) break;
  }
  if (!best.length) return a;
  const b = await serpapi(w, pairs, s, best);
  return { offers: [...a.offers, ...b.offers], hist: b.hist, queries: a.queries + b.queries, errors: [...a.errors, ...b.errors] };
}

export const PROVIDERS = {
  demo: { label: "Demo – ceny symulowane (do testów)", run: demo },
  travelpayouts: { label: "Travelpayouts / Aviasales – darmowe", run: travelpayouts },
  serpapi: { label: "Google Flights (SerpApi) – płatne, najdokładniejsze", run: serpapi },
  hybrid: { label: "Hybryda – Travelpayouts + weryfikacja w Google Flights (polecane)", run: hybrid },
};
