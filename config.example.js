/**
 * BANDFLOW SECURE CONFIGURATION TEMPLATE
 * 
 * SECURITY INSTRUCTIONS:
 * 1. Copy this file to config.js (DO NOT commit config.js to git)
 * 2. Fill in your actual credentials
 * 3. Add config.js to .gitignore
 * 4. Never share config.js or commit it to version control
 */

window.BANDFLOW_CONFIG = {
  GENERATOR_PASSWORD: 'CHANGE_THIS_TO_SECURE_PASSWORD',
  GOOGLE_SHEET_ID: 'YOUR_GOOGLE_SHEET_ID_HERE',
  GOOGLE_API_KEY: 'YOUR_GOOGLE_API_KEY_HERE',
  GOOGLE_APPS_SCRIPT_URL: 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',
  SCAN_BASE_URL: 'https://yourdomain.com/bandingtickets.html',
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
