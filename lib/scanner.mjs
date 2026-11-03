import { label, resolve } from "./airports.mjs";
import { PROVIDERS } from "./providers.mjs";
import { getHistory, getSettings, getWatch, saveHistory, saveWatch } from "./store.mjs";
import { tgSend } from "./telegram.mjs";

const MAX_PAIRS = 150;

export function pairsFor(w) {
  const o = resolve(w.origins), d = resolve(w.destinations);
  const all = o.flatMap((a) => d.filter((b) => b !== a).map((b) => [a, b]));
  return { pairs: all.slice(0, MAX_PAIRS), total: all.length, o, d };
}

const fmtPrice = (p, c) => `${Math.round(p).toLocaleString("pl-PL")} ${c}`;
function fmtOffer(o) {
  let s = `${label(o.origin)} → ${label(o.destination)}, ${o.depart}${o.ret ? ` – ${o.ret}` : ""}: ${fmtPrice(o.price, o.currency)}`;
  if (o.airline) s += ` (${o.airline}${o.stops ? `, przesiadki: ${o.stops}` : ", bezpośredni"})`;
  return s;
}

function groupMin(offers, keyFn) {
  const m = new Map();
  for (const o of offers) { const k = keyFn(o); if (!m.has(k) || m.get(k).price > o.price) m.set(k, o); }
  return [...m.values()];
}

export async function scanWatch(id, { siteUrl } = {}) {
  const w = await getWatch(id);
  if (!w) return { error: "nie ma takiej obserwacji" };
  const s = await getSettings();
  const started = new Date().toISOString();
  let res = { offers: [], hist: [], queries: 0, errors: [] };
  try {
    const { pairs, total } = pairsFor(w);
    const prov = PROVIDERS[s.provider] || PROVIDERS.demo;
    res = await prov.run(w, pairs, s);
    if (total > pairs.length) res.errors.unshift(`Za dużo par lotnisk (${total}); sprawdzam pierwsze ${pairs.length}.`);
  } catch (e) {
    res.errors.push(e.message);
  }

  const h = await getHistory(id);
  const offers = res.offers.sort((a, b) => a.price - b.price);
  const best = offers[0];
  const prev = w.lastMin ?? null;
  if (best) {
    h.scans.push({ t: started, min: best.price, n: offers.length });
    if (h.scans.length > 3000) h.scans = h.scans.slice(-3000);
    h.last = {
      t: started,
      offers: groupMin(offers, (o) => [o.origin, o.destination, o.depart, o.ret].join()).slice(0, 40),
      calendar: groupMin(offers, (o) => o.depart).sort((a, b) => a.depart.localeCompare(b.depart)).map((o) => ({ d: o.depart, p: o.price })),
      byDest: groupMin(offers, (o) => o.destination).map((o) => ({ code: o.destination, p: o.price })),
      byOrigin: groupMin(offers, (o) => o.origin).map((o) => ({ code: o.origin, p: o.price })),
    };
  }
  for (const [day, p] of res.hist) h.ext[day] = Math.min(p, h.ext[day] ?? Infinity);

  // ---- alerty
  if (best) {
    const kinds = [];
    const target = w.targetPrice;
    if (target && best.price <= target && !(prev && prev <= target && best.price >= prev))
      kinds.push(["target", `Cena w Twoim budżecie (≤ ${fmtPrice(target, w.currency)})!`]);
    if (prev && w.dropPct && best.price <= prev * (1 - w.dropPct / 100))
      kinds.push(["drop", `Spadek ceny o ${Math.round(100 * (1 - best.price / prev))}% (było ${fmtPrice(prev, w.currency)})`]);
    if (kinds.length) {
      const top = h.last.offers.slice(0, 5).map((o) => "• " + fmtOffer(o)).join("\n");
      const since = Date.now() - 90 * 86400000;
      const min90 = Math.min(...h.scans.filter((x) => Date.parse(x.t) >= since).map((x) => x.min));
      let text = `✈️ ${w.name}: ${fmtPrice(best.price, w.currency)}\n${kinds.map((k) => k[1]).join("\n")}\n\nNajtaniej teraz:\n${top}`;
      text += `\n\nNajniżej z 90 dni: ${fmtPrice(min90, w.currency)}`;
      if (best.link) text += `\n\nKup: ${best.link}`;
      if (siteUrl) text += `\nPanel: ${siteUrl}/#w${id}`;
      let delivered = "tylko w panelu";
      try { delivered = (await tgSend(s, text)) || delivered; } catch (e) { delivered = `błąd Telegrama: ${e.message}`; }
      h.alerts.unshift({ t: started, price: best.price, kinds: kinds.map((k) => k[0]), text, delivered });
      h.alerts = h.alerts.slice(0, 50);
    }
  }
  await saveHistory(id, h);

  const fresh = (await getWatch(id)) || w; // mogła zostać edytowana w trakcie
  Object.assign(fresh, { lastScanAt: started, lastMin: best ? best.price : prev, lastError: res.errors.slice(0, 5).join("\n") || null,
    lastQueries: res.queries, scanningSince: null });
  await saveWatch(fresh);
  return { id, queries: res.queries, results: offers.length, min: best?.price ?? null, errors: res.errors.slice(0, 5) };
}

export function isDue(w, now = Date.now()) {
  if (!w.active) return false;
  if (!w.lastScanAt) return true;
  return Date.parse(w.lastScanAt) + w.intervalHours * 3600000 - 5 * 60000 <= now;
}
