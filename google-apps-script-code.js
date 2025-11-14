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
 * Handle GET requests (reading data)
 */
function doGet(e) {
  try {
    Logger.log('=== doGet called ===');
    Logger.log('Parameters: ' + JSON.stringify(e.parameter));
    
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const action = e.parameter.action || 'read';
    
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
      const users = [];
      
      for (let i = 1; i < values.length; i++) {
        if (values[i][0]) {
          users.push({ id: values[i][0], name: values[i][1] || '' });
        }
      }
      
      return createResponse({ success: true, data: users });
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
      calcSheet.getRange(1, 1, 1, 6).setValues([[
        'SKU', 
        'Product Type', 
        'Total Quantity (Cartons)', 
        'Total Pieces', 
        'Last Change', 
        'Last Updated'
      ]]);
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
    
    // Create unique key: SKU + ProductType
    const uniqueKey = sku + '-' + productTypeLabel;
    
    const dataRange = calcSheet.getDataRange();
    const values = dataRange.getValues();
    
    // Find existing entry with matching SKU and ProductType
    let found = false;
    for (let i = 1; i < values.length; i++) {
      const rowSku = values[i][0] || '';
      const rowProductType = values[i][1] || '';
      
      if (rowSku === sku && rowProductType === productTypeLabel) {
        // Found existing entry
        const currentQty = parseFloat(values[i][2]) || 0;
        const currentPieces = parseFloat(values[i][3]) || 0;
        
        let updatedQty, updatedPieces, change;
        
        if (isUpdate) {
          // Calculate difference
          const diff = newQty - oldQty;
          updatedQty = currentQty + diff;
          updatedPieces = currentPieces + (diff * multiplier);
          change = diff;
        } else {
          // New entry: add to existing
          updatedQty = currentQty + newQty;
          updatedPieces = currentPieces + (newQty * multiplier);
          change = newQty;
        }
        
        // Update the row
        const rowNum = i + 1;
        calcSheet.getRange(rowNum, 3).setValue(updatedQty); // Total Quantity
        calcSheet.getRange(rowNum, 4).setValue(updatedPieces); // Total Pieces
        calcSheet.getRange(rowNum, 5).setValue(change >= 0 ? '+' + change : change.toString()); // Last Change
        calcSheet.getRange(rowNum, 6).setValue(new Date().toISOString()); // Last Updated
        
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Add new entry
      const pieces = newQty * multiplier;
      const change = isUpdate ? (newQty - oldQty) : newQty;
      calcSheet.appendRow([
        sku,
        productTypeLabel,
        newQty,
        pieces,
        change >= 0 ? '+' + change : change.toString(),
        new Date().toISOString()
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

