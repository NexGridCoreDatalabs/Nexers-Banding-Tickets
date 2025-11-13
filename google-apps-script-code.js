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
  try {
    // Handle both JSON and form-encoded data
    let data;
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (e) {
        // Try parsing as form data
        const params = e.parameter;
        if (params && params.data) {
          data = JSON.parse(params.data);
        } else {
          // Direct form data
          data = {
            action: params.action || 'append',
            serial: params.serial || '',
            values: params.values ? JSON.parse(params.values) : [],
            sku: params.sku || '',
            qty: params.qty || ''
          };
        }
      }
    } else if (e.parameter) {
      // URL-encoded form data
      const params = e.parameter;
      if (params.data) {
        data = JSON.parse(params.data);
      } else {
        data = {
          action: params.action || 'append',
          serial: params.serial || '',
          values: params.values ? JSON.parse(params.values) : [],
          sku: params.sku || '',
          qty: params.qty || ''
        };
      }
    } else {
      return createResponse({ success: false, error: 'No data received' });
    }
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    
    if (data.action === 'append') {
      // Append new row to Tickets sheet
      const ticketsSheet = sheet.getSheetByName('Tickets');
      if (!ticketsSheet) {
        return createResponse({ success: false, error: 'Tickets sheet not found' });
      }
      ticketsSheet.appendRow(data.values);
      
      // Update Calculations sheet if SKU provided
      if (data.sku && data.qty) {
        updateCalculations(data.sku, parseFloat(data.qty) || 0);
      }
      
      return createResponse({ success: true, message: 'Data saved successfully' });
    } else if (data.action === 'update') {
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
          // Update the row
          const rowNum = i + 1;
          ticketsSheet.getRange(rowNum, 1, 1, data.values.length).setValues([data.values]);
          
          // Update Calculations if SKU changed
          if (data.sku && data.qty) {
            updateCalculations(data.sku, parseFloat(data.qty) || 0);
          }
          
          found = true;
          return createResponse({ success: true, message: 'Data updated successfully' });
        }
      }
      
      // If not found, append as new ticket
      if (!found) {
        ticketsSheet.appendRow(data.values);
        
        // Update Calculations sheet if SKU provided
        if (data.sku && data.qty) {
          updateCalculations(data.sku, parseFloat(data.qty) || 0);
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
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    const action = e.parameter.action || 'read';
    
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
    }
    
    return createResponse({ success: false, error: 'Invalid action' });
  } catch (error) {
    return createResponse({ success: false, error: error.toString() });
  }
}

/**
 * Update Calculations sheet
 */
function updateCalculations(sku, qty) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID);
    let calcSheet = sheet.getSheetByName('Calculations');
    
    if (!calcSheet) {
      // Create Calculations sheet if it doesn't exist
      calcSheet = sheet.insertSheet('Calculations');
      calcSheet.getRange(1, 1, 1, 2).setValues([['SKU', 'Total Quantity']]);
    }
    
    const dataRange = calcSheet.getDataRange();
    const values = dataRange.getValues();
    
    // Find existing SKU
    let found = false;
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === sku) {
        // Update existing quantity
        const currentQty = parseFloat(values[i][1]) || 0;
        calcSheet.getRange(i + 1, 2).setValue(currentQty + qty);
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Add new SKU
      calcSheet.appendRow([sku, qty]);
    }
  } catch (error) {
    console.error('Error updating calculations:', error);
  }
}

/**
 * Helper function to create JSON response
 */
function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

