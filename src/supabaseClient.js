import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// A valid-looking URL is required before we even attempt createClient — passing an empty or
// malformed string throws synchronously at import time, which crashes the entire page to a
// blank white screen before React ever gets to render anything (no error boundary can catch
// a module-load-time throw). Checking first lets the app show a real error screen instead.
function looksLikeUrl(v) {
  try { new URL(v); return true; } catch { return false; }
}

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && looksLikeUrl(supabaseUrl));

if (!supabaseConfigured) {
  console.error(
    "Missing or invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
    "Set these in a .env file before running `npm run build` (Netlify Drop deploys a pre-built " +
    "bundle, so dashboard environment variables won't reach it — you must rebuild locally with " +
    "the real values and re-drop the new dist folder), or in Netlify's Environment Variables " +
    "settings if your site builds from a connected Git repo."
  );
}

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

