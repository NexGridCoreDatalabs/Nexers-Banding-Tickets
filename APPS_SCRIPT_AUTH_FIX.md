# Apps Script Authentication & Permission Fix

## The Issue
If Apps Script is returning raw form data instead of processing it, it might be an authentication/permission issue, even if deployed as "Web app" with "Anyone" access.

## Step-by-Step Fix

### 1. Verify Deployment Settings

1. Go to: https://script.google.com/
2. Open your project
3. Click **"Deploy"** → **"Manage deployments"**
4. Click the **pencil icon** (edit) next to your deployment
5. Check these settings:
   - **Type:** Must be "Web app" (not "API Executable")
   - **Execute as:** "Me" (your email)
   - **Who has access:** "Anyone" or "Anyone, even anonymous"
6. If "Who has access" is NOT "Anyone", change it:
   - Click the dropdown
   - Select "Anyone" or "Anyone, even anonymous"
   - Click "Deploy"
   - **Important:** Select "New version" when prompted
   - Click "Deploy" again

### 2. Check Sheet Permissions

The Apps Script runs as "Me" (your account), so it needs access to your Google Sheet:

1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1QXkL2K5hAfyvHKQ6mCFckmIu73lLw_XyENKSuqyFQgE/edit
2. Click **"Share"** (top right)
3. Make sure your Google account (the one running the Apps Script) has **"Editor"** access
4. If not, add yourself with Editor access

### 3. Test the Deployment

Test if the Web app is accessible:

1. Copy your Apps Script URL
2. Open it in a new browser tab (or incognito window)
3. You should see JSON like: `{"success":false,"error":"Invalid action"}`
4. If you see an HTML page asking for permission, that's the problem!

### 4. Check Execution Logs

1. In Apps Script, click **"Executions"** (left menu)
2. Look for recent executions
3. If you see executions:
   - Click on one
   - Check if there are errors
   - Look at the logs (click "View logs")
   - You should see "=== doPost called ===" if it's working
4. If you see NO executions, the request isn't reaching Apps Script

### 5. Common Authentication Issues

**Issue:** "Authorization required" or permission prompt
- **Fix:** Make sure "Who has access" is set to "Anyone"

**Issue:** "Script function not found"
- **Fix:** Make sure `doPost` function exists in your code

**Issue:** "Access denied" or "Permission denied"
- **Fix:** Check that your Google account has Editor access to the Sheet

**Issue:** No executions showing up
- **Fix:** The request might be blocked by CORS or the URL is wrong

### 6. Redeploy from Scratch (If Nothing Works)

1. In Apps Script, click **"Deploy"** → **"Manage deployments"**
2. Click the **trash icon** to delete the current deployment
3. Click **"New deployment"**
4. Click the **gear icon** ⚙️ next to "Select type"
5. Choose **"Web app"**
6. Settings:
   - **Description:** "Banding Tickets API"
   - **Execute as:** "Me"
   - **Who has access:** "Anyone" (or "Anyone, even anonymous")
7. Click **"Deploy"**
8. **Copy the new URL**
9. Update it in `bandingtickets.html` (line 893)

## Quick Test

After fixing, test with this URL in your browser:
```
https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?action=read&serial=TEST
```

**Expected:** `{"success":false,"error":"Ticket not found"}`
**If you see:** HTML page or error → deployment is wrong

## Still Not Working?

If it's still returning raw form data after all this:
1. Check the browser console for the exact error
2. Check Apps Script execution logs
3. Verify the URL in the HTML matches the deployment URL
4. Try creating a completely new Apps Script project and deploying it

