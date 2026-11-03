// Co godzinę: uruchamia skan obserwacji, których czas nadszedł.
import { listWatches, saveWatch } from "../../lib/store.mjs";
import { isDue } from "../../lib/scanner.mjs";
import { triggerScan } from "../../lib/trigger.mjs";

export default async (req, context) => {
  const origin = context?.site?.url || process.env.URL;
  const due = (await listWatches()).filter((w) => isDue(w));
  for (const w of due) { w.scanningSince = new Date().toISOString(); await saveWatch(w); }
  console.log("due:", due.map((w) => w.id));
  if (due.length) await triggerScan(origin, due.map((w) => w.id));
};

export const config = { schedule: "@hourly" };
