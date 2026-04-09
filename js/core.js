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
            var base = localStorage.getItem('scanBaseUrl') || 'https://nexgridcoredatalabs.github.io/Nexers-Banding-Tickets/bandingtickets.html';
            if (!localStorage.getItem('scanBaseUrl') && typeof location !== 'undefined') {
                var o = location;
                if (o.hostname === 'localhost' || o.hostname === '127.0.0.1') base = o.origin + o.pathname.replace(/\/[^/]*$/, '/bandingtickets.html');
                else if (o.protocol !== 'file:') base = o.origin + o.pathname.replace(/\/[^/]*$/, '/bandingtickets.html');
            }
            return base;
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
