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
    Logger.log('=== doPost FUNCTION CALLED ===');
    
    if (!e) {
      return createResponse({ success: false, error: 'No event payload received' });
    }
    
    Logger.log('e object keys: ' + Object.keys(e));
    Logger.log('e.postData exists: ' + (e.postData ? 'YES' : 'NO'));
    Logger.log('e.parameter exists: ' + (e.parameter ? 'YES' : 'NO'));
    
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    
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
        // Find specific ticket by serial (case-insensitive)
        const serialUpper = serial.toString().toUpperCase();
        for (let i = 1; i < values.length; i++) {
          const rowSerial = (values[i][0] || '').toString().toUpperCase();
          if (rowSerial === serialUpper) {
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
    
    Logger.log(`Found ${ticketsValues.length - 1} tickets in Tickets sheet`);
    
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
        Logger.log(`Skipping ticket ${i}: missing date or SKU (date: ${dateStr}, sku: ${sku})`);
        continue;
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
    
    Logger.log(`Grouped into ${Object.keys(groupedData).length} unique Date+SKU+ProductType combinations`);
    
    // Convert to array and sort by Date, then SKU
    const sortedData = Object.values(groupedData).sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date); // Sort by date first
      }
      return a.sku.localeCompare(b.sku); // Then by SKU
    });
    
    Logger.log(`Sorted ${sortedData.length} groups`);
    
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
      calcSheet.getRange(2, 1, rows.length, 18).setValues(rows);
      Logger.log(`Writing ${rows.length} rows to Calculations sheet`);
    } else {
      Logger.log('No data rows to write - check if tickets exist in Tickets sheet');
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
    
    try {
      buildAnalyticsCenter(sheet, sortedData, ticketsValues);
    } catch (dashboardError) {
      Logger.log('Analytics center build failed: ' + dashboardError.toString());
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
        Logger.log('Migrating old Calculations sheet structure...');
        
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
  buildVariantComparisonSheet(workbook, analyticsData);
  buildShiftSummarySheet(workbook, analyticsData);
  const skuSheetMeta = buildSkuDetailSheets(workbook, analyticsData);
  buildSkuIndexSheet(workbook, analyticsData, skuSheetMeta);
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
  const variantStats = {};
  
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
  
  groupedData.forEach(function(group) {
    const dateObj = parseIsoDate(group.date);
    if (!dateObj) return;
    
    const variantKey = group.productType || 'Other';
    ensureVariantBucket(variantStats, variantKey);
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
      thirty: finalizeVariantBucket(entry.thirty)
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
  summarySheet.getRange('A2:H2').merge().setValue('Powered by NexGridCore DataLabs ⚡').setFontSize(12).setFontColor('#4c51bf').setHorizontalAlignment('center');
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
  
  let startRow = 14;
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
  
  summarySheet.getRange(startRow + analyticsData.issuesSummary.length + 3, 1, 1, 8).merge().setValue('Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
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
  sheet.getRange('A2:J2').merge().setValue('Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
  sheet.getRange('A3:J3').merge().setValue('0.5KG vs 1KG performance across time windows').setFontColor('#718096').setHorizontalAlignment('center');
  
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
  
  let cardStartRow = 5;
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
  
  const skuHeaders = ['Variant', 'SKU', 'Cartons'];
  const skuRows = [];
  (analyticsData.variantSkuMap || []).forEach(function(entry) {
    entry.skus.forEach(function(skuRow) {
      skuRows.push([entry.variant, skuRow.sku, skuRow.cartons]);
    });
  });
  
  if (skuRows.length > 0) {
    const skuStartRow = tableStartRow + rows.length + 4;
    buildTable(sheet, '🔬 Variant SKU Breakdown', skuHeaders, skuRows, skuStartRow, {
      numericColumns: [3]
    });
  }
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
  shiftSheet.getRange('A2:J2').merge().setValue('Powered by NexGridCore DataLabs ⚡').setFontSize(12).setFontColor('#4c51bf').setHorizontalAlignment('center');
  shiftSheet.getRange('A3:J3').merge().setValue('Shifts auto-classified: Day (08:00-18:00) • Night (18:00-08:00)').setFontColor('#718096').setHorizontalAlignment('center');
  
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
  
  const startRow = 4;
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
    skuSheet.getRange('A2:H2').merge().setValue('Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
    
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
  indexSheet.getRange('A2:H2').merge().setValue('Powered by NexGridCore DataLabs ⚡').setFontColor('#4c51bf').setHorizontalAlignment('center');
  
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
    Logger.log('Error building leader name map: ' + err.toString());
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

