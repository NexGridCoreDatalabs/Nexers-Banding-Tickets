/* RetiFlux shared notification copy helpers (human-friendly, action-first). */
(function (win) {
  function s(v) { return (v == null ? '' : String(v)).trim(); }
  function num(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    return String(Math.round(n * 100) / 100);
  }

  function buildOrderPullMessage(payload) {
    payload = payload || {};
    var orderNo = s(payload.external_order_no || payload.order_no || payload.order_id || 'this order');
    var sku = s(payload.sku || 'this SKU');
    var from = s(payload.from_zone || 'source zone');
    var to = s(payload.to_zone || 'target zone');
    var qty = num(payload.quantity_needed);
    var taskType = s(payload.task_type).toUpperCase();
    var taskId = s(payload.task_id);
    var qtyText = qty ? (qty + ' units') : 'the required quantity';

    if (taskType === 'DT_MOVE' || to.toLowerCase().indexOf('dispatch') >= 0) {
      return {
        title: 'Move full pallet to Dispatch',
        body: 'Order ' + orderNo + ' needs SKU ' + sku + ' moved from ' + from + ' to Dispatch. Move a full pallet now; picker does not pick this from SuperMarket.',
        expected: 'Open move form and push the pallet to Dispatch.',
        compact: 'Order ' + orderNo + ': move full pallet of ' + sku + ' to Dispatch from ' + from + '.'
      };
    }

    return {
      title: 'Picker waiting for stock in SuperMarket',
      body: 'Order ' + orderNo + ' needs ' + qtyText + ' of SKU ' + sku + ' in SuperMarket. Move stock from ' + from + ' to ' + to + '.',
      expected: 'Open move form and send the next pallet to SuperMarket now.',
      compact: 'Order ' + orderNo + ': move ' + sku + ' from ' + from + ' to ' + to + ' so picker can continue.'
    };
  }

  function improveNotificationCopy(kind, title, body, payload) {
    var k = s(kind).toUpperCase();
    if (k === 'ORDER_PULL_TASK') {
      var msg = buildOrderPullMessage(payload);
      return {
        title: msg.title,
        body: msg.body + ' What to do: ' + msg.expected
      };
    }
    return { title: s(title), body: s(body) };
  }

  function humanizeUiMessage(text, level) {
    var t = s(text);
    if (!t) return t;
    var l = s(level).toLowerCase();

    // Common error prefix cleanup.
    t = t.replace(/^failed:\s*/i, 'Could not complete this action: ');

    // Action-focused rewording for common operator messages.
    t = t.replace(/^Move status refreshed$/i, 'Latest movement status loaded.');
    t = t.replace(/^Supervisor notified$/i, 'Supervisor alerted. Keep this line on hold until review.');
    t = t.replace(/^Marked short$/i, 'Line marked short. Zone team has been alerted to replenish.');
    t = t.replace(/^Reset to open$/i, 'Line reopened. Continue picking when stock is available.');
    t = t.replace(/^Line updated to OPEN$/i, 'Line reopened. Continue picking when stock is available.');
    t = t.replace(/^Line updated to SHORT$/i, 'Line marked short. Zone team has been alerted to replenish.');
    t = t.replace(/^Short confirmed$/i, 'Shortage confirmed. Replenishment follow-up is in progress.');
    t = t.replace(/^Report cleared — line back to Open$/i, 'Short report cleared. Line is open for picking again.');
    t = t.replace(/^Please enter a reason\.?$/i, 'Please add a short reason so the next team knows what to do.');
    t = t.replace(/^Enter a valid quantity$/i, 'Enter a valid pick quantity to continue.');
    t = t.replace(/^No source pallet assigned$/i, 'No source pallet is assigned yet. Wait for replenishment or choose a valid source.');
    t = t.replace(/^No recommended pallet for this SKU — pick manually or create replenishment$/i, 'No pallet is ready for this SKU yet. Wait for replenishment or select a valid source pallet.');
    t = t.replace(/^Create an order pallet first$/i, 'Create an order pallet first, then continue picking.');
    t = t.replace(/^Line already fully picked$/i, 'This line is already fully picked.');
    t = t.replace(/^Order is not pickable right now\.$/i, 'This order is not pickable right now. Check status and wait for release.');
    t = t.replace(/^Picking resumed$/i, 'Picking resumed. Continue from open lines.');
    t = t.replace(/^Order status updated to /i, 'Order updated: ');

    // Success clarity for common operations.
    t = t.replace(/^✓\s*Picked\s+/i, 'Picked ');
    t = t.replace(/^✓\s*Picked!$/i, 'Line marked picked.');
    t = t.replace(/^✓\s*Submitted for SM release — zone clerk will complete the transaction$/i,
      'Submitted for SuperMarket release. Zone clerk will complete dispatch handoff.');

    // Add gentle suffix for raw errors to guide user.
    if (l === 'error' && t.indexOf('Could not complete this action:') === 0) {
      t += ' Please check details and try again.';
    }
    return t;
  }

  win.RetiFluxNotifs = {
    buildOrderPullMessage: buildOrderPullMessage,
    improveNotificationCopy: improveNotificationCopy,
    humanizeUiMessage: humanizeUiMessage
  };
})(window);
