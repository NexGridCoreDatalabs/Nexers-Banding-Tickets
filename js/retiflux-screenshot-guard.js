/**
 * RetiFlux™ — best-effort screen capture / reproduction deterrence (browser only).
 *
 * Like GPS geofencing, this cannot be cryptographically enforced in a normal web page:
 * OS-level screenshots, external cameras, and remote desktop are outside the browser’s control.
 * For strong protection use a native shell or Android WebView with FLAG_SECURE (or iOS equivalent).
 *
 * What we do here: intercept common shortcut paths where events reach the page, discourage printing
 * the UI as PDF, and surface a clear policy toast. Disable via BANDFLOW_CONFIG.SCREENSHOT_GUARD = false
 * or URL ?allow_capture=1
 */
(function(global) {
  function bypassed() {
    try {
      var p = new URLSearchParams(global.location.search);
      if (p.get('allow_capture') === '1') return true;
      if (p.get('screenshot_bypass') === '1') return true;
    } catch (e0) {}
    try {
      if (global.sessionStorage && global.sessionStorage.getItem('retiflux_allow_capture') === '1') return true;
    } catch (e1) {}
    var cfg = global.BANDFLOW_CONFIG || {};
    if (cfg.SCREENSHOT_GUARD === false) return true;
    return false;
  }

  var lastToast = 0;
  function toast(msg) {
    var now = Date.now();
    if (now - lastToast < 4000) return;
    lastToast = now;
    var id = 'retiflux-screenshot-toast';
    var ex = document.getElementById(id);
    if (ex) try { ex.remove(); } catch (e2) {}
    var d = document.createElement('div');
    d.id = id;
    d.setAttribute('role', 'alert');
    d.textContent = msg;
    d.style.cssText = [
      'position:fixed', 'top:20px', 'left:50%', 'transform:translateX(-50%)', 'z-index:2147483646',
      'padding:12px 20px', 'background:rgba(15,23,42,.97)', 'border:2px solid #fbbf24', 'color:#e2e8f0',
      'font:600 13px system-ui,Segoe UI,sans-serif', 'border-radius:10px', 'max-width:min(92vw,420px)',
      'text-align:center', 'box-shadow:0 8px 32px rgba(0,0,0,.45)', 'pointer-events:none'
    ].join(';');
    if (document.body) document.body.appendChild(d);
    else return;
    setTimeout(function() { try { d.remove(); } catch (e3) {} }, 5000);
  }

  function onKey(ev) {
    if (bypassed()) return;
    var k = ev.key || '';
    var code = ev.code || '';
    var keyCode = ev.keyCode;
    var pr = (k === 'PrintScreen' || code === 'PrintScreen' || keyCode === 44);
    if (pr) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (e4) {}
      toast('Screen capture shortcuts are restricted on this app. Use official exports only.');
    }
  }

  function injectPrintGuard() {
    if (document.getElementById('retiflux-print-guard-style')) return;
    var st = document.createElement('style');
    st.id = 'retiflux-print-guard-style';
    st.textContent =
      '@media print {' +
      '  body.retiflux-guard-print * { visibility: hidden !important; }' +
      '  body.retiflux-guard-print::after {' +
      '    content: "RetiFlux™ — printing / PDF export of this screen is not permitted. Use approved reports or ask IT.";' +
      '    visibility: visible !important; display: block !important;' +
      '    position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%);' +
      '    font: 600 14px system-ui, Segoe UI, sans-serif; color: #0f172a; text-align: center; max-width: 90%;' +
      '  }' +
      '}';
    document.head.appendChild(st);
  }

  function onBeforePrint() {
    if (bypassed()) return;
    document.documentElement.classList.add('retiflux-guard-print');
    document.body.classList.add('retiflux-guard-print');
    toast('Printing or Save-as-PDF of this screen is restricted.');
  }

  function onAfterPrint() {
    document.documentElement.classList.remove('retiflux-guard-print');
    document.body.classList.remove('retiflux-guard-print');
  }

  function init() {
    if (bypassed()) return;
    injectPrintGuard();
    global.addEventListener('keydown', onKey, true);
    global.addEventListener('keyup', onKey, true);
    global.addEventListener('beforeprint', onBeforePrint);
    global.addEventListener('afterprint', onAfterPrint);
  }

  global.RetiFluxScreenshotGuard = {
    bypassed: bypassed,
    /** Call for training / support: sessionStorage retiflux_allow_capture = 1 until tab closes */
    allowCaptureThisSession: function() {
      try { global.sessionStorage.setItem('retiflux_allow_capture', '1'); } catch (e6) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
