/**
 * RetiFlux™ — Performance markers for load timing
 * Use performance.mark() / performance.measure() for DevTools profiling.
 */
(function() {
  if (typeof performance === 'undefined' || !performance.mark) return;
  var page = (document.title || 'unknown').replace(/RetiFlux™\s*·?\s*/i, '').replace(/\s*-\s*.*$/, '') || 'page';
  var safe = page.replace(/[^a-z0-9]/gi, '_').slice(0, 30);
  try {
    performance.mark('rf-load-start');
    if (document.readyState === 'complete') {
      performance.mark('rf-dom-ready');
    } else {
      window.addEventListener('DOMContentLoaded', function() {
        performance.mark('rf-dom-ready');
        performance.measure('rf-dom-' + safe, 'rf-load-start', 'rf-dom-ready');
      });
    }
    window.addEventListener('load', function() {
      performance.mark('rf-load-end');
      performance.measure('rf-full-' + safe, 'rf-load-start', 'rf-load-end');
    });
    window.rfPerfMark = function(name) {
      try {
        performance.mark('rf-' + name);
        performance.measure('rf-' + name + '-' + safe, 'rf-load-start', 'rf-' + name);
      } catch (_) {}
    };
  } catch (_) {}
})();
