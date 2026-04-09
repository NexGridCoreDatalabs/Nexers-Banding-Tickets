/**
 * RetiFlux™ — shared sign-in session (sessionStorage, same tab).
 * Used by highway sign-in → role-based redirect, and optional restore on app pages.
 */
(function(global) {
  var KEY = 'retiflux_user_session';
  global.RetiFluxAuthSession = {
    KEY: KEY,
    read: function() {
      try {
        var raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    write: function(u) {
      if (!u || !u.user_id) return;
      sessionStorage.setItem(KEY, JSON.stringify({
        user_id: u.user_id,
        name: u.name || '',
        role: (u.role || '').trim(),
        assigned_zone: u.assigned_zone != null ? u.assigned_zone : null,
        loginAt: new Date().toISOString()
      }));
    },
    clear: function() {
      sessionStorage.removeItem(KEY);
    }
  };
})(typeof window !== 'undefined' ? window : this);
