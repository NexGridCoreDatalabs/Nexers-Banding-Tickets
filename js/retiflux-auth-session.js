/**
 * RetiFlux™ — shared sign-in session.
 *
 * Storage  : localStorage (survives tab close, app switch, OS killing Chrome)
 * Expiry   : shift-based — valid only within the current 12-hour shift window
 *            Day shift   07:00–19:00 EAT
 *            Night shift 19:00–07:00 EAT
 * On shift change the stored session is silently ignored so the next clerk
 * must sign in fresh.
 */
(function(global) {
  var KEY = 'retiflux_user_session';
  var EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

  /**
   * Returns the start of the current shift as a UTC ISO string.
   * Day  shift : today    07:00 EAT = 04:00 UTC
   * Night shift: yesterday 19:00 EAT = 16:00 UTC  (when EAT hour < 7)
   *              today     19:00 EAT = 16:00 UTC  (when EAT hour >= 19)
   */
  function currentShiftStartISO() {
    var nowUtc  = new Date();
    var eatHour = new Date(nowUtc.getTime() + EAT_OFFSET_MS).getUTCHours();

    // Build a base date at midnight UTC for the EAT calendar date
    var eatNow   = new Date(nowUtc.getTime() + EAT_OFFSET_MS);
    var midUtc   = Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth(), eatNow.getUTCDate());

    var shiftStartUtc;
    if (eatHour >= 7 && eatHour < 19) {
      // Day shift — 07:00 EAT = 04:00 UTC same day
      shiftStartUtc = midUtc + 4 * 3600000;
    } else if (eatHour >= 19) {
      // Night shift — 19:00 EAT = 16:00 UTC same day
      shiftStartUtc = midUtc + 16 * 3600000;
    } else {
      // 00:00–06:59 EAT — still on last night's shift (started yesterday 19:00 EAT)
      shiftStartUtc = midUtc - 8 * 3600000; // 16:00 UTC previous day
    }
    return new Date(shiftStartUtc).toISOString();
  }

  global.RetiFluxAuthSession = {
    KEY: KEY,

    read: function() {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !obj.user_id) return null;

        // Validate: session must have been written during the current shift window
        var sessionShiftStart = obj.shiftStart;
        if (!sessionShiftStart) return null;        // old format — force re-login
        if (sessionShiftStart !== currentShiftStartISO()) return null; // shift changed

        return obj;
      } catch (e) {
        return null;
      }
    },

    write: function(u) {
      if (!u || !u.user_id) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({
          user_id:       u.user_id,
          name:          u.name          || '',
          role:          (u.role || '').trim(),
          assigned_zone: u.assigned_zone != null ? u.assigned_zone : null,
          shiftStart:    currentShiftStartISO(),
          loginAt:       new Date().toISOString()
        }));
      } catch (e) { /* localStorage unavailable — non-fatal */ }
    },

    clear: function() {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };
})(typeof window !== 'undefined' ? window : this);
