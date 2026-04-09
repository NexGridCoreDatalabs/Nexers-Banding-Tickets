/**
 * RetiFlux™ - Shared core utilities for fragmented app pages
 * Config, auth helpers, fetch, base URL
 */
(function() {
    if (typeof window.RetifluxCore !== 'undefined') return;
    var CONFIG = window.BANDFLOW_CONFIG || {};
    window.RetifluxCore = {
        CONFIG: CONFIG,
        getSheetId: function() { return CONFIG.GOOGLE_SHEET_ID || localStorage.getItem('googleSheetId') || ''; },
        getApiKey: function() { return CONFIG.GOOGLE_API_KEY || localStorage.getItem('googleApiKey') || ''; },
        getAppsScriptUrl: function() { return CONFIG.GOOGLE_APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbxVjIcc8M5_5bsqcnsyyE0SBWYa7AUVU3ws4bl70loqacX9GsS_ZvVifF3kG9GcGcmfmg/exec'; },
        getScanBaseUrl: function() {
            var cfg = window.BANDFLOW_CONFIG || {};
            /** Public deploy root (origin + /). Legacy values ending in bandingtickets.html are normalized. */
            function toPublicOrigin(u) {
                if (!u || !String(u).trim()) return '';
                try {
                    return new URL(String(u).trim().split('?')[0]).origin + '/';
                } catch (e) {
                    return '';
                }
            }
            if (cfg.SCAN_BASE_URL && String(cfg.SCAN_BASE_URL).trim()) {
                return toPublicOrigin(cfg.SCAN_BASE_URL);
            }
            var host = typeof location !== 'undefined' ? location.hostname : '';
            var isLocal = host === 'localhost' || host === '127.0.0.1';
            var stored = localStorage.getItem('scanBaseUrl');
            if (stored && !isLocal && (stored.indexOf('localhost') >= 0 || stored.indexOf('127.0.0.1') >= 0)) {
                try { localStorage.removeItem('scanBaseUrl'); } catch (e) {}
                stored = null;
            }
            var fallback = 'https://retifluxtm.vercel.app/';
            if (stored && String(stored).trim()) {
                var o = toPublicOrigin(stored);
                if (o) {
                    try {
                        var sh = new URL(o).hostname;
                        if ((sh === 'localhost' || sh === '127.0.0.1') && !isLocal) return fallback;
                    } catch (e) {}
                    return o;
                }
            }
            if (typeof location !== 'undefined') {
                var loc = location;
                if (loc.protocol === 'file:') return fallback;
                return loc.origin + '/';
            }
            return fallback;
        },
        escapeHtml: function(v) {
            if (v == null) return '';
            return String(v).replace(/[&<>"']/g, function(c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; });
        },
        whenLoaded: function(fn) {
            if (document.readyState === 'complete') setTimeout(fn, 0);
            else window.addEventListener('load', fn, { once: true });
        }
    };
})();
