# Zone Flow Mapping - Complete Rules

## Zone Abbreviations
- **REC** = Receiving Area
- **DET** = Detergents Zone
- **FAT** = Fats Zone
- **LIQ** = Liquids/Oils Zone
- **SOP** = Soaps Zone
- **SM** = SuperMarket Area
- **QAH** = QA Hold
- **REW** = Rework Zone
- **DSP** = Dispatch Loading Area
- **OUT** = Outbounding
- **OBD** = OUTBONDED

---

## Rule 1: From Receiving Area (REC)
**Can move to:** ALL zones EXCEPT Outbounding (OUT) and OUTBONDED (OBD)

✅ **Allowed destinations:**
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

## Rule 2: SuperMarket Area (SM)
**Can receive from:** ANY zone EXCEPT OBD and OUT

✅ **Can receive from:**
- Receiving Area (REC)
- Detergents Zone (DET)
- Fats Zone (FAT)
- Liquids/Oils Zone (LIQ)
- Soaps Zone (SOP)
- QA Hold (QAH)
- Rework Zone (REW)
- Dispatch Loading Area (DSP)

❌ **NOT allowed from:**
- Outbounding (OUT)
- OUTBONDED (OBD)

**Can move to:**
- SM (itself - can stay)
- Dispatch Loading Area (DSP)
- QA Hold (QAH)

**Special:** SM is the ONLY zone that allows splitting

---

## Rule 3: Rework Zone (REW)
**Can ONLY receive from:** QAH and DSP

✅ **Can receive from:**
- QA Hold (QAH)
- Dispatch Loading Area (DSP)

❌ **NOT allowed from:**
- Any other zone (including REC, DET, FAT, LIQ, SOP, SM, OUT, OBD)

**Can move to:**
- Receiving Area (REC) - for repositioning to zones again
- QA Hold (QAH)
- SuperMarket Area (SM)

❌ **NOT allowed:**
- Dispatch Loading Area (DSP)

---

## Rule 4: Once merch goes to any zone from REC
**After leaving REC, can ONLY move to:** DSP, QAH, or SM

**This means:**
- From DET → Only DSP, QAH, or SM (cannot go to other product zones, REW, REC, OUT, OBD)
- From FAT → Only DSP, QAH, or SM (cannot go to other product zones, REW, REC, OUT, OBD)
- From LIQ → Only DSP, QAH, or SM (cannot go to other product zones, REW, REC, OUT, OBD)
- From SOP → Only DSP, QAH, or SM (cannot go to other product zones, REW, REC, OUT, OBD)
- From QAH → Only DSP, QAH (itself), or SM (can also go to REW per Rule 3)
- From REW → Only DSP, QAH, or SM
- From DSP → Only DSP (itself), QAH, SM, or OUT (primary flow)

---

## Rule 5: Dispatch Loading Area (DSP)
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
- Outbounding (OUT) - primary flow
- Rework Zone (REW) - if needs rework
- QA Hold (QAH) - if needs QA check
- SuperMarket Area (SM) - can go back to SM

❌ **NOT allowed:**
- DSP (itself - cannot stay in DSP)

---

## Rule 6: Outbounding (OUT)
**Can receive from:**
- Dispatch Loading Area (DSP)

**Can move to:**
- OUTBONDED (OBD) - final consumer
- Rework Zone (REW) - if needs rework
- QA Hold (QAH) - if needs QA check

---

## Rule 7: OUTBONDED (OBD)
**Can receive from:**
- Outbounding (OUT)

**Final destination** - no further movement allowed

---

## Complete Flow Matrix

### From → To Allowed Movements

| From Zone | To Zones Allowed |
|-----------|------------------|
| **REC** | DET, FAT, LIQ, SOP, SM, QAH, REW, DSP |
| **DET** | SM, DSP, QAH |
| **FAT** | SM, DSP, QAH |
| **LIQ** | SM, DSP, QAH |
| **SOP** | SM, DSP, QAH |
| **SM** | SM (itself), DSP, QAH |
| **QAH** | REW, DSP, SM, QAH (itself) |
| **REW** | REC, QAH, SM |
| **DSP** | OUT, REW, QAH, SM |
| **OUT** | OBD, REW, QAH |
| **OBD** | (FINAL - no movement) |

---

## Complete Flow Diagram

```
REC → [DET, FAT, LIQ, SOP, SM, QAH, REW, DSP]
      ❌ NOT: OUT, OBD

DET → [SM, DSP, QAH]
      ❌ NOT: Other product zones, REW, REC, OUT, OBD

FAT → [SM, DSP, QAH]
      ❌ NOT: Other product zones, REW, REC, OUT, OBD

LIQ → [SM, DSP, QAH]
      ❌ NOT: Other product zones, REW, REC, OUT, OBD

SOP → [SM, DSP, QAH]
      ❌ NOT: Other product zones, REW, REC, OUT, OBD

SM ← [REC, DET, FAT, LIQ, SOP, QAH, REW, DSP]
     ❌ NOT from: OUT, OBD
     → [SM (itself), DSP, QAH]
     ✅ ONLY zone that allows splitting

QAH → [REW, DSP, SM, QAH (itself)]
      ← [REC, DET, FAT, LIQ, SOP, SM, DSP]

REW ← [QAH, DSP] ONLY
     ❌ NOT from: REC, DET, FAT, LIQ, SOP, SM, OUT, OBD
     → [REC, QAH, SM]
     ❌ NOT: DSP

DSP → [OUT, REW, QAH, SM]
      ❌ NOT: DSP (itself)
      ← [REC, DET, FAT, LIQ, SOP, SM, QAH, REW]

OUT ← [DSP] ONLY
     → [OBD, REW, QAH]

OBD ← [OUT] ONLY
     → (FINAL - no further movement)
```

---

## Implementation Requirements

1. **Zone eligibility validation function** - Check if movement from Zone A to Zone B is allowed
2. **SM splitting check** - Only allow splitting when destination is SM
3. **REW restriction enforcement** - Strict check: only allow REW as destination if source is QAH or DSP
4. **Post-REC restriction** - Once pallet leaves REC, restrict to only DSP, QAH, or SM (except REW can go back to REC)
5. **OBD final destination** - No movement allowed out of OUTBONDED
6. **DSP self-movement prevention** - DSP cannot move to itself
7. **REW repositioning** - REW can move back to REC for repositioning to zones again
8. **Recommendation logic** - Update `recommendDestination()` to follow these rules
9. **Dropdown filtering** - Filter "Move To" dropdown based on current zone and these rules
