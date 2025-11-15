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
      
      const users = [];
      const allSkus = new Set(); // Collect all unique SKUs
      
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
        }
      }
      
      // Return users with SKUs list
      return createResponse({ 
        success: true, 
        data: users,
        skus: Array.from(allSkus).sort() // Return sorted unique SKUs
      });
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
      // Create Calculations sheet with headers
      calcSheet = sheet.insertSheet('Calculations');
      calcSheet.getRange(1, 1, 1, 14).setValues([[
        'SKU', 
        'Product Type', 
        'Total Quantity (Cartons)', 
        'Total Pieces', 
        'Number of Tickets',
        'Average Quantity per Ticket',
        'First Ticket Date',
        'Last Ticket Date',
        'Total Layers',
        'Quality Issues Count',
        'Group Leaders',
        'Banding Types',
        'Last Change', 
        'Last Updated'
      ]]);
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
        calcSheet.getRange(1, 1, 1, 14).setValues([[
          'SKU', 
          'Product Type', 
          'Total Quantity (Cartons)', 
          'Total Pieces', 
          'Number of Tickets',
          'Average Quantity per Ticket',
          'First Ticket Date',
          'Last Ticket Date',
          'Total Layers',
          'Quality Issues Count',
          'Group Leaders',
          'Banding Types',
          'Last Change', 
          'Last Updated'
        ]]);
        
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
    
    // Query all tickets for this SKU + ProductType combination to calculate all metrics
    const ticketsSheet = sheet.getSheetByName('Tickets');
    if (!ticketsSheet) {
      Logger.log('Tickets sheet not found');
      return;
    }
    
    const ticketsDataRange = ticketsSheet.getDataRange();
    const ticketsValues = ticketsDataRange.getValues();
    
    // Column indices in Tickets sheet (0-based)
    // Serial=0, Date=1, Time=2, SKU=3, Qty=4, Layers=5, BandingType=6, ProductType=7, 
    // PalletSize=8, Notes=9, QualityIssueType=10, QualityIssueDesc=11, GroupLeader=12, etc.
    
    // Filter tickets matching SKU and ProductType
    const matchingTickets = [];
    for (let i = 1; i < ticketsValues.length; i++) { // Skip header row
      const rowSku = (ticketsValues[i][3] || '').toString().trim();
      const rowProductType = (ticketsValues[i][7] || '').toString().toLowerCase();
      
      // Check if SKU matches and ProductType contains the label
      if (rowSku === sku && (rowProductType.includes('1kg') || rowProductType.includes('0.5kg'))) {
        // Verify it matches our specific product type
        const matches1KG = productTypeLabel === '1KG' && (rowProductType.includes('1kg') || rowProductType.includes('1 kg'));
        const matches05KG = productTypeLabel === '0.5KG' && (rowProductType.includes('0.5kg') || rowProductType.includes('0.5 kg') || rowProductType.includes('0,5kg'));
        
        if (matches1KG || matches05KG) {
          matchingTickets.push({
            date: ticketsValues[i][1] || '',
            qty: parseFloat(ticketsValues[i][4]) || 0,
            layers: parseFloat(ticketsValues[i][5]) || 0,
            bandingType: (ticketsValues[i][6] || '').toString().trim(),
            qualityIssueType: (ticketsValues[i][10] || '').toString().trim(),
            groupLeader: (ticketsValues[i][12] || '').toString().trim()
          });
        }
      }
    }
    
    // Calculate all metrics
    const numTickets = matchingTickets.length;
    const totalQty = matchingTickets.reduce((sum, t) => sum + t.qty, 0);
    const avgQty = numTickets > 0 ? (totalQty / numTickets).toFixed(2) : 0;
    const totalLayers = matchingTickets.reduce((sum, t) => sum + t.layers, 0);
    const qualityIssuesCount = matchingTickets.filter(t => t.qualityIssueType !== '').length;
    
    // Get unique group leaders
    const groupLeadersSet = new Set();
    matchingTickets.forEach(t => {
      if (t.groupLeader !== '') {
        groupLeadersSet.add(t.groupLeader);
      }
    });
    const groupLeaders = Array.from(groupLeadersSet).join(', ');
    
    // Get unique banding types
    const bandingTypesSet = new Set();
    matchingTickets.forEach(t => {
      if (t.bandingType !== '') {
        // BandingType might be comma-separated, so split it
        const types = t.bandingType.split(',').map(bt => bt.trim()).filter(bt => bt !== '');
        types.forEach(bt => bandingTypesSet.add(bt));
      }
    });
    const bandingTypes = Array.from(bandingTypesSet).join(', ');
    
    // Get first and last ticket dates
    const dates = matchingTickets.map(t => t.date).filter(d => d !== '');
    let firstDate = '';
    let lastDate = '';
    if (dates.length > 0) {
      // Sort dates (assuming YYYY-MM-DD format)
      dates.sort();
      firstDate = dates[0];
      lastDate = dates[dates.length - 1];
    }
    
    // Calculate total pieces
    const totalPieces = totalQty * multiplier;
    
    // Calculate last change
    const change = isUpdate ? (newQty - oldQty) : newQty;
    const lastChange = change >= 0 ? '+' + change : change.toString();
    
    // Find existing entry or create new
    const dataRange = calcSheet.getDataRange();
    const values = dataRange.getValues();
    
    let found = false;
    for (let i = 1; i < values.length; i++) {
      const rowSku = values[i][0] || '';
      const rowProductType = values[i][1] || '';
      
      if (rowSku === sku && rowProductType === productTypeLabel) {
        // Update existing row
        const rowNum = i + 1;
        calcSheet.getRange(rowNum, 3).setValue(totalQty); // Total Quantity (Cartons)
        calcSheet.getRange(rowNum, 4).setValue(totalPieces); // Total Pieces
        calcSheet.getRange(rowNum, 5).setValue(numTickets); // Number of Tickets
        calcSheet.getRange(rowNum, 6).setValue(avgQty); // Average Quantity per Ticket
        calcSheet.getRange(rowNum, 7).setValue(firstDate); // First Ticket Date
        calcSheet.getRange(rowNum, 8).setValue(lastDate); // Last Ticket Date
        calcSheet.getRange(rowNum, 9).setValue(totalLayers); // Total Layers
        calcSheet.getRange(rowNum, 10).setValue(qualityIssuesCount); // Quality Issues Count
        calcSheet.getRange(rowNum, 11).setValue(groupLeaders); // Group Leaders
        calcSheet.getRange(rowNum, 12).setValue(bandingTypes); // Banding Types
        calcSheet.getRange(rowNum, 13).setValue(lastChange); // Last Change
        calcSheet.getRange(rowNum, 14).setValue(formatTimestamp(new Date().toISOString())); // Last Updated
        
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Add new entry
      calcSheet.appendRow([
        sku,
        productTypeLabel,
        totalQty,
        totalPieces,
        numTickets,
        avgQty,
        firstDate,
        lastDate,
        totalLayers,
        qualityIssuesCount,
        groupLeaders,
        bandingTypes,
        lastChange,
        formatTimestamp(new Date().toISOString())
      ]);
    }
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

