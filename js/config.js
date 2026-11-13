// Runtime settings. DEFAULT_ASK_URL is filled in task 21 with the deployed Supabase function URL.
const DEFAULT_ASK_URL = "https://vxwmhsgxoomcbiukeinp.supabase.co/functions/v1/luxembourg-monitor-ask";
const params = new URLSearchParams(location.search);
const ask = params.get("ask");

// Welcome-screen log (first and last name): ?visit=<url> points to a local function, ?visit=off disables the log.
const DEFAULT_VISIT_URL = "https://vxwmhsgxoomcbiukeinp.supabase.co/functions/v1/luxembourg-monitor-visit";
const visit = params.get("visit");
export const VISIT_URL = visit === "off" ? "" : (visit || DEFAULT_VISIT_URL);
export const ASK_URL = ask === "off" ? "" : (ask || DEFAULT_ASK_URL);
export const KIOSK = params.has("kiosk");
export const VIDEO = params.has("video");
export const ASK_TIMEOUT_MS = 15000;
export const IDLE_MS = 60000;
export const FACT_MS = 8000;
export const PUBLIC_URL = "https://mge-agilos.github.io/LuxembourgMonitor/";
