# 📋 HOW TO SETUP GOOGLE APPS SCRIPT

## Step-by-Step Instructions:

### 1. **Open Google Apps Script**
   - Go to: **https://script.google.com/**
   - Sign in with your Google account (the same one that has access to your Google Sheet)

### 2. **Create New Project**
   - Click **"New Project"** (or the **"+"** button)
   - A new project will open with default code (`function myFunction() {}`)

### 3. **Delete Default Code**
   - Select all the default code (Ctrl+A / Cmd+A)
   - Delete it

### 4. **Copy the Complete Code**
   - Open the file: **`google-apps-script-code.js`** (in the project root)
   - Select ALL the code (Ctrl+A / Cmd+A)
   - Copy it (Ctrl+C / Cmd+C)

### 5. **Paste into Apps Script Editor**
   - Paste the code into the Apps Script editor (Ctrl+V / Cmd+V)
   - **IMPORTANT:** Make sure you paste the ENTIRE file content

### 6. **Update Sheet ID (if needed)**
   - Look for this line near the top:
     ```javascript
     const SHEET_ID = '1QXkL2K5hAfyvHKQ6mCFckmIu73lLw_XyENKSuqyFQgE';
     ```
   - If your Sheet ID is different, update it here
   - To find your Sheet ID: Open your Google Sheet → Look at the URL
     - Example: `https://docs.google.com/spreadsheets/d/1QXkL2K5hAfyvHKQ6mCFckmIu73lLw_XyENKSuqyFQgE/edit`
     - The Sheet ID is the long string between `/d/` and `/edit`

### 7. **Save the Project**
   - Click **"Save"** (Ctrl+S / Cmd+S) or click the 💾 icon
   - Give your project a name (e.g., "Banding Tickets Backend")

### 8. **Deploy as Web App**
   - Click **"Deploy"** → **"New deployment"**
   - Click the ⚙️ gear icon next to "Select type"
   - Choose **"Web app"**
   - Configure:
     - **Description:** "Banding Tickets API" (optional)
     - **Execute as:** **"Me"** (your email)
     - **Who has access:** **"Anyone"** (or "Anyone with Google account" if you want to restrict)
   - Click **"Deploy"**

### 9. **Authorize Permissions**
   - Google will ask for permissions
   - Click **"Review Permissions"**
   - Choose your Google account
   - Click **"Advanced"** → **"Go to [Project Name] (unsafe)"** (if shown)
   - Click **"Allow"** to grant permissions

### 10. **Copy the Web App URL**
   - After deployment, you'll see a **"Web app"** URL
   - It looks like: `https://script.google.com/macros/s/AKfycbx.../exec`
   - **Copy this URL** - you'll need it for your `config.js`

### 11. **Update Your config.js**
   - Copy `config.example.js` to `config.js` (do not commit config.js)
   - Update this line:
     ```javascript
     GOOGLE_APPS_SCRIPT_URL: 'PASTE_YOUR_WEB_APP_URL_HERE',
     ```

### 12. **Test It**
   - Open `bandingtickets.html` in your browser
   - Try generating a ticket or moving a pallet
   - Check the browser console (F12) for any errors

---

## 🔧 Troubleshooting:

### **"No scripts found" in Extensions menu?**
   - This is normal! Apps Script projects are NOT automatically linked to sheets
   - You need to create them separately at script.google.com
   - The script accesses your sheet using the SHEET_ID

### **Permission Errors?**
   - Make sure you're signed in with the correct Google account
   - Make sure that account has edit access to your Google Sheet
   - Re-run the authorization if needed

### **Can't find your Sheet?**
   - Double-check the SHEET_ID in the code matches your sheet
   - Make sure the sheet is shared with your Google account

### **Deployment URL not working?**
   - Make sure "Who has access" is set to "Anyone" (or "Anyone with Google account")
   - Try redeploying: Deploy → Manage deployments → Edit → Redeploy
