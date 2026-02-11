# Add OUTBONDED Zone to ZoneConfig Sheet

## Manual Addition Steps

1. Open your Google Sheet: `1QXkL2K5hAfyvHKQ6mCFckmIu73lLw_XyENKSuqyFQgE`
2. Go to the **ZoneConfig** sheet
3. Add a new row at the bottom with the following values:

| ZoneName | Prefix | AllowsSplitting | FIFORequired | ShelfLifeDays | MaxCapacity | CurrentOccupancy | NextPalletNumber | DefaultStatus | Notes |
|----------|--------|-----------------|-------------|---------------|-------------|------------------|------------------|---------------|-------|
| OUTBONDED | OBD | FALSE | FALSE | (empty) | (empty) | 0 | 1 | Outbonded | Final consumer destination zone |

## Column Details:
- **ZoneName**: `OUTBONDED`
- **Prefix**: `OBD`
- **AllowsSplitting**: `FALSE`
- **FIFORequired**: `FALSE`
- **ShelfLifeDays**: (leave empty)
- **MaxCapacity**: (leave empty)
- **CurrentOccupancy**: `0`
- **NextPalletNumber**: `1`
- **DefaultStatus**: `Outbonded`
- **Notes**: `Final consumer destination zone`

## Alternative: Use Apps Script

You can also add this via the Apps Script by calling:
```
action=addZone&zoneName=OUTBONDED&prefix=OBD&allowsSplitting=false&fifoRequired=false&defaultStatus=Outbonded&notes=Final consumer destination zone
```

But manual addition is simpler and ensures it's exactly as you want it.
