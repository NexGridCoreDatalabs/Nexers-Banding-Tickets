/**
 * RetiFlux™ — canonical QR / scan URL helpers for the deployed app (app/*.html, PRT print).
 * Load after config.js. Uses BANDFLOW_CONFIG.SCAN_BASE_URL; never encodes localhost when
 * generating QRs from a local dev tab (phones cannot open your PC).
 */
(function () {
    if (window.RetifluxQr) return;
    var FALLBACK_ORIGIN = 'https://retifluxtm.vercel.app';

    function cfgOrigin() {
        var cfg = window.BANDFLOW_CONFIG || {};
        if (!cfg.SCAN_BASE_URL || !String(cfg.SCAN_BASE_URL).trim()) return '';
        try {
            return new URL(String(cfg.SCAN_BASE_URL).trim().split('?')[0]).origin;
        } catch (e) {
            return '';
        }
    }

    function hostIsLocal(h) {
        return h === 'localhost' || h === '127.0.0.1';
    }

    /**
     * Public site origin for encoded QR links (no trailing slash).
     */
    function publicOrigin() {
        var o = cfgOrigin();
        if (o) return o;
        if (typeof location !== 'undefined' && location.protocol !== 'file:' && !hostIsLocal(location.hostname || '')) {
            return location.origin;
        }
        return FALLBACK_ORIGIN;
    }

    /**
     * Scan opens View Ticket (app/view.html → ticket-view). Never adds geofence bypass — on-site GPS is required.
     */
    function ticketViewScanUrl(serial) {
        return publicOrigin() + '/app/view.html?serial=' + encodeURIComponent(serial == null ? '' : String(serial));
    }

    /**
     * Deep link under /app/ on the same public origin (e.g. order detail).
     */
    function appUrl(pathWithQuery) {
        var p = pathWithQuery.charAt(0) === '/' ? pathWithQuery : '/' + pathWithQuery;
        return publicOrigin() + p;
    }

    window.RetifluxQr = {
        publicOrigin: publicOrigin,
        ticketViewScanUrl: ticketViewScanUrl,
        appUrl: appUrl
    };
})();
