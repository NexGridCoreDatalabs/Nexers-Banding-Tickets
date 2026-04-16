/**
 * RetiFlux™ — Bluetooth Thermal Printer Module
 *
 * Protocol  : ESC/POS (standard thermal printer command set)
 * Transport : Web Bluetooth API (Chrome Android 56+)
 * BLE Service UUID  : 49535343-fe7d-4ae5-8fa9-9fafd205e455  (Microchip ISSC UART)
 * Write Char UUID   : 49535343-8841-43f4-a8d4-ecbe34729bb3
 *
 * Usage:
 *   RetiFluxBTPrint.isSupported()          → boolean
 *   await RetiFluxBTPrint.print(printData) → resolves when done, throws on error
 *   RetiFluxBTPrint.disconnect()           → clean disconnect
 *
 * printData shape (same object used by the popup print page):
 *   serial, productName, variant, sku, qty, uom, batchLot,
 *   mfgDate, expiryDate, line, shift, recordedBy,
 *   palletColor, notes, palletConfig, shelfLife
 */
(function (global) {
  'use strict';

  var SERVICE_UUID    = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
  var WRITE_CHAR_UUID = '49535343-8841-43f4-a8d4-ecbe34729bb3'; // preferred; auto-fallback if absent
  var CHUNK_MS        = 50;   // delay between BLE write chunks (ms) — conservative for reliability
  var CHUNK_SIZE      = 20;   // bytes per chunk — BLE safe minimum (MTU 23 - 3 ATT header)

  var _device    = null;
  var _char      = null;
  var _writeMode = 'withResponse'; // 'withResponse' | 'withoutResponse'

  // ── BLE connection ──────────────────────────────────────────────────────────

  function isSupported() {
    return !!(navigator && navigator.bluetooth && navigator.bluetooth.requestDevice);
  }

  // Resolve the best writable characteristic from a connected GATT service.
  // Prefers the known ISSC UUID; falls back to any char with write capability.
  async function resolveWriteChar(server) {
    var service = await server.getPrimaryService(SERVICE_UUID);
    var chars   = await service.getCharacteristics();

    var preferred = null, fallback = null;
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      var canWrite = (c.properties.write || c.properties.writeWithoutResponse);
      if (!canWrite) continue;
      if (c.uuid === WRITE_CHAR_UUID) { preferred = c; break; }
      if (!fallback) fallback = c;
    }

    var chosen = preferred || fallback;
    if (!chosen) throw new Error('No writable characteristic found on printer. Verify the printer is on and in range.');

    // Determine write mode from actual characteristic properties
    _writeMode = chosen.properties.write ? 'withResponse' : 'withoutResponse';
    return chosen;
  }

  async function connect() {
    if (_char && _device && _device.gatt.connected) return _char;

    // Device known but GATT dropped — try silent reconnect
    if (_device && !_device.gatt.connected) {
      try {
        var srv = await _device.gatt.connect();
        _char   = await resolveWriteChar(srv);
        return _char;
      } catch (e) {
        _device = null; _char = null;
      }
    }

    // Fresh pairing — show all nearby BLE devices.
    // Thermal printers don't advertise service UUIDs in beacons;
    // services are only visible after connecting.
    var device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID]
    });
    device.addEventListener('gattserverdisconnected', function () {
      _char = null; // keep _device for silent reconnect
    });
    var server = await device.gatt.connect();
    var char   = await resolveWriteChar(server);
    _device = device;
    _char   = char;
    return char;
  }

  async function writeChunk(char, chunk) {
    // Try the method indicated by the characteristic's properties first,
    // then fall through the chain so a wrong assumption never silently fails.
    if (_writeMode === 'withResponse') {
      if (char.writeValueWithResponse) {
        return char.writeValueWithResponse(chunk);
      }
      if (char.writeValue) {
        return char.writeValue(chunk); // older Chrome API
      }
    }
    // withoutResponse path (or fallback)
    if (char.writeValueWithoutResponse) {
      return char.writeValueWithoutResponse(chunk);
    }
    // Last resort — older Chrome
    return char.writeValue(chunk);
  }

  async function writeBytes(uint8) {
    var char = await connect();
    for (var i = 0; i < uint8.length; i += CHUNK_SIZE) {
      var chunk = uint8.slice(i, i + CHUNK_SIZE);
      await writeChunk(char, chunk);
      if (i + CHUNK_SIZE < uint8.length) {
        await new Promise(function (r) { setTimeout(r, CHUNK_MS); });
      }
    }
  }

  function disconnect() {
    if (_device && _device.gatt && _device.gatt.connected) {
      try { _device.gatt.disconnect(); } catch (e) {}
    }
    _device = null;
    _char   = null;
  }

  // ── ESC/POS primitives ──────────────────────────────────────────────────────

  var ESC = 0x1B, GS = 0x1D, LF = 0x0A;

  function cat() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      for (var j = 0; j < a.length; j++) out.push(a[j]);
    }
    return out;
  }

  function str(s, maxLen) {
    s = String(s || '');
    if (maxLen) s = s.slice(0, maxLen);
    var b = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      b.push(c < 128 ? c : 0x3F); // non-ASCII → '?'
    }
    return b;
  }

  function ln(s, maxLen) { return cat(str(s, maxLen), [LF]); }

  function pad(label, width) {
    label = String(label || '');
    return label + ' '.repeat(Math.max(0, width - label.length));
  }

  function divider(ch, w) { return ln((ch || '\u2500').repeat(w || 42)); }

  var INIT        = [ESC, 0x40];
  var ALIGN_CTR   = [ESC, 0x61, 0x01];
  var ALIGN_LEFT  = [ESC, 0x61, 0x00];
  var BOLD_ON     = [ESC, 0x45, 0x01];
  var BOLD_OFF    = [ESC, 0x45, 0x00];
  var DBL_SIZE_ON = [GS,  0x21, 0x11]; // 2× width + height
  var DBL_WID_ON  = [GS,  0x21, 0x10]; // 2× width only
  var NORMAL_SIZE = [GS,  0x21, 0x00];

  function feed(n) { return [ESC, 0x64, (n || 1)]; }

  // Partial cut with 3-line feed
  var CUT = [GS, 0x56, 0x42, 0x03];

  // ESC/POS QR Code (GS ( k model 2, size 6, error M)
  function qrBlock(data) {
    var d = str(data);
    var dLen = d.length + 3;
    var pL   = dLen & 0xFF;
    var pH   = (dLen >> 8) & 0xFF;
    return cat(
      [GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00], // set model 2
      [GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x07],         // cell size 7 (bigger QR)
      [GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31],         // error level M
      [GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30],             // store data header
      d,                                                        // data bytes
      [GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]          // print QR
    );
  }

  // ── Label layout ────────────────────────────────────────────────────────────

  var W = 42; // chars per line at default font on 80mm paper

  function buildLabel(d) {
    var serial     = String(d.serial      || '').toUpperCase();
    var name       = String(d.productName || d.sku || '').toUpperCase();
    var variant    = String(d.variant     || '').toUpperCase();
    var sku        = String(d.sku         || '').toUpperCase();
    var qty        = String(d.qty         || '') + (d.uom ? ' ' + String(d.uom).toUpperCase() : '');
    var batch      = String(d.batchLot    || '\u2014');
    var mfg        = String(d.mfgDate     || '\u2014');
    var exp        = String(d.expiryDate  || '\u2014');
    var line       = String(d.line        || '\u2014').toUpperCase();
    var shiftRaw   = String(d.shift       || '').replace(/\s*\(DS\)/i, ' DAY').replace(/\s*\(NS\)/i, ' NIGHT');
    var shift      = shiftRaw.toUpperCase() || '\u2014';
    var by         = String(d.recordedBy  || '\u2014').toUpperCase();
    var color      = String(d.palletColor || '').toUpperCase();
    var notes      = String(d.notes       || '').trim();
    var cfg        = String(d.palletConfig|| '').trim();
    var shelf      = String(d.shelfLife   || '').trim();

    var B = [];

    // ── Brand header ──
    B = cat(B, INIT);
    B = cat(B, ALIGN_CTR, BOLD_ON, DBL_WID_ON);
    B = cat(B, ln('RETIFLUX(TM) PRT', W));
    B = cat(B, NORMAL_SIZE, BOLD_OFF);

    // ── Serial (large) ──
    B = cat(B, ALIGN_CTR, BOLD_ON, DBL_SIZE_ON);
    B = cat(B, ln(serial, W));
    B = cat(B, NORMAL_SIZE, BOLD_OFF);
    B = cat(B, feed(1));

    // ── QR Code ──
    B = cat(B, ALIGN_CTR);
    B = cat(B, qrBlock(serial));
    B = cat(B, feed(1));

    // ── Product ──
    B = cat(B, divider('\u2500', W));
    B = cat(B, ALIGN_CTR, BOLD_ON, DBL_WID_ON);
    B = cat(B, ln(name.slice(0, W)));
    B = cat(B, NORMAL_SIZE, BOLD_OFF);
    if (variant) {
      B = cat(B, ALIGN_CTR);
      B = cat(B, ln(variant.slice(0, W)));
    }

    B = cat(B, ALIGN_LEFT);
    B = cat(B, ln(pad('SKU:',  8) + sku.slice(0, W - 8)));
    B = cat(B, ln(pad('QTY:',  8) + qty.slice(0, W - 8)));

    // ── Pallet config / shelf life ──
    if (cfg)   B = cat(B, ln(pad('CONFIG:', 8) + cfg.slice(0, W - 8)));
    if (shelf) B = cat(B, ln(pad('SHELF:',  8) + shelf.slice(0, W - 8)));

    // ── Batch & dates ──
    B = cat(B, divider('\u2500', W));
    B = cat(B, ln(pad('BATCH:', 8) + batch.slice(0, W - 8)));
    B = cat(B, ln(pad('MFG:',   8) + mfg.slice(0, W - 8)));
    B = cat(B, ln(pad('EXP:',   8) + exp.slice(0, W - 8)));

    // ── Production ──
    B = cat(B, divider('\u2500', W));
    B = cat(B, ln(pad('LINE:',   8) + line.slice(0, W - 8)));
    B = cat(B, ln(pad('SHIFT:',  8) + shift.slice(0, W - 8)));
    B = cat(B, ln(pad('BY:',     8) + by.slice(0, W - 8)));
    if (color) B = cat(B, ln(pad('PALLET:', 8) + color.slice(0, W - 8)));

    // ── Notes ──
    if (notes) {
      B = cat(B, divider('\u2500', W));
      B = cat(B, ln(pad('NOTES:', 8) + notes.slice(0, W - 8)));
    }

    // ── Footer ──
    B = cat(B, divider('\u2500', W));
    B = cat(B, ALIGN_CTR);
    B = cat(B, ln('NexGridCore DataLabs', W));
    B = cat(B, feed(3));
    B = cat(B, CUT);

    return new Uint8Array(B);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async function print(printData) {
    if (!isSupported()) {
      throw new Error(
        'Web Bluetooth is not available. Use Chrome on Android, or print via the popup on PC.'
      );
    }
    var label = buildLabel(printData);
    await writeBytes(label);
  }

  function isPaired() {
    return _device !== null;
  }

  global.RetiFluxBTPrint = {
    isSupported : isSupported,
    isPaired    : isPaired,
    connect     : connect,
    print       : print,
    disconnect  : disconnect
  };

})(window);
