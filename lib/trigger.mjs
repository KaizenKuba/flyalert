import { authState } from "./store.mjs";
import { scanWatch } from "./scanner.mjs";

// Uruchamia skan w tle (funkcja *-background ma do 15 minut). Lokalnie: od razu w procesie.
export async function triggerScan(origin, ids) {
  if (!ids.length) return;
  if (process.env.FLYALERT_LOCAL_STORE) {
    (async () => { for (const id of ids) await scanWatch(id, { siteUrl: origin }); })();
    return;
  }
  const auth = await authState();
  const r = await fetch(`${origin}/internal/scan`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, secret: auth?.internal }),
  });
  if (r.status >= 400) throw new Error(`Nie udało się uruchomić skanu (HTTP ${r.status})`);
}
