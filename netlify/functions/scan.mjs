// Funkcja w tle (do 15 min, Netlify od razu odpowiada 202): skanuje wskazane obserwacje.
import { authState } from "../../lib/store.mjs";
import { scanWatch } from "../../lib/scanner.mjs";

export default async (req, context) => {
  const { ids = [], secret } = await req.json().catch(() => ({}));
  const auth = await authState();
  if (!auth || secret !== auth.internal) return new Response("forbidden", { status: 403 });
  const origin = context?.site?.url || process.env.URL || new URL(req.url).origin;
  for (const id of ids) {
    try { console.log("scan", id, JSON.stringify(await scanWatch(id, { siteUrl: origin }))); }
    catch (e) { console.error("scan failed", id, e); }
  }
};

export const config = { background: true, path: "/internal/scan" };
