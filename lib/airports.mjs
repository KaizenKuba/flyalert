import data from "./airports-data.mjs";

export const { airports: AIRPORTS, groups: GROUPS, countries: COUNTRIES, regions: REGIONS } = data;

export function resolve(tokens) {
  const out = [];
  for (const raw of tokens || []) {
    const t = String(raw).trim().toUpperCase();
    if (!t) continue;
    if (GROUPS[t]) out.push(...GROUPS[t]);
    else if (/^[A-Z]{3}$/.test(t)) out.push(t);
    else throw new Error(`Nieznane lotnisko/kraj/region: ${raw}`);
  }
  return [...new Set(out)];
}

export function catalog() {
  const items = [];
  for (const [k, codes] of Object.entries(GROUPS)) {
    if (COUNTRIES[k]) items.push({ token: k, label: COUNTRIES[k], sub: `cały kraj · ${codes.length} lotn.`, kind: "kraj" });
    else items.push({ token: k, label: REGIONS[k] || k, sub: `region · ${codes.length} lotn.`, kind: "region" });
  }
  for (const a of Object.values(AIRPORTS))
    items.push({ token: a.code, label: `${a.city}`, sub: `${a.code} · ${COUNTRIES[a.country] || a.country}`, kind: "lotnisko" });
  return items;
}

export const label = (c) => (AIRPORTS[c] ? `${AIRPORTS[c].city} (${c})` : c);
