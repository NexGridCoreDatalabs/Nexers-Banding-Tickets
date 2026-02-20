function ensurePalletRow(palletId) {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const index = headers.indexOf('PalletID');
  if (index === -1) {
    throw new Error('Pallets sheet missing PalletID column.');
  }
  for (let i = 1; i < data.length; i++) {
    if ((data[i][index] || '').toString() === palletId) {
      return { sheet: sheet, rowIndex: i + 1, rowValues: data[i] };
    }
  }
  // Create placeholder row if not exists
  const empty = new Array(headers.length).fill('');
  empty[index] = palletId;
  sheet.appendRow(empty);
  const newIndex = sheet.getLastRow();
  return { sheet: sheet, rowIndex: newIndex, rowValues: empty };
}

function createChildPallet(parentTicket, quantity, targetZone, movedBy, reason) {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const palletSheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const parentInfo = ensurePalletRow(parentTicket.serial);
  const parentRow = parentInfo.rowValues;
  const headers = palletSheet.getRange(1, 1, 1, palletSheet.getLastColumn()).getValues()[0];
  const parentQty = Number(parentRow[headers.indexOf('RemainingQuantity')]) || 0;
  const childQty = Number(quantity) || 0;
  if (childQty <= 0) {
    throw new Error('Child quantity must be greater than zero.');
  }
  if (parentQty < childQty) {
    throw new Error('Not enough quantity to create child pallet.');
  }
  const fromZone = (parentRow[headers.indexOf('CurrentZone')] || '').toString().trim();
  const now = new Date();
  const movementId = generateMovementId();
  const childId = generatePalletId('SM');
  const childLog = {
    palletId: childId,
    fromZone: fromZone,
    toZone: targetZone,
    movedBy: movedBy || 'System',
    reason: reason || 'Child pallet created',
    overrideReason: '',
    quantity: childQty,
    orderReference: '',
    movementDate: now,
    movementId: movementId,
    movementStatus: 'In Transit'
  };
  logZoneMovement(childLog);
  const childTicket = Object.assign({}, parentTicket);
  childTicket.serial = childId;
  childTicket.qty = childQty;
  childTicket.notes = (parentTicket.notes ? parentTicket.notes + '\n' : '') + (reason || '') + ' [Child of ' + parentTicket.serial + ']';
  childTicket.modifiedBy = movedBy || 'System';
  createOrUpdatePalletFromTicket(childTicket, {
    currentZone: fromZone,
    status: 'Active',
    parentId: parentTicket.serial,
    lastMovedAt: now,
    lastMovedBy: movedBy || 'System',
    palletType: 'Banded',
    inTransitToZone: targetZone,
    inTransitMovementID: movementId,
    inTransitInitiatedAt: now,
    inTransitInitiatedBy: movedBy || 'System'
  });
  const newRemaining = parentQty - childQty;
  const remainingCol = headers.indexOf('RemainingQuantity');
  const notesCol = headers.indexOf('Notes');
  const lastMovedAtCol = headers.indexOf('LastMovedAt');
  const lastMovedByCol = headers.indexOf('LastMovedBy');
  if (remainingCol >= 0) {
    palletSheet.getRange(parentInfo.rowIndex, remainingCol + 1).setValue(newRemaining);
  }
  if (notesCol >= 0) {
    const existingNotes = parentRow[notesCol] || '';
    palletSheet.getRange(parentInfo.rowIndex, notesCol + 1).setValue(existingNotes + '\nSplit: created child ' + childId + ' qty ' + childQty);
  }
  if (lastMovedAtCol >= 0) {
    palletSheet.getRange(parentInfo.rowIndex, lastMovedAtCol + 1).setValue(new Date());
  }
  if (lastMovedByCol >= 0) {
    palletSheet.getRange(parentInfo.rowIndex, lastMovedByCol + 1).setValue(movedBy || 'System');
  }
  refreshInventorySnapshotSilently();
  const childCol = headers.indexOf('ChildPallets');
  if (childCol >= 0) {
    const existingChildren = parentRow[childCol] ? parentRow[childCol].toString().split(',').map(function(val) { return val.trim(); }).filter(Boolean) : [];
    if (existingChildren.indexOf(childId) === -1) {
      existingChildren.push(childId);
      palletSheet.getRange(parentInfo.rowIndex, childCol + 1).setValue(existingChildren.join(', '));
    }
  }
  return {
    childId: childId,
    parentRemaining: newRemaining
  };
}
/**
 * RetiFlux™ - Google Apps Script Backend
 * Retis Fluxit, Data Vincit (The Network Flows, Data Conquers)
 * 
 * Powered by NexGridCore DataLabs
 * 
 * INSTRUCTIONS:
 * 1. Go to https://script.google.com/
 * 2. Click "New Project"
 * 3. Delete the default code
 * 4. Paste this entire file
 * 5. Click "Deploy" → "New deployment"
 * 6. Choose type: "Web app"
 * 7. Execute as: "Me"
 * 8. Who has access: "Anyone"
 * 9. Click "Deploy"
 * 10. Copy the Web App URL and use it in your RetiFlux™ deployment
 */

// Your Google Sheet ID (update this)
const SHEET_ID = '1QXkL2K5hAfyvHKQ6mCFckmIu73lLw_XyENKSuqyFQgE';

// Stock movement constants
const STOCK_MOVEMENT_SHEETS = {
  Pallets: [
    'PalletID',
    'PalletType',
    'OriginalTicketSerial',
    'ZonePrefix',
    'CurrentZone',
    'Status',
    'SKU',
    'ProductType',
    'Quantity',
    'RemainingQuantity',
    'Layers',
    'ManufacturingDate',
    'BatchLot',
    'ExpiryDate',
    'ShelfLifeDays',
    'ParentPalletID',
    'ChildPallets',
    'PhotoLinks',
    'CreatedBy',
    'CreatedAt',
    'LastMovedAt',
    'LastMovedBy',
    'Notes',
    'InTransitToZone',
    'InTransitMovementID',
    'InTransitInitiatedAt',
    'InTransitInitiatedBy'
  ],
  ZoneMovements: [
    'MovementID',
    'PalletID',
    'FromZone',
    'ToZone',
    'MovementDate',
    'MovementTime',
    'MovedBy',
    'Reason',
    'OverrideReason',
    'Quantity',
    'OrderReference',
    'Notes',
    'CreatedAt',
    'MovementStatus',
    'ReceivedAt',
    'ReceivedBy',
    'AutoRevertedAt',
    'CancelledAt',
    'CancelledBy',
    'CancelEscalationReason'
  ],
  ZoneConfig: [
    'ZoneName',
    'Prefix',
    'AllowsSplitting',
    'FIFORequired',
    'ShelfLifeDays',
    'MaxCapacity',
    'CurrentOccupancy',
    'NextPalletNumber',
    'DefaultStatus',
    'Notes'
  ],
  SKUZoneMapping: [
    'SKU',
    'AllowedZones',
    'DefaultZone',
    'RequiresBanding',
    'ShelfLifeDays',
    'Notes',
    'ProductType',
    'Sachet Type',
    'Tablet Type',
    'UoM'
  ],
  QAHold: [
    'HoldID',
    'PalletID',
    'HoldDate',
    'HoldTime',
    'Reason',
    'HeldBy',
    'QAReference',
    'Status',
    'ReleaseDate',
    'ReleasedBy',
    'ReleaseNotes'
  ],
  Rework: [
    'ReworkID',
    'PalletID',
    'ReworkDate',
    'ReworkTime',
    'ReworkReason',
    'AssignedTo',
    'Status',
    'CompletedDate',
    'CompletedBy',
    'Result',
    'Notes'
  ],
  Dispatch: [
    'DispatchID',
    'OrderReference',
    'PalletID',
    'ChildPalletID',
    'AssignedDate',
    'AssignedBy',
    'VehicleID',
    'DriverName',
    'DriverContact',
    'LoadingDate',
    'LoadingBy',
    'ShippedDate',
    'ShippedBy',
    'Status',
    'ProofOfLoadingPhotos',
    'Notes'
  ],
  BinCards: [
    'BinCardID',
    'Zone',
    'SKU',
    'ShiftDate',
    'Shift',
    'OpeningBalance',
    'MovedIn',
    'MovedOut',
    'SystemClosingBalance',
    'PhysicalCount',
    'Variance',
    'ConfirmedBy',
    'ConfirmedAt',
    'Status',
    'RevokedBy',
    'RevokedAt'
  ]
};

/** Sheet groups for organization: Landing, Analytics (green), Backend (blue), Config (amber) */
const SHEET_GROUPS = {
  Landing: { color: '9ca3af', sheets: ['Landing'] },
  Analytics: { color: '34d399', sheets: ['Summary', 'Variant_Comparison', 'Visuals', 'Shift_Summary', 'SKU_Index', 'InventorySnapshot', 'Unpaired SKU Review'] },
  Backend: { color: '60a5fa', sheets: ['Tickets', 'Calculations', 'Pallets', 'ZoneMovements', 'Zone Movements', 'User Activity Log', 'QAHold', 'Rework', 'Dispatch', 'BinCards'] },
  Config: { color: 'fbbf24', sheets: ['SKUZoneMapping', 'ZoneConfig', 'Authorized Users', 'Config'] }
};

const SENSITIVE_SHEETS = [].concat(SHEET_GROUPS.Backend.sheets, SHEET_GROUPS.Config.sheets);
const ADMIN_PASSWORD_KEY = 'ADMIN_SHEET_PASSWORD';

const INVENTORY_ZONE_ORDER = [
  'Receiving Area',
  'Detergents Zone',
  'Fats Zone',
  'Liquids/Oils Zone',
  'Soaps Zone',
  'SuperMarket Area',
  'QA Hold',
  'Rework Zone',
  'Dispatch Loading Area',
  'Outbounding'
];

function buildHeaderIndexMap(headers) {
  const map = {};
  headers.forEach(function(header, idx) {
    if (header) {
      map[header] = idx;
    }
  });
  return map;
}

const DEFAULT_ZONE_CONFIG = [
  {
    ZoneName: 'Receiving Area',
    Prefix: 'REC',
    AllowsSplitting: false,
    FIFORequired: false,
    ShelfLifeDays: '',
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Received'
  },
  {
    ZoneName: 'Detergents Zone',
    Prefix: 'DET',
    AllowsSplitting: false,
    FIFORequired: true,
    ShelfLifeDays: 180,
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Active'
  },
  {
    ZoneName: 'Fats Zone',
    Prefix: 'FAT',
    AllowsSplitting: false,
    FIFORequired: true,
    ShelfLifeDays: 180,
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Active'
  },
  {
    ZoneName: 'Liquids/Oils Zone',
    Prefix: 'LIQ',
    AllowsSplitting: false,
    FIFORequired: true,
    ShelfLifeDays: 120,
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Active'
  },
  {
    ZoneName: 'Soaps Zone',
    Prefix: 'SOP',
    AllowsSplitting: false,
    FIFORequired: true,
    ShelfLifeDays: 240,
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Active'
  },
  {
    ZoneName: 'SuperMarket Area',
    Prefix: 'SM',
    AllowsSplitting: true,
    FIFORequired: true,
    ShelfLifeDays: '',
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Active'
  },
  {
    ZoneName: 'QA Hold',
    Prefix: 'QAH',
    AllowsSplitting: false,
    FIFORequired: false,
    ShelfLifeDays: '',
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Hold'
  },
  {
    ZoneName: 'Rework Zone',
    Prefix: 'REW',
    AllowsSplitting: false,
    FIFORequired: false,
    ShelfLifeDays: '',
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Rework'
  },
  {
    ZoneName: 'Dispatch Loading Area',
    Prefix: 'DSP',
    AllowsSplitting: false,
    FIFORequired: true,
    ShelfLifeDays: '',
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Dispatch'
  },
  {
    ZoneName: 'Outbounding',
    Prefix: 'OUT',
    AllowsSplitting: false,
    FIFORequired: false,
    ShelfLifeDays: '',
    MaxCapacity: '',
    CurrentOccupancy: 0,
    NextPalletNumber: 1,
    DefaultStatus: 'Shipped'
  }
];

const SKU_ZONE_CACHE = {
  timestamp: 0,
  data: null
};
const SKU_ZONE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Handle POST requests (writing data)
 */
function doPost(e) {
  // Always return JSON, even on error
  try {
    if (!e) {
      return createResponse({ success: false, error: 'No event payload received' });
    }
    
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    
    // Handle both JSON and form-encoded data
    let data;
    let rawData = null;
    
    // PRIORITY 1: Try postData.contents (raw POST body - for JSON or form data)
    if (e.postData && e.postData.contents) {
      rawData = e.postData.contents;
      const contentType = e.postData.type || '';
      
      // If it's JSON content type, parse directly
      if (contentType.indexOf('application/json') !== -1) {
        try {
          data = JSON.parse(rawData);
        } catch (parseError) {
          return createResponse({ success: false, error: 'Failed to parse JSON: ' + parseError.toString() });
        }
      }
      // If it's form data (starts with "data=")
      else if (rawData.startsWith('data=')) {
        try {
          const encodedData = rawData.substring(5);
          const decodedData = decodeURIComponent(encodedData);
          data = JSON.parse(decodedData);
        } catch (parseError) {
          return createResponse({ success: false, error: 'Failed to parse form data: ' + parseError.toString() });
        }
      }
      // Try parsing as raw JSON (might be JSON without proper content-type)
      else {
        try {
          data = JSON.parse(rawData);
        } catch (parseError) {
          return createResponse({ success: false, error: 'Unknown data format. Content-Type: ' + contentType + ', Data: ' + rawData.substring(0, 100) });
        }
      }
    }
    // Try e.parameter (form data - Apps Script auto-decodes URL params)
    else if (e.parameter && e.parameter.data) {
      rawData = e.parameter.data;
      
      // Apps Script may have already decoded it, but check if it's still encoded
      try {
        // Try parsing directly first (in case it's already decoded)
        data = JSON.parse(rawData);
      } catch (e1) {
        // If that fails, try decoding first
        try {
          const decodedData = decodeURIComponent(rawData);
          data = JSON.parse(decodedData);
        } catch (e2) {
          return createResponse({ success: false, error: 'Failed to parse parameter data. Tried direct parse and decode. Raw: ' + rawData });
        }
      }
    }
    // Fallback to direct parameter access
    else if (e.parameter) {
      const params = e.parameter;
      if (params.data) {
        try {
          data = JSON.parse(params.data);
        } catch (e1) {
          try {
            const decodedData = decodeURIComponent(params.data);
            data = JSON.parse(decodedData);
          } catch (e2) {
            return createResponse({ success: false, error: 'Failed to parse parameter data' });
          }
        }
      } else {
        // Direct form data fields
        data = {
          action: params.action || 'append',
          serial: params.serial || '',
          values: params.values ? (typeof params.values === 'string' ? JSON.parse(params.values) : params.values) : [],
          sku: params.sku || '',
          qty: params.qty || ''
        };
      }
    } else {
      return createResponse({ success: false, error: 'No data received. postData: ' + (e.postData ? 'exists' : 'null') + ', parameter: ' + (e.parameter ? 'exists' : 'null') });
    }
    
    // Validate data structure
    if (!data || !data.action) {
      return createResponse({ success: false, error: 'Invalid data structure. Received: ' + JSON.stringify(data) });
    }
    
    return handleWriteOperation(data, sheet);
  } catch (error) {
    // Only log critical errors
    Logger.log('doPost error: ' + error.toString());
    return createResponse({ success: false, error: 'doPost error: ' + error.toString() });
  }
}

/**
 * Handle write operations (used by both doPost and doGet)
 */
function handleWriteOperation(data, sheet) {
  try {
    // Log user activity with more details
    const modifiedBy = data.values && data.values.length > 18 ? data.values[18] : 'Unknown';
    logUserActivity(data.action.toUpperCase() + ': ' + (data.serial || 'New ticket'), 'ModifiedBy: ' + modifiedBy + ', SKU: ' + (data.sku || 'N/A'));
    
    if (data.action === 'append') {
      // Append new row to Tickets sheet
      const ticketsSheet = sheet.getSheetByName('Tickets');
      if (!ticketsSheet) {
        return createResponse({ success: false, error: 'Tickets sheet not found' });
      }
      
      // If only serial provided (partial data), create row with serial and empty cells
      if (data.values && data.values.length === 1) {
        // Create a row with serial in first column, rest empty
        const headers = ticketsSheet.getRange(1, 1, 1, 19).getValues()[0];
        const newRow = new Array(19).fill('');
        newRow[0] = data.values[0]; // Serial in first column
        ticketsSheet.appendRow(newRow);
      } else {
        // Overwrite product info from SKUZoneMapping
        const sku = (data.values[3] || data.sku || '').toString().trim();
        if (sku) {
          const entry = findSkuZoneEntry(sku);
          if (!entry) {
            return createResponse({ success: false, error: 'SKU "' + sku + '" is not in the catalog. Add it to SKUZoneMapping first.' });
          }
          const info = getSkuProductInfo(sku);
          data.values[7] = info.productType;
          data.values[13] = info.sachetType;
          data.values[14] = info.tabletType;
          if (data.values.length < 16) while (data.values.length < 16) data.values.push('');
          data.values[15] = info.uom;
        }
        // Full row data provided
        ticketsSheet.appendRow(data.values);
        const ticketPayload = mapTicketRowToObject(data.values);
        if (ticketPayload) {
          createOrUpdatePalletFromTicket(ticketPayload);
        }
      }
      
      // Update Calculations sheet if SKU and productType provided
      var pt = (data.values && data.values[7]) ? data.values[7] : data.productType;
      if (data.sku && data.qty && pt) {
        updateCalculations(data.sku, parseFloat(data.qty) || 0, pt, 0, false);
      }
      
      // Auto-refresh analytics every 10 new tickets
      try {
        var props = PropertiesService.getScriptProperties();
        var count = parseInt(props.getProperty('TICKETS_SINCE_LAST_RECALC') || '0', 10) + 1;
        props.setProperty('TICKETS_SINCE_LAST_RECALC', String(count));
        if (count >= 10) {
          props.setProperty('TICKETS_SINCE_LAST_RECALC', '0');
          recalculateAllCalculations(sheet, false);
        }
      } catch (autoErr) {}
      
      return createResponse({ success: true, message: 'Data saved successfully' });
    } 
    else if (data.action === 'update') {
      // Update existing row, or append if not found
      const ticketsSheet = sheet.getSheetByName('Tickets');
      if (!ticketsSheet) {
        return createResponse({ success: false, error: 'Tickets sheet not found' });
      }
      
      const dataRange = ticketsSheet.getDataRange();
      const values = dataRange.getValues();
      const serial = data.serial;
      
      // Find row with matching serial (column A)
      let found = false;
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === serial) {
          // Overwrite product info from SKUZoneMapping
          const sku = (data.values[3] || data.sku || '').toString().trim();
          if (sku) {
            const entry = findSkuZoneEntry(sku);
            if (!entry) {
              return createResponse({ success: false, error: 'SKU "' + sku + '" is not in the catalog. Add it to SKUZoneMapping first.' });
            }
            const info = getSkuProductInfo(sku);
            data.values[7] = info.productType;
            data.values[13] = info.sachetType;
            data.values[14] = info.tabletType;
            if (data.values.length < 16) while (data.values.length < 16) data.values.push('');
            data.values[15] = info.uom;
          }
          // Get old quantity from existing row (column E = index 4)
          const oldQty = parseFloat(values[i][4]) || 0;
          const newQty = parseFloat(data.qty) || 0;
          
          // Update the row
          const rowNum = i + 1;
          ticketsSheet.getRange(rowNum, 1, rowNum, data.values.length).setValues([data.values]);
          
          // Update Calculations if SKU and productType provided
          var ptUpdate = (data.values && data.values[7]) ? data.values[7] : data.productType;
          if (data.sku && data.qty && ptUpdate) {
            updateCalculations(data.sku, newQty, ptUpdate, oldQty, true);
          }
          
          const ticketPayload = mapTicketRowToObject(data.values);
          if (ticketPayload) {
            createOrUpdatePalletFromTicket(ticketPayload);
          }
          found = true;
          return createResponse({ success: true, message: 'Data updated successfully' });
        }
      }
      
      // If not found, append as new ticket
      if (!found) {
        // Overwrite product info from SKUZoneMapping
        const skuAppend = (data.values[3] || data.sku || '').toString().trim();
        if (skuAppend) {
          const entryAppend = findSkuZoneEntry(skuAppend);
          if (!entryAppend) {
            return createResponse({ success: false, error: 'SKU "' + skuAppend + '" is not in the catalog. Add it to SKUZoneMapping first.' });
          }
          const infoAppend = getSkuProductInfo(skuAppend);
          data.values[7] = infoAppend.productType;
          data.values[13] = infoAppend.sachetType;
          data.values[14] = infoAppend.tabletType;
          if (data.values.length < 16) while (data.values.length < 16) data.values.push('');
          data.values[15] = infoAppend.uom;
        }
        ticketsSheet.appendRow(data.values);
        const ticketPayload = mapTicketRowToObject(data.values);
        if (ticketPayload) {
          createOrUpdatePalletFromTicket(ticketPayload);
        }
        
        // Update Calculations sheet if SKU and productType provided
        var ptNew = (data.values && data.values[7]) ? data.values[7] : data.productType;
        if (data.sku && data.qty && ptNew) {
          updateCalculations(data.sku, parseFloat(data.qty) || 0, ptNew, 0, false);
        }
        
        return createResponse({ success: true, message: 'Data saved as new ticket' });
      }
    }
    
    return createResponse({ success: false, error: 'Invalid action' });
  } catch (error) {
    return createResponse({ success: false, error: error.toString() });
  }
}

/**
 * Log user information for tracking
 */
function logUserActivity(action, additionalInfo) {
  try {
    const userEmail = Session.getActiveUser().getEmail() || 'Anonymous';
    const effectiveUser = Session.getEffectiveUser().getEmail() || 'Anonymous';
    const timestamp = new Date().toISOString();
    
    // Try to get IP address from request (if available)
    const ipAddress = 'N/A'; // IP not directly available in Apps Script web apps
    
    // Log to tracking sheet (silent - no console logs)
    try {
      const sheet = SpreadsheetApp.openById(SHEET_ID);
      let trackingSheet = sheet.getSheetByName('User Activity Log');
      
      if (!trackingSheet) {
        // Create tracking sheet
        trackingSheet = sheet.insertSheet('User Activity Log');
        trackingSheet.getRange(1, 1, 1, 5).setValues([[
          'Timestamp',
          'Action',
          'Active User Email',
          'Effective User Email',
          'Additional Info'
        ]]);
        // Format header row
        const headerRange = trackingSheet.getRange(1, 1, 1, 5);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#4285f4');
        headerRange.setFontColor('#ffffff');
      }
      
      // Append log entry
      trackingSheet.appendRow([
        timestamp,
        action,
        userEmail,
        effectiveUser,
        additionalInfo || ''
      ]);
    } catch (trackingError) {
      // Silent fail - don't log to avoid performance impact
    }
  } catch (error) {
    // Silent fail - don't log to avoid performance impact
  }
}

/**
 * Handle GET requests (reading data)
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action).trim() : 'read';
    if (action === 'version' || action === 'ping') {
      return createResponse({ success: true, version: '2026-02-10-getRecentMovements', msg: 'Deployment has getRecentMovements' });
    }
    if (action === 'getRecentMovements') {
      return getRecentMovements(parseInt(e.parameter.limit || '10', 10));
    }
    if (action === 'getSkus') {
      const skus = getSkusFromZoneMapping();
      return createResponse({ success: true, skus: skus });
    }
    if (action === 'getSkuProductInfo') {
      const sku = (e.parameter.sku || '').toString().trim();
      const info = getSkuProductInfo(sku);
      return createResponse({ success: true, info: info });
    }
    if (action === 'harmonizeSkuProductInfo') {
      const sheet = SpreadsheetApp.openById(SHEET_ID);
      const result = harmonizeSkuProductInfo(sheet);
      return createResponse({ success: true, result: result });
    }
    if (action === 'organizeSheets') {
      const sheet = SpreadsheetApp.openById(SHEET_ID);
      const hideSensitive = parseBoolean(e.parameter.hideSensitive);
      const result = organizeSheetsWithLanding(sheet, hideSensitive);
      return createResponse(result);
    }
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const serial = e.parameter.serial || '';
    
    // Log user activity
    logUserActivity('GET: ' + action + (serial ? ' (Serial: ' + serial + ')' : ''), JSON.stringify(e.parameter));
    
    // Handle write operations via GET (to avoid POST/CORS issues)
    if (action === 'append' || action === 'update') {
      // Parse the values from query parameter
      let values;
      try {
        values = JSON.parse(e.parameter.values || '[]');
      } catch (e) {
        return createResponse({ success: false, error: 'Failed to parse values: ' + e.toString() });
      }
      
      const data = {
        action: action,
        serial: e.parameter.serial || '',
        values: values,
        sku: e.parameter.sku || '',
        qty: e.parameter.qty || '',
        oldQty: e.parameter.oldQty || '0',
        productType: e.parameter.productType || ''
      };
      
      // Use the same logic as doPost
      return handleWriteOperation(data, sheet);
    }
    
    if (action === 'read') {
      const serial = e.parameter.serial;
      const includePallet = e.parameter.includePallet !== '0' && e.parameter.includePallet !== 'false';
      const ticketsSheet = sheet.getSheetByName('Tickets');
      
      if (!ticketsSheet) {
        return createResponse({ success: false, error: 'Tickets sheet not found' });
      }
      
      const dataRange = ticketsSheet.getDataRange();
      const values = dataRange.getValues();
      
      if (serial) {
        const serialUpper = serial.toString().toUpperCase();
        for (let i = 1; i < values.length; i++) {
          const rowSerial = (values[i][0] || '').toString().toUpperCase();
          if (rowSerial === serialUpper) {
            const headers = values[0];
            const row = values[i];
            const ticket = {};
            headers.forEach(function(header, index) {
              ticket[header] = row[index] || '';
            });
            var palletRecord = null;
            if (includePallet) {
              var palletsSheet = sheet.getSheetByName('Pallets');
              if (palletsSheet) {
                var palletRange = palletsSheet.getDataRange();
                var palletValues = palletRange.getValues();
                var palletHeaders = palletValues[0] || [];
                for (var p = 1; p < palletValues.length; p++) {
                  if ((palletValues[p][0] || '').toString().toUpperCase() === serialUpper) {
                    palletRecord = {};
                    palletHeaders.forEach(function(header, idx) {
                      palletRecord[header] = palletValues[p][idx];
                    });
                    break;
                  }
                }
              }
            }
            return createResponse({ success: true, data: ticket, pallet: palletRecord });
          }
        }
        return createResponse({ success: false, error: 'Ticket not found' });
      } else {
        // Return all tickets
        return createResponse({ success: true, data: values });
      }
    } else if (action === 'createChildPallet') {
      const palletId = (e.parameter.palletId || '').toString().trim();
      const toZone = (e.parameter.toZone || '').toString().trim();
      const movedBy = (e.parameter.movedBy || '').toString().trim();
      const quantity = Number(e.parameter.quantity || 0);
      const reason = (e.parameter.reason || '').toString();
      if (!palletId) {
        return createResponse({ success: false, error: 'Pallet ID is required.' });
      }
      if (!toZone) {
        return createResponse({ success: false, error: 'Destination zone is required.' });
      }
      if (!movedBy) {
        return createResponse({ success: false, error: 'Moved By is required.' });
      }
      if (!quantity || quantity <= 0) {
        return createResponse({ success: false, error: 'Child quantity must be greater than zero.' });
      }
      const palletsSheet = sheet.getSheetByName('Pallets');
      if (!palletsSheet) {
        return createResponse({ success: false, error: 'Pallets sheet not found' });
      }
      const dataRange = palletsSheet.getDataRange();
      const values = dataRange.getValues();
      if (values.length <= 1) {
        return createResponse({ success: false, error: 'Pallets sheet has no data' });
      }
      const headers = values[0];
      const columnIndexMap = {};
      headers.forEach(function(header, idx) {
        columnIndexMap[header] = idx;
      });
      const palletIdIndex = columnIndexMap.PalletID;
      if (palletIdIndex === undefined) {
        return createResponse({ success: false, error: 'PalletID column missing in Pallets sheet' });
      }
      let parentRow = null;
      for (let i = 1; i < values.length; i++) {
        if ((values[i][palletIdIndex] || '').toString().trim().toUpperCase() === palletId.toUpperCase()) {
          parentRow = values[i];
          break;
        }
      }
      if (!parentRow) {
        return createResponse({ success: false, error: 'Pallet not found: ' + palletId });
      }
      const parentTicket = buildTicketFromPalletRow(parentRow, columnIndexMap);
      if (!parentTicket) {
        return createResponse({ success: false, error: 'Unable to load parent pallet details.' });
      }
      const childResult = createChildPallet(parentTicket, quantity, toZone, movedBy, reason);
      return createResponse({
        success: true,
        message: 'Child pallet ' + childResult.childId + ' initiated - awaiting receipt at ' + toZone,
        childPalletId: childResult.childId,
        parentRemaining: childResult.parentRemaining
      });
    } else if (action === 'inventorySnapshot') {
      return createInventorySnapshot();
    } else if (action === 'users') {
      // Get authorized users
      const usersSheet = sheet.getSheetByName('Authorized Users');
      if (!usersSheet) {
        return createResponse({ success: false, error: 'Authorized Users sheet not found' });
      }
      
      const dataRange = usersSheet.getDataRange();
      const values = dataRange.getValues();
      const headers = values[0] || [];
      
      // Find column indices
      const idCol = 0; // Assuming ID is first column
      const nameCol = headers.indexOf('Name') >= 0 ? headers.indexOf('Name') : 1;
      const skusCol = headers.indexOf('SKUs') >= 0 ? headers.indexOf('SKUs') : -1;
      const sachetTypeCol = headers.indexOf('Sachet Type') >= 0 ? headers.indexOf('Sachet Type') : -1;
      const tabletTypeCol = headers.indexOf('Tablet Type') >= 0 ? headers.indexOf('Tablet Type') : -1;
      
      const users = [];
      const allSkus = new Set(); // Collect all unique SKUs
      const allSachetTypes = new Set(); // Collect all unique Sachet Types
      const allTabletTypes = new Set(); // Collect all unique Tablet Types
      
      const roleCol = headers.indexOf('Role') >= 0 ? headers.indexOf('Role') : -1;
      for (let i = 1; i < values.length; i++) {
        if (values[i][idCol]) {
          const userEntry = { id: values[i][idCol], name: values[i][nameCol] || '' };
          if (roleCol >= 0) {
            userEntry.role = (values[i][roleCol] || '').toString().trim();
          }
          users.push(userEntry);
          
          // Collect SKUs from SKUs column if it exists
          if (skusCol >= 0 && values[i][skusCol]) {
            const skusStr = (values[i][skusCol] || '').toString();
            // SKUs might be comma-separated or newline-separated
            const skus = skusStr.split(/[,\n]/).map(s => s.trim()).filter(s => s !== '');
            skus.forEach(sku => allSkus.add(sku));
          }
          
          // Collect Sachet Types
          if (sachetTypeCol >= 0 && values[i][sachetTypeCol]) {
            const sachetTypesStr = (values[i][sachetTypeCol] || '').toString();
            const sachetTypes = sachetTypesStr.split(/[,\n]/).map(s => s.trim()).filter(s => s !== '');
            sachetTypes.forEach(st => allSachetTypes.add(st));
          }
          
          // Collect Tablet Types
          if (tabletTypeCol >= 0 && values[i][tabletTypeCol]) {
            const tabletTypesStr = (values[i][tabletTypeCol] || '').toString();
            const tabletTypes = tabletTypesStr.split(/[,\n]/).map(s => s.trim()).filter(s => s !== '');
            tabletTypes.forEach(tt => allTabletTypes.add(tt));
          }
        }
      }
      
      // Return users with SKUs, Sachet Types, and Tablet Types lists
      return createResponse({ 
        success: true, 
        data: users,
        skus: Array.from(allSkus).sort(), // Return sorted unique SKUs
        sachetTypes: Array.from(allSachetTypes).sort(), // Return sorted unique Sachet Types
        tabletTypes: Array.from(allTabletTypes).sort() // Return sorted unique Tablet Types
      });
    } else if (action === 'recalculate') {
      // Full recalculation of Calculations sheet from all tickets
      var skipAnalytics = parseBoolean(e.parameter.skipAnalytics);
      return recalculateAllCalculations(sheet, skipAnalytics);
    } else if (action === 'login') {
      const userId = (e.parameter.userId || '').trim();
      const passcode = (e.parameter.passcode || '').trim();
      if (!userId || !passcode) {
        return createResponse({ success: false, error: 'Missing user ID or passcode' });
      }
      
      const usersSheet = sheet.getSheetByName('Authorized Users');
      if (!usersSheet) {
        return createResponse({ success: false, error: 'Authorized Users sheet not found' });
      }
      
      const dataRange = usersSheet.getDataRange();
      const values = dataRange.getValues();
      const headers = values[0] || [];
      
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] && values[i][0].toString().trim() === userId) {
          const storedPasscode = (values[i][2] || '').toString().trim();
          if (!storedPasscode) {
            return createResponse({ success: false, error: 'User has no passcode configured' });
          }
          
          if (storedPasscode === passcode) {
            const roleCol = headers.indexOf('Role');
            const userData = { id: values[i][0], name: values[i][1] || '' };
            if (roleCol >= 0) {
              userData.role = (values[i][roleCol] || '').toString().trim();
            }
            return createResponse({
              success: true,
              data: userData
            });
          }
          
          return createResponse({ success: false, error: 'Invalid passcode' });
        }
      }
      
      return createResponse({ success: false, error: 'User not found' });
    }
    else if (action === 'initializeStockMovement') {
      return initializeStockMovementSheets();
    }
    else if (action === 'getZoneConfig') {
      var includeRecent = (e.parameter.includeRecentMovements || e.parameter.includeRecent) === 'true' || e.parameter.includeRecentMovements === true;
      return getZoneConfigDataResponse(includeRecent);
    }
    else if (action === 'getZoneInventoryTotals') {
      return getZoneInventoryTotals();
    }
    else if (action === 'getPalletsInZone') {
      return getPalletsInZone({
        zoneName: e.parameter.zoneName || '',
        status: e.parameter.status || '',
        limit: e.parameter.limit || ''
      });
    }
    else if (action === 'movePallet') {
      return movePallet({
        palletId: e.parameter.palletId || '',
        toZone: e.parameter.toZone || '',
        movedBy: e.parameter.movedBy || '',
        reason: e.parameter.reason || '',
        overrideReason: e.parameter.overrideReason || '',
        quantity: e.parameter.quantity || '',
        orderReference: e.parameter.orderReference || ''
      });
    }
    else if (action === 'receivePallet') {
      return receivePallet({
        palletId: e.parameter.palletId || '',
        receivedBy: e.parameter.receivedBy || ''
      });
    }
    else if (action === 'getInboundsToZone') {
      return getInboundsToZone({ zoneName: e.parameter.zoneName || '' });
    }
    else if (action === 'getOutboundsFromZone') {
      return getOutboundsFromZone({ zoneName: e.parameter.zoneName || '' });
    }
    else if (action === 'cancelTransit') {
      return cancelTransit({
        palletId: e.parameter.palletId || '',
        cancelledBy: e.parameter.cancelledBy || '',
        escalationReason: e.parameter.escalationReason || ''
      });
    }
    else if (action === 'runAutoRevertTransits') {
      return runAutoRevertTransits();
    }
    else if (action === 'getBinCardData') {
      return getBinCardData({
        zone:      e.parameter.zone      || '',
        sku:       e.parameter.sku       || '',
        shiftDate: e.parameter.shiftDate  || '',
        shift:     e.parameter.shift     || ''
      });
    }
    else if (action === 'confirmBinCard') {
      return confirmBinCard({
        zone:                 e.parameter.zone                || '',
        sku:                  e.parameter.sku                 || '',
        shift:                e.parameter.shift               || '',
        shiftDate:            e.parameter.shiftDate           || '',
        physicalCount:        e.parameter.physicalCount       || 0,
        systemClosingBalance: e.parameter.systemClosingBalance || 0,
        openingBalance:       e.parameter.openingBalance      || 0,
        movedIn:              e.parameter.movedIn             || 0,
        movedOut:             e.parameter.movedOut            || 0,
        confirmedBy:          e.parameter.confirmedBy         || ''
      });
    }
    else if (action === 'confirmZoneBinCard') {
      return confirmZoneBinCard({
        zone:                 e.parameter.zone                || '',
        shift:                e.parameter.shift               || '',
        shiftDate:            e.parameter.shiftDate           || '',
        physicalCount:        e.parameter.physicalCount       || 0,
        systemClosingBalance: e.parameter.systemClosingBalance || 0,
        openingBalance:       e.parameter.openingBalance      || 0,
        movedIn:              e.parameter.movedIn             || 0,
        movedOut:             e.parameter.movedOut            || 0,
        confirmedBy:          e.parameter.confirmedBy         || ''
      });
    }
    else if (action === 'confirmZoneBinCardPerSku') {
      var physicalCountsRaw = e.parameter.physicalCounts || '';
      try {
        var physicalCounts = typeof physicalCountsRaw === 'string' ? JSON.parse(physicalCountsRaw) : physicalCountsRaw;
        if (!Array.isArray(physicalCounts)) physicalCounts = [];
      } catch (err) {
        return createResponse({ success: false, error: 'Invalid physicalCounts JSON.' });
      }
      return confirmZoneBinCardPerSku({
        zone:           e.parameter.zone     || '',
        shift:          e.parameter.shift    || '',
        shiftDate:      e.parameter.shiftDate || '',
        confirmedBy:    e.parameter.confirmedBy || '',
        physicalCounts: physicalCounts
      });
    }
    else if (action === 'getBinCardVarianceReport') {
      return getBinCardVarianceReport({
        dateFrom:  e.parameter.dateFrom || '',
        dateTo:    e.parameter.dateTo   || '',
        shift:     e.parameter.shift   || '',
        zone:      e.parameter.zone   || ''
      });
    }
    else if (action === 'getConfirmedBinCardsForAdmin') {
      return getConfirmedBinCardsForAdmin({
        dateFrom:  e.parameter.dateFrom || '',
        dateTo:    e.parameter.dateTo   || '',
        shift:     e.parameter.shift   || '',
        zone:      e.parameter.zone   || ''
      });
    }
    else if (action === 'revokeZoneBinCard') {
      return revokeZoneBinCard({
        zone:      e.parameter.zone     || '',
        shift:     e.parameter.shift   || '',
        shiftDate: e.parameter.shiftDate || '',
        revokedBy: e.parameter.revokedBy || ''
      });
    }
    
    return createResponse({ success: false, error: 'Invalid action' });
  } catch (error) {
    return createResponse({ success: false, error: error.toString() });
  }
}

/**
 * Format timestamp to readable format: "Friday 11th Oct, 2025 0024HRS"
 */
function formatTimestamp(timestamp) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[date.getDay()];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    // Get ordinal suffix (1st, 2nd, 3rd, 4th, etc.)
    function getOrdinal(n) {
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    
    // padStart alternative for Apps Script
    function padZero(num) {
      return num < 10 ? '0' + num : String(num);
    }
    
    const hours = padZero(date.getHours());
    const minutes = padZero(date.getMinutes());
    
    return dayName + ' ' + getOrdinal(day) + ' ' + month + ', ' + year + ' ' + hours + minutes + 'HRS';
  } catch (e) {
    return timestamp;
  }
}

/**
 * Full recalculation of Calculations sheet from all tickets
 * Creates comprehensive analytics sorted by Date, then SKU
 */
function recalculateAllCalculations(sheet, skipAnalytics) {
  try {
    sheet = sheet || SpreadsheetApp.openById(SHEET_ID);
    
    const ticketsSheet = sheet.getSheetByName('Tickets');
    if (!ticketsSheet) {
      return createResponse({ success: false, error: 'Tickets sheet not found' });
    }
    
    let calcSheet = sheet.getSheetByName('Calculations');
    if (!calcSheet) {
      calcSheet = sheet.insertSheet('Calculations');
    } else {
      calcSheet.clear();
    }
    
    // Create comprehensive headers with Date and analytics
    calcSheet.getRange(1, 1, 1, 18).setValues([[
      'Date',
      'SKU', 
      'Product Type', 
      'Total Quantity (Cartons)', 
      'Total Pieces', 
      'Number of Tickets',
      'Average Quantity per Ticket',
      'Total Layers',
      'Quality Issues Count',
      'Group Leaders',
      'Banding Types',
      'First Ticket Time',
      'Last Ticket Time',
      'Sachet Type',
      'Tablet Type',
      'Last Change', 
      'Last Updated',
      'Serial Numbers'
    ]]);
    
    // Format header row
    const headerRange = calcSheet.getRange(1, 1, 1, 18);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');
    
    // Get all tickets
    const ticketsDataRange = ticketsSheet.getDataRange();
    const ticketsValues = ticketsDataRange.getValues();
    
    // Removed verbose logging for performance
    
    // Column indices: Serial=0, Date=1, Time=2, SKU=3, Qty=4, Layers=5, BandingType=6, 
    // ProductType=7, PalletSize=8, Notes=9, QualityIssueType=10, QualityIssueDesc=11, 
    // GroupLeader=12, SachetType=13, TabletType=14, MerchHistory=15, etc.
    
    // Group tickets by Date + SKU + ProductType
    const groupedData = {};
    
    for (let i = 1; i < ticketsValues.length; i++) {
      // Handle date - could be Date object, ISO string, or YYYY-MM-DD string
      let dateValue = ticketsValues[i][1];
      let dateStr = '';
      
      if (dateValue instanceof Date) {
        // Convert Date object to YYYY-MM-DD string
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        dateStr = year + '-' + month + '-' + day;
      } else if (typeof dateValue === 'string') {
        // If it's an ISO string, extract the date part
        if (dateValue.includes('T')) {
          dateStr = dateValue.split('T')[0];
        } else {
          dateStr = dateValue;
        }
      } else if (dateValue) {
        // Try to convert to string
        dateStr = dateValue.toString();
      }
      
      const sku = (ticketsValues[i][3] || '').toString().trim();
      const productType = (ticketsValues[i][7] || '').toString().toLowerCase();
      const qty = parseFloat(ticketsValues[i][4]) || 0;
      const time = ticketsValues[i][2] || '';
      const serial = ticketsValues[i][0] || '';
      
      // Determine product type label and multiplier
      const is1KG = productType.includes('1kg') || productType.includes('1 kg');
      const is05KG = productType.includes('0.5kg') || productType.includes('0.5 kg') || productType.includes('0,5kg');
      
      let productTypeLabel = '';
      let multiplier = 0;
      
      if (is1KG) {
        productTypeLabel = '1KG';
        multiplier = 6;
      } else if (is05KG) {
        productTypeLabel = '0.5KG';
        multiplier = 12;
      } else {
        continue; // Skip if no valid product type
      }
      
      if (!dateStr || !sku) {
        continue; // Skip invalid tickets silently
      }
      
      // Create unique key: Date + SKU + ProductType
      const key = dateStr + '|' + sku + '|' + productTypeLabel;
      
      if (!groupedData[key]) {
        groupedData[key] = {
          date: dateStr,
          sku: sku,
          productType: productTypeLabel,
          multiplier: multiplier,
          totalQty: 0,
          totalPieces: 0,
          numTickets: 0,
          totalLayers: 0,
          qualityIssuesCount: 0,
          groupLeaders: new Set(),
          bandingTypes: new Set(),
          serials: [],
          firstTime: '',
          lastTime: '',
          sachetTypes: new Set(),
          tabletTypes: new Set()
        };
      }
      
      const group = groupedData[key];
      group.totalQty += qty;
      group.totalPieces += qty * multiplier;
      group.numTickets += 1;
      group.totalLayers += parseFloat(ticketsValues[i][5]) || 0;
      
      // Track sachet and tablet types
      const sachetType = ticketsValues[i][13] || '';
      const tabletType = ticketsValues[i][14] || '';
      if (sachetType) {
        group.sachetTypes.add(sachetType);
      }
      if (tabletType) {
        group.tabletTypes.add(tabletType);
      }
      
      if (ticketsValues[i][10]) { // QualityIssueType
        group.qualityIssuesCount += 1;
      }
      
      const groupLeader = ticketsValues[i][12] || '';
      if (groupLeader) {
        group.groupLeaders.add(groupLeader);
      }
      
      const bandingType = ticketsValues[i][6] || '';
      if (bandingType) {
        const types = bandingType.split(',').map(bt => bt.trim()).filter(bt => bt !== '');
        types.forEach(bt => group.bandingTypes.add(bt));
      }
      
      if (serial) {
        group.serials.push(serial);
      }
      
      if (time) {
        if (!group.firstTime || time < group.firstTime) {
          group.firstTime = time;
        }
        if (!group.lastTime || time > group.lastTime) {
          group.lastTime = time;
        }
      }
    }
    
    // Convert to array and sort by Date, then SKU
    const sortedData = Object.values(groupedData).sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date); // Sort by date first
      }
      return a.sku.localeCompare(b.sku); // Then by SKU
    });
    
    // Write data to sheet
    const rows = sortedData.map(group => {
      const avgQty = group.numTickets > 0 ? (group.totalQty / group.numTickets) : 0;
      
      return [
        group.date,
        group.sku,
        group.productType,
        group.totalQty,
        group.totalPieces,
        group.numTickets,
        avgQty,
        group.totalLayers,
        group.qualityIssuesCount,
        Array.from(group.groupLeaders).join(', '),
        Array.from(group.bandingTypes).join(', '),
        group.firstTime,
        group.lastTime,
        Array.from(group.sachetTypes).join(', '),
        Array.from(group.tabletTypes).join(', '),
        '', // Last Change (not applicable for full recalculation)
        formatTimestamp(new Date().toISOString()),
        group.serials.join(', ')
      ];
    });
    
    if (rows.length > 0) {
      var calcBatchSize = 400;
      for (var rOff = 0; rOff < rows.length; rOff += calcBatchSize) {
        var rChunk = rows.slice(rOff, rOff + calcBatchSize);
        calcSheet.getRange(2 + rOff, 1, rChunk.length, 18).setValues(rChunk);
        SpreadsheetApp.flush();
        if (rOff + calcBatchSize < rows.length) Utilities.sleep(200);
      }
    }
    
    // Apply filters and sorting
    if (rows.length > 0) {
      const dataRange = calcSheet.getRange(1, 1, rows.length + 1, 18);
      const existingFilter = calcSheet.getFilter();
      if (existingFilter) {
        existingFilter.remove();
      }
      dataRange.createFilter();
      
      // Sort by Date (column 1), then SKU (column 2)
      const sortRange = calcSheet.getRange(2, 1, rows.length, 18);
      sortRange.sort([{column: 1, ascending: true}, {column: 2, ascending: true}]);
    }
    
    if (!skipAnalytics) {
      try {
        buildAnalyticsCenter(sheet, sortedData, ticketsValues);
      } catch (dashboardError) {
        Logger.log('Analytics build failed: ' + (dashboardError && dashboardError.toString ? dashboardError.toString() : dashboardError));
      }
    }
    
    return createResponse({ 
      success: true, 
      message: `Recalculated ${rows.length} entries from ${ticketsValues.length - 1} tickets`,
      count: rows.length
    });
  } catch (error) {
    Logger.log('Error recalculating: ' + error.toString());
    return createResponse({ success: false, error: error.toString() });
  }
}

/**
 * Update Calculations sheet
 * Tracks SKU + ProductType combinations separately
 * @param {string} sku - Product SKU
 * @param {number} newQty - New quantity (cartons)
 * @param {string} productType - Product type (e.g., "1kg" or "0.5kg")
 * @param {number} oldQty - Old quantity (for updates, 0 for new)
 * @param {boolean} isUpdate - Whether this is an update or new entry
 */
function updateCalculations(sku, newQty, productType, oldQty, isUpdate) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    let calcSheet = sheet.getSheetByName('Calculations');
    
    if (!calcSheet) {
      // Create Calculations sheet with comprehensive headers
      calcSheet = sheet.insertSheet('Calculations');
      calcSheet.getRange(1, 1, 1, 20).setValues([[
        'Date',
        'SKU', 
        'Product Type', 
        'Total Quantity (Cartons)', 
        'Total Pieces', 
        'Number of Tickets',
        'Average Quantity per Ticket',
        'Total Layers',
        'Quality Issues Count',
        'Group Leaders',
        'Banding Types',
        'First Ticket Time',
        'Last Ticket Time',
        'Sachet Type',
        'Tablet Type',
        'Last Change', 
        'Last Updated',
        'Serial Numbers'
      ]]);
      
      // Format header row
      const headerRange = calcSheet.getRange(1, 1, 1, 20);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4285f4');
      headerRange.setFontColor('#ffffff');
      headerRange.setHorizontalAlignment('center');
    } else {
      // Check if old structure exists and migrate if needed
      const headers = calcSheet.getRange(1, 1, 1, calcSheet.getLastColumn()).getValues()[0];
      const headerCount = headers.length;
      
      // If old structure (6 columns or less), migrate to new structure
      if (headerCount <= 6) {
        // Migration happens silently
        
        // Save existing data (skip header row)
        const dataRange = calcSheet.getDataRange();
        const allData = dataRange.getValues();
        const oldData = allData.length > 1 ? allData.slice(1) : [];
        
        // Clear and recreate with new headers
        calcSheet.clear();
      calcSheet.getRange(1, 1, 1, 18).setValues([[
        'Date',
        'SKU', 
        'Product Type', 
        'Total Quantity (Cartons)', 
        'Total Pieces', 
        'Number of Tickets',
        'Average Quantity per Ticket',
        'Total Layers',
        'Quality Issues Count',
        'Group Leaders',
        'Banding Types',
        'First Ticket Time',
        'Last Ticket Time',
        'Sachet Type',
        'Tablet Type',
        'Last Change', 
        'Last Updated',
        'Serial Numbers'
      ]]);
      
      // Format header row
      const headerRange = calcSheet.getRange(1, 1, 1, 18);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#4285f4');
        headerRange.setFontColor('#ffffff');
        headerRange.setHorizontalAlignment('center');
        
        // Note: Old entries will be recalculated from Tickets sheet when tickets are saved/updated
        // Migration complete silently
      }
    }
    
    // Determine product type and multiplier
    const productTypeLower = (productType || '').toLowerCase();
    const is1KG = productTypeLower.includes('1kg') || productTypeLower.includes('1 kg');
    const is05KG = productTypeLower.includes('0.5kg') || productTypeLower.includes('0.5 kg') || productTypeLower.includes('0,5kg');
    
    let productTypeLabel = '';
    let multiplier = 0;
    
    if (is1KG) {
      productTypeLabel = '1KG';
      multiplier = 6;
    } else if (is05KG) {
      productTypeLabel = '0.5KG';
      multiplier = 12;
    } else {
      // If no product type specified, skip calculation
      return;
    }
    
    // Skip full recalc on save for speed; run action=recalculate to refresh Calculations
  } catch (error) {
    // Silent fail - calculations will be recalculated on next operation
  }
}

/**
 * Build analytics center sheets (Summary, SKU Index, SKU detail tabs)
 * @param {Spreadsheet} workbook
 * @param {Array<Object>} groupedData - Output from recalculateAllCalculations
 * @param {Array<Array>} ticketsValues - Raw tickets sheet values (including header)
 */
function buildAnalyticsCenter(workbook, groupedData, ticketsValues) {
  const leaderNameMap = getLeaderNameMap(workbook);
  const analyticsData = computeAnalyticsData(groupedData, ticketsValues, leaderNameMap);
  
  ensureConfigSheet(workbook);
  buildSummarySheet(workbook, analyticsData);
  SpreadsheetApp.flush();
  buildVariantComparisonSheet(workbook, analyticsData);
  SpreadsheetApp.flush();
  buildVisualsSheet(workbook, analyticsData);
  SpreadsheetApp.flush();
  buildShiftSummarySheet(workbook, analyticsData);
  SpreadsheetApp.flush();
  Utilities.sleep(150);
  const skuSheetMeta = buildSkuDetailSheets(workbook, analyticsData);
  SpreadsheetApp.flush();
  Utilities.sleep(150);
  buildSkuIndexSheet(workbook, analyticsData, skuSheetMeta);
  SpreadsheetApp.flush();
  storeAnalyticsCache({
    totals: analyticsData.totals,
    variantStats: analyticsData.variantStats,
    visuals: analyticsData.visuals,
    labels: analyticsData.labels
  });
}

/**
 * Compute aggregates required for dashboards
 */
function computeAnalyticsData(groupedData, ticketsValues, leaderNameMap) {
  leaderNameMap = leaderNameMap || {};
  const today = getStartOfDay(new Date());
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 29);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  
  const dayMap = {};
  const skuMap = {};
  const activeSkuTodaySet = new Set();
  const variantSkuMap = {};
  const variantStats = {};
  const visualsData = {
    rawDaily: [],
    rawScatter: [],
    rawLeaderVariant: [],
    rawSku: []
  };
  
  const totals = {
    cartonsToday: 0,
    piecesToday: 0,
    cartons7d: 0,
    pieces7d: 0,
    cartons30d: 0,
    pieces30d: 0,
    cartonsMTD: 0,
    piecesMTD: 0,
    tickets7d: 0,
    tickets30d: 0,
    layers7d: 0,
    layers30d: 0,
    issues7d: 0,
    issues30d: 0,
    totalCartonsAll: 0,
    totalPiecesAll: 0
  };
  
  totals.avgLayersAll = 0;
  totals.issueRateAll = 0;
  
  if (ticketsValues && ticketsValues.length > 1) {
    for (let i = 1; i < ticketsValues.length; i++) {
      const row = ticketsValues[i];
      let dateValue = row[1];
      let dateStr = '';
      if (dateValue instanceof Date) {
        dateStr = formatDateKey(dateValue);
      } else if (typeof dateValue === 'string' && dateValue.length) {
        dateStr = dateValue.includes('T') ? dateValue.split('T')[0] : dateValue;
      } else if (dateValue) {
        dateStr = dateValue.toString();
      }
      
      const sku = (row[3] || '').toString().trim();
      const qty = parseFloat(row[4]) || 0;
      const productTypeRaw = (row[7] || '').toString().toLowerCase();
      const is1KG = productTypeRaw.includes('1kg') || productTypeRaw.includes('1 kg');
      const is05KG = productTypeRaw.includes('0.5kg') || productTypeRaw.includes('0.5 kg') || productTypeRaw.includes('0,5kg');
      let productTypeLabel = '';
      let multiplier = 0;
      if (is1KG) {
        productTypeLabel = '1KG';
        multiplier = 6;
      } else if (is05KG) {
        productTypeLabel = '0.5KG';
        multiplier = 12;
      } else {
        productTypeLabel = 'Other';
        multiplier = 0;
      }
      
      if (!dateStr || !sku || qty === 0) {
        continue;
      }
      
      const issueFlag = row[10] ? 1 : 0;
      const leaderIds = parseLeaderNames(row[12]);
      const leaderNames = leaderIds.length ? leaderIds.map(function(id) { return toLeaderDisplayName(id, leaderNameMap); }) : ['Unassigned'];
      leaderNames.forEach(function(name) {
        visualsData.rawLeaderVariant.push({
          date: dateStr,
          leader: name || 'Unassigned',
          variant: productTypeLabel,
          tickets: 1,
          cartons: qty,
          issues: issueFlag
        });
      });
      
      visualsData.rawScatter.push({
        date: dateStr,
        variant: productTypeLabel,
        layers: parseFloat(row[5]) || 0,
        palletSize: parseFloat(row[8]) || 0,
        qtyPerTicket: qty
      });
      
      visualsData.rawSku.push({
        date: dateStr,
        variant: productTypeLabel,
        sku: sku,
        cartons: qty,
        pieces: multiplier ? qty * multiplier : 0,
        tickets: 1
      });
    }
  }
  
  groupedData.forEach(function(group) {
    const dateObj = parseIsoDate(group.date);
    if (!dateObj) return;
    
    const variantKey = group.productType || 'Other';
    ensureVariantBucket(variantStats, variantKey);
    ensureVariantSkuBucket(variantSkuMap, variantKey, group.sku);
    accumulateVariantSku(variantSkuMap, variantKey, group.sku, group.totalQty, group.totalPieces, group.numTickets);
    accumulateVariant(variantStats[variantKey].all, group.totalQty, group.totalPieces, group.numTickets, group.totalLayers, group.qualityIssuesCount);
    if (isSameDay(dateObj, today)) {
      accumulateVariant(variantStats[variantKey].today, group.totalQty, group.totalPieces, group.numTickets, group.totalLayers, group.qualityIssuesCount);
    }
    if (dateObj >= sevenDaysAgo && dateObj <= today) {
      accumulateVariant(variantStats[variantKey].seven, group.totalQty, group.totalPieces, group.numTickets, group.totalLayers, group.qualityIssuesCount);
    }
    if (dateObj >= thirtyDaysAgo && dateObj <= today) {
      accumulateVariant(variantStats[variantKey].thirty, group.totalQty, group.totalPieces, group.numTickets, group.totalLayers, group.qualityIssuesCount);
    }
    const dayKey = formatDateKey(dateObj);
    
    if (!dayMap[dayKey]) {
      dayMap[dayKey] = {
        date: dayKey,
        dateObj: dateObj,
        cartons: 0,
        pieces: 0,
        tickets: 0,
        issues: 0,
        skuSet: new Set()
      };
    }
    
    const dayEntry = dayMap[dayKey];
    dayEntry.cartons += group.totalQty;
    dayEntry.pieces += group.totalPieces;
    dayEntry.tickets += group.numTickets;
    dayEntry.issues += group.qualityIssuesCount;
    dayEntry.skuSet.add(group.sku + '|' + group.productType);
    
    totals.totalCartonsAll += group.totalQty;
    totals.totalPiecesAll += group.totalPieces;
    
    if (isSameDay(dateObj, today)) {
      totals.cartonsToday += group.totalQty;
      totals.piecesToday += group.totalPieces;
      activeSkuTodaySet.add(group.sku + '|' + group.productType);
    }
    
    if (dateObj >= sevenDaysAgo && dateObj <= today) {
      totals.cartons7d += group.totalQty;
      totals.pieces7d += group.totalPieces;
      totals.tickets7d += group.numTickets;
      totals.layers7d += group.totalLayers;
      totals.issues7d += group.qualityIssuesCount;
    }
    
    if (dateObj >= thirtyDaysAgo && dateObj <= today) {
      totals.cartons30d += group.totalQty;
      totals.pieces30d += group.totalPieces;
      totals.tickets30d += group.numTickets;
      totals.layers30d += group.totalLayers;
      totals.issues30d += group.qualityIssuesCount;
    }
    
    if (dateObj >= monthStart && dateObj <= today) {
      totals.cartonsMTD += group.totalQty;
      totals.piecesMTD += group.totalPieces;
    }
    
    const skuKey = group.sku + '|' + group.productType;
    if (!skuMap[skuKey]) {
      skuMap[skuKey] = {
        key: skuKey,
        sku: group.sku,
        productType: group.productType,
        data: [],
        totalsAll: { cartons: 0, pieces: 0, tickets: 0, layers: 0, issues: 0 },
        totals7d: { cartons: 0, pieces: 0, tickets: 0, layers: 0, issues: 0 },
        totals30d: { cartons: 0, pieces: 0, tickets: 0, layers: 0, issues: 0 },
        todayCartons: 0,
        lastDate: null,
        leaderSet: new Set(),
        bandingSet: new Set(),
        sachetSet: new Set(),
        tabletSet: new Set(),
        recentIssues: [],
        issueTypes: []
      };
    }
    
    const skuEntry = skuMap[skuKey];
    const leaderDisplayList = formatLeaderList(group.groupLeaders, leaderNameMap);
    
    skuEntry.data.push({
      date: group.date,
      totalQty: group.totalQty,
      totalPieces: group.totalPieces,
      numTickets: group.numTickets,
      avgQty: group.numTickets ? group.totalQty / group.numTickets : 0,
      totalLayers: group.totalLayers,
      qualityIssues: group.qualityIssuesCount,
      groupLeaders: leaderDisplayList,
      bandingTypes: Array.from(group.bandingTypes || []).join(', '),
      firstTime: group.firstTime,
      lastTime: group.lastTime,
      sachet: Array.from(group.sachetTypes || []).join(', '),
      tablet: Array.from(group.tabletTypes || []).join(', '),
      serials: group.serials.join(', ')
    });
    
    skuEntry.totalsAll.cartons += group.totalQty;
    skuEntry.totalsAll.pieces += group.totalPieces;
    skuEntry.totalsAll.tickets += group.numTickets;
    skuEntry.totalsAll.layers += group.totalLayers;
    skuEntry.totalsAll.issues += group.qualityIssuesCount;
    
    if (!skuEntry.lastDate || dateObj > skuEntry.lastDate) {
      skuEntry.lastDate = dateObj;
    }
    
    if (isSameDay(dateObj, today)) {
      skuEntry.todayCartons += group.totalQty;
    }
    
    if (dateObj >= sevenDaysAgo && dateObj <= today) {
      skuEntry.totals7d.cartons += group.totalQty;
      skuEntry.totals7d.pieces += group.totalPieces;
      skuEntry.totals7d.tickets += group.numTickets;
      skuEntry.totals7d.layers += group.totalLayers;
      skuEntry.totals7d.issues += group.qualityIssuesCount;
    }
    
    if (dateObj >= thirtyDaysAgo && dateObj <= today) {
      skuEntry.totals30d.cartons += group.totalQty;
      skuEntry.totals30d.pieces += group.totalPieces;
      skuEntry.totals30d.tickets += group.numTickets;
      skuEntry.totals30d.layers += group.totalLayers;
      skuEntry.totals30d.issues += group.qualityIssuesCount;
    }
    
    (group.groupLeaders || new Set()).forEach(function(leader) {
      if (!leader) return;
      const displayLeader = toLeaderDisplayName(leader, leaderNameMap);
      skuEntry.leaderSet.add(displayLeader);
    });
    
    (group.bandingTypes || new Set()).forEach(function(type) {
      if (type) {
        skuEntry.bandingSet.add(type);
      }
    });
    
    (group.sachetTypes || new Set()).forEach(function(type) {
      if (type) {
        skuEntry.sachetSet.add(type);
      }
    });
    
    (group.tabletTypes || new Set()).forEach(function(type) {
      if (type) {
        skuEntry.tabletSet.add(type);
      }
    });
  });
  
  const issueDetails = collectIssueDetails(ticketsValues, today, sevenDaysAgo, thirtyDaysAgo);
  
  const perSkuArray = Object.keys(skuMap).map(function(key) {
    const entry = skuMap[key];
    const detail = issueDetails[key] || { counts7d: {}, recent: [] };
    entry.recentIssues = detail.recent.slice(0, 5);
    entry.issueTypes = Object.keys(detail.counts7d).map(function(type) {
      return { type: type, count: detail.counts7d[type] };
    }).sort(function(a, b) { return b.count - a.count; });
    entry.issueCount7d = entry.issueTypes.reduce(function(acc, obj) { return acc + obj.count; }, 0);
    entry.avgLayers7d = entry.totals7d.tickets ? entry.totals7d.layers / entry.totals7d.tickets : 0;
    entry.avgLayers30d = entry.totals30d.tickets ? entry.totals30d.layers / entry.totals30d.tickets : 0;
    entry.lastDateStr = entry.lastDate ? formatDateKey(entry.lastDate) : '-';
    entry.dayData = entry.data.sort(function(a, b) {
      return a.date < b.date ? 1 : -1;
    });
    entry.key = key;
    return entry;
  }).sort(function(a, b) {
    if (a.sku === b.sku) {
      return a.productType.localeCompare(b.productType);
    }
    return a.sku.localeCompare(b.sku);
  });
  
  const issuesSummary = [];
  perSkuArray.forEach(function(entry) {
    if (entry.issueCount7d > 0) {
      issuesSummary.push({
        sku: entry.sku,
        productType: entry.productType,
        count: entry.issueCount7d,
        types: entry.issueTypes.slice(0, 3).map(function(obj) {
          return obj.type + ' (' + obj.count + ')';
        }).join(', ')
      });
    }
  });
  
  const perDayArray = Object.keys(dayMap).map(function(key) {
    const item = dayMap[key];
    return {
      date: key,
      cartons: item.cartons,
      pieces: item.pieces,
      tickets: item.tickets,
      issues: item.issues,
      skuCount: item.skuSet.size
    };
  }).sort(function(a, b) {
    return a.date < b.date ? 1 : -1;
  });
  visualsData.rawDaily = perDayArray.slice();
  
  totals.avgLayers7d = totals.tickets7d ? totals.layers7d / totals.tickets7d : 0;
  totals.issueRate7d = totals.tickets7d ? totals.issues7d / totals.tickets7d : 0;
  const allTickets = totals.tickets30d + totals.tickets7d;
  totals.avgLayersAll = allTickets ? (totals.layers30d + totals.layers7d) / allTickets : 0;
  totals.issueRateAll = allTickets ? (totals.issues30d + totals.issues7d) / allTickets : 0;
  totals.activeSkusToday = activeSkuTodaySet.size;
  
  const leaderStats = computeLeaderStats(ticketsValues, today, sevenDaysAgo, leaderNameMap);
  const shiftSummaries = computeShiftBuckets(ticketsValues, leaderNameMap);
  const variantArray = Object.keys(variantStats).map(function(key) {
    const entry = variantStats[key];
    return {
      variant: key,
      all: finalizeVariantBucket(entry.all),
      today: finalizeVariantBucket(entry.today),
      seven: finalizeVariantBucket(entry.seven),
      thirty: finalizeVariantBucket(entry.thirty),
      skuStats: buildVariantSkuStats(variantSkuMap[key] || {})
    };
  }).sort(function(a, b) {
    return a.variant.localeCompare(b.variant);
  });
  
  return {
    today: today,
    totals: totals,
    perDay: perDayArray,
    perSku: perSkuArray,
    leaderTable: leaderStats.table.slice(0, 6),
    issuesSummary: issuesSummary.slice(0, 10),
    issueDetails: issueDetails,
    shiftTable: shiftSummaries,
    multiLeaderTickets: leaderStats.multi,
    leaderlessTickets: leaderStats.leaderless,
    leaderlessTotals: leaderStats.leaderlessTotals,
    variantStats: variantArray,
    visuals: buildVisualsData(visualsData),
    labels: {
      today: formatDisplayDate(today),
      refreshedAt: new Date().toLocaleString()
    }
  };
}

function ensureVariantBucket(container, key) {
  if (!container[key]) {
    container[key] = {
      all: createVariantBucket(),
      today: createVariantBucket(),
      seven: createVariantBucket(),
      thirty: createVariantBucket()
    };
  }
}

function ensureVariantSkuBucket(container, variantKey, sku) {
  if (!container[variantKey]) {
    container[variantKey] = {};
  }
  if (!container[variantKey][sku]) {
    container[variantKey][sku] = { cartons: 0, pieces: 0, tickets: 0 };
  }
}

function accumulateVariantSku(container, variantKey, sku, cartons, pieces, tickets) {
  if (!container[variantKey]) {
    container[variantKey] = {};
  }
  if (!container[variantKey][sku]) {
    container[variantKey][sku] = { cartons: 0, pieces: 0, tickets: 0 };
  }
  container[variantKey][sku].cartons += cartons || 0;
  container[variantKey][sku].pieces += pieces || 0;
  container[variantKey][sku].tickets += tickets || 0;
}

function createVariantBucket() {
  return { cartons: 0, pieces: 0, tickets: 0, layers: 0, issues: 0 };
}

function accumulateVariant(bucket, cartons, pieces, tickets, layers, issues) {
  bucket.cartons += cartons || 0;
  bucket.pieces += pieces || 0;
  bucket.tickets += tickets || 0;
  bucket.layers += layers || 0;
  bucket.issues += issues || 0;
}

function finalizeVariantBucket(bucket) {
  const avgLayers = bucket.tickets ? bucket.layers / bucket.tickets : 0;
  const issueRate = bucket.tickets ? bucket.issues / bucket.tickets : 0;
  return Object.assign({}, bucket, {
    avgLayers: avgLayers,
    issueRate: issueRate
  });
}

function buildVariantSkuStats(skuMap) {
  return Object.keys(skuMap).map(function(sku) {
    return {
      sku: sku,
      cartons: skuMap[sku].cartons,
      pieces: skuMap[sku].pieces,
      tickets: skuMap[sku].tickets
    };
  }).sort(function(a, b) {
    return b.cartons - a.cartons;
  });
}

function buildVisualsData(visualsRaw) {
  const daily = visualsRaw.rawDaily || [];
  const scatter = visualsRaw.rawScatter || [];
  const leaderEntries = visualsRaw.rawLeaderVariant || [];
  const skuEntries = visualsRaw.rawSku || [];
  
  const heatmapMap = {};
  leaderEntries.forEach(function(entry) {
    const key = entry.leader + '|' + entry.variant;
    if (!heatmapMap[key]) {
      heatmapMap[key] = { leader: entry.leader, variant: entry.variant, tickets: 0, cartons: 0, issues: 0 };
    }
    heatmapMap[key].tickets += entry.tickets || 0;
    heatmapMap[key].cartons += entry.cartons || 0;
    heatmapMap[key].issues += entry.issues || 0;
  });
  const heatmap = Object.keys(heatmapMap).map(function(key) {
    return heatmapMap[key];
  }).sort(function(a, b) {
    return b.tickets - a.tickets;
  });
  
  const variantTotals = {};
  skuEntries.forEach(function(entry) {
    if (!variantTotals[entry.variant]) {
      variantTotals[entry.variant] = 0;
    }
    variantTotals[entry.variant] += entry.cartons || 0;
  });
  const variantShare = Object.keys(variantTotals).map(function(variant) {
    return [variant, variantTotals[variant]];
  }).sort(function(a, b) {
    return b[1] - a[1];
  });
  
  const skuTotals = {};
  skuEntries.forEach(function(entry) {
    if (!skuTotals[entry.sku]) {
      skuTotals[entry.sku] = 0;
    }
    skuTotals[entry.sku] += entry.cartons || 0;
  });
  const topSku = Object.keys(skuTotals).map(function(sku) {
    return [sku, skuTotals[sku]];
  }).sort(function(a, b) {
    return b[1] - a[1];
  }).slice(0, 10);
  
  return {
    daily: daily,
    scatter: scatter,
    heatmap: heatmap,
    variantShare: variantShare,
    topSku: topSku,
    raw: visualsRaw
  };
}

/**
 * Ensure Config sheet exists with default headers
 */
function ensureConfigSheet(workbook) {
  let configSheet = workbook.getSheetByName('Config');
  if (!configSheet) {
    configSheet = workbook.insertSheet('Config');
    configSheet.getRange(1, 1, 1, 7).setValues([[
      'SKU',
      'Friendly Name',
      'Category',
      'Product Types',
      'Target Cartons / Day',
      'Alert Threshold',
      'Notes'
    ]]);
    configSheet.getRange('A1:G1').setFontWeight('bold').setBackground('#2d3748').setFontColor('#ffffff');
    configSheet.setColumnWidths(1, 7, 160);
  }
  configSheet.getRange(1, 1, configSheet.getMaxRows(), configSheet.getMaxColumns()).setFontFamily('Cascadia Mono');
}

/**
 * Build Summary sheet with KPI cards and tables
 */
function buildSummarySheet(workbook, analyticsData) {
  let summarySheet = workbook.getSheetByName('Summary');
  if (!summarySheet) {
    summarySheet = workbook.insertSheet('Summary');
  }
  
  summarySheet.clear();
  summarySheet.getRange(1, 1, summarySheet.getMaxRows(), summarySheet.getMaxColumns()).setFontFamily('Cascadia Mono');
  summarySheet.setColumnWidths(1, 8, 200);
  
  summarySheet.getRange('A1:H1').merge().setValue('Banding Analytics Center 📈').setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center').setFontColor('#1a202c').setBackground('#f8fafc');
  summarySheet.getRange('A2:H2').merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs ⚡').setFontSize(12).setFontColor('#4c51bf').setHorizontalAlignment('center');
  summarySheet.getRange('A3:H3').merge().setValue('Refreshed: ' + analyticsData.labels.refreshedAt).setFontSize(10).setFontColor('#718096').setHorizontalAlignment('center');
  
  const cards = [
    { range: 'A5:C7', title: '📦 Cartons Today', value: formatNumber(analyticsData.totals.cartonsToday), subtitle: 'Today (' + analyticsData.labels.today + ')', color: '#4dabf7', note: 'All cartons scanned today across every SKU and pack size.' },
    { range: 'D5:F7', title: '🗓️ Cartons (7d)', value: formatNumber(analyticsData.totals.cartons7d), subtitle: 'Rolling 7 days', color: '#5ad5a9', note: 'Seven-day rolling carton total. Helps spot short-term surges or dips.' },
    { range: 'G5:H7', title: '📊 Cartons (30d)', value: formatNumber(analyticsData.totals.cartons30d), subtitle: 'Rolling 30 days', color: '#ffb347', note: 'Rolling 30-day carton total for medium-term tracking.' },
    { range: 'A8:C10', title: '🧱 Avg Layers (All)', value: formatDecimal(analyticsData.totals.avgLayersAll), subtitle: 'Lifetime per ticket', color: '#9f7aea', note: 'All-time average layers per ticket.' },
    { range: 'D8:F10', title: '⚠️ Issue Rate (All)', value: formatPercent(analyticsData.totals.issueRateAll), subtitle: 'Lifetime issues/ticket', color: '#f56565', note: 'All-time quality issue rate across all tickets.' },
    { range: 'G8:H10', title: '🧑‍🔧 Active SKUs', value: formatNumber(analyticsData.totals.activeSkusToday), subtitle: 'Producing today', color: '#48bb78', note: 'Distinct SKU + pack combinations that produced tickets today.' }
  ];
  
  cards.forEach(function(card) {
    const range = summarySheet.getRange(card.range);
    range.merge();
    range.setValue(card.title + '\n' + card.value + '\n' + card.subtitle);
    range.setBackground(card.color);
    range.setFontColor('#ffffff');
    range.setFontSize(13);
    range.setVerticalAlignment('middle');
    range.setHorizontalAlignment('left');
    range.setWrap(true);
    range.setNote(card.note || '');
  });
  
  const perDayTableStart = 14;
  let startRow = perDayTableStart;
  const perDayRows = analyticsData.perDay.slice(0, 14);
  buildTable(summarySheet, '📅 Production by Day', ['Date', 'Cartons', 'Pieces', 'Tickets', 'Issues', 'Distinct SKUs'], perDayRows.map(function(day) {
    return [day.date, day.cartons, day.pieces, day.tickets, day.issues, day.skuCount];
  }), startRow, { numericColumns: [2, 3, 4, 5, 6] });
  
  startRow += perDayRows.length + 4;
  buildTable(summarySheet, '📦 SKU Performance', ['SKU', 'Product Type', 'Cartons (7d)', 'Cartons (30d)', 'Avg Layers (7d)', 'Issue Rate (7d)', 'Last Production'], analyticsData.perSku.map(function(entry) {
    const issueRate = entry.totals7d.tickets ? entry.totals7d.issues / entry.totals7d.tickets : 0;
    return [
      entry.sku,
      entry.productType,
      entry.totals7d.cartons,
      entry.totals30d.cartons,
      entry.avgLayers7d,
      issueRate,
      entry.lastDateStr
    ];
  }), startRow, { numericColumns: [3, 4], decimalColumns: [5], percentColumns: [6], notes: {5: 'Average is total layers ÷ tickets for this SKU and pack type over the last 7 days.'} });
  
  startRow += analyticsData.perSku.length + 4;
  const multiLeaderRows = (analyticsData.multiLeaderTickets || []).slice(0, 10).map(function(item) {
    return [item.date, item.serial, item.leaders, item.qty];
  });
  buildTable(summarySheet, '🚩 Tickets With Multiple Leaders', ['Date', 'Serial', 'Leaders Entered', 'Cartons'], multiLeaderRows, startRow, {
    numericColumns: [4],
    bodyBackground: '#fff5f5',
    notes: { 4: 'Cartons credited only to first-listed leader. Please correct any duplicate entries.' }
  });
  
  startRow += multiLeaderRows.length + 4;
  const missingLeaderRows = (analyticsData.leaderlessTickets || []).slice(0, 10).map(function(item) {
    return [item.date, item.serial, item.qty, item.sku];
  });
  buildTable(summarySheet, '⚠️ Tickets Missing Leader', ['Date', 'Serial', 'Cartons', 'SKU'], missingLeaderRows, startRow, {
    numericColumns: [3],
    bodyBackground: '#fffbea',
    notes: { 3: 'Leader field blank on ticket; cartons excluded from productivity totals until corrected.' }
  });
  
  startRow += missingLeaderRows.length + 4;
  buildTable(summarySheet, '🛠️ Quality Issues (7d)', ['SKU', 'Product Type', 'Issues', 'Top Issue Types'], analyticsData.issuesSummary.map(function(item) {
    return [item.sku, item.productType, item.count, item.types];
  }), startRow, { numericColumns: [3] });
  
  summarySheet.getRange(startRow + analyticsData.issuesSummary.length + 3, 1, 1, 8).merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
  
  try {
    buildSummaryCharts(summarySheet, perDayTableStart, perDayRows.length);
  } catch (chartError) {
    // Chart build failed silently - non-critical
  }
}

function buildVariantComparisonSheet(workbook, analyticsData) {
  let sheet = workbook.getSheetByName('Variant_Comparison');
  if (!sheet) {
    sheet = workbook.insertSheet('Variant_Comparison');
  }
  
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily('Cascadia Mono');
  sheet.setColumnWidths(1, 10, 150);
  
  sheet.getRange('A1:J1').merge().setValue('Variant Comparison ⚖️').setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#f8fafc').setFontColor('#1a202c');
  sheet.getRange('A2:J2').merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
  sheet.getRange('A3:J3').merge().setValue('0.5KG vs 1KG performance across time windows').setFontColor('#718096').setHorizontalAlignment('center');
  sheet.getRange('A4:J4').merge().setValue('Last refreshed: ' + (analyticsData.labels.refreshedAt || '—')).setFontSize(10).setFontColor('#94a3b8').setHorizontalAlignment('center');
  
  const variants = analyticsData.variantStats || [];
  if (!variants.length) {
    sheet.getRange('A4').setValue('No variant data yet').setFontColor('#a0aec0');
    return;
  }
  
  const periods = [
    { key: 'today', label: 'Today', color: '#4dabf7' },
    { key: 'seven', label: 'Rolling 7 days', color: '#5ad5a9' },
    { key: 'thirty', label: 'Rolling 30 days', color: '#ffb347' },
    { key: 'all', label: 'All Time', color: '#9f7aea' }
  ];
  
  let cardStartRow = 6;
  periods.forEach(function(period, pIndex) {
    variants.forEach(function(variant, vIndex) {
      const row = cardStartRow + pIndex * 4;
      const col = 1 + vIndex * 4;
      const range = sheet.getRange(row, col, 3, 3);
      range.merge();
      const stats = variant[period.key] || {};
      range.setValue(variant.variant + ' • ' + period.label + '\nCartons: ' + formatNumber(stats.cartons || 0) + '\nPieces: ' + formatNumber(stats.pieces || 0));
      range.setBackground(period.color);
      range.setFontColor('#ffffff');
      range.setWrap(true);
      range.setVerticalAlignment('middle');
      range.setHorizontalAlignment('left');
    });
  });
  
  sheet.getRange(cardStartRow + periods.length * 4 + 1, 1, 1, 10).merge().setValue('Variant KPIs • All windows are auto-refreshed after each recalculation').setFontColor('#a0aec0').setHorizontalAlignment('center');
  
  let tableStartRow = cardStartRow + periods.length * 4 + 3;
  const headers = ['Variant', 'Cartons (All)', 'Pieces (All)', 'Tickets (All)', 'Avg Layers', 'Issue Rate', 'Cartons Today', 'Cartons (7d)', 'Cartons (30d)', 'Pieces (30d)'];
  const rows = variants.map(function(variant) {
    return [
      variant.variant,
      variant.all.cartons,
      variant.all.pieces,
      variant.all.tickets,
      variant.all.avgLayers,
      variant.all.issueRate,
      variant.today.cartons,
      variant.seven.cartons,
      variant.thirty.cartons,
      variant.thirty.pieces
    ];
  });
  
  buildTable(sheet, '📊 Variant Overview', headers, rows, tableStartRow, {
    numericColumns: [2, 3, 4, 7, 8, 9, 10],
    decimalColumns: [5],
    percentColumns: [6]
  });
  
  const skuHeaders = ['Variant', 'SKU', 'Cartons', 'Pieces', 'Tickets', 'Contribution %'];
  const skuRows = [];
  (analyticsData.variantStats || []).forEach(function(entry) {
    (entry.skuStats || []).forEach(function(stat) {
      const contribution = entry.all.cartons ? stat.cartons / entry.all.cartons : 0;
      skuRows.push([entry.variant, stat.sku, stat.cartons, stat.pieces, stat.tickets, contribution]);
    });
  });
  
  let skuStartRow = null;
  if (skuRows.length > 0) {
    skuStartRow = tableStartRow + rows.length + 4;
    buildTable(sheet, '🔬 Variant SKU Breakdown', skuHeaders, skuRows, skuStartRow, {
      numericColumns: [3, 4, 5],
      percentColumns: [6]
    });
  }
  
  try {
    buildVariantCharts(sheet, tableStartRow, rows.length, skuStartRow, skuRows.length);
  } catch (variantChartError) {
    // Variant chart build failed silently - non-critical
  }
}

function buildVisualsSheet(workbook, analyticsData) {
  let sheet = workbook.getSheetByName('Visuals');
  if (!sheet) {
    sheet = workbook.insertSheet('Visuals');
  }
  
  let preservedFilters = null;
  try {
    preservedFilters = {
      preset: sheet.getRange('B6').getValue(),
      startDate: sheet.getRange('E6').getValue(),
      endDate: sheet.getRange('F6').getValue()
    };
  } catch (filterError) {
    preservedFilters = null;
  }
  
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily('Cascadia Mono');
  sheet.setColumnWidths(1, 12, 165);
  
  sheet.getRange('A1:L1').merge().setValue('NexGridCore Visual Intelligence 🎨').setFontSize(20).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#1a202c').setFontColor('#f7fafc');
  sheet.getRange('A2:L2').merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs ⚡ | Complete visual storytelling for operations').setFontColor('#4c51bf').setHorizontalAlignment('center');
  sheet.getRange('A3:L3').merge().setValue('Last refreshed: ' + (analyticsData.labels.refreshedAt || '—')).setFontSize(10).setFontColor('#94a3b8').setHorizontalAlignment('center');
  
  const filterConfig = setupVisualFilterControls(sheet, preservedFilters);
  const visuals = analyticsData.visuals || {};
  const filtered = filterVisualData(visuals, filterConfig);
  const rangeLabel = filtered.rangeLabel || 'All Time';
  
  const vizTotals = analyticsData.totals;
  const vizCards = [
    { cell: 'G4:H6', title: 'Total Cartons', subtitle: rangeLabel, value: formatNumber(vizTotals.totalCartonsAll), color: '#4dabf7', note: 'Sum of all cartons produced in the selected range.' },
    { cell: 'I4:J6', title: 'Total Pieces', subtitle: rangeLabel, value: formatNumber(vizTotals.totalPiecesAll), color: '#5ad5a9', note: 'Pieces derived from cartons × pack size.' },
    { cell: 'K4:L6', title: 'Issue Rate', subtitle: 'Lifetime', value: formatPercent(vizTotals.issueRateAll), color: '#f56565', note: 'Quality issues divided by tickets for all time.' }
  ];
  vizCards.forEach(function(card) {
    const range = sheet.getRange(card.cell);
    range.merge();
    range.setValue(card.title + '\n' + card.value + '\n' + card.subtitle);
    range.setBackground(card.color);
    range.setFontColor('#ffffff');
    range.setWrap(true);
    range.setVerticalAlignment('middle');
    range.setHorizontalAlignment('center');
    range.setNote(card.note || '');
  });
  
  let cursorRow = 12;
  sheet.getRange(cursorRow - 1, 1, 1, 12).merge().setValue('Filtered range: ' + rangeLabel + '. Adjust preset/custom dates above, then use Visual Controls → Apply Filters.').setFontColor('#718096');
  
  // Daily trend table
  const dailyData = filtered.daily.length ? filtered.daily : [{date: analyticsData.labels.today, cartons: 0, pieces: 0}];
  sheet.getRange(cursorRow, 1, 1, 3).merge().setValue('Daily Trend • ' + rangeLabel).setFontWeight('bold');
  cursorRow += 1;
  const dailyHeader = sheet.getRange(cursorRow, 1, 1, 3);
  dailyHeader.setValues([['Date', 'Cartons', 'Pieces']]).setFontWeight('bold').setBackground('#edf2f7');
  const dailyValuesRange = sheet.getRange(cursorRow + 1, 1, dailyData.length, 3);
  dailyValuesRange.setValues(dailyData.map(function(item) { return [item.date, item.cartons, item.pieces]; }));
  dailyValuesRange.setNumberFormat('0.00');
  const dailyRange = sheet.getRange(cursorRow, 1, dailyData.length + 1, 3);
  cursorRow += dailyData.length + 2;
  sheet.getRange(cursorRow, 1, 1, 3).merge().setValue('Shows cartons vs pieces produced each day within the selected window.').setFontColor('#718096');
  cursorRow += 2;
  
  // Scatter data
  const scatterRow = 12;
  const scatterData = filtered.scatter.length ? filtered.scatter : [{variant: 'N/A', layers: 0, qtyPerTicket: 0, palletSize: 0}];
  sheet.getRange(scatterRow, 6, 1, 4).merge().setValue('Layers vs Qty per Ticket (Bubble size = pallet) • ' + rangeLabel).setFontWeight('bold');
  sheet.getRange(scatterRow + 1, 6, 1, 4).setValues([['Variant', 'Layers', 'Qty / Ticket', 'Pallet Size']]).setFontWeight('bold').setBackground('#edf2f7');
  const scatterValuesRange = sheet.getRange(scatterRow + 2, 6, scatterData.length, 4);
  scatterValuesRange.setValues(scatterData.map(function(item) { return [item.variant, item.layers, item.qtyPerTicket, item.palletSize]; }));
  scatterValuesRange.setNumberFormat('0.00');
  const scatterRange = sheet.getRange(scatterRow + 1, 6, scatterData.length + 1, 4);
  sheet.getRange(scatterRow + scatterData.length + 3, 6, 1, 4).merge().setValue('Each bubble represents a ticket: X = layers, Y = quantity per ticket, size = pallet size.').setFontColor('#718096');
  
  // Heatmap
  let heatmapRow = Math.max(cursorRow, scatterRow + scatterData.length + 6);
  sheet.getRange(heatmapRow, 1, 1, 6).merge().setValue('Leader vs Variant Heatmap (Tickets) • ' + rangeLabel).setFontWeight('bold');
  heatmapRow += 1;
  const heatmapData = filtered.heatmap || [];
  const leaders = Array.from(new Set(heatmapData.map(function(entry) { return entry.leader; }))).sort();
  const variants = Array.from(new Set(heatmapData.map(function(entry) { return entry.variant; }))).sort();
  let heatmapRange = null;
  if (leaders.length && variants.length) {
    sheet.getRange(heatmapRow, 2, 1, variants.length).setValues([variants]).setFontWeight('bold').setBackground('#edf2f7');
    sheet.getRange(heatmapRow + 1, 1, leaders.length, 1).setValues(leaders.map(function(name) { return [name]; })).setFontWeight('bold').setBackground('#edf2f7');
    const matrix = leaders.map(function(leader) {
      return variants.map(function(variant) {
        const match = heatmapData.find(function(entry) { return entry.leader === leader && entry.variant === variant; });
        return match ? match.tickets : 0;
      });
    });
    heatmapRange = sheet.getRange(heatmapRow + 1, 2, leaders.length, variants.length);
    heatmapRange.setValues(matrix);
    heatmapRange.setNumberFormat('0');
    let maxHeatValue = 0;
    matrix.forEach(function(row) {
      row.forEach(function(value) {
        if (value > maxHeatValue) maxHeatValue = value;
      });
    });
    if (maxHeatValue <= 0) maxHeatValue = 1;
    const rules = sheet.getConditionalFormatRules();
    const heatRule = SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue('#edf2f7', SpreadsheetApp.InterpolationType.NUMBER, '0')
      .setGradientMidpointWithValue('#63b3ed', SpreadsheetApp.InterpolationType.PERCENTILE, '50')
      .setGradientMaxpointWithValue('#1a365d', SpreadsheetApp.InterpolationType.NUMBER, String(maxHeatValue))
      .setRanges([heatmapRange])
      .build();
    rules.push(heatRule);
    sheet.setConditionalFormatRules(rules);
    heatmapRow += leaders.length + 3;
  } else {
    sheet.getRange(heatmapRow, 1, 1, 6).merge().setValue('Heatmap data will appear once the selected range contains tickets.').setFontColor('#a0aec0');
    heatmapRow += 2;
  }
  
  // Variant share + caption
  sheet.getRange(heatmapRow, 1, 1, 4).merge().setValue('Variant Share (Cartons) • ' + rangeLabel).setFontWeight('bold');
  const variantShare = filtered.variantShare.length ? filtered.variantShare : [['N/A', 0]];
  sheet.getRange(heatmapRow + 1, 1, 1, 2).setValues([['Variant', 'Cartons']]).setFontWeight('bold').setBackground('#edf2f7');
  const variantShareRange = sheet.getRange(heatmapRow + 2, 1, variantShare.length, 2);
  variantShareRange.setValues(variantShare);
  variantShareRange.setNumberFormat('0.00');
  const shareRange = sheet.getRange(heatmapRow + 1, 1, variantShare.length + 1, 2);
  
  sheet.getRange(heatmapRow, 6, 1, 4).merge().setValue('Top SKU Output (Cartons) • ' + rangeLabel).setFontWeight('bold');
  const topSku = filtered.topSku.length ? filtered.topSku : [['N/A', 0]];
  sheet.getRange(heatmapRow + 1, 6, 1, 2).setValues([['SKU', 'Cartons']]).setFontWeight('bold').setBackground('#edf2f7');
  const topSkuRange = sheet.getRange(heatmapRow + 2, 6, topSku.length, 2);
  topSkuRange.setValues(topSku);
  topSkuRange.setNumberFormat('0.00');
  const skuRange = sheet.getRange(heatmapRow + 1, 6, topSku.length + 1, 2);
  heatmapRow += Math.max(variantShare.length, topSku.length) + 4;
  
  const chartRanges = {
    daily: dailyRange,
    scatter: scatterRange,
    variantShare: shareRange,
    topSku: skuRange
  };
  
  try {
    buildVisualsCharts(sheet, chartRanges);
  } catch (visualsError) {
    // Visuals chart build failed silently - non-critical
  }
  
  sheet.getRange(heatmapRow, 1, 1, 12).merge().setValue('Tip: change filters above then use Visual Controls → Apply Filters to refresh this dashboard.').setFontColor('#4c51bf').setHorizontalAlignment('center');
}

function setupVisualFilterControls(sheet, defaults) {
  sheet.getRange('A4:B4').merge().setValue('Preset Range').setFontWeight('bold').setBackground('#edf2f7').setHorizontalAlignment('center');
  sheet.getRange('E4:F4').merge().setValue('Custom Dates').setFontWeight('bold').setBackground('#edf2f7').setHorizontalAlignment('center');
  sheet.getRange('A7:F8').merge().setValue('Pick a preset or custom range, then use the Visual Controls menu → Apply Filters to redraw the dashboard.').setWrap(true).setFontColor('#2c5282').setVerticalAlignment('middle').setBackground('#e6fffa');
  
  sheet.getRange('A5').setValue('Choice');
  const presetCell = sheet.getRange('B6');
  const presets = ['Today', 'Last 7 Days', 'Last 30 Days', 'All Time'];
  const validation = SpreadsheetApp.newDataValidation().requireValueInList(presets, true).setAllowInvalid(false).build();
  presetCell.setDataValidation(validation);
  if (defaults && defaults.preset) {
    presetCell.setValue(defaults.preset);
  } else if (!presetCell.getValue()) {
    presetCell.setValue('All Time');
  }
  presetCell.setBackground('#fff5f5');
  
  sheet.getRange('E5').setValue('Start Date');
  sheet.getRange('F5').setValue('End Date');
  const startCell = sheet.getRange('E6');
  const endCell = sheet.getRange('F6');
  startCell.setNumberFormat('yyyy-mm-dd');
  endCell.setNumberFormat('yyyy-mm-dd');
  if (defaults && defaults.startDate) {
    startCell.setValue(defaults.startDate);
  }
  if (defaults && defaults.endDate) {
    endCell.setValue(defaults.endDate);
  }
  
  return getVisualFilterConfig(sheet);
}

function getVisualFilterConfig(sheet) {
  const preset = sheet.getRange('B6').getValue() || 'All Time';
  const startDate = normalizeDateValue(sheet.getRange('E6').getValue());
  const endDate = normalizeDateValue(sheet.getRange('F6').getValue());
  return {
    preset: preset,
    startDate: startDate,
    endDate: endDate
  };
}

function filterVisualData(visuals, config) {
  const raw = visuals.raw || {};
  const rawDaily = raw.rawDaily || visuals.daily || [];
  const rawScatter = raw.rawScatter || visuals.scatter || [];
  const rawLeader = raw.rawLeaderVariant || [];
  const rawSku = raw.rawSku || [];
  
  const rangeInfo = computeFilterRange(config);
  function withinRange(dateStr) {
    if (!rangeInfo.start || !rangeInfo.end) {
      return true;
    }
    const dateObj = parseIsoDate(dateStr);
    if (!dateObj) {
      return false;
    }
    return dateObj >= rangeInfo.start && dateObj <= rangeInfo.end;
  }
  
  const daily = rawDaily.filter(function(entry) { return withinRange(entry.date); });
  const scatter = rawScatter.filter(function(entry) { return withinRange(entry.date); });
  const leaderEntries = rawLeader.filter(function(entry) { return withinRange(entry.date); });
  const skuEntries = rawSku.filter(function(entry) { return withinRange(entry.date); });
  
  return {
    daily: daily,
    scatter: scatter,
    heatmap: aggregateLeaderVariantEntries(leaderEntries),
    variantShare: aggregateVariantShareFromEntries(skuEntries),
    topSku: aggregateTopSkuFromEntries(skuEntries),
    rangeLabel: rangeInfo.label
  };
}

function computeFilterRange(config) {
  const today = normalizeDateValue(new Date());
  let start = null;
  let end = null;
  let label = 'All Time';
  const preset = (config.preset || 'All Time').toString();
  switch (preset) {
    case 'Today':
      start = today;
      end = today;
      label = 'Today';
      break;
    case 'Last 7 Days':
      start = new Date(today);
      start.setDate(today.getDate() - 6);
      end = today;
      label = 'Last 7 Days';
      break;
    case 'Last 30 Days':
      start = new Date(today);
      start.setDate(today.getDate() - 29);
      end = today;
      label = 'Last 30 Days';
      break;
    default:
      start = null;
      end = null;
      label = 'All Time';
      break;
  }
  
  if (config.startDate && config.endDate) {
    start = config.startDate;
    end = config.endDate;
    if (start && end && start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    if (start && end) {
      const tz = Session.getScriptTimeZone();
      label = Utilities.formatDate(start, tz, 'MMM d, yyyy') + ' → ' + Utilities.formatDate(end, tz, 'MMM d, yyyy');
    }
  }
  
  return { start: start, end: end, label: label };
}

function aggregateLeaderVariantEntries(entries) {
  const map = {};
  entries.forEach(function(entry) {
    const leader = entry.leader || 'Unassigned';
    const variant = entry.variant || 'Other';
    const key = leader + '|' + variant;
    if (!map[key]) {
      map[key] = { leader: leader, variant: variant, tickets: 0, cartons: 0, issues: 0 };
    }
    map[key].tickets += entry.tickets || 0;
    map[key].cartons += entry.cartons || 0;
    map[key].issues += entry.issues || 0;
  });
  return Object.keys(map).map(function(key) { return map[key]; }).sort(function(a, b) {
    return b.tickets - a.tickets;
  });
}

function aggregateVariantShareFromEntries(entries) {
  const variantTotals = {};
  entries.forEach(function(entry) {
    const variant = entry.variant || 'Other';
    variantTotals[variant] = (variantTotals[variant] || 0) + (entry.cartons || 0);
  });
  return Object.keys(variantTotals).map(function(variant) {
    return [variant, variantTotals[variant]];
  }).sort(function(a, b) { return b[1] - a[1]; });
}

function aggregateTopSkuFromEntries(entries) {
  const skuTotals = {};
  entries.forEach(function(entry) {
    const sku = entry.sku || 'Unknown SKU';
    skuTotals[sku] = (skuTotals[sku] || 0) + (entry.cartons || 0);
  });
  return Object.keys(skuTotals).map(function(sku) {
    return [sku, skuTotals[sku]];
  }).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);
}

function getAnalyticsPropertyStore() {
  try {
    const docProps = PropertiesService.getDocumentProperties();
    if (docProps) {
      return docProps;
    }
  } catch (docErr) {
    // Fallback to script properties silently
  }
  return PropertiesService.getScriptProperties();
}

function storeAnalyticsCache(payload) {
  try {
    getAnalyticsPropertyStore().setProperty('NEXGRIDCORE_ANALYTICS_CACHE', JSON.stringify(payload));
  } catch (cacheError) {
    // Cache failed silently - non-critical
  }
}

function loadAnalyticsCache() {
  try {
    const data = getAnalyticsPropertyStore().getProperty('NEXGRIDCORE_ANALYTICS_CACHE');
    return data ? JSON.parse(data) : null;
  } catch (cacheError) {
    // Cache read failed - return null silently
    return null;
  }
}

function refreshVisualsDashboard() {
  const cached = loadAnalyticsCache();
  if (!cached) {
    SpreadsheetApp.getUi().alert('No cached analytics data found. Please run the full recalculation first.');
    return;
  }
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  buildVisualsSheet(workbook, cached);
  SpreadsheetApp.getUi().alert('Visuals dashboard refreshed with current filters.');
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Visual Controls')
    .addItem('Apply Filters', 'refreshVisualsDashboard')
    .addToUi();
  ui.createMenu('Data')
    .addItem('Refresh Analytics', 'runRefreshAnalyticsFromMenu')
    .addItem('Organize Sheets (Landing, Colors, Order)', 'runOrganizeSheetsFromMenu')
    .addSeparator()
    .addItem('Show Config & Backend Sheets…', 'showPasswordDialogForSensitiveSheets')
    .addItem('Hide Config & Backend Sheets', 'runHideSensitiveSheetsFromMenu')
    .addSeparator()
    .addItem('Set Admin Password…', 'showSetAdminPasswordDialog')
    .addToUi();
}

function runRefreshAnalyticsFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
  SpreadsheetApp.getUi().alert('Refreshing analytics. This may take a minute…');
  var result = recalculateAllCalculations(ss, false);
  if (result && result.success) {
    var summary = ss.getSheetByName('Summary');
    if (summary) ss.setActiveSheet(summary);
    SpreadsheetApp.getUi().alert('Analytics refreshed. Last refresh time is shown on each sheet.');
  } else {
    SpreadsheetApp.getUi().alert(result && result.error ? result.error : 'Refresh failed. Try again or run Recalculate from the web app.');
  }
}

/**
 * Organize sheets: Landing page, tab colors, logical order. Hide sensitive sheets.
 * Call from menu or API (action=organizeSheets).
 */
function organizeSheetsWithLanding(workbook, hideSensitive) {
  workbook = workbook || SpreadsheetApp.openById(SHEET_ID);
  hideSensitive = hideSensitive !== false;
  var sheets = workbook.getSheets();
  var sheetMap = {};
  sheets.forEach(function(s) { sheetMap[s.getName()] = s; });

  // Ensure Landing sheet exists
  var landing = sheetMap['Landing'] || workbook.insertSheet('Landing', 0);
  if (!sheetMap['Landing']) sheetMap['Landing'] = landing;

  // Build table of contents on Landing
  var tocRows = [['Section', 'Sheet', 'Link']];
  var sectionOrder = ['Landing', 'Analytics', 'Backend', 'Config'];
  sectionOrder.forEach(function(sectionKey) {
    var group = SHEET_GROUPS[sectionKey];
    if (!group) return;
    tocRows.push(['', '── ' + sectionKey + ' ──', '']);
    var toProcess = group.sheets.slice();
    if (sectionKey === 'Analytics') {
      sheets.forEach(function(s) {
        var n = s.getName();
        if (n.indexOf('SKU_') === 0 && toProcess.indexOf(n) < 0) toProcess.push(n);
      });
    }
    toProcess.forEach(function(name) {
      var sh = sheetMap[name] || workbook.getSheetByName(name);
      if (!sh) return;
      var gid = sh.getSheetId();
      tocRows.push([sectionKey, name, '=HYPERLINK("#gid=' + gid + '","Open")']);
    });
    tocRows.push(['', '', '']);
  });

  landing.clear();
  landing.getRange(1, 1, 1, 3).merge().setValue('RetiFlux™ IMS Sheet Index').setFontSize(18).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  landing.getRange(2, 1, 2, 3).merge().setValue('Use links below to navigate. Config & Backend sheets hidden by default.').setFontSize(11).setFontColor('#64748b');
  if (tocRows.length > 0) {
    landing.getRange(4, 1, tocRows.length, 3).setValues(tocRows);
  }
  landing.getRange(4, 1, 4, 3).setFontWeight('bold').setBackground('#e2e8f0');
  landing.setColumnWidths(1, 3, 120);

  // Set tab colors by group
  var colorMap = {};
  Object.keys(SHEET_GROUPS).forEach(function(k) {
    var c = SHEET_GROUPS[k].color || '9ca3af';
    (SHEET_GROUPS[k].sheets || []).forEach(function(n) { colorMap[n] = c; });
  });
  workbook.getSheets().forEach(function(s) {
    var n = s.getName();
    var col = colorMap[n] || (n.indexOf('SKU_') === 0 ? '34d399' : '9ca3af');
    try { s.setTabColor(col); } catch (e) {}
  });

  // Ensure Landing is first
  if (landing.getIndex() !== 1) {
    try {
      workbook.setActiveSheet(landing);
      workbook.moveActiveSheet(0);
    } catch (err) {}
  }

  if (hideSensitive) {
    SENSITIVE_SHEETS.forEach(function(name) {
      var sh = sheetMap[name] || workbook.getSheetByName(name);
      if (sh && !sh.isSheetHidden()) try { sh.hideSheet(); } catch (e) {}
    });
  }
  SpreadsheetApp.flush();
  return { success: true, message: 'Sheets organized. Landing updated.' };
}

function runOrganizeSheetsFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
  organizeSheetsWithLanding(ss, true);
  SpreadsheetApp.getUi().alert('Sheets organized. Landing is first. Config & Backend are hidden.');
}

function hideSensitiveSheets(workbook) {
  workbook = workbook || SpreadsheetApp.openById(SHEET_ID);
  var sheetMap = {};
  workbook.getSheets().forEach(function(s) { sheetMap[s.getName()] = s; });
  SENSITIVE_SHEETS.forEach(function(name) {
    var sh = sheetMap[name] || workbook.getSheetByName(name);
    if (sh && !sh.isSheetHidden()) try { sh.hideSheet(); } catch (e) {}
  });
  SpreadsheetApp.flush();
}

function showSensitiveSheets(workbook) {
  workbook = workbook || SpreadsheetApp.openById(SHEET_ID);
  var sheetMap = {};
  workbook.getSheets().forEach(function(s) { sheetMap[s.getName()] = s; });
  SENSITIVE_SHEETS.forEach(function(name) {
    var sh = sheetMap[name] || workbook.getSheetByName(name);
    if (sh && sh.isSheetHidden()) try { sh.showSheet(); } catch (e) {}
  });
  SpreadsheetApp.flush();
}

function getAdminSheetPassword() {
  try {
    return PropertiesService.getScriptProperties().getProperty(ADMIN_PASSWORD_KEY) || '';
  } catch (e) { return ''; }
}

function setAdminSheetPassword(newPassword) {
  var p = (newPassword || '').toString().trim();
  PropertiesService.getScriptProperties().setProperty(ADMIN_PASSWORD_KEY, p);
  return true;
}

function checkPasswordAndShowSheets(password) {
  var stored = getAdminSheetPassword();
  if (!stored) {
    SpreadsheetApp.getUi().alert('No admin password set. Use Data > Set Admin Password… first.');
    return false;
  }
  if (password !== stored) {
    SpreadsheetApp.getUi().alert('Incorrect password.');
    return false;
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
  showSensitiveSheets(ss);
  SpreadsheetApp.getUi().alert('Config & Backend sheets are now visible.');
  return true;
}

function showPasswordDialogForSensitiveSheets() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;padding:16px;min-width:260px">' +
    '<p><strong>Enter Admin Password</strong></p>' +
    '<input type="password" id="pwd" style="width:100%;margin:8px 0;padding:6px" placeholder="Password" />' +
    '<br/><button onclick="submitPwd()" style="margin-top:8px;padding:6px 14px">OK</button>' +
    '</div>' +
    '<script>function submitPwd(){var p=document.getElementById("pwd").value;if(!p){alert("Enter password");return;}google.script.run.withSuccessHandler(function(ok){if(ok)google.script.host.close();}).withFailureHandler(function(e){alert("Error: "+e);}).checkPasswordAndShowSheets(p);}</script>'
  ).setWidth(300).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, 'Show Config & Backend Sheets');
}

function showSetAdminPasswordDialog() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;padding:16px;min-width:260px">' +
    '<p><strong>Set Admin Password</strong></p>' +
    '<p style="font-size:11px;color:#666">Used to show Config & Backend sheets.</p>' +
    '<input type="password" id="pwd" style="width:100%;margin:8px 0;padding:6px" placeholder="New password" />' +
    '<br/><button onclick="submitPwd()" style="margin-top:8px;padding:6px 14px">Save</button>' +
    '</div>' +
    '<script>function submitPwd(){var p=document.getElementById("pwd").value;if(!p){alert("Enter a password");return;}google.script.run.withSuccessHandler(function(){alert("Password saved.");google.script.host.close();}).withFailureHandler(function(e){alert("Error: "+e);}).setAdminSheetPassword(p);}</script>'
  ).setWidth(300).setHeight(160);
  SpreadsheetApp.getUi().showModalDialog(html, 'Set Admin Password');
}

function runHideSensitiveSheetsFromMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
  hideSensitiveSheets(ss);
  SpreadsheetApp.getUi().alert('Config & Backend sheets are now hidden.');
}

/**
 * Build shift-level intelligence sheet
 */
function buildShiftSummarySheet(workbook, analyticsData) {
  let shiftSheet = workbook.getSheetByName('Shift_Summary');
  if (!shiftSheet) {
    shiftSheet = workbook.insertSheet('Shift_Summary');
  }
  
  shiftSheet.clear();
  shiftSheet.getRange(1, 1, shiftSheet.getMaxRows(), shiftSheet.getMaxColumns()).setFontFamily('Cascadia Mono');
  shiftSheet.setColumnWidths(1, 10, 190);
  
  shiftSheet.getRange('A1:J1').merge().setValue('Shift Intelligence Hub 🌗').setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#f8fafc').setFontColor('#1a202c').setNote('Shift-by-shift performance with leader accountability and SKU mix.');
  shiftSheet.getRange('A2:J2').merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs ⚡').setFontSize(12).setFontColor('#4c51bf').setHorizontalAlignment('center');
  shiftSheet.getRange('A3:J3').merge().setValue('Shifts auto-classified: Day (08:00-18:00) • Night (18:00-08:00)').setFontColor('#718096').setHorizontalAlignment('center');
  shiftSheet.getRange('A4:J4').merge().setValue('Last refreshed: ' + (analyticsData.labels.refreshedAt || '—')).setFontSize(10).setFontColor('#94a3b8').setHorizontalAlignment('center');
  
  const headers = ['Date', 'Shift', 'Cartons', 'Pieces', 'Tickets', 'Issues', 'Group Leaders (cartons)', 'SKU Output (cartons)', 'Banding Mix', 'Time Window'];
  const rows = (analyticsData.shiftTable || []).map(function(shift) {
    return [
      shift.date,
      shift.label,
      shift.cartons,
      shift.pieces,
      shift.tickets,
      shift.issues,
      shift.leadersText || '—',
      shift.skuText || '—',
      shift.bandingText || '—',
      shift.timeRange || shift.window
    ];
  });
  
  const startRow = 5;
  buildTable(shiftSheet, '🌗 Shift Performance', headers, rows, startRow, {
    numericColumns: [3, 4, 5, 6],
    textColumns: [10]
  });
  
  const headerRow = shiftSheet.getRange(startRow + 1, 1, 1, headers.length);
  headerRow.getCell(1, 7).setNote('Leaders ranked by cartons produced during the shift.');
  headerRow.getCell(1, 8).setNote('SKU + pack combinations contributing to the shift total.');
  headerRow.getCell(1, 9).setNote('Banding styles applied (comma-separated).');
  
  shiftSheet.getRange(startRow + rows.length + 3, 1, 1, headers.length).merge().setValue('Need deeper diagnostics? Filter by date or shift and drill into SKU tabs.').setFontColor('#4c51bf').setHorizontalAlignment('center');
}

function buildSummaryCharts(sheet, perDayStartRow, perDayCount) {
  try {
    sheet.getCharts().forEach(function(chart) {
      sheet.removeChart(chart);
    });
  } catch (err) {
    // Chart clearing failed silently - non-critical
  }
  
  if (perDayCount > 0) {
    const trendRange = sheet.getRange(perDayStartRow + 1, 1, perDayCount + 1, 2);
    const trendChart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(trendRange)
      .setOption('title', 'Daily Cartons Trend')
      .setOption('legend', 'none')
      .setOption('curveType', 'function')
      .setPosition(perDayStartRow, 9, 0, 0)
      .build();
    sheet.insertChart(trendChart);
    
    if (perDayCount > 1) {
      const piecesRange = sheet.getRange(perDayStartRow + 1, 1, perDayCount + 1, 3);
      const piecesChart = sheet.newChart()
        .setChartType(Charts.ChartType.COLUMN)
        .addRange(piecesRange)
        .setOption('title', 'Cartons vs Pieces')
        .setOption('legend', { position: 'bottom' })
        .setPosition(perDayStartRow + 20, 9, 0, 0)
        .build();
      sheet.insertChart(piecesChart);
    }
  }
}

function buildVisualsCharts(sheet, ranges) {
  try {
    sheet.getCharts().forEach(function(chart) {
      sheet.removeChart(chart);
    });
  } catch (err) {
    // Chart clearing failed silently - non-critical
  }
  
  if (ranges.daily && ranges.daily.getNumRows() > 1) {
    const trendChart = sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(ranges.daily)
      .setOption('title', 'Daily Cartons vs Pieces')
      .setOption('legend', { position: 'bottom' })
      .setOption('curveType', 'function')
      .setPosition(ranges.daily.getRow() + ranges.daily.getNumRows() + 1, 5, 0, 0)
      .build();
    sheet.insertChart(trendChart);
  }
  
  if (ranges.scatter && ranges.scatter.getNumRows() > 1) {
    const scatterChart = sheet.newChart()
      .setChartType(Charts.ChartType.BUBBLE)
      .addRange(ranges.scatter)
      .setOption('title', 'Layers vs Qty per Ticket (Bubble size = Pallet)')
      .setOption('legend', { position: 'right' })
      .setPosition(ranges.scatter.getRow() + ranges.scatter.getNumRows() + 1, 10, 0, 0)
      .build();
    sheet.insertChart(scatterChart);
  }
  
  if (ranges.variantShare && ranges.variantShare.getNumRows() > 1) {
    const columnChart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(ranges.variantShare)
      .setOption('title', 'Variant Share (Cartons)')
      .setOption('legend', 'none')
      .setPosition(ranges.variantShare.getRow() + ranges.variantShare.getNumRows() + 2, 5, 0, 0)
      .build();
    sheet.insertChart(columnChart);
  }
  
  if (ranges.topSku && ranges.topSku.getNumRows() > 1) {
    const skuChart = sheet.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(ranges.topSku)
      .setOption('title', 'Top SKU Output')
      .setOption('legend', 'none')
      .setPosition(ranges.topSku.getRow() + ranges.topSku.getNumRows() + 2, 10, 0, 0)
      .build();
    sheet.insertChart(skuChart);
  }
}

function buildVariantCharts(sheet, tableStartRow, variantCount, skuStartRow, skuCount) {
  try {
    sheet.getCharts().forEach(function(chart) {
      sheet.removeChart(chart);
    });
  } catch (err) {
    // Variant chart clearing failed silently - non-critical
  }
  
  if (variantCount > 0) {
    const overviewRange = sheet.getRange(tableStartRow + 1, 1, variantCount + 1, 2);
    const columnChart = sheet.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(overviewRange)
      .setOption('title', 'Cartons by Variant (All Time)')
      .setOption('legend', 'none')
      .setPosition(tableStartRow, 12, 0, 0)
      .build();
    sheet.insertChart(columnChart);
    
    const shareRange = sheet.getRange(tableStartRow + 1, 1, variantCount + 1, 2);
    const pieChart = sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(shareRange)
      .setOption('title', 'Variant Share (Cartons All Time)')
      .setPosition(tableStartRow + 18, 12, 0, 0)
      .build();
    sheet.insertChart(pieChart);
  }
  
  if (skuCount && skuStartRow) {
    const displayCount = Math.min(skuCount, 10);
    const skuRange = sheet.getRange(skuStartRow + 1, 1, displayCount + 1, 3);
    const skuChart = sheet.newChart()
      .setChartType(Charts.ChartType.BAR)
      .addRange(skuRange)
      .setOption('title', 'Top SKU Contributors (Cartons)')
      .setOption('legend', 'none')
      .setPosition(skuStartRow, 12, 0, 0)
      .build();
    sheet.insertChart(skuChart);
  }
}

/**
 * Build SKU detail sheets
 * @returns {Object} map of SKU keys to sheet metadata
 */
function buildSkuDetailSheets(workbook, analyticsData) {
  const existingSheets = workbook.getSheets().filter(function(s) {
    return s.getName().indexOf('SKU_') === 0;
  });
  const keepSheetNames = new Set();
  const sheetMeta = {};
  
  analyticsData.perSku.forEach(function(entry) {
    let sheetName = createSkuSheetName(entry.sku, entry.productType);
    let uniqueName = sheetName;
    let counter = 2;
    while (keepSheetNames.has(uniqueName)) {
      uniqueName = sheetName + '_' + counter;
      counter++;
    }
    sheetName = uniqueName;
    keepSheetNames.add(sheetName);
    
    let skuSheet = workbook.getSheetByName(sheetName);
    if (!skuSheet) {
      skuSheet = workbook.insertSheet(sheetName);
    }
    
    skuSheet.clear();
    skuSheet.getRange(1, 1, skuSheet.getMaxRows(), skuSheet.getMaxColumns()).setFontFamily('Cascadia Mono');
    skuSheet.setColumnWidths(1, 12, 190);
    
    skuSheet.getRange('A1:H1').merge().setValue('SKU Analytics • ' + entry.sku + ' • ' + entry.productType).setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#edf2f7');
    skuSheet.getRange('A2:H2').merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
    
    const skuCards = [
      { range: 'A4:C6', title: '📦 Cartons Today', value: formatNumber(entry.todayCartons), subtitle: 'Today', color: '#4dabf7' },
      { range: 'D4:E6', title: '🗓️ Cartons (7d)', value: formatNumber(entry.totals7d.cartons), subtitle: 'Rolling 7d', color: '#5ad5a9' },
      { range: 'F4:H6', title: '📈 Cartons (30d)', value: formatNumber(entry.totals30d.cartons), subtitle: 'Rolling 30d', color: '#ffb347' },
      { range: 'A7:C9', title: '🧱 Avg Layers (7d)', value: formatDecimal(entry.avgLayers7d), subtitle: 'Per ticket', color: '#9f7aea' },
      { range: 'D7:E9', title: '🎯 Tickets (7d)', value: formatNumber(entry.totals7d.tickets), subtitle: 'Rolling 7d', color: '#63b3ed' },
      { range: 'F7:H9', title: '⚠️ Issues (7d)', value: formatNumber(entry.totals7d.issues), subtitle: 'Rolling 7d', color: '#f56565' }
    ];
    
    skuCards.forEach(function(card) {
      const range = skuSheet.getRange(card.range);
      range.merge();
      range.setValue(card.title + '\n' + card.value + '\n' + card.subtitle);
      range.setBackground(card.color);
      range.setFontColor('#ffffff');
      range.setWrap(true);
      range.setHorizontalAlignment('left');
      range.setVerticalAlignment('middle');
    });
    
    const tableStartRow = 11;
    const tableData = entry.dayData.slice(0, 30).map(function(row) {
      const issueRate = row.numTickets ? row.qualityIssues / row.numTickets : 0;
      return [
        row.date,
        row.totalQty,
        row.totalPieces,
        row.numTickets,
        row.avgQty,
        row.totalLayers,
        row.bandingTypes,
        row.groupLeaders,
        formatTimeRange(row.firstTime, row.lastTime),
        row.sachet,
        row.tablet,
        issueRate
      ];
    });
    
    buildTable(skuSheet, '📋 Recent Production', ['Date', 'Cartons', 'Pieces', 'Tickets', 'Avg Qty', 'Layers', 'Banding Types', 'Group Leaders', 'Time Window', 'Sachet', 'Tablet', 'Issue Rate'], tableData, tableStartRow, {
      numericColumns: [2, 3, 4, 6],
      decimalColumns: [5],
    percentColumns: [12],
    textColumns: [9]
    });
    
    const issuesStart = tableStartRow + tableData.length + 4;
    const issueRows = entry.recentIssues.length ? entry.recentIssues : [{ date: '-', type: 'No issues', description: '-', serial: '-' }];
    buildTable(skuSheet, '🛠️ Recent Issues', ['Date', 'Type', 'Description', 'Serial'], issueRows.map(function(item) {
      return [item.date, item.type, item.description, item.serial || '-'];
    }), issuesStart, {});
    
    skuSheet.getRange(issuesStart + issueRows.length + 3, 1, 1, 8).merge().setValue('Banding data • ' + entry.sku + ' • ' + entry.productType).setFontColor('#a0aec0').setHorizontalAlignment('center');
    
    sheetMeta[entry.key] = {
      sheetName: sheetName,
      sheetId: skuSheet.getSheetId()
    };
  });
  
  existingSheets.forEach(function(sheet) {
    if (!keepSheetNames.has(sheet.getName())) {
      workbook.deleteSheet(sheet);
    }
  });
  
  return sheetMeta;
}

/**
 * Build SKU index sheet with links to detail tabs
 */
function buildSkuIndexSheet(workbook, analyticsData, sheetMeta) {
  let indexSheet = workbook.getSheetByName('SKU_Index');
  if (!indexSheet) {
    indexSheet = workbook.insertSheet('SKU_Index');
  }
  
  indexSheet.clear();
  indexSheet.getRange(1, 1, indexSheet.getMaxRows(), indexSheet.getMaxColumns()).setFontFamily('Cascadia Mono');
  indexSheet.setColumnWidths(1, 8, 190);
  
  indexSheet.getRange('A1:H1').merge().setValue('SKU Directory 📚').setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#edf2f7');
  indexSheet.getRange('A2:H2').merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
  
  const header = ['SKU', 'Product Type', 'Cartons (7d)', 'Cartons (30d)', 'Last Production', 'Leaders', 'Status', 'Open'];
  const rows = analyticsData.perSku.map(function(entry) {
    const key = entry.key;
    const meta = sheetMeta[key];
    const link = meta ? '=HYPERLINK("#gid=' + meta.sheetId + '","View")' : '';
    const status = entry.totals7d.cartons > 0 ? '🟢 Active' : '⚠️ Idle';
    return [
      entry.sku,
      entry.productType,
      entry.totals7d.cartons,
      entry.totals30d.cartons,
      entry.lastDateStr,
      Array.from(entry.leaderSet).join(', '),
      status,
      link
    ];
  });
  
  buildTable(indexSheet, '📌 Overview', header, rows, 4, { numericColumns: [3, 4] });
}

/**
 * Shared helper to build tables with title + header styling
 */
function buildTable(sheet, title, headers, rows, startRow, options) {
  options = options || {};

  const titleRange = sheet.getRange(startRow, 1, 1, headers.length);
  titleRange.merge().setValue(title).setFontWeight('bold').setFontColor('#2d3748').setBackground('#e2e8f0');
  
  const headerRange = sheet.getRange(startRow + 1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold').setBackground('#2d3748').setFontColor('#ffffff');
  if (options.columnWidth) {
    sheet.setColumnWidths(1, headers.length, options.columnWidth);
  }
  if (options.notes) {
    Object.keys(options.notes).forEach(function(colIndex) {
      const col = parseInt(colIndex, 10);
      if (!isNaN(col) && col >= 1 && col <= headers.length) {
        sheet.getRange(startRow + 1, col).setNote(options.notes[colIndex]);
      }
    });
  }

  if (rows.length > 0) {
    const bodyRange = sheet.getRange(startRow + 2, 1, rows.length, headers.length);
    bodyRange.setValues(rows);
    const bodyBg = options.bodyBackground || '#f8fafc';
    bodyRange.setBackground(bodyBg);
    if (options.bodyFontColor) {
      bodyRange.setFontColor(options.bodyFontColor);
    }
    if (options.wrap !== false) {
      bodyRange.setWrap(true);
      bodyRange.setVerticalAlignment('top');
    }
    
    if (options.numericColumns) {
      options.numericColumns.forEach(function(col) {
        applyNumberFormatToColumn(sheet, startRow + 2, rows.length, col, '#,##0');
      });
    }
    if (options.decimalColumns) {
      options.decimalColumns.forEach(function(col) {
        applyNumberFormatToColumn(sheet, startRow + 2, rows.length, col, '#,##0.00');
      });
    }
    if (options.percentColumns) {
      options.percentColumns.forEach(function(col) {
        applyNumberFormatToColumn(sheet, startRow + 2, rows.length, col, '0.0%');
      });
    }
    if (options.textColumns) {
      options.textColumns.forEach(function(col) {
        applyNumberFormatToColumn(sheet, startRow + 2, rows.length, col, '@');
      });
    }
  } else {
    const placeholderRange = sheet.getRange(startRow + 2, 1, 1, headers.length);
    placeholderRange.merge().setValue('No data yet').setFontColor('#a0aec0').setHorizontalAlignment('center');
    placeholderRange.setBackground(options.bodyBackground || '#f8fafc');
    if (options.bodyFontColor) {
      placeholderRange.setFontColor(options.bodyFontColor);
    }
    if (options.textColumns) {
      options.textColumns.forEach(function(col) {
        applyNumberFormatToColumn(sheet, startRow + 2, 1, col, '@');
      });
    }
  }
}

function applyNumberFormatToColumn(sheet, startRow, rowCount, columnIndex, format) {
  if (!rowCount || rowCount <= 0) return;
  const maxCols = sheet.getMaxColumns();
  if (columnIndex < 1 || columnIndex > maxCols) return;
  sheet.getRange(startRow, columnIndex, rowCount, 1).setNumberFormat(format);
}

/**
 * Collect issue details from Tickets sheet raw data
 */
function collectIssueDetails(ticketsValues, today, sevenDaysAgo, thirtyDaysAgo) {
  const issueMap = {};
  for (let i = 1; i < ticketsValues.length; i++) {
    const row = ticketsValues[i];
    const sku = (row[3] || '').toString().trim();
    if (!sku) continue;
    const productTypeLabel = getProductTypeLabel(row[7]);
    if (!productTypeLabel) continue;
    const dateObj = normalizeDateValue(row[1]);
    if (!dateObj) continue;
    const key = sku + '|' + productTypeLabel;
    if (!issueMap[key]) {
      issueMap[key] = { counts7d: {}, counts30d: {}, recent: [] };
    }
    const issueType = (row[10] || '').toString().trim();
    const issueDesc = (row[11] || '').toString().trim();
    
    if (issueType) {
      if (dateObj >= sevenDaysAgo && dateObj <= today) {
        issueMap[key].counts7d[issueType] = (issueMap[key].counts7d[issueType] || 0) + 1;
      }
      if (dateObj >= thirtyDaysAgo && dateObj <= today) {
        issueMap[key].counts30d[issueType] = (issueMap[key].counts30d[issueType] || 0) + 1;
        issueMap[key].recent.push({
          date: formatDateKey(dateObj),
          type: issueType,
          description: issueDesc || 'No description',
          serial: row[0] || ''
        });
      }
    }
  }
  
  Object.keys(issueMap).forEach(function(key) {
    issueMap[key].recent.sort(function(a, b) {
      return a.date < b.date ? 1 : -1;
    });
  });
  
  return issueMap;
}

function computeLeaderStats(ticketsValues, today, sevenDaysAgo, leaderNameMap) {
  leaderNameMap = leaderNameMap || {};
  const counts = {};
  const leaderlessTickets = [];
  
  for (let i = 1; i < ticketsValues.length; i++) {
    const row = ticketsValues[i];
    const qty = parseFloat(row[4]) || 0;
    const serial = row[0] || '';
    const rawLeader = (row[12] || '').toString().trim();
    
    if (!rawLeader) {
      leaderlessTickets.push({ serial: serial, qty: qty });
      continue;
    }
    
    const leaderId = rawLeader.toUpperCase();
    if (!counts[leaderId]) {
      counts[leaderId] = { id: leaderId, cartons: 0, tickets: 0, raw: rawLeader };
    }
    counts[leaderId].cartons += qty;
    counts[leaderId].tickets += 1;
  }
  
  const table = Object.keys(counts).map(function(id) {
    const displayName = leaderNameMap[id] || counts[id].raw || id;
    return { leader: displayName, cartons: counts[id].cartons, tickets: counts[id].tickets, id: id };
  }).sort(function(a, b) {
    return b.cartons - a.cartons;
  });
  
  if (leaderlessTickets.length > 0) {
    table.push({
      leader: 'Unassigned ⚠️',
      cartons: leaderlessTickets.reduce(function(sum, item) { return sum + item.qty; }, 0),
      tickets: leaderlessTickets.length,
      unassigned: true
    });
  }
  
  return { table: table, leaderlessTickets: leaderlessTickets };
}

function computeShiftBuckets(ticketsValues, leaderNameMap) {
  leaderNameMap = leaderNameMap || {};
  const buckets = {};
  for (let i = 1; i < ticketsValues.length; i++) {
    const row = ticketsValues[i];
    const sku = (row[3] || '').toString().trim();
    if (!sku) continue;
    const dateObj = normalizeDateValue(row[1]);
    if (!dateObj) continue;
    const dateTime = combineDateTime(dateObj, row[2]);
    const shiftInfo = getShiftInfo(dateTime);
    const key = shiftInfo.key;
    if (!buckets[key]) {
      buckets[key] = {
        dateKey: shiftInfo.dateKey,
        shift: shiftInfo.shift,
        label: shiftInfo.label,
        window: shiftInfo.window,
        cartons: 0,
        pieces: 0,
        tickets: 0,
        issues: 0,
        leaders: {},
        skuMix: {},
        banding: new Set(),
        firstTime: null,
        lastTime: null
      };
    }
    
    const bucket = buckets[key];
    const qty = parseFloat(row[4]) || 0;
    const productTypeLabel = getProductTypeLabel(row[7]);
    const multiplier = productTypeLabel === '1KG' ? 6 : productTypeLabel === '0.5KG' ? 12 : 0;
    
    bucket.cartons += qty;
    bucket.pieces += qty * multiplier;
    bucket.tickets += 1;
    if (row[10]) {
      bucket.issues += 1;
    }
    
    const leaders = parseLeaderNames(row[12]);
    const primaryLeader = leaders[0];
    if (primaryLeader) {
      const displayLeader = toLeaderDisplayName(primaryLeader, leaderNameMap);
      bucket.leaders[displayLeader] = (bucket.leaders[displayLeader] || 0) + qty;
    }
    
    const skuKey = productTypeLabel ? sku + ' (' + productTypeLabel + ')' : sku;
    if (skuKey) {
      bucket.skuMix[skuKey] = (bucket.skuMix[skuKey] || 0) + qty;
    }
    
    const banding = (row[6] || '').toString();
    if (banding) {
      banding.split(',').map(function(item) { return item.trim(); }).filter(function(item) { return item; }).forEach(function(item) {
        bucket.banding.add(item);
      });
    }
    
    const timeValue = dateTime;
    if (!bucket.firstTime || timeValue < bucket.firstTime) {
      bucket.firstTime = timeValue;
    }
    if (!bucket.lastTime || timeValue > bucket.lastTime) {
      bucket.lastTime = timeValue;
    }
  }
  
  const shiftOrder = { 'Day': 0, 'Night': 1 };
  return Object.keys(buckets).map(function(key) {
    const bucket = buckets[key];
    return {
      key: key,
      date: bucket.dateKey,
      shift: bucket.shift,
      label: bucket.label,
      window: bucket.window,
      cartons: bucket.cartons,
      pieces: bucket.pieces,
      tickets: bucket.tickets,
      issues: bucket.issues,
      leadersText: summarizeValueMap(bucket.leaders, 5),
      skuText: summarizeValueMap(bucket.skuMix, 6),
      bandingText: bucket.banding.size ? Array.from(bucket.banding).join(', ') : '—',
      timeRange: formatTimeRange(bucket.firstTime, bucket.lastTime)
    };
  }).sort(function(a, b) {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    const orderA = shiftOrder[a.shift] || 0;
    const orderB = shiftOrder[b.shift] || 0;
    return orderA - orderB;
  });
}

function summarizeValueMap(map, limit) {
  const entries = Object.keys(map || {}).map(function(key) {
    return { key: key, value: map[key] };
  }).sort(function(a, b) {
    return b.value - a.value;
  });
  const selected = entries.slice(0, limit || entries.length);
  return selected.length ? selected.map(function(item) {
    return item.key + ' (' + formatNumber(item.value) + ')';
  }).join(', ') : '';
}

function parseLeaderNames(value) {
  if (!value) return [];
  const raw = value.toString();
  const idMatches = raw.match(/USER\s*\d+/gi);
  if (idMatches && idMatches.length) {
    return idMatches.map(function(match) {
      return match.replace(/\s+/g, '').toUpperCase();
    });
  }
  return raw.split(/[,;\n]+/).map(function(item) {
    return cleanLeaderToken(item);
  }).filter(function(item) {
    return item.length > 0;
  });
}

function cleanLeaderToken(token) {
  if (!token) return '';
  let cleaned = token.toString().trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/\(.*?\)/g, '').trim();
  cleaned = cleaned.replace(/[-–|].*$/, '').trim();
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

function toLeaderDisplayName(rawValue, nameMap) {
  if (!rawValue) return '';
  const value = rawValue.toString().trim();
  if (!value) return '';
  if (!nameMap) return value;
  
  const upper = value.toUpperCase();
  if (nameMap[upper]) return nameMap[upper];
  
  return value;
}

function formatLeaderList(leaderSet, nameMap) {
  if (!leaderSet) return '';
  return Array.from(leaderSet).map(function(id) {
    return toLeaderDisplayName(id, nameMap);
  }).filter(function(name) {
    return name;
  }).join(', ');
}

function parseTimeValue(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return {
      hours: value.getHours(),
      minutes: value.getMinutes(),
      seconds: value.getSeconds(),
      source: value
    };
  }
  if (typeof value === 'number' && !isNaN(value)) {
    const totalSeconds = Math.round(value * 24 * 60 * 60);
    return {
      hours: Math.floor(totalSeconds / 3600) % 24,
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60
    };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = match[3] ? parseInt(match[3], 10) : 0;
      const meridian = match[4] ? match[4].toUpperCase() : '';
      if (meridian === 'PM' && hours < 12) hours += 12;
      if (meridian === 'AM' && hours === 12) hours = 0;
      return { hours: hours, minutes: minutes, seconds: seconds };
    }
    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      return {
        hours: parsedDate.getHours(),
        minutes: parsedDate.getMinutes(),
        seconds: parsedDate.getSeconds(),
        source: parsedDate
      };
    }
  }
  return null;
}

function formatTimeValue(value) {
  const parsed = parseTimeValue(value);
  if (!parsed) return '-';
  const dateObj = parsed.source || new Date(1970, 0, 1, parsed.hours || 0, parsed.minutes || 0, parsed.seconds || 0);
  return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'hh:mm a');
}

function formatTimeRange(start, end) {
  const startStr = formatTimeValue(start);
  const endStr = formatTimeValue(end);
  if (startStr === '-' && endStr === '-') return '-';
  if (startStr === '-' || endStr === '-') return startStr !== '-' ? startStr : endStr;
  if (startStr === endStr) return startStr;
  return startStr + ' - ' + endStr;
}

function combineDateTime(dateObj, timeValue) {
  const parsed = parseTimeValue(timeValue);
  if (!parsed) {
    return new Date(
      dateObj.getFullYear(),
      dateObj.getMonth(),
      dateObj.getDate(),
      12,
      0,
      0
    );
  }
  return new Date(
    dateObj.getFullYear(),
    dateObj.getMonth(),
    dateObj.getDate(),
    parsed.hours || 0,
    parsed.minutes || 0,
    parsed.seconds || 0
  );
}

function getShiftInfo(dateTime) {
  const baseDate = getStartOfDay(dateTime);
  const dayStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 8, 0);
  const nightStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 18, 0);
  let shiftDate = baseDate;
  let shift = '';
  let label = '';
  let window = '';
  
  if (dateTime >= dayStart && dateTime < nightStart) {
    shift = 'Day';
    label = '☀️ Day Shift';
    window = '08:00 - 18:00';
  } else {
    shift = 'Night';
    label = '🌙 Night Shift';
    window = '18:00 - 08:00';
    if (dateTime < dayStart) {
      shiftDate = new Date(baseDate);
      shiftDate.setDate(shiftDate.getDate() - 1);
    }
  }
  
  const dateKey = formatDateKey(shiftDate);
  return {
    key: dateKey + '|' + shift,
    dateKey: dateKey,
    shift: shift,
    label: label,
    window: window
  };
}

/**
 * Bin-card specific shift classifier: Day 07:00–19:00, Night 19:00–07:00.
 * Kept separate from getShiftInfo() so existing analytics are unaffected.
 */
function getBinCardShiftInfo(dateTime) {
  const y = dateTime.getFullYear(), m = dateTime.getMonth(), d = dateTime.getDate();
  const dayStart   = new Date(y, m, d,  7, 0, 0);
  const nightStart = new Date(y, m, d, 19, 0, 0);
  const nextDayStart = new Date(y, m, d + 1, 7, 0, 0);
  const prevNightStart = new Date(y, m, d - 1, 19, 0, 0);

  let shift, shiftStart, shiftEnd, shiftDateKey;

  if (dateTime >= dayStart && dateTime < nightStart) {
    shift = 'Day';
    shiftStart = dayStart;
    shiftEnd   = nightStart;
    shiftDateKey = formatDateKey(dayStart);
  } else if (dateTime >= nightStart) {
    shift = 'Night';
    shiftStart = nightStart;
    shiftEnd   = nextDayStart;
    shiftDateKey = formatDateKey(nightStart);
  } else {
    // Before 07:00 — belongs to previous day's night shift
    shift = 'Night';
    shiftStart = prevNightStart;
    shiftEnd   = dayStart;
    shiftDateKey = formatDateKey(prevNightStart);
  }

  return {
    shift: shift,
    shiftStart: shiftStart,
    shiftEnd: shiftEnd,
    shiftDateKey: shiftDateKey,
    label: shift === 'Day' ? '☀️ Day Shift (07:00–19:00)' : '🌙 Night Shift (19:00–07:00)'
  };
}

/**
 * Returns shift window for a given date string and shift name (Day/Night).
 * shiftDate: YYYY-MM-DD, shift: 'Day' or 'Night'.
 */
function getBinCardShiftInfoForParams(shiftDate, shift) {
  if (!shiftDate || !shift) return null;
  var parts = (shiftDate + '').trim().split('-');
  if (parts.length !== 3) return null;
  var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  var s = (shift + '').trim().toLowerCase();
  var dayStart = new Date(y, m, d, 7, 0, 0);
  var nightStart = new Date(y, m, d, 19, 0, 0);
  var nextDay7 = new Date(y, m, d + 1, 7, 0, 0);
  var shiftStart, shiftEnd, shiftDateKey;
  if (s === 'day') {
    shiftStart = dayStart;
    shiftEnd = nightStart;
    shiftDateKey = formatDateKey(dayStart);
  } else if (s === 'night') {
    shiftStart = nightStart;
    shiftEnd = nextDay7;
    shiftDateKey = formatDateKey(nightStart);
  } else {
    return null;
  }
  return {
    shift: s === 'day' ? 'Day' : 'Night',
    shiftStart: shiftStart,
    shiftEnd: shiftEnd,
    shiftDateKey: shiftDateKey,
    label: s === 'day' ? '☀️ Day Shift (07:00–19:00)' : '🌙 Night Shift (19:00–07:00)'
  };
}

function getLeaderNameMap(workbook) {
  const map = {};
  try {
    const sheet = workbook.getSheetByName('Authorized Users');
    if (!sheet) return map;
    const values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return map;
    const headers = values[0] || [];
    const idCol = 0;
    const nameCol = headers.indexOf('Name') >= 0 ? headers.indexOf('Name') : 1;
    for (let i = 1; i < values.length; i++) {
      const rawId = (values[i][idCol] || '').toString().trim();
      if (!rawId) continue;
      const upperId = rawId.toUpperCase();
      const name = (values[i][nameCol] || '').toString().trim() || rawId;
      map[upperId] = name;
    }
  } catch (err) {
    // Leader map build failed silently - non-critical
  }
  return map;
}

function parseIsoDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return new Date(year, month, day);
}

function getStartOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate();
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function formatDisplayDate(date) {
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return getStartOfDay(value);
  }
  if (typeof value === 'string') {
    if (value.indexOf('T') >= 0) {
      return getStartOfDay(new Date(value));
    }
    const parsed = parseIsoDate(value);
    return parsed ? getStartOfDay(parsed) : null;
  }
  return null;
}

function getProductTypeLabel(rawType) {
  const value = (rawType || '').toString().toLowerCase();
  if (value.indexOf('1kg') >= 0 || value.indexOf('1 kg') >= 0) {
    return '1KG';
  }
  if (value.indexOf('0.5kg') >= 0 || value.indexOf('0,5kg') >= 0 || value.indexOf('0.5 kg') >= 0) {
    return '0.5KG';
  }
  return '';
}

function createSkuSheetName(sku, productType) {
  const base = 'SKU_' + sku + '_' + productType;
  const cleaned = base.replace(/[^A-Za-z0-9_\- ]/g, '').substring(0, 90);
  return cleaned;
}

function formatNumber(num) {
  if (!num) return '0';
  return Number(num).toLocaleString();
}

function formatDecimal(num) {
  if (!num) return '0.00';
  return Number(num).toFixed(2);
}

function formatPercent(value) {
  if (!value) return '0%';
  return (value * 100).toFixed(1) + '%';
}

/**
 * Helper function to create JSON response
 */
function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Initialize stock movement sheets and defaults
 */
function initializeStockMovementSheets() {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  Object.keys(STOCK_MOVEMENT_SHEETS).forEach(function(sheetName) {
    ensureSheetWithHeaders(workbook, sheetName, STOCK_MOVEMENT_SHEETS[sheetName]);
  });
  seedZoneConfig(workbook);
  return createResponse({ success: true, message: 'Stock movement sheets initialized' });
}

/**
 * Ensure sheet exists with provided headers
 * @param {SpreadsheetApp.Spreadsheet} workbook
 * @param {string} sheetName
 * @param {string[]} headers
 */
function ensureSheetWithHeaders(workbook, sheetName, headers) {
  let sheet = workbook.getSheetByName(sheetName);
  if (!sheet) {
    sheet = workbook.insertSheet(sheetName);
  }
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const existingHeaders = headerRange.getValues()[0];
  const needsHeaderUpdate = headers.some(function(header, idx) {
    return (existingHeaders[idx] || '').toString().trim() !== header;
  });
  if (needsHeaderUpdate) {
    headerRange.setValues([headers]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Seed ZoneConfig defaults if missing
 * @param {SpreadsheetApp.Spreadsheet} workbook
 */
function seedZoneConfig(workbook) {
  const sheet = ensureSheetWithHeaders(workbook, 'ZoneConfig', STOCK_MOVEMENT_SHEETS.ZoneConfig);
  const data = sheet.getDataRange().getValues();
  const headers = data[0] || STOCK_MOVEMENT_SHEETS.ZoneConfig;
  const prefixColIndex = headers.indexOf('Prefix');
  if (prefixColIndex === -1) {
    throw new Error('ZoneConfig sheet is missing the Prefix column.');
  }
  const existingPrefixes = new Set();
  for (let i = 1; i < data.length; i++) {
    const prefix = (data[i][prefixColIndex] || '').toString().trim().toUpperCase();
    if (prefix) {
      existingPrefixes.add(prefix);
    }
  }
  const rowsToAppend = [];
  DEFAULT_ZONE_CONFIG.forEach(function(zone) {
  if (!existingPrefixes.has(zone.Prefix.toUpperCase())) {
      rowsToAppend.push(buildZoneConfigRow(zone));
    }
  });
  if (rowsToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, STOCK_MOVEMENT_SHEETS.ZoneConfig.length)
      .setValues(rowsToAppend);
  }
}

function buildZoneConfigRow(zone) {
  return STOCK_MOVEMENT_SHEETS.ZoneConfig.map(function(header) {
    if (zone.hasOwnProperty(header)) {
      return zone[header];
    }
    if (header === 'CurrentOccupancy') {
      return 0;
    }
    if (header === 'NextPalletNumber') {
      return 1;
    }
    return '';
  });
}

/**
 * Generate pallet ID based on zone prefix (e.g., DET, FAT, LIQ)
 * Automatically increments counter in ZoneConfig sheet
 * @param {string} zonePrefix
 */
function generatePalletId(zonePrefix) {
  if (!zonePrefix) {
    throw new Error('zonePrefix is required to generate a pallet ID.');
  }
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'ZoneConfig', STOCK_MOVEMENT_SHEETS.ZoneConfig);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const prefixCol = headers.indexOf('Prefix');
  const counterCol = headers.indexOf('NextPalletNumber');
  if (prefixCol === -1 || counterCol === -1) {
    throw new Error('ZoneConfig sheet is missing required columns.');
  }
  for (let i = 1; i < data.length; i++) {
    const prefix = (data[i][prefixCol] || '').toString().trim().toUpperCase();
    if (prefix === zonePrefix.toUpperCase()) {
      const currentCounter = Number(data[i][counterCol]) || 1;
      const palletId = 'FG-' + prefix + '-' + String(currentCounter).padStart(5, '0');
      sheet.getRange(i + 1, counterCol + 1).setValue(currentCounter + 1);
      return palletId;
    }
  }
  throw new Error('Zone prefix not configured: ' + zonePrefix);
}

/**
 * Initiate pallet move (Phase 1) - Two-phase movement flow.
 * Pallet stays at origin with "In Transit" until received at destination.
 * @param {Object} params - palletId, toZone, movedBy, reason, overrideReason, quantity, orderReference
 */
function movePallet(params) {
  const requiredFields = ['palletId', 'toZone', 'movedBy'];
  requiredFields.forEach(function(field) {
    if (!params || !params[field]) {
      throw new Error('Missing required field: ' + field);
    }
  });
  const palletId = params.palletId;
  const toZone = params.toZone;
  const movedBy = params.movedBy;
  const reason = params.reason || '';
  const overrideReason = params.overrideReason || '';
  const quantity = params.quantity;
  const orderReference = params.orderReference || '';
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const palletsSheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const palletData = palletsSheet.getDataRange().getValues();
  if (palletData.length <= 1) {
    throw new Error('Pallets sheet is empty.');
  }
  const headers = palletData[0];
  const palletIdCol = headers.indexOf('PalletID');
  if (palletIdCol === -1) {
    throw new Error('Pallets sheet missing PalletID column.');
  }
  let targetRow = -1;
  let palletRowValues = null;
  for (let i = 1; i < palletData.length; i++) {
    if ((palletData[i][palletIdCol] || '').toString().trim() === palletId) {
      targetRow = i;
      palletRowValues = palletData[i];
      break;
    }
  }
  if (targetRow === -1 || !palletRowValues) {
    throw new Error('Pallet not found: ' + palletId);
  }
  const currentZoneCol = headers.indexOf('CurrentZone');
  const inTransitToCol = headers.indexOf('InTransitToZone');
  const inTransitMovementCol = headers.indexOf('InTransitMovementID');
  const inTransitAtCol = headers.indexOf('InTransitInitiatedAt');
  const inTransitByCol = headers.indexOf('InTransitInitiatedBy');
  const notesCol = headers.indexOf('Notes');
  const currentZone = palletRowValues[currentZoneCol] || '';
  const existingInTransit = (palletRowValues[inTransitToCol] || '').toString().trim();
  if (existingInTransit) {
    throw new Error('Pallet is already in transit to ' + existingInTransit + '. Receive or cancel first.');
  }
  if (currentZone === toZone) {
    throw new Error('Pallet is already in ' + toZone);
  }
  const palletTypeCol = headers.indexOf('PalletType');
  const zoneEligibility = checkZoneEligibility({
    sku: palletRowValues[headers.indexOf('SKU')],
    toZone: toZone,
    palletType: palletTypeCol >= 0 ? palletRowValues[palletTypeCol] : ''
  });
  if (!zoneEligibility.allowed) {
    throw new Error(zoneEligibility.message || ('Pallet cannot move to ' + toZone));
  }
  if (!overrideReason) {
    enforceFifoIfRequired({
      palletId: palletId,
      targetZone: toZone,
      palletsSheet: palletsSheet,
      palletHeaders: headers,
      palletData: palletData
    });
  }
  // When quantity not provided (full-pallet move), use pallet's RemainingQuantity or Quantity
  var qtyToLog = quantity;
  if (qtyToLog === '' || qtyToLog == null) {
    var remCol = headers.indexOf('RemainingQuantity');
    var qtyCol = headers.indexOf('Quantity');
    var rem = remCol >= 0 ? Number(palletRowValues[remCol]) : 0;
    var qty = qtyCol >= 0 ? Number(palletRowValues[qtyCol]) : 0;
    qtyToLog = (rem > 0 ? rem : qty) || '';
  }
  const now = new Date();
  const movementId = generateMovementId();
  logZoneMovement({
    palletId: palletId,
    fromZone: currentZone,
    toZone: toZone,
    movedBy: movedBy,
    reason: reason,
    overrideReason: overrideReason,
    quantity: qtyToLog,
    orderReference: orderReference,
    movementDate: now,
    movementId: movementId,
    movementStatus: 'In Transit'
  });
  const updates = {};
  if (inTransitToCol >= 0) updates[inTransitToCol] = toZone;
  if (inTransitMovementCol >= 0) updates[inTransitMovementCol] = movementId;
  if (inTransitAtCol >= 0) updates[inTransitAtCol] = now;
  if (inTransitByCol >= 0) updates[inTransitByCol] = movedBy;
  if (notesCol >= 0 && reason) {
    const existingNotes = palletRowValues[notesCol] || '';
    updates[notesCol] = existingNotes ? existingNotes + '\n[Initiate] ' + reason : '[Initiate] ' + reason;
  }
  if (Object.keys(updates).length > 0) {
    const rowData = palletsSheet.getRange(targetRow + 1, 1, 1, palletsSheet.getLastColumn()).getValues()[0];
    Object.keys(updates).forEach(function(colIndexStr) {
      rowData[Number(colIndexStr)] = updates[colIndexStr];
    });
    palletsSheet.getRange(targetRow + 1, 1, 1, rowData.length).setValues([rowData]);
  }
  logUserActivity('INITIATE MOVE: ' + palletId, 'From ' + currentZone + ' to ' + toZone + ' by ' + movedBy);
  refreshInventorySnapshotSilently();
  return createResponse({
    success: true,
    message: 'Move initiated. Awaiting receipt at ' + toZone,
    palletId: palletId,
    fromZone: currentZone,
    toZone: toZone,
    movementId: movementId
  });
}

function enforceFifoIfRequired(config) {
  const headers = config.palletHeaders;
  const zoneCol = headers.indexOf('CurrentZone');
  const createdAtCol = headers.indexOf('CreatedAt');
  if (zoneCol === -1 || createdAtCol === -1) {
    return true;
  }
  const targetZone = config.targetZone;
  const zoneConfig = getZoneConfigMap();
  const zoneSettings = zoneConfig[targetZone] || {};
  if (!zoneSettings.FIFORequired) {
    return true;
  }
  const palletsInZone = config.palletData
    .slice(1)
    .filter(function(row) {
      return (row[zoneCol] || '').toString().trim() === targetZone;
    })
    .sort(function(a, b) {
      const aDate = new Date(a[createdAtCol]);
      const bDate = new Date(b[createdAtCol]);
      return aDate - bDate;
    });
  if (palletsInZone.length === 0) {
    return true;
  }
  const oldestPallet = palletsInZone[0][headers.indexOf('PalletID')];
  if (oldestPallet !== config.palletId) {
    throw new Error('FIFO enforcement active for ' + targetZone + '. Oldest pallet is ' + oldestPallet + '. Provide override reason to bypass.');
  }
  return true;
}

function logZoneMovement(entry) {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'ZoneMovements', STOCK_MOVEMENT_SHEETS.ZoneMovements);
  const movementId = entry.movementId || generateMovementId();
  const movementStatus = entry.movementStatus || 'In Transit';
  const row = STOCK_MOVEMENT_SHEETS.ZoneMovements.map(function(header) {
    switch (header) {
      case 'MovementID':
        return movementId;
      case 'PalletID':
        return entry.palletId;
      case 'FromZone':
        return entry.fromZone || '';
      case 'ToZone':
        return entry.toZone;
      case 'MovementDate':
        return Utilities.formatDate(entry.movementDate || new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      case 'MovementTime':
        return Utilities.formatDate(entry.movementDate || new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');
      case 'MovedBy':
        return entry.movedBy;
      case 'Reason':
        return entry.reason || '';
      case 'OverrideReason':
        return entry.overrideReason || '';
      case 'Quantity':
        return entry.quantity || '';
      case 'OrderReference':
        return entry.orderReference || '';
      case 'Notes':
        return entry.notes || '';
      case 'CreatedAt':
        return new Date();
      case 'MovementStatus':
        return movementStatus;
      case 'ReceivedAt':
      case 'ReceivedBy':
      case 'AutoRevertedAt':
      case 'CancelledAt':
      case 'CancelledBy':
      case 'CancelEscalationReason':
        return '';
      default:
        return '';
    }
  });
  sheet.appendRow(row);
  return movementId;
}

const TRANSIT_TIMEOUT_MINUTES = 25;

/**
 * Receive pallet at destination (Phase 2).
 * Clears in-transit fields, updates CurrentZone, marks movement as Received.
 */
function receivePallet(params) {
  const palletId = (params.palletId || '').toString().trim();
  const receivedBy = (params.receivedBy || '').toString().trim();
  if (!palletId || !receivedBy) {
    throw new Error('Missing palletId or receivedBy');
  }
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const palletsSheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const palletData = palletsSheet.getDataRange().getValues();
  const headers = palletData[0];
  const zoneCol = headers.indexOf('CurrentZone');
  const inTransitToCol = headers.indexOf('InTransitToZone');
  const inTransitMovementCol = headers.indexOf('InTransitMovementID');
  const inTransitAtCol = headers.indexOf('InTransitInitiatedAt');
  const inTransitByCol = headers.indexOf('InTransitInitiatedBy');
  const lastMovedAtCol = headers.indexOf('LastMovedAt');
  const lastMovedByCol = headers.indexOf('LastMovedBy');
  const statusCol = headers.indexOf('Status');
  const palletIdCol = headers.indexOf('PalletID');
  let targetRow = -1;
  let palletRowValues = null;
  for (let i = 1; i < palletData.length; i++) {
    if ((palletData[i][palletIdCol] || '').toString().trim() === palletId) {
      targetRow = i;
      palletRowValues = palletData[i];
      break;
    }
  }
  if (targetRow === -1 || !palletRowValues) {
    throw new Error('Pallet not found: ' + palletId);
  }
  const toZone = (palletRowValues[inTransitToCol] || '').toString().trim();
  if (!toZone) {
    throw new Error('Pallet is not in transit. Nothing to receive.');
  }
  const fromZone = (palletRowValues[zoneCol] || '').toString().trim();
  const movementId = (palletRowValues[inTransitMovementCol] || '').toString().trim();
  const zoneEligibility = checkZoneEligibility({
    sku: palletRowValues[headers.indexOf('SKU')],
    toZone: toZone,
    palletType: (palletRowValues[headers.indexOf('PalletType')] || '').toString()
  });
  const now = new Date();
  const updates = {};
  updates[zoneCol] = toZone;
  updates[inTransitToCol] = '';
  updates[inTransitMovementCol] = '';
  updates[inTransitAtCol] = '';
  updates[inTransitByCol] = '';
  updates[lastMovedAtCol] = now;
  updates[lastMovedByCol] = receivedBy;
  if (statusCol >= 0) {
    updates[statusCol] = zoneEligibility.targetStatus || 'Active';
  }
  const rowData = palletsSheet.getRange(targetRow + 1, 1, 1, palletsSheet.getLastColumn()).getValues()[0];
  Object.keys(updates).forEach(function(k) {
    const idx = Number(k);
    if (idx >= 0) rowData[idx] = updates[k];
  });
  palletsSheet.getRange(targetRow + 1, 1, 1, rowData.length).setValues([rowData]);
  const movSheet = ensureSheetWithHeaders(workbook, 'ZoneMovements', STOCK_MOVEMENT_SHEETS.ZoneMovements);
  const movData = movSheet.getDataRange().getValues();
  const movHeaders = movData[0];
  const movIdCol = movHeaders.indexOf('MovementID');
  const movStatusCol = movHeaders.indexOf('MovementStatus');
  const movReceivedAtCol = movHeaders.indexOf('ReceivedAt');
  const movReceivedByCol = movHeaders.indexOf('ReceivedBy');
  for (let i = movData.length - 1; i >= 1; i--) {
    if ((movData[i][movIdCol] || '').toString().trim() === movementId) {
      if (movStatusCol >= 0) movSheet.getRange(i + 1, movStatusCol + 1).setValue('Received');
      if (movReceivedAtCol >= 0) movSheet.getRange(i + 1, movReceivedAtCol + 1).setValue(now);
      if (movReceivedByCol >= 0) movSheet.getRange(i + 1, movReceivedByCol + 1).setValue(receivedBy);
      break;
    }
  }
  logUserActivity('RECEIVE: ' + palletId, 'Received at ' + toZone + ' by ' + receivedBy);
  refreshInventorySnapshotSilently();
  return createResponse({
    success: true,
    message: 'Pallet received at ' + toZone,
    palletId: palletId,
    fromZone: fromZone,
    toZone: toZone
  });
}

/**
 * Get pallets inbound to a zone (InTransitToZone = zoneName).
 * Sorted by InTransitInitiatedAt (FIFO - oldest first).
 */
function getInboundsToZone(params) {
  const zoneName = (params.zoneName || '').toString().trim();
  if (!zoneName) {
    throw new Error('zoneName is required.');
  }
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const inTransitToCol = headers.indexOf('InTransitToZone');
  const inTransitAtCol = headers.indexOf('InTransitInitiatedAt');
  const palletIdCol = headers.indexOf('PalletID');
  if (inTransitToCol < 0) {
    return createResponse({ success: true, zone: zoneName, pallets: [] });
  }
  const pallets = data.slice(1)
    .filter(function(row) {
      return (row[inTransitToCol] || '').toString().trim() === zoneName;
    })
    .map(function(row) {
      return rowToObject(headers, row);
    })
    .sort(function(a, b) {
      const aDate = new Date(a.InTransitInitiatedAt || 0);
      const bDate = new Date(b.InTransitInitiatedAt || 0);
      return aDate - bDate;
    });
  return createResponse({
    success: true,
    zone: zoneName,
    count: pallets.length,
    pallets: pallets
  });
}

/**
 * Get pallets outbound from a zone (CurrentZone = zoneName AND InTransitToZone set).
 */
function getOutboundsFromZone(params) {
  const zoneName = (params.zoneName || '').toString().trim();
  if (!zoneName) {
    throw new Error('zoneName is required.');
  }
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const zoneCol = headers.indexOf('CurrentZone');
  const inTransitToCol = headers.indexOf('InTransitToZone');
  const inTransitAtCol = headers.indexOf('InTransitInitiatedAt');
  if (zoneCol < 0 || inTransitToCol < 0) {
    return createResponse({ success: true, zone: zoneName, pallets: [] });
  }
  const pallets = data.slice(1)
    .filter(function(row) {
      return (row[zoneCol] || '').toString().trim() === zoneName &&
             (row[inTransitToCol] || '').toString().trim() !== '';
    })
    .map(function(row) {
      return rowToObject(headers, row);
    })
    .sort(function(a, b) {
      const aDate = new Date(a.InTransitInitiatedAt || 0);
      const bDate = new Date(b.InTransitInitiatedAt || 0);
      return aDate - bDate;
    });
  return createResponse({
    success: true,
    zone: zoneName,
    count: pallets.length,
    pallets: pallets
  });
}

/**
 * Check if user can cancel transit (Supervisor or QA only).
 * Authorized Users sheet should have optional "Role" column: Supervisor, QA, or Zone Clerk.
 */
function canUserCancelTransit(userId) {
  try {
    const workbook = SpreadsheetApp.openById(SHEET_ID);
    const sheet = workbook.getSheetByName('Authorized Users');
    if (!sheet) return false;
    const values = sheet.getDataRange().getValues();
    const headers = values[0] || [];
    const idCol = 0;
    const roleCol = headers.indexOf('Role');
    if (roleCol < 0) return false;
    const uid = (userId || '').toString().trim();
    for (let i = 1; i < values.length; i++) {
      if ((values[i][idCol] || '').toString().trim() === uid) {
        const role = (values[i][roleCol] || '').toString().trim().toLowerCase();
        return role === 'supervisor' || role === 'qa';
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Cancel in-transit movement. Supervisor or QA only. Requires escalation reason.
 */
function cancelTransit(params) {
  const palletId = (params.palletId || '').toString().trim();
  const cancelledBy = (params.cancelledBy || '').toString().trim();
  const escalationReason = (params.escalationReason || '').toString().trim();
  if (!palletId || !cancelledBy) {
    throw new Error('Missing palletId or cancelledBy');
  }
  if (!escalationReason) {
    throw new Error('Escalation reason is required to cancel transit');
  }
  if (!canUserCancelTransit(cancelledBy)) {
    throw new Error('Only Supervisors or QA can cancel transit. Your role does not permit this action.');
  }
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const palletsSheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const palletData = palletsSheet.getDataRange().getValues();
  const headers = palletData[0];
  const inTransitToCol = headers.indexOf('InTransitToZone');
  const inTransitMovementCol = headers.indexOf('InTransitMovementID');
  const inTransitAtCol = headers.indexOf('InTransitInitiatedAt');
  const inTransitByCol = headers.indexOf('InTransitInitiatedBy');
  const notesCol = headers.indexOf('Notes');
  const palletIdCol = headers.indexOf('PalletID');
  let targetRow = -1;
  let palletRowValues = null;
  for (let i = 1; i < palletData.length; i++) {
    if ((palletData[i][palletIdCol] || '').toString().trim() === palletId) {
      targetRow = i;
      palletRowValues = palletData[i];
      break;
    }
  }
  if (targetRow === -1 || !palletRowValues) {
    throw new Error('Pallet not found: ' + palletId);
  }
  const inTransitTo = (palletRowValues[inTransitToCol] || '').toString().trim();
  if (!inTransitTo) {
    throw new Error('Pallet is not in transit. Nothing to cancel.');
  }
  const movementId = (palletRowValues[inTransitMovementCol] || '').toString().trim();
  const now = new Date();
  const updates = {};
  updates[inTransitToCol] = '';
  updates[inTransitMovementCol] = '';
  updates[inTransitAtCol] = '';
  updates[inTransitByCol] = '';
  if (notesCol >= 0) {
    const existingNotes = palletRowValues[notesCol] || '';
    updates[notesCol] = existingNotes + '\n[Cancelled by ' + cancelledBy + '] ' + escalationReason;
  }
  const rowData = palletsSheet.getRange(targetRow + 1, 1, 1, palletsSheet.getLastColumn()).getValues()[0];
  Object.keys(updates).forEach(function(k) {
    const idx = Number(k);
    if (idx >= 0) rowData[idx] = updates[k];
  });
  palletsSheet.getRange(targetRow + 1, 1, 1, rowData.length).setValues([rowData]);
  const movSheet = ensureSheetWithHeaders(workbook, 'ZoneMovements', STOCK_MOVEMENT_SHEETS.ZoneMovements);
  const movData = movSheet.getDataRange().getValues();
  const movHeaders = movData[0];
  const movIdCol = movHeaders.indexOf('MovementID');
  const movStatusCol = movHeaders.indexOf('MovementStatus');
  const movCancelledAtCol = movHeaders.indexOf('CancelledAt');
  const movCancelledByCol = movHeaders.indexOf('CancelledBy');
  const movEscalationCol = movHeaders.indexOf('CancelEscalationReason');
  for (let i = movData.length - 1; i >= 1; i--) {
    if ((movData[i][movIdCol] || '').toString().trim() === movementId) {
      if (movStatusCol >= 0) movSheet.getRange(i + 1, movStatusCol + 1).setValue('Cancelled');
      if (movCancelledAtCol >= 0) movSheet.getRange(i + 1, movCancelledAtCol + 1).setValue(now);
      if (movCancelledByCol >= 0) movSheet.getRange(i + 1, movCancelledByCol + 1).setValue(cancelledBy);
      if (movEscalationCol >= 0) movSheet.getRange(i + 1, movEscalationCol + 1).setValue(escalationReason);
      break;
    }
  }
  logUserActivity('CANCEL TRANSIT: ' + palletId, 'By ' + cancelledBy + ' - ' + escalationReason);
  refreshInventorySnapshotSilently();
  return createResponse({
    success: true,
    message: 'Transit cancelled. Pallet remains at origin.',
    palletId: palletId
  });
}

/**
 * Auto-revert pallets that have been in transit longer than TRANSIT_TIMEOUT_MINUTES.
 * Call via time-based trigger (e.g. every 5-10 min).
 */
function runAutoRevertTransits() {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const palletsSheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const palletData = palletsSheet.getDataRange().getValues();
  const headers = palletData[0];
  const inTransitToCol = headers.indexOf('InTransitToZone');
  const inTransitMovementCol = headers.indexOf('InTransitMovementID');
  const inTransitAtCol = headers.indexOf('InTransitInitiatedAt');
  const inTransitByCol = headers.indexOf('InTransitInitiatedBy');
  const palletIdCol = headers.indexOf('PalletID');
  const zoneCol = headers.indexOf('CurrentZone');
  if (inTransitToCol < 0 || inTransitAtCol < 0) {
    return createResponse({ success: true, reverted: 0, message: 'No in-transit columns' });
  }
  const now = new Date();
  const cutoffMs = now.getTime() - (TRANSIT_TIMEOUT_MINUTES * 60 * 1000);
  const reverted = [];
  for (let i = 1; i < palletData.length; i++) {
    const row = palletData[i];
    const inTransitTo = (row[inTransitToCol] || '').toString().trim();
    if (!inTransitTo) continue;
    const initiatedAt = row[inTransitAtCol];
    const initiatedMs = initiatedAt ? new Date(initiatedAt).getTime() : 0;
    if (initiatedMs < cutoffMs) {
      const palletId = (row[palletIdCol] || '').toString().trim();
      const fromZone = (row[zoneCol] || '').toString().trim();
      const movementId = (row[inTransitMovementCol] || '').toString().trim();
      const updates = {};
      updates[inTransitToCol] = '';
      updates[inTransitMovementCol] = '';
      updates[inTransitAtCol] = '';
      updates[inTransitByCol] = '';
      const rowData = palletsSheet.getRange(i + 1, 1, 1, palletsSheet.getLastColumn()).getValues()[0];
      Object.keys(updates).forEach(function(k) {
        rowData[Number(k)] = updates[k];
      });
      palletsSheet.getRange(i + 1, 1, 1, rowData.length).setValues([rowData]);
      const movSheet = ensureSheetWithHeaders(workbook, 'ZoneMovements', STOCK_MOVEMENT_SHEETS.ZoneMovements);
      const movData = movSheet.getDataRange().getValues();
      const movHeaders = movData[0];
      const movIdCol = movHeaders.indexOf('MovementID');
      const movStatusCol = movHeaders.indexOf('MovementStatus');
      const movAutoRevertedCol = movHeaders.indexOf('AutoRevertedAt');
      for (let j = movData.length - 1; j >= 1; j--) {
        if ((movData[j][movIdCol] || '').toString().trim() === movementId) {
          if (movStatusCol >= 0) movSheet.getRange(j + 1, movStatusCol + 1).setValue('Auto-Reverted');
          if (movAutoRevertedCol >= 0) movSheet.getRange(j + 1, movAutoRevertedCol + 1).setValue(now);
          break;
        }
      }
      logUserActivity('AUTO-REVERT: ' + palletId, 'In transit > ' + TRANSIT_TIMEOUT_MINUTES + ' min - reverted to ' + fromZone);
      reverted.push({ palletId: palletId, fromZone: fromZone });
    }
  }
  if (reverted.length > 0) {
    refreshInventorySnapshotSilently();
  }
  return createResponse({
    success: true,
    reverted: reverted.length,
    pallets: reverted
  });
}

function getRecentMovements(limit) {
  var movements = getRecentMovementsData(limit || 10);
  return createResponse({ success: true, movements: movements });
}

/**
 * Compute zone inventory stats from Pallets + ZoneMovements.
 * Same logic as Inventory Snapshot sheet — single source of truth for zone totals.
 * Returns { zoneStats, facilityTotals, palletInfoMap, receivingSummary, movementSummary, movementDetails }.
 */
function computeZoneInventoryStats() {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const palletsSheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const palletsData = palletsSheet.getDataRange().getValues();
  const palletHeaders = palletsData[0] || [];
  const palletIndex = buildHeaderIndexMap(palletHeaders);
  const palletInfoMap = {};
  const zoneStats = {};
  const receivingSummary = {};
  const movementSummary = {};
  const movementDetails = [];
  const facilityTotals = {
    current: 0,
    outbound: 0,
    received: 0,
    receivedPallets: 0,
    currentPallets: 0,
    outboundPallets: 0,
    activeSkuSet: new Set()
  };

  function ensureZone(zoneName) {
    if (!zoneStats[zoneName]) {
      zoneStats[zoneName] = {
        skuStats: {},
        totals: { current: 0, outbound: 0, palletsCurrent: 0, palletsOutbound: 0 }
      };
    }
    return zoneStats[zoneName];
  }

  function ensureZoneSku(zoneName, sku) {
    const zone = ensureZone(zoneName);
    if (!zone.skuStats[sku]) {
      zone.skuStats[sku] = {
        currentQty: 0,
        outboundQty: 0,
        lastMovement: null
      };
    }
    return zone.skuStats[sku];
  }

  function addReceivingMetric(dateKey, sku, cartons, pallets) {
    if (!dateKey || !sku) return;
    if (!receivingSummary[dateKey]) {
      receivingSummary[dateKey] = {};
    }
    if (!receivingSummary[dateKey][sku]) {
      receivingSummary[dateKey][sku] = { received: 0, pallets: 0 };
    }
    receivingSummary[dateKey][sku].received += cartons || 0;
    receivingSummary[dateKey][sku].pallets += pallets || 0;
  }

  function addMovementMetric(dateKey, zoneName, sku, field, amount) {
    if (!dateKey || !zoneName || !sku || !amount) return;
    if (!movementSummary[dateKey]) {
      movementSummary[dateKey] = {};
    }
    if (!movementSummary[dateKey][zoneName]) {
      movementSummary[dateKey][zoneName] = {};
    }
    if (!movementSummary[dateKey][zoneName][sku]) {
      movementSummary[dateKey][zoneName][sku] = { movedIn: 0, movedOut: 0, shipped: 0 };
    }
    movementSummary[dateKey][zoneName][sku][field] += amount;
  }

  for (let i = 1; i < palletsData.length; i++) {
    const row = palletsData[i];
    if (!row || !row[palletIndex.PalletID]) continue;
    const palletId = (row[palletIndex.PalletID] || '').toString().trim().toUpperCase();
    const zoneName = row[palletIndex.CurrentZone] || 'Unknown Zone';
    const sku = row[palletIndex.SKU] || 'Unassigned SKU';
    const originalQty = Number(row[palletIndex.Quantity]) || 0;
    const remainingQty = Number(row[palletIndex.RemainingQuantity]) || Number(row[palletIndex.Quantity]) || 0;
    const lastMoved = row[palletIndex.LastMovedAt] ? new Date(row[palletIndex.LastMovedAt]) : null;
    const createdAt = row[palletIndex.CreatedAt] ? new Date(row[palletIndex.CreatedAt]) : null;
    const parentId = palletIndex.ParentPalletID !== undefined ? (row[palletIndex.ParentPalletID] || '').toString().trim() : '';
    const isOriginalPallet = !parentId;
    palletInfoMap[palletId] = {
      sku: sku,
      quantity: originalQty,
      remaining: remainingQty,
      zone: zoneName
    };
    if (isOriginalPallet) {
      facilityTotals.received += originalQty;
      facilityTotals.receivedPallets += 1;
    }
    if (isOriginalPallet && createdAt) {
      const dateKey = Utilities.formatDate(createdAt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      addReceivingMetric(dateKey, sku, originalQty, 1);
    }

    const skuStats = ensureZoneSku(zoneName, sku);
    const zone = ensureZone(zoneName);
    if (zoneName === 'Outbounding') {
      if (lastMoved && (!skuStats.lastMovement || lastMoved > skuStats.lastMovement)) {
        skuStats.lastMovement = lastMoved;
      }
      continue;
    }

    skuStats.currentQty += remainingQty;
    zone.totals.current += remainingQty;
    zone.totals.palletsCurrent += 1;
    facilityTotals.current += remainingQty;
    facilityTotals.currentPallets += 1;
    if (remainingQty > 0) {
      facilityTotals.activeSkuSet.add(sku);
    }
    if (lastMoved && (!skuStats.lastMovement || lastMoved > skuStats.lastMovement)) {
      skuStats.lastMovement = lastMoved;
    }
  }

  const movementsSheet = ensureSheetWithHeaders(workbook, 'ZoneMovements', STOCK_MOVEMENT_SHEETS.ZoneMovements);
  const movementData = movementsSheet.getDataRange().getValues();
  const movementHeaders = movementData[0] || [];
  const movementIndex = buildHeaderIndexMap(movementHeaders);
  for (let i = 1; i < movementData.length; i++) {
    const row = movementData[i];
    if (!row || !row[movementIndex.ToZone]) continue;
    const palletId = (row[movementIndex.PalletID] || '').toString().trim().toUpperCase();
    const info = palletInfoMap[palletId];
    const sku = info ? info.sku : 'Unassigned SKU';
    const fromZone = row[movementIndex.FromZone] || (info ? info.zone : 'Unknown Zone');
    const qty = Number(row[movementIndex.Quantity]) || (info ? info.quantity : 0) || 0;
    const moveDate = row[movementIndex.MovementDate] ? new Date(row[movementIndex.MovementDate]) : null;
    const skuStats = ensureZoneSku(fromZone, sku);
    skuStats.outboundQty += qty;
    const zone = ensureZone(fromZone);
    zone.totals.outbound += qty;
    if ((row[movementIndex.ToZone] || '').toString().trim() === 'Outbounding') {
      zone.totals.palletsOutbound += 1;
      facilityTotals.outbound += qty;
      facilityTotals.outboundPallets += 1;
    }
    if (moveDate && (!skuStats.lastMovement || moveDate > skuStats.lastMovement)) {
      skuStats.lastMovement = moveDate;
    }
    const toZone = (row[movementIndex.ToZone] || '').toString().trim();
    const movementTimestamp = moveDate
      ? Utilities.formatDate(moveDate, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
      : (row[movementIndex.MovementTime]
        ? Utilities.formatDate(new Date(row[movementIndex.MovementDate] + 'T' + row[movementIndex.MovementTime]), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
        : '');
    movementDetails.push({
      movementDate: movementTimestamp || (moveDate ? moveDate.toISOString() : ''),
      dateKey: moveDate ? Utilities.formatDate(moveDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '',
      movementId: row[movementIndex.MovementID] || '',
      palletId: palletId,
      sku: sku,
      fromZone: fromZone || 'Unknown Zone',
      toZone: toZone || 'Unknown Zone',
      quantity: qty,
      movedBy: row[movementIndex.MovedBy] || '',
      orderReference: row[movementIndex.OrderReference] || '',
      reason: row[movementIndex.Reason] || '',
      overrideReason: row[movementIndex.OverrideReason] || '',
      notes: row[movementIndex.Notes] || ''
    });
    if (moveDate) {
      const dateKey = Utilities.formatDate(moveDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (fromZone) {
        addMovementMetric(dateKey, fromZone, sku, 'movedOut', qty);
      }
      if (toZone && toZone.toUpperCase() !== 'OUTBOUNDING') {
        addMovementMetric(dateKey, toZone, sku, 'movedIn', qty);
      }
      if (toZone && toZone.toUpperCase() === 'OUTBOUNDING') {
        addMovementMetric(dateKey, 'Outbounding', sku, 'shipped', qty);
      }
    }
  }

  return { zoneStats: zoneStats, facilityTotals: facilityTotals, receivingSummary: receivingSummary, movementSummary: movementSummary, movementDetails: movementDetails };
}

function getZoneInventoryTotals() {
  const computed = computeZoneInventoryStats();
  const zoneStats = computed.zoneStats;
  const zoneOrder = INVENTORY_ZONE_ORDER.concat(Object.keys(zoneStats).filter(function(zone) {
    return INVENTORY_ZONE_ORDER.indexOf(zone) === -1;
  }));
  const zones = zoneOrder.map(function(zoneName) {
    const zone = zoneStats[zoneName];
    if (!zone) return null;
    return {
      zoneName: zoneName,
      current: zone.totals.current,
      palletsCurrent: zone.totals.palletsCurrent,
      outbound: zone.totals.outbound,
      palletsOutbound: zone.totals.palletsOutbound
    };
  }).filter(Boolean);
  return createResponse({ success: true, zones: zones, facilityTotals: computed.facilityTotals });
}

function createInventorySnapshot() {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  let sheet = workbook.getSheetByName('InventorySnapshot');
  if (!sheet) {
    sheet = workbook.insertSheet('InventorySnapshot');
  }
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setFontFamily('Cascadia Mono');
  sheet.setColumnWidths(1, 9, 180);

  const computed = computeZoneInventoryStats();
  const zoneStats = computed.zoneStats;
  const facilityTotals = computed.facilityTotals;
  const receivingSummary = computed.receivingSummary;
  const movementSummary = computed.movementSummary;
  const movementDetails = computed.movementDetails;

  const timestamp = new Date();
  sheet.getRange('A1:I1').merge().setValue('Inventory Snapshot 📦').setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#f8fafc').setFontColor('#1a202c');
  sheet.getRange('A2:I2').merge().setValue('Refreshed: ' + Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm')).setFontColor('#4c51bf').setHorizontalAlignment('center');
  sheet.getRange('A3:I3').merge().setValue('RetiFlux™ Powered by NexGridCore DataLabs').setFontColor('#718096').setHorizontalAlignment('center').setFontStyle('italic');
  let rowCursor = 11;
  sheet.getRange(rowCursor, 1, 1, 5).setValues([['Zone', 'Current Qty', 'Current Pallets', 'Outbound Qty', 'Outbound Pallets']]);
  sheet.getRange(rowCursor, 1, 1, 5).setBackground('#1f2937').setFontColor('#ffffff').setFontWeight('bold');
  rowCursor += 1;

  const zoneOrder = INVENTORY_ZONE_ORDER.concat(Object.keys(zoneStats).filter(function(zone) {
    return INVENTORY_ZONE_ORDER.indexOf(zone) === -1;
  }));

  zoneOrder.forEach(function(zoneName) {
    const zone = zoneStats[zoneName];
    if (!zone) return;
    sheet.getRange(rowCursor, 1, 1, 5).setValues([[
      zoneName,
      zone.totals.current,
      zone.totals.palletsCurrent,
      zone.totals.outbound,
      zone.totals.palletsOutbound
    ]]);
    rowCursor += 1;
  });

  rowCursor += 2;
  sheet.getRange(rowCursor, 1, 1, 7).setValues([['Zone', 'SKU', 'Current Qty', 'Outbound Qty', 'Stock Status', 'Last Movement', '']]);
  sheet.getRange(rowCursor, 1, 1, 7).setBackground('#2d3748').setFontColor('#ffffff').setFontWeight('bold');
  rowCursor += 1;

  zoneOrder.forEach(function(zoneName) {
    const zone = zoneStats[zoneName];
    if (!zone) return;
    const entries = Object.keys(zone.skuStats).map(function(sku) {
      const stats = zone.skuStats[sku];
      const status = stats.currentQty > 0 ? 'In Stock' : 'Out of Stock';
      return {
        zone: zoneName,
        sku: sku,
        current: stats.currentQty,
        outbound: stats.outboundQty,
        status: status,
        lastMovement: stats.lastMovement
      };
    }).sort(function(a, b) {
      if (b.current === a.current) {
        return a.sku.localeCompare(b.sku);
      }
      return b.current - a.current;
    });
    entries.forEach(function(entry) {
      sheet.getRange(rowCursor, 1, 1, 7).setValues([[
        entry.zone,
        entry.sku,
        entry.current,
        entry.outbound,
        entry.status,
        entry.lastMovement ? Utilities.formatDate(entry.lastMovement, Session.getScriptTimeZone(), 'MMM d, yyyy HH:mm') : '',
        ''
      ]]);
      rowCursor += 1;
    });
    if (entries.length) {
      rowCursor += 1;
    }
  });

  rowCursor += 1;
  sheet.getRange(rowCursor, 1, 1, 7).merge()
    .setValue('Daily Receiving Log')
    .setFontWeight('bold')
    .setFontSize(13)
    .setFontColor('#1a202c');
  rowCursor += 1;
  sheet.getRange(rowCursor, 1, 1, 7).merge()
    .setValue('Captures every pallet birthed into the warehouse from Receiving Area.')
    .setFontStyle('italic')
    .setFontColor('#4a5568');
  rowCursor += 1;
  const receivingHeader = ['Date', 'Zone', 'SKU', 'Received (Cartons)', 'Pallets'];
  sheet.getRange(rowCursor, 1, 1, receivingHeader.length).setValues([receivingHeader]);
  sheet.getRange(rowCursor, 1, 1, receivingHeader.length).setBackground('#1a202c').setFontColor('#ffffff').setFontWeight('bold');
  rowCursor += 1;

  const receivingDates = Object.keys(receivingSummary).sort(function(a, b) {
    return b.localeCompare(a);
  });
  receivingDates.forEach(function(dateKey) {
    const skus = Object.keys(receivingSummary[dateKey]).sort();
    skus.forEach(function(sku) {
      const stats = receivingSummary[dateKey][sku];
      sheet.getRange(rowCursor, 1, 1, receivingHeader.length).setValues([[
        dateKey,
        'Receiving Area',
        sku,
        stats.received,
        stats.pallets
      ]]);
      rowCursor += 1;
    });
  });

  rowCursor += 2;
  sheet.getRange(rowCursor, 1, 1, 7).merge()
    .setValue('Daily Zone Movements')
    .setFontWeight('bold')
    .setFontSize(13)
    .setFontColor('#1a202c');
  rowCursor += 1;
  sheet.getRange(rowCursor, 1, 1, 7).merge()
    .setValue('Tracks inter-zone transfers, dispatch staging, and outbound shipments (FIFO monitored).')
    .setFontStyle('italic')
    .setFontColor('#4a5568');
  rowCursor += 1;
  const movementHeader = ['Date', 'Zone', 'SKU', 'Moved In (Cartons)', 'Moved Out (Cartons)', 'Shipped (Cartons)', 'Current Stock (Cartons)'];
  sheet.getRange(rowCursor, 1, 1, movementHeader.length).setValues([movementHeader]);
  sheet.getRange(rowCursor, 1, 1, movementHeader.length).setBackground('#1a202c').setFontColor('#ffffff').setFontWeight('bold');
  rowCursor += 1;

  const movementDates = Object.keys(movementSummary).sort(function(a, b) {
    return b.localeCompare(a);
  });
  const currentStockDisplayed = {};
  movementDates.forEach(function(dateKey) {
    const zones = Object.keys(movementSummary[dateKey]).sort();
    zones.forEach(function(zoneName) {
      const skus = Object.keys(movementSummary[dateKey][zoneName]).sort();
      skus.forEach(function(sku) {
        const summaryStats = movementSummary[dateKey][zoneName][sku];
        const currentNow = zoneStats[zoneName] && zoneStats[zoneName].skuStats[sku]
          ? zoneStats[zoneName].skuStats[sku].currentQty : 0;
        const stockKey = zoneName + '||' + sku;
        const currentColumnValue = currentStockDisplayed[stockKey] ? '' : currentNow;
        sheet.getRange(rowCursor, 1, 1, movementHeader.length).setValues([[
          dateKey,
          zoneName,
          sku,
          summaryStats.movedIn || 0,
          summaryStats.movedOut || 0,
          summaryStats.shipped || 0,
          currentColumnValue
        ]]);
        if (!currentStockDisplayed[stockKey]) {
          currentStockDisplayed[stockKey] = true;
        }
        rowCursor += 1;
      });
    });
  });

  rowCursor += 2;
  sheet.getRange(rowCursor, 1, 1, 10).merge()
    .setValue('Movement History Detail')
    .setFontWeight('bold')
    .setFontSize(13)
    .setFontColor('#1a202c');
  rowCursor += 1;
  sheet.getRange(rowCursor, 1, 1, 10).merge()
    .setValue('End-to-end trail of every movement with its source, destination, movement ID, and notes.')
    .setFontStyle('italic')
    .setFontColor('#4a5568');
  rowCursor += 1;
  const movementDetailHeader = ['Movement Date', 'Movement ID', 'Pallet ID', 'SKU', 'From Zone', 'To Zone', 'Quantity (Cartons)', 'Moved By', 'Order Ref', 'Reason / Notes'];
  sheet.getRange(rowCursor, 1, 1, movementDetailHeader.length).setValues([movementDetailHeader]);
  sheet.getRange(rowCursor, 1, 1, movementDetailHeader.length).setBackground('#1a202c').setFontColor('#ffffff').setFontWeight('bold');
  rowCursor += 1;

  movementDetails.sort(function(a, b) {
    return (b.dateKey || '').localeCompare(a.dateKey || '');
  }).forEach(function(detail) {
    const reasonNotes = [detail.reason, detail.overrideReason, detail.notes].filter(function(part) {
      return part && part.toString().trim().length;
    }).join(' | ');
    sheet.getRange(rowCursor, 1, 1, movementDetailHeader.length).setValues([[
      detail.movementDate || detail.dateKey || '',
      detail.movementId,
      detail.palletId,
      detail.sku,
      detail.fromZone,
      detail.toZone,
      detail.quantity,
      detail.movedBy,
      detail.orderReference,
      reasonNotes || ''
    ]]);
    rowCursor += 1;
  });

  const receivingZone = zoneStats['Receiving Area'];
  const receivingQty = facilityTotals.received;
  const receivingPallets = facilityTotals.receivedPallets;
  const cardData = [
    { range: 'A4:C6', title: 'Receiving Area', value: formatNumber(receivingQty), subtitle: receivingPallets + ' pallets awaiting processing', color: '#4dabf7' },
    { range: 'D4:F6', title: 'In Stock', value: formatNumber(facilityTotals.current), subtitle: facilityTotals.currentPallets + ' pallets', color: '#48bb78' },
    { range: 'G4:I6', title: 'Outbounded', value: formatNumber(facilityTotals.outbound), subtitle: facilityTotals.outboundPallets + ' pallets shipped', color: '#f6ad55' },
    { range: 'A7:C9', title: 'Active SKUs', value: formatNumber(facilityTotals.activeSkuSet.size), subtitle: 'SKUs with stock', color: '#9f7aea' }
  ];
  cardData.forEach(function(card) {
    const range = sheet.getRange(card.range);
    range.merge();
    range.setValue(card.title + '\n' + card.value + '\n' + card.subtitle);
    range.setBackground(card.color);
    range.setFontColor('#ffffff');
    range.setFontSize(13);
    range.setFontWeight('bold');
    range.setVerticalAlignment('middle');
    range.setHorizontalAlignment('left');
    range.setWrap(true);
  });

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow > 0 && lastColumn > 0) {
    sheet.getRange(1, 1, lastRow, lastColumn).setWrap(true);
    sheet.autoResizeColumns(1, lastColumn);
    sheet.autoResizeRows(1, lastRow);
  }

  return createResponse({ success: true, message: 'InventorySnapshot sheet rebuilt.' });
}

function refreshInventorySnapshotSilently() {
  try {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(100)) {
      // Snapshot refresh skipped silently (lock in use)
      return;
    }
    try {
      createInventorySnapshot();
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Snapshot refresh error - silent fail
  }
}

function generateMovementId() {
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return 'MOV-' + ts + '-' + random;
}

function getZoneConfigMap() {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'ZoneConfig', STOCK_MOVEMENT_SHEETS.ZoneConfig);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const rowObj = {};
    headers.forEach(function(header, idx) {
      rowObj[header] = data[i][idx];
    });
    map[rowObj.ZoneName] = rowObj;
  }
  return map;
}

function getZoneConfigDataResponse(includeRecentMovements) {
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'ZoneConfig', STOCK_MOVEMENT_SHEETS.ZoneConfig);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const zones = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const zone = {};
    headers.forEach(function(header, idx) {
      zone[header] = data[i][idx];
    });
    zones.push(zone);
  }
  var payload = { success: true, zones: zones };
  if (includeRecentMovements) {
    var movementsResult = getRecentMovementsData(10);
    payload.movements = movementsResult;
  }
  return createResponse(payload);
}

function normalizeMovementRow(raw) {
  var alias = {
    'Movement ID': 'MovementID', 'MovementId': 'MovementID',
    'Pallet ID': 'PalletID', 'PalletId': 'PalletID',
    'From Zone': 'FromZone', 'From zone': 'FromZone',
    'To Zone': 'ToZone', 'To zone': 'ToZone',
    'Movement Date': 'MovementDate', 'Date': 'MovementDate',
    'Movement Time': 'MovementTime', 'Time': 'MovementTime',
    'Moved By': 'MovedBy', 'Moved by': 'MovedBy',
    'Order Reference': 'OrderReference', 'Order Ref': 'OrderReference',
    'Override Reason': 'OverrideReason', 'FIFO Override': 'OverrideReason',
    'Created At': 'CreatedAt', 'Created': 'CreatedAt', 'Logged At': 'CreatedAt'
  };
  var obj = {};
  var canonicalKeys = ['MovementID', 'PalletID', 'FromZone', 'ToZone', 'MovementDate', 'MovementTime', 'MovedBy', 'Reason', 'OverrideReason', 'Quantity', 'OrderReference', 'Notes', 'CreatedAt'];
  canonicalKeys.forEach(function(k) {
    obj[k] = raw[k];
    if (obj[k] === undefined) {
      for (var h in raw) {
        if (h && (h.replace(/\s/g, '') === k || alias[h] === k)) {
          obj[k] = raw[h];
          break;
        }
      }
    }
  });
  return obj;
}

function getRecentMovementsData(limit) {
  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var sheet = workbook.getSheetByName('ZoneMovements') || workbook.getSheetByName('Zone Movements');
  if (!sheet) {
    var sheets = workbook.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var name = (sheets[s].getName() || '').toLowerCase().replace(/\s/g, '');
      if (name === 'zonemovements' || name.indexOf('zonemovement') >= 0) {
        sheet = sheets[s];
        break;
      }
    }
  }
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r) continue;
    var hasData = false;
    for (var c = 0; c < (r || []).length; c++) {
      if (r[c] !== undefined && r[c] !== null && String(r[c]).trim()) {
        hasData = true;
        break;
      }
    }
    if (!hasData) continue;
    var raw = {};
    for (var j = 0; j < headers.length; j++) {
      var v = r[j];
      if (v instanceof Date) {
        raw[headers[j]] = v.toISOString ? v.toISOString() : String(v);
      } else {
        raw[headers[j]] = v;
      }
    }
    var obj = normalizeMovementRow(raw);
    rows.push(obj);
  }
  rows.sort(function(a, b) {
    var da = (a.CreatedAt ? new Date(a.CreatedAt).getTime() : NaN) ||
             (a.MovementDate ? new Date(a.MovementDate).getTime() : NaN) ||
             (a.MovementTime ? new Date(a.MovementTime).getTime() : NaN) || 0;
    var db = (b.CreatedAt ? new Date(b.CreatedAt).getTime() : NaN) ||
             (b.MovementDate ? new Date(b.MovementDate).getTime() : NaN) ||
             (b.MovementTime ? new Date(b.MovementTime).getTime() : NaN) || 0;
    return db - da;
  });
  return rows.slice(0, Math.min(limit || 10, rows.length));
}

/**
 * Evaluate SKU-to-zone eligibility using SKUZoneMapping sheet
 * @param {Object} config
 *  - sku {string}
 *  - toZone {string}
 *  - palletType {string}
 */
function checkZoneEligibility(config) {
  if (!config || !config.toZone) {
    return { allowed: false, message: 'Target zone required' };
  }
  const toZone = config.toZone.trim();
  const toZoneUpper = toZone.toUpperCase();
  const toZoneLower = toZone.toLowerCase();
  // OUTBONDED is the final consumer destination - accepts all SKUs from Outbounding
  // Handle all case variations: OUTBONDED, Outbonded, outbonded, OUTBOUNDED, Outbounded
  if (toZoneUpper === 'OUTBONDED' || toZoneUpper === 'OUTBOUNDED' || 
      toZoneLower === 'outbonded' || toZoneLower === 'outbounded') {
    return {
      allowed: true,
      targetStatus: 'Outbounded',
      info: 'OUTBONDED is final destination - accepts all pallets.'
    };
  }
  if (toZone === 'Outbounding') {
    return {
      allowed: true,
      targetStatus: 'Shipped',
      info: 'Outbounding treated as final shipping zone.'
    };
  }
  const zoneConfigMap = getZoneConfigMap();
  const zoneSettings = zoneConfigMap[toZone] || {};
  const defaultStatus = zoneSettings.DefaultStatus || 'Active';
  const result = {
    allowed: true,
    targetStatus: defaultStatus
  };
  const sku = (config.sku || '').toString().trim();
  if (!sku) {
    result.info = 'No SKU specified; allowing by default.';
    return result;
  }
  const skuMapping = findSkuZoneEntry(sku);
  if (!skuMapping) {
    result.info = 'SKU not yet mapped; allowing by default.';
    return result;
  }
  if (skuMapping.requiresBanding && (config.palletType || '').toLowerCase() !== 'banded') {
    return {
      allowed: false,
      message: 'SKU ' + sku + ' requires banded pallets only.'
    };
  }
  if (skuMapping.allowedZones.length > 0) {
    const zoneNameNormalized = toZone.toUpperCase();
    const allowed = skuMapping.allowedZones.some(function(zone) {
      return zone.toUpperCase() === zoneNameNormalized;
    });
    if (!allowed) {
      return {
        allowed: false,
        message: 'SKU ' + sku + ' not allowed in ' + toZone + '. Allowed zones: ' + skuMapping.allowedZones.join(', ')
      };
    }
  }
  if (skuMapping.shelfLifeDays) {
    result.shelfLifeDays = skuMapping.shelfLifeDays;
  }
  return result;
}

/**
 * Return pallets currently in a zone (FIFO ordered)
 * @param {Object} params
 *  - zoneName {string}
 *  - status {string} optional
 *  - limit {number} optional
 */
function getPalletsInZone(params) {
  if (!params || !params.zoneName) {
    throw new Error('zoneName is required.');
  }
  const zoneName = params.zoneName.trim();
  const statusFilter = (params.status || '').trim();
  const limit = params.limit ? Number(params.limit) : null;
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return createResponse({ success: true, pallets: [] });
  }
  const headers = data[0];
  const zoneCol = headers.indexOf('CurrentZone');
  const statusCol = headers.indexOf('Status');
  const createdAtCol = headers.indexOf('CreatedAt');
  if (zoneCol === -1 || createdAtCol === -1) {
    throw new Error('Pallets sheet missing required columns.');
  }
  const pallets = data.slice(1).filter(function(row) {
    if ((row[zoneCol] || '').toString().trim() !== zoneName) return false;
    if (statusFilter && statusCol >= 0) {
      const rowStatus = (row[statusCol] || '').toString().trim();
      if (rowStatus.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }
    }
    return true;
  }).map(function(row) {
    return rowToObject(headers, row);
  }).sort(function(a, b) {
    const aDate = new Date(a.CreatedAt || a.CreatedDate || 0);
    const bDate = new Date(b.CreatedAt || b.CreatedDate || 0);
    return aDate - bDate;
  });
  const finalList = limit ? pallets.slice(0, limit) : pallets;
  return createResponse({
    success: true,
    zone: zoneName,
    count: finalList.length,
    pallets: finalList
  });
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach(function(header, idx) {
    obj[header] = row[idx];
  });
  return obj;
}

function getSkuZoneMappingData(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && SKU_ZONE_CACHE.data && (now - SKU_ZONE_CACHE.timestamp) < SKU_ZONE_CACHE_TTL_MS) {
    return SKU_ZONE_CACHE.data;
  }
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ensureSheetWithHeaders(workbook, 'SKUZoneMapping', STOCK_MOVEMENT_SHEETS.SKUZoneMapping);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const mapping = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const entry = {};
    headers.forEach(function(header, idx) {
      entry[header] = data[i][idx];
    });
    entry.allowedZones = parseAllowedZones(entry.AllowedZones);
    entry.requiresBanding = parseBoolean(entry.RequiresBanding);
    entry.shelfLifeDays = entry.ShelfLifeDays || '';
    entry.SKU = (entry.SKU || '').toString().trim();
    if (entry.SKU) {
      mapping.push(entry);
    }
  }
  SKU_ZONE_CACHE.data = mapping;
  SKU_ZONE_CACHE.timestamp = now;
  return mapping;
}

function findSkuZoneEntry(sku) {
  const normalizedSku = sku.toString().trim().toUpperCase();
  if (!normalizedSku) {
    return null;
  }
  const mapping = getSkuZoneMappingData();
  let exactMatch = mapping.find(function(entry) {
    return entry.SKU.toUpperCase() === normalizedSku;
  });
  if (exactMatch) {
    return exactMatch;
  }
  // Allow wildcard entries using trailing *
  const wildcardMatch = mapping.find(function(entry) {
    const skuValue = entry.SKU.toUpperCase();
    if (skuValue.endsWith('*')) {
      const prefix = skuValue.slice(0, -1);
      return normalizedSku.startsWith(prefix);
    }
    return false;
  });
  return wildcardMatch || null;
}

function normalizeProductType(val) {
  if (!val) return '';
  const v = (val + '').toUpperCase().replace(/\s/g, '');
  if (v === '1KG') return '1KG';
  if (v === '0.5KG' || v === '05KG') return '0.5KG';
  return (val + '').trim();
}

function getSkusFromZoneMapping() {
  const mapping = getSkuZoneMappingData();
  return mapping.map(function(e) { return (e.SKU || '').trim(); }).filter(Boolean).sort();
}

function getSkuProductInfo(sku) {
  const entry = findSkuZoneEntry(sku);
  if (!entry) return { productType: '', sachetType: '', tabletType: '', uom: '' };
  return {
    productType: normalizeProductType(entry.ProductType || entry['Product Type'] || ''),
    sachetType: (entry['Sachet Type'] || entry.SachetType || '').toString().trim(),
    tabletType: (entry['Tablet Type'] || entry.TabletType || '').toString().trim(),
    uom: (entry.UoM || entry.uom || '').toString().trim()
  };
}

function harmonizeSkuProductInfo(workbook) {
  workbook = workbook || SpreadsheetApp.openById(SHEET_ID);
  if (!workbook) throw new Error('Could not open workbook');
  var unpaired = [];
  var ticketsSheet = workbook.getSheetByName('Tickets');
  if (ticketsSheet) {
    var data = ticketsSheet.getDataRange().getValues();
    var headers = data[0] || [];
    var skuCol = headers.indexOf('SKU') >= 0 ? headers.indexOf('SKU') : 3;
    var ptCol = headers.indexOf('Product Type') >= 0 ? headers.indexOf('Product Type') : (headers.indexOf('ProductType') >= 0 ? headers.indexOf('ProductType') : 7);
    var sachetCol = headers.indexOf('Sachet Type') >= 0 ? headers.indexOf('Sachet Type') : (headers.indexOf('SachetType') >= 0 ? headers.indexOf('SachetType') : 13);
    var tabletCol = headers.indexOf('Tablet Type') >= 0 ? headers.indexOf('Tablet Type') : (headers.indexOf('TabletType') >= 0 ? headers.indexOf('TabletType') : 14);
    var uomCol = headers.indexOf('UoM') >= 0 ? headers.indexOf('UoM') : (headers.length > 15 ? 15 : -1);
    if (uomCol < 0 && headers.length <= 15) {
      headers.push('UoM');
      uomCol = headers.length - 1;
      ticketsSheet.getRange(1, uomCol + 1).setValue('UoM');
    }
    var placeholder = '\u2014'; // em dash when catalog has no value
    for (var i = 1; i < data.length; i++) {
      var sku = (data[i][skuCol] || '').toString().trim();
      if (!sku) continue;
      var info = findSkuZoneEntry(sku) ? getSkuProductInfo(sku) : null;
      if (info && info.productType) {
        data[i][ptCol] = info.productType;
        if (sachetCol >= 0) data[i][sachetCol] = info.sachetType || placeholder;
        if (tabletCol >= 0) data[i][tabletCol] = info.tabletType || placeholder;
        if (uomCol >= 0) data[i][uomCol] = info.uom || placeholder;
      } else {
        if (ptCol >= 0) data[i][ptCol] = 'NOT IN CATALOG';
        if (sachetCol >= 0) data[i][sachetCol] = 'NOT IN CATALOG';
        if (tabletCol >= 0) data[i][tabletCol] = 'NOT IN CATALOG';
        if (uomCol >= 0) data[i][uomCol] = 'NOT IN CATALOG';
        unpaired.push({ sheet: 'Tickets', row: i + 1, sku: sku });
      }
    }
    var numDataRows = data.length - 1;
    if (numDataRows > 0) {
      var batchSize = 400;
      var rows = data.slice(1);
      for (var off = 0; off < rows.length; off += batchSize) {
        var chunk = rows.slice(off, off + batchSize);
        if (chunk.length === 0) break;
        ticketsSheet.getRange(2 + off, 1, chunk.length, data[0].length).setValues(chunk);
        SpreadsheetApp.flush();
        if (off + batchSize < rows.length) Utilities.sleep(200);
      }
    }
  }
  var calcSheet = workbook.getSheetByName('Calculations');
  if (calcSheet) {
    var calcData = calcSheet.getDataRange().getValues();
    var calcHeaders = calcData[0] || [];
    var cSkuCol = calcHeaders.indexOf('SKU') >= 0 ? calcHeaders.indexOf('SKU') : 1;
    var cPtCol = calcHeaders.indexOf('Product Type') >= 0 ? calcHeaders.indexOf('Product Type') : 2;
    var cSachetCol = calcHeaders.indexOf('Sachet Type') >= 0 ? calcHeaders.indexOf('Sachet Type') : 13;
    var cTabletCol = calcHeaders.indexOf('Tablet Type') >= 0 ? calcHeaders.indexOf('Tablet Type') : 14;
    var calcPlaceholder = '\u2014'; // em dash when catalog has no value
    for (var j = 1; j < calcData.length; j++) {
      var cSku = (calcData[j][cSkuCol] || '').toString().trim();
      if (!cSku) continue;
      var cInfo = findSkuZoneEntry(cSku) ? getSkuProductInfo(cSku) : null;
      if (cInfo && cInfo.productType) {
        calcData[j][cPtCol] = cInfo.productType;
        if (cSachetCol >= 0) calcData[j][cSachetCol] = cInfo.sachetType || calcPlaceholder;
        if (cTabletCol >= 0) calcData[j][cTabletCol] = cInfo.tabletType || calcPlaceholder;
      } else {
        if (cPtCol >= 0) calcData[j][cPtCol] = 'NOT IN CATALOG';
        if (cSachetCol >= 0) calcData[j][cSachetCol] = 'NOT IN CATALOG';
        if (cTabletCol >= 0) calcData[j][cTabletCol] = 'NOT IN CATALOG';
        unpaired.push({ sheet: 'Calculations', row: j + 1, sku: cSku });
      }
    }
    var numCalcRows = calcData.length - 1;
    if (numCalcRows > 0) {
      var calcBatchSize = 400;
      var calcRows = calcData.slice(1);
      for (var cOff = 0; cOff < calcRows.length; cOff += calcBatchSize) {
        var cChunk = calcRows.slice(cOff, cOff + calcBatchSize);
        if (cChunk.length === 0) break;
        calcSheet.getRange(2 + cOff, 1, cChunk.length, calcData[0].length).setValues(cChunk);
        SpreadsheetApp.flush();
        if (cOff + calcBatchSize < calcRows.length) Utilities.sleep(200);
      }
    }
  }
  var reviewSheet = workbook.getSheetByName('Unpaired SKU Review');
  if (!reviewSheet) reviewSheet = workbook.insertSheet('Unpaired SKU Review');
  else reviewSheet.clear();
  reviewSheet.getRange(1, 1, 1, 4).setValues([['Sheet', 'Row', 'SKU', 'Notes']]);
  reviewSheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#f59e0b').setFontColor('#ffffff');
  var reviewRows = unpaired.map(function(u) { return [u.sheet, u.row, u.sku, 'Add to SKUZoneMapping']; });
  if (reviewRows.length) {
    reviewSheet.getRange(2, 1, reviewRows.length, 4).setValues(reviewRows);
  }
  return { updated: true, unpairedCount: unpaired.length };
}

function parseAllowedZones(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return value.toString().split(/[,\n]/).map(function(zone) {
    return zone.trim();
  }).filter(function(zone) {
    return zone.length > 0;
  });
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (value === undefined || value === null) return false;
  const str = value.toString().trim().toLowerCase();
  return str === 'true' || str === 'yes' || str === '1';
}

function splitCsvList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return value.toString().split(',').map(function(item) {
    return item.trim();
  }).filter(function(item) {
    return item.length > 0;
  });
}

function mapTicketRowToObject(row) {
  if (!row || row.length === 0) {
    return null;
  }
  return {
    serial: row[0] || '',
    date: row[1] || '',
    time: row[2] || '',
    sku: row[3] || '',
    qty: Number(row[4]) || 0,
    layers: row[5] || '',
    bandingType: splitCsvList(row[6]),
    productType: splitCsvList(row[7]),
    palletSize: splitCsvList(row[8]),
    notes: row[9] || '',
    qualityIssueType: row[10] || '',
    qualityIssueDesc: row[11] || '',
    groupLeader: row[12] || '',
    sachetType: row[13] || '',
    tabletType: row[14] || '',
    merchHistory: row[15] || '',
    createdAt: row[16] || '',
    firstModified: row[17] || '',
    lastModified: row[18] || '',
    changeHistory: row[19] || '',
    modifiedBy: row[20] || ''
  };
}

function buildTicketFromPalletRow(row, columnIndexMap) {
  if (!row || !columnIndexMap) {
    return null;
  }
  const get = function(header) {
    const idx = columnIndexMap[header];
    return idx >= 0 ? row[idx] : '';
  };
  return {
    serial: get('PalletID') || '',
    date: get('ManufacturingDate') || '',
    time: '',
    sku: get('SKU') || '',
    qty: Number(get('RemainingQuantity')) || Number(get('Quantity')) || 0,
    layers: get('Layers') || '',
    bandingType: splitCsvList(get('BandingType')),
    productType: splitCsvList(get('ProductType')),
    palletSize: splitCsvList(get('PalletSize')),
    notes: get('Notes') || '',
    qualityIssueType: '',
    qualityIssueDesc: '',
    groupLeader: '',
    sachetType: '',
    tabletType: '',
    merchHistory: [],
    createdAt: get('CreatedAt') || '',
    firstModified: '',
    lastModified: get('LastMovedAt') || '',
    changeHistory: '',
    modifiedBy: get('LastMovedBy') || ''
  };
}

function deriveZonePrefix(palletId) {
  if (!palletId) return '';
  const match = palletId.toString().match(/^FG-([A-Z0-9]+)-/i);
  return match ? match[1].toUpperCase() : '';
}

function determinePalletType(palletId) {
  if (!palletId) return 'Standard';
  return palletId.toUpperCase().indexOf('-BND-') >= 0 ? 'Banded' : 'Standard';
}

function createOrUpdatePalletFromTicket(ticket, overrides) {
  if (!ticket || !ticket.serial || !ticket.sku) {
    return;
  }
  const opts = overrides || {};
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const palletSheet = ensureSheetWithHeaders(workbook, 'Pallets', STOCK_MOVEMENT_SHEETS.Pallets);
  const data = palletSheet.getDataRange().getValues();
  const headers = data[0];
  const columnIndexMap = {};
  headers.forEach(function(header, idx) {
    columnIndexMap[header] = idx;
  });
  const requiredColumns = ['PalletID', 'CurrentZone', 'Status', 'CreatedAt', 'LastMovedAt', 'LastMovedBy'];
  const missingColumn = requiredColumns.find(function(header) { return columnIndexMap[header] === undefined; });
  if (missingColumn) {
    throw new Error('Pallets sheet missing required column: ' + missingColumn);
  }
  const palletId = ticket.serial;
  let targetRowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][columnIndexMap.PalletID] || '').toString() === palletId) {
      targetRowIndex = i;
      break;
    }
  }
  const zoneConfigMap = getZoneConfigMap();
  const skuEntry = ticket.sku ? findSkuZoneEntry(ticket.sku) : null;
  const fallbackZone = 'Receiving Area';
  const existingRow = targetRowIndex >= 1 ? data[targetRowIndex] : null;
  const priorZone = existingRow && columnIndexMap.CurrentZone !== undefined ? (existingRow[columnIndexMap.CurrentZone] || '') : '';
  const defaultZone = opts.currentZone || priorZone || opts.initialZone ||
    (skuEntry && (skuEntry.DefaultZone || (skuEntry.allowedZones && skuEntry.allowedZones[0]))) ||
    fallbackZone;
  const zoneSettings = zoneConfigMap[defaultZone] || {};
  const now = new Date();
  const createdAtExisting = existingRow && columnIndexMap.CreatedAt !== undefined ? existingRow[columnIndexMap.CreatedAt] : '';
  const lastMovedAtExisting = existingRow && columnIndexMap.LastMovedAt !== undefined ? existingRow[columnIndexMap.LastMovedAt] : '';
  const lastMovedByExisting = existingRow && columnIndexMap.LastMovedBy !== undefined ? existingRow[columnIndexMap.LastMovedBy] : '';
  const createdAtValue = opts.createdAt || createdAtExisting || (ticket.createdAt ? new Date(ticket.createdAt) : now);
  const lastMovedAtValue = opts.lastMovedAt || lastMovedAtExisting || createdAtValue;
  const lastMovedByValue = opts.lastMovedBy || lastMovedByExisting || ticket.modifiedBy || 'System';
  const remainingQuantityValue = opts.remainingQuantity != null
    ? Number(opts.remainingQuantity)
    : (existingRow && columnIndexMap.RemainingQuantity !== undefined
        ? (Number(existingRow[columnIndexMap.RemainingQuantity]) || Number(existingRow[columnIndexMap.Quantity]) || Number(ticket.qty) || 0)
        : (Number(ticket.qty) || 0));
  const parentIdValue = opts.parentId || (existingRow && columnIndexMap.ParentPalletID !== undefined ? (existingRow[columnIndexMap.ParentPalletID] || '') : '');
  let childListValue = existingRow && columnIndexMap.ChildPallets !== undefined ? (existingRow[columnIndexMap.ChildPallets] || '') : '';
  if (opts.appendChildId) {
    const parts = childListValue ? childListValue.split(',').map(function(entry) { return entry.trim(); }).filter(Boolean) : [];
    if (parts.indexOf(opts.appendChildId) === -1) {
      parts.push(opts.appendChildId);
      childListValue = parts.join(', ');
    }
  }
  const notesValue = opts.notes ||
    (ticket.notes || (existingRow && columnIndexMap.Notes !== undefined ? (existingRow[columnIndexMap.Notes] || '') : ''));
  const rowValues = STOCK_MOVEMENT_SHEETS.Pallets.map(function(header) {
    switch (header) {
      case 'PalletID':
        return palletId;
      case 'PalletType':
        return opts.palletType || determinePalletType(palletId);
      case 'OriginalTicketSerial':
        return ticket.serial;
      case 'ZonePrefix':
        return opts.zonePrefix || deriveZonePrefix(palletId);
      case 'CurrentZone':
        return defaultZone;
      case 'Status':
        return opts.status ||
          (existingRow && columnIndexMap.Status !== undefined ? (existingRow[columnIndexMap.Status] || zoneSettings.DefaultStatus || 'Active') : (zoneSettings.DefaultStatus || 'Active'));
      case 'SKU':
        return ticket.sku || '';
      case 'ProductType':
        return Array.isArray(ticket.productType) ? ticket.productType.join(', ') : (ticket.productType || '');
      case 'Quantity':
        return ticket.qty || '';
      case 'RemainingQuantity':
        return remainingQuantityValue;
      case 'Layers':
        return ticket.layers || '';
      case 'ManufacturingDate':
        return ticket.date || '';
      case 'BatchLot':
        return ticket.batchLot || '';
      case 'ExpiryDate':
        return ticket.expiryDate || '';
      case 'ShelfLifeDays':
        if (opts.shelfLifeDays != null) {
          return opts.shelfLifeDays;
        }
        return skuEntry ? (skuEntry.shelfLifeDays || '') : '';
      case 'ParentPalletID':
        return parentIdValue;
      case 'ChildPallets':
        return childListValue;
      case 'PhotoLinks':
        return ticket.photoLinks || '';
      case 'CreatedBy':
        return ticket.modifiedBy || 'System';
      case 'CreatedAt':
        return createdAtValue;
      case 'LastMovedAt':
        return lastMovedAtValue;
      case 'LastMovedBy':
        return lastMovedByValue;
      case 'Notes':
        return notesValue;
      case 'InTransitToZone':
        return opts.inTransitToZone || '';
      case 'InTransitMovementID':
        return opts.inTransitMovementID || '';
      case 'InTransitInitiatedAt':
        return opts.inTransitInitiatedAt || '';
      case 'InTransitInitiatedBy':
        return opts.inTransitInitiatedBy || '';
      default:
        return '';
    }
  });
  if (targetRowIndex >= 1) {
    palletSheet.getRange(targetRowIndex + 1, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    palletSheet.appendRow(rowValues);
  }
  refreshInventorySnapshotSilently();
}

// ─────────────────────────────────────────────────────────────────────────────
// BIN CARDS — read current shift balances and save confirmations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns bin card data for the current shift (or a given date/shift).
 * Reads Pallets + ZoneMovements; no writes.
 */
function getBinCardData(params) {
  params = params || {};
  const workbook = SpreadsheetApp.openById(SHEET_ID);
  const filterZone = (params.zone || '').toString().trim();
  const filterSku  = (params.sku  || '').toString().trim();
  const paramShiftDate = (params.shiftDate || '').toString().trim();
  const paramShift    = (params.shift     || '').toString().trim();

  const now = new Date();
  var shiftInfo;
  if (paramShiftDate && paramShift) {
    shiftInfo = getBinCardShiftInfoForParams(paramShiftDate, paramShift);
    if (!shiftInfo) return createResponse({ success: false, error: 'Invalid shiftDate or shift. Use YYYY-MM-DD and Day or Night.' });
  } else {
    shiftInfo = getBinCardShiftInfo(now);
  }
  var isPastShift = shiftInfo.shiftEnd <= now;

  // ── 1. Build pallet map: palletId → { sku, currentZone, remainingQty } ──
  const palletsSheet = workbook.getSheetByName('Pallets');
  if (!palletsSheet) return createResponse({ success: false, error: 'Pallets sheet not found' });

  const palletsData = palletsSheet.getDataRange().getValues();
  const palletHeaders = palletsData[0] || [];
  const pi = buildHeaderIndexMap(palletHeaders);
  const palletMap = {};

  for (var i = 1; i < palletsData.length; i++) {
    var row = palletsData[i];
    if (!row || !row[pi.PalletID]) continue;
    var palletId = (row[pi.PalletID] || '').toString().trim().toUpperCase();
    palletMap[palletId] = {
      sku:         (row[pi.SKU]              || 'Unknown').toString().trim(),
      currentZone: (row[pi.CurrentZone]      || '').toString().trim(),
      remainingQty: Number(row[pi.RemainingQuantity]) || Number(row[pi.Quantity]) || 0
    };
  }

  var SKIP_ZONES = { 'Outbounding': true, 'Outbonded': true, 'Outbounded': true };
  var zoneSkuBalance = {};
  var zoneSkuMov = {};
  var movementsInShift = [];
  var palletConsistency = { totalPallets: 0, sumOfZonePallets: 0, consistent: true, birthedOriginalCount: 0, palletsByZone: {} };

  if (isPastShift) {
    // ── Past shift: replay ZoneMovements up to shiftEnd (segmented by row chunks) ──
    var movSheet = workbook.getSheetByName('ZoneMovements') || workbook.getSheetByName('Zone Movements');
    if (!movSheet) return createResponse({ success: false, error: 'ZoneMovements sheet not found for past-shift replay.' });
    var movHeaders = movSheet.getRange(1, 1, 1, 30).getValues()[0] || [];
    var mi = buildHeaderIndexMap(movHeaders);
    var numRows = movSheet.getLastRow();
    var CHUNK = 4000;
    var allMovements = [];
    for (var startRow = 2; startRow <= numRows; startRow += CHUNK) {
      var endRow = Math.min(startRow + CHUNK - 1, numRows);
      var chunkData = movSheet.getRange(startRow, 1, endRow, movHeaders.length || 25).getValues();
      for (var ci = 0; ci < chunkData.length; ci++) {
        var mrow = chunkData[ci];
        if (!mrow || !mrow[mi.MovementID]) continue;
        var tsRaw = mi.CreatedAt >= 0 ? mrow[mi.CreatedAt] : null;
        if (!tsRaw && mi.MovementDate >= 0 && mi.MovementTime >= 0) {
          var md = mrow[mi.MovementDate], mt = mrow[mi.MovementTime];
          if (md && mt) tsRaw = new Date((md + '').trim() + 'T' + (mt + '').trim());
          else if (md) tsRaw = md instanceof Date ? md : new Date(md);
        }
        if (!tsRaw) continue;
        var ts = tsRaw instanceof Date ? tsRaw : new Date(tsRaw);
        if (isNaN(ts.getTime()) || ts > shiftInfo.shiftEnd) continue;
        var movStatus = (mrow[mi.MovementStatus] || '').toString().trim().toLowerCase();
        if (movStatus === 'cancelled' || movStatus === 'auto-reverted') continue;
        var pid2 = (mrow[mi.PalletID] || '').toString().trim().toUpperCase();
        var sku2 = palletMap[pid2] ? palletMap[pid2].sku : 'Unknown';
        var fromZone = (mrow[mi.FromZone] || '').toString().trim();
        var toZone   = (mrow[mi.ToZone]   || '').toString().trim();
        var qty = Number(mrow[mi.Quantity]) || 0;
        allMovements.push({ ts: ts, pid2: pid2, sku2: sku2, fromZone: fromZone, toZone: toZone, qty: qty, mrow: mrow, mi: mi });
      }
    }
    allMovements.sort(function(a, b) { return a.ts - b.ts; });
    for (var m = 0; m < allMovements.length; m++) {
      var am = allMovements[m];
      if (am.fromZone && !SKIP_ZONES[am.fromZone]) {
        var outKey = am.fromZone + '|||' + am.sku2;
        zoneSkuBalance[outKey] = (zoneSkuBalance[outKey] || 0) - am.qty;
      }
      if (am.toZone && !SKIP_ZONES[am.toZone]) {
        var inKey = am.toZone + '|||' + am.sku2;
        zoneSkuBalance[inKey] = (zoneSkuBalance[inKey] || 0) + am.qty;
      }
    }
    for (var m2 = 0; m2 < allMovements.length; m2++) {
      var am2 = allMovements[m2];
      if (am2.ts < shiftInfo.shiftStart || am2.ts >= shiftInfo.shiftEnd) continue;
      movementsInShift.push({
        palletId: am2.pid2, sku: am2.sku2, fromZone: am2.fromZone, toZone: am2.toZone, quantity: am2.qty,
        movedBy: (am2.mrow[am2.mi.MovedBy] || '').toString().trim(),
        movementDate: am2.ts.toISOString ? am2.ts.toISOString() : String(am2.ts),
        movementId: (am2.mrow[am2.mi.MovementID] || '').toString().trim()
      });
      if (am2.fromZone && !SKIP_ZONES[am2.fromZone]) {
        var ok = am2.fromZone + '|||' + am2.sku2;
        if (!zoneSkuMov[ok]) zoneSkuMov[ok] = { movedIn: 0, movedOut: 0 };
        zoneSkuMov[ok].movedOut += am2.qty;
      }
      if (am2.toZone && !SKIP_ZONES[am2.toZone]) {
        var ik = am2.toZone + '|||' + am2.sku2;
        if (!zoneSkuMov[ik]) zoneSkuMov[ik] = { movedIn: 0, movedOut: 0 };
        zoneSkuMov[ik].movedIn += am2.qty;
      }
    }
    movementsInShift.sort(function(a, b) { return new Date(b.movementDate) - new Date(a.movementDate); });
    var replayedByZone = {};
    Object.keys(zoneSkuBalance).forEach(function(k) {
      var z = k.split('|||')[0];
      replayedByZone[z] = (replayedByZone[z] || 0) + (zoneSkuBalance[k] || 0);
    });
    var sumRep = Object.keys(replayedByZone).reduce(function(s, z) { return s + (replayedByZone[z] || 0); }, 0);
    palletConsistency = { totalPallets: sumRep, sumOfZonePallets: sumRep, consistent: true, birthedOriginalCount: 0, palletsByZone: replayedByZone };
  } else {
    // ── Current shift: derive from Pallets + movements in window ──
    var palletsByZone = {};
    var totalPallets = 0;
    var birthedOriginalCount = 0;
    var parentIdIdx = palletHeaders.indexOf('ParentPalletID');
    for (var pi2 = 1; pi2 < palletsData.length; pi2++) {
      var r = palletsData[pi2];
      if (!r || !r[pi.PalletID]) continue;
      totalPallets += 1;
      var pz = (r[pi.CurrentZone] || '').toString().trim() || 'Unknown Zone';
      palletsByZone[pz] = (palletsByZone[pz] || 0) + 1;
      if (parentIdIdx >= 0) {
        var pidVal = (r[parentIdIdx] || '').toString().trim();
        if (!pidVal) birthedOriginalCount += 1;
      } else {
        birthedOriginalCount += 1;
      }
    }
    var sumOfZonePallets = Object.keys(palletsByZone).reduce(function(s, z) { return s + (palletsByZone[z] || 0); }, 0);
    palletConsistency = {
      totalPallets: totalPallets,
      sumOfZonePallets: sumOfZonePallets,
      consistent: totalPallets === sumOfZonePallets,
      birthedOriginalCount: birthedOriginalCount,
      palletsByZone: palletsByZone
    };
    Object.keys(palletMap).forEach(function(pid) {
      var p = palletMap[pid];
      if (!p.currentZone || SKIP_ZONES[p.currentZone]) return;
      var key = p.currentZone + '|||' + p.sku;
      zoneSkuBalance[key] = (zoneSkuBalance[key] || 0) + p.remainingQty;
    });
    var movSheet2 = workbook.getSheetByName('ZoneMovements') || workbook.getSheetByName('Zone Movements');
    if (movSheet2) {
      var movData = movSheet2.getDataRange().getValues();
      var movHeaders2 = movData[0] || [];
      var mi2 = buildHeaderIndexMap(movHeaders2);
      for (var j = 1; j < movData.length; j++) {
        var mrow = movData[j];
        if (!mrow || !mrow[mi2.MovementID]) continue;
        var tsRaw = mi2.CreatedAt >= 0 ? mrow[mi2.CreatedAt] : null;
        if (!tsRaw && mi2.MovementDate >= 0 && mi2.MovementTime >= 0) {
          var md = mrow[mi2.MovementDate], mt = mrow[mi2.MovementTime];
          if (md && mt) tsRaw = new Date((md + '').trim() + 'T' + (mt + '').trim());
          else if (md) tsRaw = md instanceof Date ? md : new Date(md);
        }
        if (!tsRaw) continue;
        var ts = tsRaw instanceof Date ? tsRaw : new Date(tsRaw);
        if (isNaN(ts.getTime()) || ts < shiftInfo.shiftStart || ts >= shiftInfo.shiftEnd) continue;
        var movStatus = (mrow[mi2.MovementStatus] || '').toString().trim().toLowerCase();
        if (movStatus === 'cancelled' || movStatus === 'auto-reverted') continue;
        var pid2 = (mrow[mi2.PalletID] || '').toString().trim().toUpperCase();
        var pInfo = palletMap[pid2];
        if (!pInfo) continue;
        var sku2 = pInfo.sku;
        var fromZone = (mrow[mi2.FromZone] || '').toString().trim();
        var toZone   = (mrow[mi2.ToZone]   || '').toString().trim();
        var qty = Number(mrow[mi2.Quantity]) || 0;
        movementsInShift.push({
          palletId: pid2, sku: sku2, fromZone: fromZone, toZone: toZone, quantity: qty,
          movedBy: (mrow[mi2.MovedBy] || '').toString().trim(),
          movementDate: ts.toISOString ? ts.toISOString() : String(ts),
          movementId: (mrow[mi2.MovementID] || '').toString().trim()
        });
        if (fromZone && !SKIP_ZONES[fromZone]) {
          var outKey = fromZone + '|||' + sku2;
          if (!zoneSkuMov[outKey]) zoneSkuMov[outKey] = { movedIn: 0, movedOut: 0 };
          zoneSkuMov[outKey].movedOut += qty;
        }
        if (toZone && !SKIP_ZONES[toZone]) {
          var inKey = toZone + '|||' + sku2;
          if (!zoneSkuMov[inKey]) zoneSkuMov[inKey] = { movedIn: 0, movedOut: 0 };
          zoneSkuMov[inKey].movedIn += qty;
        }
      }
      movementsInShift.sort(function(a, b) { return new Date(b.movementDate) - new Date(a.movementDate); });
    }
  }

  // ── 4. Merge into cards ──
  var allKeys = {};
  Object.keys(zoneSkuBalance).forEach(function(k) { allKeys[k] = true; });
  Object.keys(zoneSkuMov).forEach(function(k)     { allKeys[k] = true; });

  var cards = [];
  Object.keys(allKeys).forEach(function(key) {
    var parts = key.split('|||');
    var zone  = parts[0] || '';
    var sku   = parts[1] || '';
    if (!zone || !sku) return;
    if (filterZone && zone.toLowerCase() !== filterZone.toLowerCase()) return;
    if (filterSku  && sku.toLowerCase()  !== filterSku.toLowerCase())  return;

    var closing  = zoneSkuBalance[key] || 0;
    var mov      = zoneSkuMov[key]     || { movedIn: 0, movedOut: 0 };
    var opening  = closing - mov.movedIn + mov.movedOut;

    cards.push({
      zone: zone, sku: sku,
      openingBalance: Math.max(0, opening),
      movedIn: mov.movedIn,
      movedOut: mov.movedOut,
      systemClosingBalance: closing,
      confirmed: false, status: 'Open'
    });
  });

  cards.sort(function(a, b) {
    if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
    return a.sku.localeCompare(b.sku);
  });

  // ── 5. Overlay existing confirmations; build zone-level confirmation map with variance details ──
  var confirmedZones = {};
  try {
    var bcSheet = workbook.getSheetByName('BinCards');
    if (bcSheet) {
      var bcData = bcSheet.getDataRange().getValues();
      var bcH    = bcData[0] || [];
      var bci    = buildHeaderIndexMap(bcH);
      var _idx = function(name) { return (bci[name] != null && bci[name] >= 0) ? bci[name] : bcH.indexOf(name); };
      var statusIdx = _idx('Status');
      var shiftDateIdx = _idx('ShiftDate');
      var shiftIdx = _idx('Shift');
      var zoneIdx = _idx('Zone');
      var skuIdx = _idx('SKU');
      var cbIdx = _idx('ConfirmedBy'), caIdx = _idx('ConfirmedAt'), physIdx = _idx('PhysicalCount');
      var sysIdx = _idx('SystemClosingBalance'), obIdx = _idx('OpeningBalance'), miIdx = _idx('MovedIn'), moIdx = _idx('MovedOut'), varIdx = _idx('Variance');
      if (shiftDateIdx < 0 || shiftIdx < 0 || zoneIdx < 0 || skuIdx < 0) { /* skip overlay if cols missing */ } else {
      for (var r = 1; r < bcData.length; r++) {
        var brow = bcData[r];
        if (!brow) continue;
        var status = (statusIdx >= 0 ? (brow[statusIdx] || '') : '').toString().trim().toLowerCase();
        if (status === 'revoked') continue;
        var rowShiftDate = (brow[shiftDateIdx] || '').toString().trim();
        var rowShift = (brow[shiftIdx] || '').toString().trim();
        if (rowShiftDate !== shiftInfo.shiftDateKey) continue;
        if (rowShift.toLowerCase() !== (shiftInfo.shift || '').toLowerCase()) continue;
        var bZone = (brow[zoneIdx] || '').toString().trim();
        var bSku  = (brow[skuIdx]  || '').toString().trim();
        if (bSku === 'ZONE_TOTAL') {
          confirmedZones[bZone] = {
            confirmed: true,
            confirmedBy: (cbIdx >= 0 ? (brow[cbIdx] || '') : '').toString(),
            confirmedAt: (caIdx >= 0 ? (brow[caIdx] || '') : '').toString(),
            totalPhysical: (physIdx >= 0 ? Number(brow[physIdx]) : 0) || 0,
            totalSystem: (sysIdx >= 0 ? Number(brow[sysIdx]) : 0) || 0,
            totalOpening: (obIdx >= 0 ? Number(brow[obIdx]) : 0) || 0,
            totalMovedIn: (miIdx >= 0 ? Number(brow[miIdx]) : 0) || 0,
            totalMovedOut: (moIdx >= 0 ? Number(brow[moIdx]) : 0) || 0,
            zoneVariance: (varIdx >= 0 ? Number(brow[varIdx]) : 0) || 0,
            varianceDetails: []
          };
        }
      }
      for (var r = 1; r < bcData.length; r++) {
        var brow = bcData[r];
        if (!brow) continue;
        if ((brow[shiftDateIdx] || '').toString().trim() !== shiftInfo.shiftDateKey) continue;
        if ((brow[shiftIdx] || '').toString().trim().toLowerCase() !== (shiftInfo.shift || '').toLowerCase()) continue;
        var bZone = (brow[zoneIdx] || '').toString().trim();
        var bSku  = (brow[skuIdx]  || '').toString().trim();
        if (bSku === 'ZONE_TOTAL') continue;
        if (confirmedZones[bZone] && confirmedZones[bZone].varianceDetails) {
          var phys = (physIdx >= 0 ? Number(brow[physIdx]) : 0) || 0;
          var sys  = (sysIdx >= 0 ? Number(brow[sysIdx]) : 0) || 0;
          var v    = (varIdx >= 0 ? Number(brow[varIdx]) : null);
          if (isNaN(v)) v = phys - sys;
          var open = (obIdx >= 0 ? Number(brow[obIdx]) : 0) || 0;
          var min  = (miIdx >= 0 ? Number(brow[miIdx]) : 0) || 0;
          var mout = (moIdx >= 0 ? Number(brow[moIdx]) : 0) || 0;
          confirmedZones[bZone].varianceDetails.push({
            sku: bSku, physicalCount: phys, systemClosing: sys, variance: v,
            openingBalance: open, movedIn: min, movedOut: mout
          });
        }
      }
      }
    }
  } catch (e2) { /* non-critical */ }

  // Derive the unique zones present in cards
  var zoneSet = {};
  cards.forEach(function(c) { zoneSet[c.zone] = true; });
  var totalZones = Object.keys(zoneSet).length;
  var confirmedZoneCount = Object.keys(confirmedZones).filter(function(z) {
    return confirmedZones[z] && confirmedZones[z].confirmed;
  }).length;

  var snapshotAt = isPastShift ? shiftInfo.shiftEnd : new Date();
  return createResponse({
    success: true,
    shiftInfo: {
      shift: shiftInfo.shift,
      shiftDateKey: shiftInfo.shiftDateKey,
      label: shiftInfo.label,
      shiftStart: shiftInfo.shiftStart.toISOString(),
      shiftEnd:   shiftInfo.shiftEnd.toISOString()
    },
    snapshotAt: snapshotAt.toISOString(),
    cards: cards,
    confirmedZones: confirmedZones,
    totalCards: totalZones,
    confirmedCount: confirmedZoneCount,
    palletConsistency: palletConsistency,
    movementsInShift: movementsInShift
  });
}

/**
 * Save a bin-card confirmation. Creates the BinCards sheet on first use.
 */
function confirmBinCard(params) {
  params = params || {};
  var zone       = (params.zone       || '').toString().trim();
  var sku        = (params.sku        || '').toString().trim();
  var shift      = (params.shift      || '').toString().trim();
  var shiftDate  = (params.shiftDate  || '').toString().trim();
  var confirmedBy = (params.confirmedBy || '').toString().trim();
  var physicalCount        = Number(params.physicalCount);
  var systemClosingBalance = Number(params.systemClosingBalance);
  var openingBalance       = Number(params.openingBalance)  || 0;
  var movedIn              = Number(params.movedIn)         || 0;
  var movedOut             = Number(params.movedOut)        || 0;

  if (!zone || !sku || !shift || !shiftDate || isNaN(physicalCount) || !confirmedBy) {
    return createResponse({ success: false, error: 'Missing required fields.' });
  }

  var variance    = physicalCount - systemClosingBalance;
  var confirmedAt = new Date().toISOString();
  var binCardId   = 'BC-' + shiftDate.replace(/-/g, '') + '-' + shift.charAt(0).toUpperCase()
                  + '-' + zone.replace(/\s+/g, '').toUpperCase().substring(0, 6)
                  + '-' + sku.replace(/\s+/g, '').toUpperCase().substring(0, 8);

  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var bcSheet  = ensureSheetWithHeaders(workbook, 'BinCards', STOCK_MOVEMENT_SHEETS.BinCards);

  // Update if row already exists for this shift / zone / sku
  var existing = bcSheet.getDataRange().getValues();
  var bcHdrs   = existing[0] || [];
  var bci      = buildHeaderIndexMap(bcHdrs);
  for (var i = 1; i < existing.length; i++) {
    var row = existing[i];
    if (!row) continue;
    if ((row[bci.Zone]      || '').toString().trim() === zone      &&
        (row[bci.SKU]       || '').toString().trim() === sku       &&
        (row[bci.ShiftDate] || '').toString().trim() === shiftDate &&
        (row[bci.Shift]     || '').toString().trim() === shift) {
      var rn = i + 1;
      bcSheet.getRange(rn, bci.PhysicalCount + 1).setValue(physicalCount);
      bcSheet.getRange(rn, bci.Variance      + 1).setValue(variance);
      bcSheet.getRange(rn, bci.ConfirmedBy   + 1).setValue(confirmedBy);
      bcSheet.getRange(rn, bci.ConfirmedAt   + 1).setValue(confirmedAt);
      bcSheet.getRange(rn, bci.Status        + 1).setValue('Confirmed');
      logUserActivity('UPDATE_BIN_CARD: ' + zone + '/' + sku + '/' + shift + '/' + shiftDate,
                      'By: ' + confirmedBy + ', Physical: ' + physicalCount + ', Variance: ' + variance);
      return createResponse({ success: true, binCardId: (row[bci.BinCardID] || binCardId).toString(),
                              variance: variance, message: 'Bin card confirmed.' });
    }
  }

  // Append new confirmation row
  var newRow = STOCK_MOVEMENT_SHEETS.BinCards.map(function(col) {
    switch (col) {
      case 'BinCardID':             return binCardId;
      case 'Zone':                  return zone;
      case 'SKU':                   return sku;
      case 'ShiftDate':             return shiftDate;
      case 'Shift':                 return shift;
      case 'OpeningBalance':        return openingBalance;
      case 'MovedIn':               return movedIn;
      case 'MovedOut':              return movedOut;
      case 'SystemClosingBalance':  return systemClosingBalance;
      case 'PhysicalCount':         return physicalCount;
      case 'Variance':              return variance;
      case 'ConfirmedBy':           return confirmedBy;
      case 'ConfirmedAt':           return confirmedAt;
      case 'Status':                return 'Confirmed';
      default:                      return '';
    }
  });
  bcSheet.appendRow(newRow);
  logUserActivity('CONFIRM_BIN_CARD: ' + zone + '/' + sku + '/' + shift + '/' + shiftDate,
                  'By: ' + confirmedBy + ', Physical: ' + physicalCount + ', Variance: ' + variance);

  return createResponse({ success: true, binCardId: binCardId, variance: variance,
                          message: 'Bin card confirmed and saved.' });
}

/**
 * Save a zone-level bin-card confirmation (one record per zone, SKU = 'ZONE_TOTAL').
 * Variance is calculated and stored server-side only — never returned to the client.
 */
function confirmZoneBinCard(params) {
  params = params || {};
  var zone       = (params.zone       || '').toString().trim();
  var shift      = (params.shift      || '').toString().trim();
  var shiftDate  = (params.shiftDate  || '').toString().trim();
  var confirmedBy = (params.confirmedBy || '').toString().trim();
  var physicalCount        = Number(params.physicalCount);
  var systemClosingBalance = Number(params.systemClosingBalance) || 0;
  var openingBalance       = Number(params.openingBalance)  || 0;
  var movedIn              = Number(params.movedIn)         || 0;
  var movedOut             = Number(params.movedOut)        || 0;

  if (!zone || !shift || !shiftDate || isNaN(physicalCount) || !confirmedBy) {
    return createResponse({ success: false, error: 'Missing required fields.' });
  }

  var variance    = physicalCount - systemClosingBalance; // stored server-side only
  var confirmedAt = new Date().toISOString();
  var binCardId   = 'BC-' + shiftDate.replace(/-/g, '') + '-' + shift.charAt(0).toUpperCase()
                  + '-' + zone.replace(/\s+/g, '').toUpperCase().substring(0, 8) + '-ZONE';

  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var bcSheet  = ensureSheetWithHeaders(workbook, 'BinCards', STOCK_MOVEMENT_SHEETS.BinCards);

  // Update existing zone record if present
  var existing = bcSheet.getDataRange().getValues();
  var bcHdrs   = existing[0] || [];
  var bci      = buildHeaderIndexMap(bcHdrs);
  for (var i = 1; i < existing.length; i++) {
    var row = existing[i];
    if (!row) continue;
    if ((row[bci.Zone]      || '').toString().trim() === zone          &&
        (row[bci.SKU]       || '').toString().trim() === 'ZONE_TOTAL'  &&
        (row[bci.ShiftDate] || '').toString().trim() === shiftDate     &&
        (row[bci.Shift]     || '').toString().trim() === shift) {
      var rn = i + 1;
      bcSheet.getRange(rn, bci.PhysicalCount + 1).setValue(physicalCount);
      bcSheet.getRange(rn, bci.Variance      + 1).setValue(variance);
      bcSheet.getRange(rn, bci.ConfirmedBy   + 1).setValue(confirmedBy);
      bcSheet.getRange(rn, bci.ConfirmedAt   + 1).setValue(confirmedAt);
      bcSheet.getRange(rn, bci.Status        + 1).setValue('Confirmed');
      logUserActivity('UPDATE_ZONE_BIN_CARD: ' + zone + '/' + shift + '/' + shiftDate,
                      'By: ' + confirmedBy + ', Physical: ' + physicalCount + ', Variance: ' + variance);
      return createResponse({ success: true, binCardId: (row[bci.BinCardID] || binCardId).toString(),
                              message: 'Zone bin card updated.' });
    }
  }

  // Append new zone-level row
  var newRow = STOCK_MOVEMENT_SHEETS.BinCards.map(function(col) {
    switch (col) {
      case 'BinCardID':             return binCardId;
      case 'Zone':                  return zone;
      case 'SKU':                   return 'ZONE_TOTAL';
      case 'ShiftDate':             return shiftDate;
      case 'Shift':                 return shift;
      case 'OpeningBalance':        return openingBalance;
      case 'MovedIn':               return movedIn;
      case 'MovedOut':              return movedOut;
      case 'SystemClosingBalance':  return systemClosingBalance;
      case 'PhysicalCount':         return physicalCount;
      case 'Variance':              return variance;
      case 'ConfirmedBy':           return confirmedBy;
      case 'ConfirmedAt':           return confirmedAt;
      case 'Status':                return 'Confirmed';
      default:                      return '';
    }
  });
  bcSheet.appendRow(newRow);
  logUserActivity('CONFIRM_ZONE_BIN_CARD: ' + zone + '/' + shift + '/' + shiftDate,
                  'By: ' + confirmedBy + ', Physical: ' + physicalCount + ', Variance: ' + variance);

  return createResponse({ success: true, binCardId: binCardId,
                          message: 'Zone bin card confirmed and saved.' });
}

/**
 * Save per-SKU physical counts for a zone, then add ZONE_TOTAL for zone-level confirmation.
 * physicalCounts: array of { sku, physicalCount, openingBalance, movedIn, movedOut, systemClosingBalance }
 */
function confirmZoneBinCardPerSku(params) {
  params = params || {};
  var zone         = (params.zone         || '').toString().trim();
  var shift        = (params.shift        || '').toString().trim();
  var shiftDate    = (params.shiftDate    || '').toString().trim();
  var confirmedBy  = (params.confirmedBy  || '').toString().trim();
  var physicalCounts = params.physicalCounts || [];

  if (!zone || !shift || !shiftDate || !confirmedBy || !Array.isArray(physicalCounts) || physicalCounts.length === 0) {
    return createResponse({ success: false, error: 'Missing required fields or empty physicalCounts.' });
  }

  var totalPhysical = 0;
  var totalOpening = 0;
  var totalMovedIn = 0;
  var totalMovedOut = 0;
  var totalSystem = 0;
  var confirmedAt = new Date().toISOString();

  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var bcSheet  = ensureSheetWithHeaders(workbook, 'BinCards', STOCK_MOVEMENT_SHEETS.BinCards);

  for (var p = 0; p < physicalCounts.length; p++) {
    var item = physicalCounts[p];
    if (!item || !item.sku) continue;
    var sku   = (item.sku || '').toString().trim();
    var phys  = Number(item.physicalCount);
    if (isNaN(phys)) continue;
    var sys   = Number(item.systemClosingBalance) || 0;
    var open  = Number(item.openingBalance)  || 0;
    var inQ   = Number(item.movedIn)         || 0;
    var outQ  = Number(item.movedOut)        || 0;
    totalPhysical += phys;
    totalOpening  += open;
    totalMovedIn  += inQ;
    totalMovedOut += outQ;
    totalSystem   += sys;

    var variance = phys - sys;
    var binCardId = 'BC-' + shiftDate.replace(/-/g, '') + '-' + shift.charAt(0).toUpperCase()
                  + '-' + zone.replace(/\s+/g, '').toUpperCase().substring(0, 6)
                  + '-' + sku.replace(/\s+/g, '').toUpperCase().substring(0, 8);

    var existing = bcSheet.getDataRange().getValues();
    var bcHdrs   = existing[0] || [];
    var bci      = buildHeaderIndexMap(bcHdrs);
    var found = false;
    for (var i = 1; i < existing.length; i++) {
      var row = existing[i];
      if (!row) continue;
      if ((row[bci.Zone]      || '').toString().trim() === zone      &&
          (row[bci.SKU]      || '').toString().trim() === sku       &&
          (row[bci.ShiftDate]|| '').toString().trim() === shiftDate &&
          (row[bci.Shift]    || '').toString().trim() === shift) {
        var rn = i + 1;
        bcSheet.getRange(rn, bci.PhysicalCount + 1).setValue(phys);
        bcSheet.getRange(rn, bci.Variance      + 1).setValue(variance);
        bcSheet.getRange(rn, bci.ConfirmedBy  + 1).setValue(confirmedBy);
        bcSheet.getRange(rn, bci.ConfirmedAt  + 1).setValue(confirmedAt);
        bcSheet.getRange(rn, bci.Status       + 1).setValue('Confirmed');
        found = true;
        break;
      }
    }
    if (!found) {
      var newRow = STOCK_MOVEMENT_SHEETS.BinCards.map(function(col) {
        switch (col) {
          case 'BinCardID':             return binCardId;
          case 'Zone':                  return zone;
          case 'SKU':                   return sku;
          case 'ShiftDate':             return shiftDate;
          case 'Shift':                 return shift;
          case 'OpeningBalance':        return open;
          case 'MovedIn':               return inQ;
          case 'MovedOut':              return outQ;
          case 'SystemClosingBalance':  return sys;
          case 'PhysicalCount':         return phys;
          case 'Variance':              return variance;
          case 'ConfirmedBy':           return confirmedBy;
          case 'ConfirmedAt':           return confirmedAt;
          case 'Status':                return 'Confirmed';
          default:                      return '';
        }
      });
      bcSheet.appendRow(newRow);
    }
  }

  var zoneBinCardId = 'BC-' + shiftDate.replace(/-/g, '') + '-' + shift.charAt(0).toUpperCase()
                    + '-' + zone.replace(/\s+/g, '').toUpperCase().substring(0, 8) + '-ZONE';
  var zoneVariance = totalPhysical - totalSystem;

  var existing = bcSheet.getDataRange().getValues();
  var bcHdrs   = existing[0] || [];
  var bci      = buildHeaderIndexMap(bcHdrs);
  for (var i = 1; i < existing.length; i++) {
    var row = existing[i];
    if (!row) continue;
    if ((row[bci.Zone]      || '').toString().trim() === zone          &&
        (row[bci.SKU]       || '').toString().trim() === 'ZONE_TOTAL'  &&
        (row[bci.ShiftDate] || '').toString().trim() === shiftDate     &&
        (row[bci.Shift]     || '').toString().trim() === shift) {
      var rn = i + 1;
      bcSheet.getRange(rn, bci.PhysicalCount + 1).setValue(totalPhysical);
      bcSheet.getRange(rn, bci.Variance      + 1).setValue(zoneVariance);
      bcSheet.getRange(rn, bci.ConfirmedBy   + 1).setValue(confirmedBy);
      bcSheet.getRange(rn, bci.ConfirmedAt   + 1).setValue(confirmedAt);
      bcSheet.getRange(rn, bci.Status        + 1).setValue('Confirmed');
      logUserActivity('UPDATE_ZONE_BIN_CARD_PER_SKU: ' + zone + '/' + shift + '/' + shiftDate,
                      'By: ' + confirmedBy + ', Physical: ' + totalPhysical + ', Variance: ' + zoneVariance);
      var varianceDetails = buildVarianceDetails(physicalCounts, totalSystem, totalPhysical);
      return createResponse({ success: true, binCardId: zoneBinCardId, varianceDetails: varianceDetails, message: 'Zone bin card confirmed (per SKU).' });
    }
  }

  var newRow = STOCK_MOVEMENT_SHEETS.BinCards.map(function(col) {
    switch (col) {
      case 'BinCardID':             return zoneBinCardId;
      case 'Zone':                  return zone;
      case 'SKU':                   return 'ZONE_TOTAL';
      case 'ShiftDate':             return shiftDate;
      case 'Shift':                 return shift;
      case 'OpeningBalance':        return totalOpening;
      case 'MovedIn':               return totalMovedIn;
      case 'MovedOut':              return totalMovedOut;
      case 'SystemClosingBalance':  return totalSystem;
      case 'PhysicalCount':         return totalPhysical;
      case 'Variance':              return zoneVariance;
      case 'ConfirmedBy':           return confirmedBy;
      case 'ConfirmedAt':           return confirmedAt;
      case 'Status':                return 'Confirmed';
      default:                      return '';
    }
  });
  bcSheet.appendRow(newRow);
  logUserActivity('CONFIRM_ZONE_BIN_CARD_PER_SKU: ' + zone + '/' + shift + '/' + shiftDate,
                  'By: ' + confirmedBy + ', Physical: ' + totalPhysical + ', Variance: ' + zoneVariance);

  var varianceDetails = buildVarianceDetails(physicalCounts, totalSystem, totalPhysical);
  return createResponse({ success: true, binCardId: zoneBinCardId, varianceDetails: varianceDetails, message: 'Zone bin card confirmed (per SKU).' });
}

function buildVarianceDetails(physicalCounts, totalSystem, totalPhysical) {
  var details = [];
  for (var i = 0; i < physicalCounts.length; i++) {
    var it = physicalCounts[i];
    var sys = Number(it.systemClosingBalance) || 0;
    var phys = Number(it.physicalCount) || 0;
    var v = phys - sys;
    details.push({ sku: it.sku, systemClosing: sys, physicalCount: phys, variance: v });
  }
  details.push({ sku: 'ZONE_TOTAL', systemClosing: totalSystem, physicalCount: totalPhysical, variance: totalPhysical - totalSystem });
  return details;
}

function getBinCardVarianceReport(params) {
  params = params || {};
  var dateFrom = (params.dateFrom || '').toString().trim();
  var dateTo   = (params.dateTo   || '').toString().trim();
  var shift    = (params.shift    || '').toString().trim().toLowerCase();
  var zone     = (params.zone     || '').toString().trim().toLowerCase();

  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var bcSheet  = workbook.getSheetByName('BinCards');
  if (!bcSheet) return createResponse({ success: true, rows: [] });

  var data = bcSheet.getDataRange().getValues();
  var hdr  = data[0] || [];
  var bci  = buildHeaderIndexMap(hdr);
  var _col = function(name) { var i = (bci[name] != null && bci[name] >= 0) ? bci[name] : hdr.indexOf(name); return i >= 0 ? i : -1; };
  var cStatus = _col('Status'), cShiftDate = _col('ShiftDate'), cShift = _col('Shift'), cZone = _col('Zone'), cSku = _col('SKU');
  var cOb = _col('OpeningBalance'), cMi = _col('MovedIn'), cMo = _col('MovedOut'), cSys = _col('SystemClosingBalance');
  var cPhys = _col('PhysicalCount'), cVar = _col('Variance'), cCb = _col('ConfirmedBy'), cCa = _col('ConfirmedAt');
  if (cShiftDate < 0 || cShift < 0 || cZone < 0 || cSku < 0) return createResponse({ success: true, rows: [] });
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!row) continue;
    var status = (cStatus >= 0 ? (row[cStatus] || '') : '').toString().trim().toLowerCase();
    if (status === 'revoked') continue;
    var shiftDate = (row[cShiftDate] || '').toString().trim();
    var sShift    = (row[cShift] || '').toString().trim().toLowerCase();
    var bZone     = (row[cZone] || '').toString().trim().toLowerCase();
    if (dateFrom && shiftDate < dateFrom) continue;
    if (dateTo   && shiftDate > dateTo)   continue;
    if (shift    && sShift !== shift)    continue;
    if (zone     && bZone.indexOf(zone) < 0) continue;
    rows.push({
      zone: (row[cZone] || '').toString(),
      sku: (row[cSku] || '').toString(),
      shiftDate: shiftDate,
      shift: (row[cShift] || '').toString(),
      openingBalance: (cOb >= 0 ? Number(row[cOb]) : 0) || 0,
      movedIn: (cMi >= 0 ? Number(row[cMi]) : 0) || 0,
      movedOut: (cMo >= 0 ? Number(row[cMo]) : 0) || 0,
      systemClosing: (cSys >= 0 ? Number(row[cSys]) : 0) || 0,
      physicalCount: (cPhys >= 0 ? Number(row[cPhys]) : 0) || 0,
      variance: (cVar >= 0 ? Number(row[cVar]) : 0) || 0,
      confirmedBy: (cCb >= 0 ? (row[cCb] || '') : '').toString(),
      confirmedAt: (cCa >= 0 ? (row[cCa] || '') : '').toString()
    });
  }
  return createResponse({ success: true, rows: rows });
}

function getConfirmedBinCardsForAdmin(params) {
  params = params || {};
  var dateFrom = (params.dateFrom || '').toString().trim();
  var dateTo   = (params.dateTo   || '').toString().trim();
  var shift    = (params.shift    || '').toString().trim().toLowerCase();
  var zone     = (params.zone     || '').toString().trim().toLowerCase();

  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var bcSheet  = workbook.getSheetByName('BinCards');
  if (!bcSheet) return createResponse({ success: true, zones: [] });

  var data = bcSheet.getDataRange().getValues();
  var hdr  = data[0] || [];
  var bci  = buildHeaderIndexMap(hdr);
  var seen = {};
  var zones = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!row) continue;
    var status = (row[bci.Status] || '').toString().trim();
    if (status === 'Revoked') continue;
    var bSku = (row[bci.SKU] || '').toString().trim();
    if (bSku !== 'ZONE_TOTAL') continue;
    var shiftDate = (row[bci.ShiftDate] || '').toString().trim();
    var sShift    = (row[bci.Shift]     || '').toString().trim().toLowerCase();
    var bZone     = (row[bci.Zone]      || '').toString().trim();
    var key = bZone + '|' + shiftDate + '|' + sShift;
    if (seen[key]) continue;
    if (dateFrom && shiftDate < dateFrom) continue;
    if (dateTo   && shiftDate > dateTo)   continue;
    if (shift    && sShift !== shift)    continue;
    if (zone     && bZone.toLowerCase().indexOf(zone) < 0) continue;
    seen[key] = true;
    zones.push({ zone: bZone, shiftDate: shiftDate, shift: row[bci.Shift], confirmedBy: (row[bci.ConfirmedBy] || '').toString(), confirmedAt: (row[bci.ConfirmedAt] || '').toString() });
  }
  return createResponse({ success: true, zones: zones });
}

function revokeZoneBinCard(params) {
  params = params || {};
  var zone      = (params.zone      || '').toString().trim();
  var shift     = (params.shift     || '').toString().trim();
  var shiftDate = (params.shiftDate || '').toString().trim();
  var revokedBy = (params.revokedBy || '').toString().trim();

  if (!zone || !shift || !shiftDate || !revokedBy) {
    return createResponse({ success: false, error: 'Missing required fields.' });
  }

  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var bcSheet  = workbook.getSheetByName('BinCards');
  if (!bcSheet) return createResponse({ success: false, error: 'BinCards sheet not found.' });

  var data = bcSheet.getDataRange().getValues();
  var hdr  = data[0] || [];
  var bci  = buildHeaderIndexMap(hdr);
  var revokedAt = new Date().toISOString();
  var revokedCount = 0;
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!row) continue;
    if ((row[bci.Zone]      || '').toString().trim() !== zone)  continue;
    if ((row[bci.Shift]     || '').toString().trim() !== shift) continue;
    if ((row[bci.ShiftDate] || '').toString().trim() !== shiftDate) continue;
    var rn = r + 1;
    bcSheet.getRange(rn, bci.Status + 1).setValue('Revoked');
    if (bci.RevokedBy >= 0) bcSheet.getRange(rn, bci.RevokedBy + 1).setValue(revokedBy);
    if (bci.RevokedAt >= 0) bcSheet.getRange(rn, bci.RevokedAt + 1).setValue(revokedAt);
    revokedCount++;
  }
  if (revokedCount === 0) return createResponse({ success: false, error: 'No matching bin cards found.' });
  logUserActivity('REVOKE_ZONE_BIN_CARD: ' + zone + '/' + shift + '/' + shiftDate, 'By: ' + revokedBy);
  return createResponse({ success: true, message: 'Bin card revoked. Zone can be re-confirmed.', revokedCount: revokedCount });
}

/**
 * One-time backfill: update ZoneMovements rows where Quantity is 0 or blank.
 * Uses pallet's current RemainingQuantity (or Quantity) from Pallets.
 * Run once from Apps Script Editor: select backfillZoneMovementsQuantity, click Run.
 */
function backfillZoneMovementsQuantity() {
  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var movSheet = workbook.getSheetByName('ZoneMovements') || workbook.getSheetByName('Zone Movements');
  if (!movSheet) {
    Logger.log('ZoneMovements sheet not found.');
    return { updated: 0, skipped: 0, notFound: 0, errors: [] };
  }
  var palletsSheet = workbook.getSheetByName('Pallets');
  if (!palletsSheet) {
    Logger.log('Pallets sheet not found.');
    return { updated: 0, skipped: 0, notFound: 0, errors: [] };
  }
  var movData = movSheet.getDataRange().getValues();
  var movHdr = movData[0] || [];
  var mi = buildHeaderIndexMap(movHdr);
  var palletData = palletsSheet.getDataRange().getValues();
  var palletHdr = palletData[0] || [];
  var pi = buildHeaderIndexMap(palletHdr);
  var remCol = palletHdr.indexOf('RemainingQuantity');
  var qtyCol = palletHdr.indexOf('Quantity');
  var palletIdCol = palletHdr.indexOf('PalletID');
  if (mi.Quantity < 0 || mi.PalletID < 0) {
    Logger.log('ZoneMovements missing Quantity or PalletID column.');
    return { updated: 0, skipped: 0, notFound: 0, errors: ['Missing columns'] };
  }
  var palletMap = {};
  for (var p = 1; p < palletData.length; p++) {
    var prow = palletData[p];
    var pid = (prow[palletIdCol] || '').toString().trim().toUpperCase();
    if (!pid) continue;
    var rem = remCol >= 0 ? Number(prow[remCol]) : 0;
    var qty = qtyCol >= 0 ? Number(prow[qtyCol]) : 0;
    palletMap[pid] = rem > 0 ? rem : (qty || 0);
  }
  var updated = 0, skipped = 0, notFound = 0;
  var qtyColIdx = mi.Quantity;
  for (var r = 1; r < movData.length; r++) {
    var mrow = movData[r];
    if (!mrow) continue;
    var qtyVal = mrow[qtyColIdx];
    var qtyNum = Number(qtyVal);
    if (qtyNum > 0) {
      skipped++;
      continue;
    }
    var pid = (mrow[mi.PalletID] || '').toString().trim().toUpperCase();
    if (!pid) {
      skipped++;
      continue;
    }
    var palletQty = palletMap[pid];
    if (!palletQty || palletQty <= 0) {
      notFound++;
      continue;
    }
    movSheet.getRange(r + 1, qtyColIdx + 1).setValue(palletQty);
    updated++;
  }
  Logger.log('Backfill done: updated=' + updated + ', skipped=' + skipped + ', palletNotFound=' + notFound);
  return { updated: updated, skipped: skipped, notFound: notFound };
}

/**
 * One-time backfill: recalculate BinCards OpeningBalance, MovedIn, MovedOut, SystemClosingBalance
 * from ZoneMovements (after ZoneMovements Quantity has been backfilled).
 * Run AFTER backfillZoneMovementsQuantity. Select backfillBinCardsFromZoneMovements, click Run.
 */
function backfillBinCardsFromZoneMovements() {
  var workbook = SpreadsheetApp.openById(SHEET_ID);
  var bcSheet = workbook.getSheetByName('BinCards');
  if (!bcSheet) {
    Logger.log('BinCards sheet not found.');
    return { updated: 0, errors: [] };
  }
  var movSheet = workbook.getSheetByName('ZoneMovements') || workbook.getSheetByName('Zone Movements');
  if (!movSheet) {
    Logger.log('ZoneMovements sheet not found.');
    return { updated: 0, errors: [] };
  }
  var palletsSheet = workbook.getSheetByName('Pallets');
  if (!palletsSheet) {
    Logger.log('Pallets sheet not found.');
    return { updated: 0, errors: [] };
  }
  var bcData = bcSheet.getDataRange().getValues();
  var bcHdr = bcData[0] || [];
  var bci = buildHeaderIndexMap(bcHdr);
  if (bci.OpeningBalance == null || bci.MovedIn == null || bci.MovedOut == null || bci.SystemClosingBalance == null) {
    Logger.log('BinCards missing required columns: OpeningBalance, MovedIn, MovedOut, SystemClosingBalance');
    return { updated: 0, errors: ['Missing columns'] };
  }
  var SKIP_ZONES = { 'Outbounding': true, 'Outbonded': true, 'Outbounded': true };
  var palletData = palletsSheet.getDataRange().getValues();
  var palletHdr = palletData[0] || [];
  var pi = buildHeaderIndexMap(palletHdr);
  var palletMap = {};
  for (var p = 1; p < palletData.length; p++) {
    var prow = palletData[p];
    var pid = (prow[pi.PalletID] || '').toString().trim().toUpperCase();
    if (!pid) continue;
    palletMap[pid] = {
      sku: (prow[pi.SKU] || 'Unknown').toString().trim(),
      remainingQty: Number(prow[pi.RemainingQuantity]) || Number(prow[pi.Quantity]) || 0
    };
  }
  var shiftsSeen = {};
  var updated = 0;
  for (var r = 1; r < bcData.length; r++) {
    var row = bcData[r];
    if (!row) continue;
    var status = (row[bci.Status] || '').toString().trim();
    if (status === 'Revoked') continue;
    var shiftDate = (row[bci.ShiftDate] || '').toString().trim();
    var shift = (row[bci.Shift] || '').toString().trim();
    var zone = (row[bci.Zone] || '').toString().trim();
    if (!shiftDate || !shift || !zone) continue;
    var shiftKey = shiftDate + '|' + shift;
    var zoneTotals;
    if (!shiftsSeen[shiftKey]) {
      var shiftInfo = getBinCardShiftInfoForParams(shiftDate, shift);
      if (!shiftInfo) continue;
      var zoneSkuBalance = {};
      var zoneSkuMov = {};
      var movHeaders = movSheet.getRange(1, 1, 1, 30).getValues()[0] || [];
      var mi = buildHeaderIndexMap(movHeaders);
      var numRows = movSheet.getLastRow();
      var CHUNK = 4000;
      var allMovements = [];
      for (var startRow = 2; startRow <= numRows; startRow += CHUNK) {
        var endRow = Math.min(startRow + CHUNK - 1, numRows);
        var chunkData = movSheet.getRange(startRow, 1, endRow, movHeaders.length || 25).getValues();
        for (var ci = 0; ci < chunkData.length; ci++) {
          var mrow = chunkData[ci];
          if (!mrow || !mrow[mi.MovementID]) continue;
          var tsRaw = mi.CreatedAt >= 0 ? mrow[mi.CreatedAt] : null;
          if (!tsRaw && mi.MovementDate >= 0 && mi.MovementTime >= 0) {
            var md = mrow[mi.MovementDate], mt = mrow[mi.MovementTime];
            if (md && mt) tsRaw = new Date((md + '').trim() + 'T' + (mt + '').trim());
            else if (md) tsRaw = md instanceof Date ? md : new Date(md);
          }
          if (!tsRaw) continue;
          var ts = tsRaw instanceof Date ? tsRaw : new Date(tsRaw);
          if (isNaN(ts.getTime()) || ts > shiftInfo.shiftEnd) continue;
          var movStatus = (mrow[mi.MovementStatus] || '').toString().trim().toLowerCase();
          if (movStatus === 'cancelled' || movStatus === 'auto-reverted') continue;
          var pid2 = (mrow[mi.PalletID] || '').toString().trim().toUpperCase();
          var sku2 = palletMap[pid2] ? palletMap[pid2].sku : 'Unknown';
          var fromZone = (mrow[mi.FromZone] || '').toString().trim();
          var toZone = (mrow[mi.ToZone] || '').toString().trim();
          var qty = Number(mrow[mi.Quantity]) || 0;
          allMovements.push({ ts: ts, fromZone: fromZone, toZone: toZone, sku2: sku2, qty: qty });
        }
      }
      allMovements.sort(function(a, b) { return a.ts - b.ts; });
      for (var m = 0; m < allMovements.length; m++) {
        var am = allMovements[m];
        if (am.fromZone && !SKIP_ZONES[am.fromZone]) {
          var outKey = am.fromZone + '|||' + am.sku2;
          zoneSkuBalance[outKey] = (zoneSkuBalance[outKey] || 0) - am.qty;
        }
        if (am.toZone && !SKIP_ZONES[am.toZone]) {
          var inKey = am.toZone + '|||' + am.sku2;
          zoneSkuBalance[inKey] = (zoneSkuBalance[inKey] || 0) + am.qty;
        }
      }
      for (var m2 = 0; m2 < allMovements.length; m2++) {
        var am2 = allMovements[m2];
        if (am2.ts < shiftInfo.shiftStart || am2.ts >= shiftInfo.shiftEnd) continue;
        if (am2.fromZone && !SKIP_ZONES[am2.fromZone]) {
          var ok = am2.fromZone + '|||' + am2.sku2;
          if (!zoneSkuMov[ok]) zoneSkuMov[ok] = { movedIn: 0, movedOut: 0 };
          zoneSkuMov[ok].movedOut += am2.qty;
        }
        if (am2.toZone && !SKIP_ZONES[am2.toZone]) {
          var ik = am2.toZone + '|||' + am2.sku2;
          if (!zoneSkuMov[ik]) zoneSkuMov[ik] = { movedIn: 0, movedOut: 0 };
          zoneSkuMov[ik].movedIn += am2.qty;
        }
      }
      zoneTotals = {};
      var allKeys = {};
      Object.keys(zoneSkuBalance).forEach(function(k) { allKeys[k] = true; });
      Object.keys(zoneSkuMov).forEach(function(k) { allKeys[k] = true; });
      Object.keys(allKeys).forEach(function(key) {
        var parts = key.split('|||');
        var z = parts[0] || '';
        var sku = parts[1] || '';
        if (!z) return;
        if (!zoneTotals[z]) zoneTotals[z] = { opening: 0, movedIn: 0, movedOut: 0, closing: 0 };
        var closing = zoneSkuBalance[key] || 0;
        var mov = zoneSkuMov[key] || { movedIn: 0, movedOut: 0 };
        var opening = closing - mov.movedIn + mov.movedOut;
        zoneTotals[z].closing += closing;
        zoneTotals[z].movedIn += mov.movedIn;
        zoneTotals[z].movedOut += mov.movedOut;
        zoneTotals[z].opening += Math.max(0, opening);
      });
      shiftsSeen[shiftKey] = zoneTotals;
    } else {
      zoneTotals = shiftsSeen[shiftKey];
    }
    var tot = zoneTotals[zone];
    if (!tot) continue;
    var rn = r + 1;
    bcSheet.getRange(rn, bci.OpeningBalance + 1).setValue(tot.opening);
    bcSheet.getRange(rn, bci.MovedIn + 1).setValue(tot.movedIn);
    bcSheet.getRange(rn, bci.MovedOut + 1).setValue(tot.movedOut);
    bcSheet.getRange(rn, bci.SystemClosingBalance + 1).setValue(tot.closing);
    if (bci.Variance >= 0) {
      var phys = Number(row[bci.PhysicalCount]) || 0;
      bcSheet.getRange(rn, bci.Variance + 1).setValue(phys - tot.closing);
    }
    updated++;
  }
  Logger.log('BinCards backfill done: updated=' + updated + ' rows.');
  return { updated: updated };
}

