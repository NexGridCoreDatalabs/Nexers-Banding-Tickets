# Test Your Apps Script

## The Problem
The error "Unexpected token 'd'" means Apps Script is returning the raw request data (`"data=%7B%2..."`) instead of processing it. This means `doPost` isn't working.

## Quick Test

1. **Test your Apps Script URL directly:**
   - Open this URL in your browser (replace with your actual URL):
   ```
   https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec?action=read&serial=TEST
   ```
   - You should see JSON like: `{"success":false,"error":"Ticket not found"}`
   - If you see HTML or an error page, the deployment is wrong

2. **Check your Apps Script code:**
   - Go to: https://script.google.com/
   - Open your project
   - Make sure the entire `google-apps-script-code.js` file is pasted
   - Look for the `doPost` function (should be around line 23)

3. **Verify deployment:**
   - Click "Deploy" → "Manage deployments"
   - Click the pencil icon (edit)
   - Make sure:
     - **Type:** "Web app" (NOT "API Executable")
     - **Execute as:** "Me"
     - **Who has access:** "Anyone" or "Anyone, even anonymous"
   - If it's set to "API Executable", that's the problem! Change it to "Web app"

4. **Check execution logs:**
   - In Apps Script, click "Executions" (left menu)
   - Look for recent executions
   - Click on one to see if there are errors
   - If you see errors, share them

## Common Issues

### Issue 1: Deployed as "API Executable" instead of "Web app"
**Fix:** Delete the deployment and create a new one as "Web app"

### Issue 2: doPost function missing or has errors
**Fix:** Copy the entire `google-apps-script-code.js` file into your Apps Script

### Issue 3: Access permissions wrong
**Fix:** Set "Who has access" to "Anyone" or "Anyone, even anonymous"

### Issue 4: Old deployment version
**Fix:** When editing deployment, select "New version" under Version

## What Should Happen

When you POST data to Apps Script:
1. Apps Script receives: `data=%7B%22action%22%3A%22append%22...`
2. `doPost` function processes it
3. Apps Script returns: `{"success":true,"message":"Data saved successfully"}`

But currently:
1. Apps Script receives: `data=%7B%22action%22%3A%22append%22...`
2. `doPost` doesn't run (or fails silently)
3. Apps Script returns: `data=%7B%22action%22%3A%22append%22...` (raw data)

That's why you get "Unexpected token 'd'" - it's trying to parse `"data=..."` as JSON!

