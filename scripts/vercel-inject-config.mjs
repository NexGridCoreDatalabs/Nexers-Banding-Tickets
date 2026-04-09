/**
 * Writes root config.js for Vercel deployments from environment variables.
 * Set in Vercel: Project → Settings → Environment Variables.
 * Local: skips unless VERCEL=1 or FORCE_VERCEL_CONFIG=1 so your hand-made config.js is preserved.
 */
import { writeFileSync } from 'fs';

const runInject = process.env.VERCEL === '1' || process.env.CI === 'true' || process.env.FORCE_VERCEL_CONFIG === '1';

if (!runInject) {
  console.log('[vercel-inject-config] Skip (set VERCEL=1 or FORCE_VERCEL_CONFIG=1 to generate config.js).');
  process.exit(0);
}

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_ANON_KEY || '').trim();

if (!supabaseUrl || !supabaseKey) {
  console.error('[vercel-inject-config] Missing SUPABASE_URL or SUPABASE_ANON_KEY.');
  console.error('Add them in Vercel → Project → Settings → Environment Variables (all environments you deploy).');
  process.exit(1);
}

const vercelHost = (process.env.VERCEL_URL || '').trim();
const scanBase =
  (process.env.SCAN_BASE_URL || '').trim() ||
  (vercelHost ? `https://${vercelHost}` : '');

const screenshotGuard = process.env.SCREENSHOT_GUARD !== 'false';

const cfg = {
  GENERATOR_PASSWORD: (process.env.GENERATOR_PASSWORD || '').trim(),
  GOOGLE_SHEET_ID: (process.env.GOOGLE_SHEET_ID || '').trim(),
  GOOGLE_API_KEY: (process.env.GOOGLE_API_KEY || '').trim(),
  GOOGLE_APPS_SCRIPT_URL: (process.env.GOOGLE_APPS_SCRIPT_URL || '').trim(),
  SCAN_BASE_URL: scanBase,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: supabaseKey,
  SCREENSHOT_GUARD: screenshotGuard,
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

const banner = '/* Generated at build time for Vercel. Do not commit. */\n';
writeFileSync(new URL('../config.js', import.meta.url), banner + 'window.BANDFLOW_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n', 'utf8');

console.log('[vercel-inject-config] Wrote config.js (Supabase URL present:', !!supabaseUrl, ').');
