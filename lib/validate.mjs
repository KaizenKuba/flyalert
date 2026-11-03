import { resolve } from "./airports.mjs";

const isoDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "") || isNaN(Date.parse(s + "T00:00:00Z")) ||
      new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s) throw new Error(`Nieprawidłowa data: ${s}`);
  return s;
};

export function validateWatch(p, old = {}) {
  const w = { ...old };
  for (const k of ["origins", "destinations"]) {
    if (p[k] !== undefined || !old[k]) {
      const v = (Array.isArray(p[k]) ? p[k] : String(p[k] || "").split(/[\s,;]+/)).map((t) => String(t).trim().toUpperCase()).filter(Boolean);
      if (!v.length) throw new Error(k === "origins" ? "Wybierz, skąd lecisz." : "Wybierz, dokąd lecisz.");
      resolve(v);
      w[k] = v;
    }
  }
  if (p.dateFrom !== undefined || !old.dateFrom) w.dateFrom = isoDate(p.dateFrom);
  if (p.dateTo !== undefined || !old.dateTo) w.dateTo = isoDate(p.dateTo);
  if (w.dateFrom > w.dateTo) throw new Error("Data „od” jest późniejsza niż „do”.");
  const num = (v, d) => (v === undefined || v === "" || v === null ? d : Number(v));
  w.oneWay = p.oneWay !== undefined ? !!p.oneWay : !!old.oneWay;
  w.directOnly = p.directOnly !== undefined ? !!p.directOnly : !!old.directOnly;
  w.nightsMin = num(p.nightsMin, old.nightsMin ?? 5);
  w.nightsMax = num(p.nightsMax, old.nightsMax ?? 10);
  if (!w.oneWay && w.nightsMin > w.nightsMax) throw new Error("Minimalny pobyt jest dłuższy niż maksymalny.");
  w.targetPrice = p.targetPrice !== undefined ? (p.targetPrice === "" || p.targetPrice === null ? null : Number(p.targetPrice)) : old.targetPrice ?? null;
  w.dropPct = num(p.dropPct, old.dropPct ?? 5);
  w.currency = String(p.currency || old.currency || "PLN").toUpperCase();
  w.intervalHours = Math.max(1, num(p.intervalHours, old.intervalHours ?? 6));
  w.active = p.active !== undefined ? !!p.active : old.active ?? true;
  w.name = String(p.name || old.name || `${w.origins.join(", ")} → ${w.destinations.join(", ")}`).slice(0, 80);
  for (const k of ["nightsMin", "nightsMax", "dropPct", "intervalHours"]) if (!Number.isFinite(w[k])) throw new Error(`Błędna wartość: ${k}`);
  if (w.targetPrice !== null && !Number.isFinite(w.targetPrice)) throw new Error("Błędna cena docelowa.");
  return w;
}
