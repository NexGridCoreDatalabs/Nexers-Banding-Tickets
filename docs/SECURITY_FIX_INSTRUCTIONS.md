# 🚨 SECURITY FIX - CRITICAL ACTION REQUIRED

## ⚠️ EXPOSED API KEY DETECTED

Your Google API key was exposed in the repository: `AIzaSyBUSYg78PSD47OWJkzEa4kMQknjROGulLI`

## IMMEDIATE ACTIONS REQUIRED:

### 1. **REVOKE THE EXPOSED API KEY** (DO THIS NOW!)

1. Go to: https://console.cloud.google.com/apis/credentials
2. Find the API key: `AIzaSyBUSYg78PSD47OWJkzEa4kMQknjROGulLI`
3. Click on it → Click **"DELETE"** or **"RESTRICT"** → **"DELETE KEY"**
4. Create a NEW API key with proper restrictions:
   - Restrict to specific APIs (Google Sheets API, Google Apps Script API)
   - Restrict to specific HTTP referrers (your domain only)
   - Add IP restrictions if possible

### 2. **REMOVE SETUP_SECRETS.md FROM GIT HISTORY**

The file `SETUP_SECRETS.md` was committed to GitHub. Even if deleted, it's still in git history.

**To remove it completely:**

```bash
# Option 1: Use git filter-branch (if you have admin access)
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch SETUP_SECRETS.md" \
  --prune-empty --tag-name-filter cat -- --all

# Option 2: Use BFG Repo-Cleaner (recommended)
# Download from: https://rtyley.github.io/bfg-repo-cleaner/
java -jar bfg.jar --delete-files SETUP_SECRETS.md
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Then force push (WARNING: This rewrites history!)
git push origin --force --all
```

**⚠️ WARNING:** Force pushing rewrites git history. Coordinate with your team first!

### 3. **UPDATE YOUR CONFIG.JS**

Create/update `config.js` (NOT committed to git) with your NEW API key:

```javascript
window.BANDFLOW_CONFIG = {
  GENERATOR_PASSWORD: 'YOUR_SECURE_PASSWORD',
  GOOGLE_SHEET_ID: 'YOUR_SHEET_ID',
  GOOGLE_API_KEY: 'YOUR_NEW_API_KEY_HERE', // ← Use NEW key
  GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxbujRsVW-vVwt34GVCOlCm145mjgp4uV11-YhSy1CQtXPKiqdlPycfTj7q8GvIHg0a0g/exec',
  SCAN_BASE_URL: 'https://yourdomain.com/bandingtickets.html',
  SECURITY: {
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000,
    SESSION_TIMEOUT: 30 * 60 * 1000,
    DEBUG_MODE: false
  }
};
```

### 4. **VERIFY .gitignore**

Ensure `.gitignore` includes:
- `config.js`
- `SETUP_SECRETS.md`
- `*.secret`
- `*.key`
- `.env`

### 5. **GOOGLE APPS SCRIPT URL**

Your Apps Script deployment URL:
```
https://script.google.com/macros/s/AKfycbxbujRsVW-vVwt34GVCOlCm145mjgp4uV11-YhSy1CQtXPKiqdlPycfTj7q8GvIHg0a0g/exec
```

**To find/edit your Apps Script:**
1. Go to: https://script.google.com/
2. Find your project: "Banding Tickets" or similar
3. Click on it to edit
4. Deploy → Manage deployments → Copy the Web App URL

---

## ✅ WHAT WAS FIXED:

- ✅ Removed hardcoded API key from `bandingtickets.html`
- ✅ Updated `.gitignore` to prevent future secret commits
- ✅ Code now requires `config.js` (not in git) for credentials

## 🔒 PREVENTION:

**NEVER commit:**
- API keys
- Passwords
- Secret tokens
- Credentials
- `.env` files
- `config.js` (use `config.example.js` instead)

**ALWAYS:**
- Use environment variables or external config files
- Add secrets to `.gitignore`
- Use GitHub Secrets for CI/CD
- Review files before committing (`git diff`)
