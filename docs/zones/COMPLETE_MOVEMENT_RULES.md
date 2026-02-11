# Complete Movement Rules Map - Banding Tickets System

## Zone Name Standardization
**IMPORTANT:** All zone name comparisons must be case-insensitive to avoid mismatches.

### Zone Name Variations (all should be treated as equivalent):
- **OUTBONDED**: `OUTBONDED`, `Outbonded`, `outbonded`, `OUTBOUNDED`, `Outbounded`
- **Outbounding**: `Outbounding`, `outbounding`, `OUTBOUNDING`
- **Rework Zone**: `Rework Zone`, `Rework`, `rework zone`, `rework`
- **QA Hold**: `QA Hold`, `qa hold`, `QAH`
- **Dispatch Loading Area**: `Dispatch Loading Area`, `dispatch loading area`, `DSP`

---

## Complete Movement Rules Matrix

### Rule 1: From Receiving Area (REC)
**Can move to:** ALL zones EXCEPT Outbounding (OUT) and OUTBONDED (OBD)

✅ **Allowed:**
- Detergents Zone (DET)
- Fats Zone (FAT)
- Liquids/Oils Zone (LIQ)
- Soaps Zone (SOP)
- SuperMarket Area (SM)
- QA Hold (QAH)
- Rework Zone (REW)
- Dispatch Loading Area (DSP)

❌ **NOT allowed:**
- Outbounding (OUT)
- OUTBONDED (OBD)

---

### Rule 2: From Product Zones (DET, FAT, LIQ, SOP)
**Can move to:** ONLY SM, DSP, QAH

✅ **Allowed:**
- SuperMarket Area (SM)
- Dispatch Loading Area (DSP)
- QA Hold (QAH)

❌ **NOT allowed:**
- Other product zones (DET, FAT, LIQ, SOP)
- Rework Zone (REW)
- Receiving Area (REC)
- Outbounding (OUT)
- OUTBONDED (OBD)

---

### Rule 3: From SuperMarket Area (SM)
**Can receive from:** ANY zone EXCEPT OBD and OUT

**Can move to:**
- SM (itself - can stay)
- Dispatch Loading Area (DSP)
- QA Hold (QAH)

**Special:** SM is the ONLY zone that allows splitting

---

### Rule 4: From QA Hold (QAH)
**Can move to:**
- Rework Zone (REW)
- Dispatch Loading Area (DSP)
- SuperMarket Area (SM)
- QAH (itself - can stay)

---

### Rule 5: From Rework Zone (REW)
**Can ONLY receive from:** QAH and DSP

✅ **Can receive from:**
- QA Hold (QAH)
- Dispatch Loading Area (DSP)

❌ **NOT allowed from:**
- Any other zone (REC, DET, FAT, LIQ, SOP, SM, OUT, OBD)

**Can move to:**
- Receiving Area (REC) - for repositioning
- QA Hold (QAH)
- SuperMarket Area (SM)

❌ **NOT allowed:**
- Dispatch Loading Area (DSP) - cannot move to DSP

---

### Rule 6: From Dispatch Loading Area (DSP)
**Can receive from:**
- Receiving Area (REC)
- Detergents Zone (DET)
- Fats Zone (FAT)
- Liquids/Oils Zone (LIQ)
- Soaps Zone (SOP)
- SuperMarket Area (SM)
- QA Hold (QAH)
- Rework Zone (REW)

**Can move to:**
- Outbounding (OUT) - primary forward flow
- Rework Zone (REW)
- QA Hold (QAH)
- SuperMarket Area (SM)

❌ **NOT allowed:**
- DSP (itself - cannot stay in DSP)

---

### Rule 7: From Outbounding (OUT)
**Can receive from:**
- Dispatch Loading Area (DSP)

**Can move to:**
- **OUTBONDED (OBD)** - final consumer destination ✅
- Rework Zone (REW)
- QA Hold (QAH)

**Special Status Rule:** If pallet STATUS is "Outbounding" or "Shipped", it can ONLY move to:
- OUTBONDED (OBD) ✅
- Rework Zone (REW)
- QA Hold (QAH)

---

### Rule 8: From OUTBONDED (OBD)
**Can receive from:**
- Outbounding (OUT)

**Final destination** - NO movement allowed out

❌ **NOT allowed:**
- Any movement from OUTBONDED (final consumer destination)

---

## Implementation Checklist

### Frontend Validation (`bandingtickets.html`)
- [x] Rule 1: REC → All except OUT, OBD
- [x] Rule 2: Product zones → Only SM, DSP, QAH
- [x] Rule 3: SM → SM (itself), DSP, QAH
- [x] Rule 4: QAH → REW, DSP, SM, QAH (itself)
- [x] Rule 5: REW → REC, QAH, SM (NOT DSP)
- [x] Rule 6: DSP → OUT, REW, QAH, SM (NOT itself)
- [x] Rule 7: OUT → OBD, REW, QAH
- [x] Rule 8: OBD → None (final)
- [x] REW can ONLY receive from QAH and DSP
- [x] DSP cannot move to itself
- [x] OUTBONDED is final - no movement out
- [ ] **FIX NEEDED:** Outbounding STATUS pallets validation (check zone name, not just status)
- [ ] **FIX NEEDED:** Case-insensitive zone name matching for OUTBONDED

### Backend Validation (`COMPLETE_APPS_SCRIPT_CODE.js`)
- [x] OUTBONDED accepts all SKUs (bypasses SKU restrictions)
- [x] Case-insensitive matching for OUTBONDED/OUTBOUNDED
- [ ] **VERIFY:** Zone name matching handles all case variations
- [ ] **VERIFY:** Status-based validation for "Outbounding" status pallets

---

## Critical Fixes Required

### Fix 1: Frontend - Case-Insensitive OUTBONDED Matching
**Location:** `getAllowedDestinations()` function
**Issue:** Uses `zName === 'outbonded'` (exact lowercase match)
**Fix:** Use case-insensitive matching: `zName.includes('outbonded')` or normalize to lowercase

### Fix 2: Frontend - Outbounding Zone Name Check
**Location:** `submitMovementForm()` function
**Issue:** Only checks pallet STATUS, not current ZONE name
**Fix:** Also check if current zone is "Outbounding" (case-insensitive)

### Fix 3: Backend - Zone Name Normalization
**Location:** `checkZoneEligibility()` function
**Issue:** May not handle all zone name variations
**Fix:** Ensure case-insensitive matching for all zone names

---

## Testing Checklist

After fixes, test these scenarios:

1. ✅ Move from "Outbounding" zone → "OUTBONDED" (should work)
2. ✅ Move from "Outbounding" zone → "Outbonded" (should work - case variation)
3. ✅ Move pallet with "Outbounding" status → "OUTBONDED" (should work)
4. ✅ Move from "OUTBONDED" → Any zone (should fail - final destination)
5. ✅ Move from "Outbounding" → "Rework Zone" (should work)
6. ✅ Move from "Outbounding" → "QA Hold" (should work)
7. ✅ Move from "Outbounding" → "SM" (should fail - not allowed)
8. ✅ Move from "Outbounding" → "DSP" (should fail - not allowed)

---

## Zone Name Matching Strategy

**Recommended approach:**
1. Normalize all zone names to lowercase for comparison
2. Use `.includes()` for partial matches (handles "Rework Zone" vs "Rework")
3. Use exact match for specific zones (OUTBONDED, QA Hold)
4. Handle common variations (OUTBONDED, Outbonded, outbonded, OUTBOUNDED)

**Example normalization:**
```javascript
function normalizeZoneName(zoneName) {
    return (zoneName || '').toString().trim().toLowerCase();
}

function isOutbondedZone(zoneName) {
    const normalized = normalizeZoneName(zoneName);
    return normalized === 'outbonded' || normalized === 'outbounded';
}

function isOutboundingZone(zoneName) {
    const normalized = normalizeZoneName(zoneName);
    return normalized.includes('outbounding') && !isOutbondedZone(zoneName);
}
```
