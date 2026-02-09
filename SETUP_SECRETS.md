# 🔐 SETUP GITHUB SECRETS

## Quick Setup (3 Steps)

### 1. Add Secrets
Go to: Settings → Secrets and variables → Actions → New repository secret

Add these 5 secrets:
- `GENERATOR_PASSWORD` = `NEXGRID2025`
- `GOOGLE_SHEET_ID` = `1QXkL2K5hAfyvHKQ6mCFckmIu73lLw_XyENKSuqyFQgE`
- `GOOGLE_API_KEY` = `AIzaSyBUSYg78PSD47OWJkzEa4kMQknjROGulLI`
- `GOOGLE_APPS_SCRIPT_URL` = `https://script.google.com/macros/s/AKfycbxbujRsVW-vVwt34GVCOlCm145mjgp4uV11-YhSy1CQtXPKiqdlPycfTj7q8GvIHg0a0g/exec`
- `SCAN_BASE_URL` = `https://nexgridcoredatalabs.github.io/Nexers-Banding-Tickets/bandingtickets.html`

### 2. Enable Actions
Settings → Pages → Source: **GitHub Actions**

### 3. Deploy
Actions → "Deploy to GitHub Pages with Secure Config" → Run workflow

---

**Done!** Config.js will be generated from secrets at deploy time.
