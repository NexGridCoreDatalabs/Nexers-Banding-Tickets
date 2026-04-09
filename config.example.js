/**
 * BANDFLOW / RetiFlux SECURE CONFIGURATION TEMPLATE
 *
 * Local dev: copy to config.js and fill in (config.js is gitignored).
 *
 * Vercel: do NOT commit secrets. Set the same values as env vars — see deploy/env.example.
 * Build runs scripts/vercel-inject-config.mjs and writes config.js on Vercel only.
 *
 * Env names (Vercel Dashboard → Environment Variables):
 *   SUPABASE_URL, SUPABASE_ANON_KEY  (required)
 *   GENERATOR_PASSWORD, GOOGLE_SHEET_ID, GOOGLE_API_KEY, GOOGLE_APPS_SCRIPT_URL, SCAN_BASE_URL (optional)
 *   SCREENSHOT_GUARD = true | false
 */

window.BANDFLOW_CONFIG = {
  GENERATOR_PASSWORD: 'CHANGE_THIS_TO_SECURE_PASSWORD',
  GOOGLE_SHEET_ID: 'YOUR_GOOGLE_SHEET_ID_HERE',
  GOOGLE_API_KEY: 'YOUR_GOOGLE_API_KEY_HERE',
  GOOGLE_APPS_SCRIPT_URL: 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',
  SCAN_BASE_URL: 'https://yourdomain.com/bandingtickets.html',
  SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY_HERE',
  /** Best-effort screenshot / print deterrence in the browser (not absolute; see js/retiflux-screenshot-guard.js). Set false to disable. */
  SCREENSHOT_GUARD: true,
  SECURITY: {
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000,
    SESSION_TIMEOUT: 30 * 60 * 1000,
    DEBUG_MODE: false
  },
  API: {
    TIMEOUT: 30000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000
  }
};
