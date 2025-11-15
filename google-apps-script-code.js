/**
 * Google Apps Script Code for Banding Tickets System
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
 * 10. Copy the Web App URL and use it in bandingtickets.html
 */

// Your Google Sheet ID (update this)
const SHEET_ID = '1QXkL2K5hAfyvHKQ6mCFckmIu73lLw_XyENKSuqyFQgE';

/**
 * Handle POST requests (writing data)
 */
function doPost(e) {
  // Always return JSON, even on error
  try {
    // Log immediately to confirm doPost is called
    Logger.log('=== doPost FUNCTION CALLED ===');
    Logger.log('e object keys: ' + Object.keys(e).join(', '));
    Logger.log('e.postData exists: ' + (e.postData ? 'YES' : 'NO'));
    Logger.log('e.parameter exists: ' + (e.parameter ? 'YES' : 'NO'));
    
    // Log user activity
    logUserActivity('POST: Write operation', 'POST request received');
    
    // Handle both JSON and form-encoded data
    let data;
    let rawData = null;
    
    // Log what we received for debugging
    if (e.postData) {
      Logger.log('e.postData type: ' + (e.postData.type || 'undefined'));
      Logger.log('e.postData contents length: ' + (e.postData.contents ? e.postData.contents.length : 0));
      Logger.log('e.postData contents preview: ' + (e.postData.contents ? e.postData.contents.substring(0, 200) : 'null'));
    }
    if (e.parameter) {
      Logger.log('e.parameter keys: ' + Object.keys(e.parameter).join(', '));
      Logger.log('e.parameter values: ' + JSON.stringify(e.parameter).substring(0, 200));
    }
    
    // PRIORITY 1: Try postData.contents (raw POST body - for JSON or form data)
    if (e.postData && e.postData.contents) {
      rawData = e.postData.contents;
      Logger.log('Found postData.contents, length: ' + rawData.length);
      
      // Check content type
      const contentType = e.postData.type || '';
      Logger.log('Content-Type: ' + contentType);
      
      // If it's JSON content type, parse directly
      if (contentType.indexOf('application/json') !== -1) {
        try {
          data = JSON.parse(rawData);
          Logger.log('Parsed as JSON successfully');
        } catch (parseError) {
          return createResponse({ success: false, error: 'Failed to parse JSON: ' + parseError.toString() });
        }
      }
      // If it's form data (starts with "data=")
      else if (rawData.startsWith('data=')) {
        try {
          const encodedData = rawData.substring(5); // Remove "data="
          const decodedData = decodeURIComponent(encodedData);
          Logger.log('Decoded form data: ' + decodedData.substring(0, 200));
          data = JSON.parse(decodedData);
        } catch (parseError) {
          return createResponse({ success: false, error: 'Failed to parse form data: ' + parseError.toString() });
        }
      }
      // Try parsing as raw JSON (might be JSON without proper content-type)
      else {
        try {
          data = JSON.parse(rawData);
          Logger.log('Parsed as raw JSON successfully');
        } catch (parseError) {
          return createResponse({ success: false, error: 'Unknown data format. Content-Type: ' + contentType + ', Data: ' + rawData.substring(0, 100) });
        }
      }
    }
    // Try e.parameter (form data - Apps Script auto-decodes URL params)
    else if (e.parameter && e.parameter.data) {
      rawData = e.parameter.data;
      Logger.log('Parameter data: ' + rawData);
      
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
    Logger.log('Error in doPost: ' + error.toString());
    Logger.log('Error stack: ' + (error.stack || 'No stack trace'));
    return createResponse({ success: false, error: 'doPost error: ' + error.toString() });
  }
}

/**
 * Handle write operations (used by both doPost and doGet)
 */
function handleWriteOperation(data, sheet) {
  try {
    Logger.log('handleWriteOperation called with action: ' + data.action);
    Logger.log('data object: ' + JSON.stringify(data));
    
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
        Logger.log('Created row with serial only: ' + data.values[0]);
      } else {
        // Full row data provided
        ticketsSheet.appendRow(data.values);
        Logger.log('Appended full row');
      }
      
      // Update Calculations sheet if SKU and productType provided
      if (data.sku && data.qty && data.productType) {
        updateCalculations(data.sku, parseFloat(data.qty) || 0, data.productType, 0, false);
      }
      
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
          // Get old quantity from existing row (column E = index 4)
          const oldQty = parseFloat(values[i][4]) || 0;
          const newQty = parseFloat(data.qty) || 0;
          
          // Update the row
          const rowNum = i + 1;
          ticketsSheet.getRange(rowNum, 1, 1, data.values.length).setValues([data.values]);
          
          // Update Calculations if SKU and productType provided
          if (data.sku && data.qty && data.productType) {
            updateCalculations(data.sku, newQty, data.productType, oldQty, true);
          }
          
          found = true;
          return createResponse({ success: true, message: 'Data updated successfully' });
        }
      }
      
      // If not found, append as new ticket
      if (!found) {
        ticketsSheet.appendRow(data.values);
        
        // Update Calculations sheet if SKU and productType provided
        if (data.sku && data.qty && data.productType) {
          updateCalculations(data.sku, parseFloat(data.qty) || 0, data.productType, 0, false);
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
    
    Logger.log('=== USER ACTIVITY ===');
    Logger.log('Action: ' + action);
    Logger.log('Active User Email: ' + userEmail);
    Logger.log('Effective User Email: ' + effectiveUser);
    Logger.log('Timestamp: ' + timestamp);
    Logger.log('Additional Info: ' + (additionalInfo || 'None'));
    Logger.log('====================');
    
    // Also log to a tracking sheet if it exists
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
      Logger.log('Could not log to tracking sheet: ' + trackingError.toString());
    }
  } catch (error) {
    Logger.log('Error logging user activity: ' + error.toString());
  }
}

/**
 * Handle GET requests (reading data)
 */
function doGet(e) {
  try {
    Logger.log('=== doGet called ===');
    Logger.log('Parameters: ' + JSON.stringify(e.parameter));
    
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const action = e.parameter.action || 'read';
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
      const ticketsSheet = sheet.getSheetByName('Tickets');
      
      if (!ticketsSheet) {
        return createResponse({ success: false, error: 'Tickets sheet not found' });
      }
      
      const dataRange = ticketsSheet.getDataRange();
      const values = dataRange.getValues();
      
      if (serial) {
        // Find specific ticket by serial
        for (let i = 1; i < values.length; i++) {
          if (values[i][0] === serial) {
            const headers = values[0];
            const row = values[i];
            const ticket = {};
            headers.forEach((header, index) => {
              ticket[header] = row[index] || '';
            });
            return createResponse({ success: true, data: ticket });
          }
        }
        return createResponse({ success: false, error: 'Ticket not found' });
      } else {
        // Return all tickets
        return createResponse({ success: true, data: values });
      }
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
      
      for (let i = 1; i < values.length; i++) {
        if (values[i][idCol]) {
          users.push({ 
            id: values[i][idCol], 
            name: values[i][nameCol] || '' 
          });
          
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
      return recalculateAllCalculations(sheet);
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
      
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] && values[i][0].toString().trim() === userId) {
          const storedPasscode = (values[i][2] || '').toString().trim();
          if (!storedPasscode) {
            return createResponse({ success: false, error: 'User has no passcode configured' });
          }
          
          if (storedPasscode === passcode) {
            return createResponse({
              success: true,
              data: {
                id: values[i][0],
                name: values[i][1] || ''
              }
            });
          }
          
          return createResponse({ success: false, error: 'Invalid passcode' });
        }
      }
      
      return createResponse({ success: false, error: 'User not found' });
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
function recalculateAllCalculations(sheet) {
  try {
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
    calcSheet.getRange(1, 1, 1, 20).setValues([[
      'Date',
      'SKU', 
      'Product Type', 
      'Total Quantity (Cartons)', 
      'Total Pieces',
      'Total Sachets',
      'Total Tablet Pieces',
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
    
    // Get all tickets
    const ticketsDataRange = ticketsSheet.getDataRange();
    const ticketsValues = ticketsDataRange.getValues();
    
    // Column indices: Serial=0, Date=1, Time=2, SKU=3, Qty=4, Layers=5, BandingType=6, 
    // ProductType=7, PalletSize=8, Notes=9, QualityIssueType=10, QualityIssueDesc=11, 
    // GroupLeader=12, SachetType=13, TabletType=14, MerchHistory=15, etc.
    
    // Group tickets by Date + SKU + ProductType
    const groupedData = {};
    
    for (let i = 1; i < ticketsValues.length; i++) {
      const date = ticketsValues[i][1] || '';
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
      
      if (!date || !sku) continue;
      
      // Create unique key: Date + SKU + ProductType
      const key = date + '|' + sku + '|' + productTypeLabel;
      
      if (!groupedData[key]) {
        groupedData[key] = {
          date: date,
          sku: sku,
          productType: productTypeLabel,
          multiplier: multiplier,
          totalQty: 0,
          totalPieces: 0,
          totalSachets: 0,
          totalTablets: 0,
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
      
      // Calculate sachets and tablets (1 carton = 12 sachets + 12 tablets)
      const sachetType = ticketsValues[i][13] || '';
      const tabletType = ticketsValues[i][14] || '';
      if (sachetType) {
        group.totalSachets += qty * 12;
        group.sachetTypes.add(sachetType);
      }
      if (tabletType) {
        group.totalTablets += qty * 12;
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
      const avgQty = group.numTickets > 0 ? (group.totalQty / group.numTickets).toFixed(2) : 0;
      
      return [
        group.date,
        group.sku,
        group.productType,
        group.totalQty,
        group.totalPieces,
        group.totalSachets,
        group.totalTablets,
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
      calcSheet.getRange(2, 1, rows.length, 20).setValues(rows);
    }
    
    // Apply filters and sorting
    const dataRange = calcSheet.getDataRange();
    calcSheet.setAutoFilter(1, 1, rows.length + 1, 20);
    
    // Sort by Date (column 1), then SKU (column 2)
    const sortRange = calcSheet.getRange(2, 1, rows.length, 20);
    sortRange.sort([{column: 1, ascending: true}, {column: 2, ascending: true}]);
    
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
        'Total Sachets',
        'Total Tablet Pieces',
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
        Logger.log('Migrating old Calculations sheet structure...');
        
        // Save existing data (skip header row)
        const dataRange = calcSheet.getDataRange();
        const allData = dataRange.getValues();
        const oldData = allData.length > 1 ? allData.slice(1) : [];
        
        // Clear and recreate with new headers
        calcSheet.clear();
        calcSheet.getRange(1, 1, 1, 20).setValues([[
          'Date',
          'SKU', 
          'Product Type', 
          'Total Quantity (Cartons)', 
          'Total Pieces',
          'Total Sachets',
          'Total Tablet Pieces',
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
        
        // Note: Old entries will be recalculated from Tickets sheet when tickets are saved/updated
        Logger.log('Migration complete. Old entries will be recalculated from Tickets sheet.');
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
      Logger.log('No valid product type found for SKU: ' + sku);
      return;
    }
    
    // For incremental updates, trigger full recalculation to ensure accuracy
    // This ensures manual edits are reflected and maintains Date + SKU grouping
    Logger.log('Triggering full recalculation for accurate analytics...');
    recalculateAllCalculations(sheet);
  } catch (error) {
    Logger.log('Error updating calculations: ' + error.toString());
  }
}

/**
 * Helper function to create JSON response
 */
function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

