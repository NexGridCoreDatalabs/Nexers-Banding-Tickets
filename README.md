# Nexers Banding Tickets

Banding ticket generator and pallet tracking for Nexers (BIDCO Africa). Web app frontend + Google Apps Script backend.

## Quick Start

1. **Backend:** Copy `google-apps-script-code.js` into a [Google Apps Script](https://script.google.com/) project, deploy as Web App
2. **Config:** Copy `config.example.js` to `config.js`, add your Apps Script Web App URL
3. **Frontend:** Open `bandingtickets.html` (or host it)

See **[docs/HOW_TO_SETUP_APPS_SCRIPT.md](docs/HOW_TO_SETUP_APPS_SCRIPT.md)** for full setup.

## Project Structure

```
bandingtickets.html      # Frontend (ticket creation, view/edit, zone movements)
google-apps-script-code.js # Backend (Sheets API, calculations, analytics)
config.example.js        # Config template (copy to config.js)
docs/                    # Documentation
  ├── HOW_TO_SETUP_APPS_SCRIPT.md
  ├── SECURITY_FIX_INSTRUCTIONS.md
  ├── zones/             # Zone config, movement rules
  └── archive/           # Historical implementation notes
```

## Features

- Ticket generation (scan QR → fill form → save to Sheets)
- Geofencing (authorized locations only)
- SKU catalog from SKUZoneMapping
- Zone movements, pallet tracking
- Analytics (Summary, Variant Comparison, Visuals, Shift Summary)
- Sheet organization (Landing, colors, hide config/backend)

## Docs

| Doc | Description |
|-----|-------------|
| [HOW_TO_SETUP_APPS_SCRIPT.md](docs/HOW_TO_SETUP_APPS_SCRIPT.md) | Setup Apps Script and deploy |
| [SECURITY_FIX_INSTRUCTIONS.md](docs/SECURITY_FIX_INSTRUCTIONS.md) | API key and security guidance |
| [zones/](docs/zones/) | Zone config, movement rules, OUTBONDED |
