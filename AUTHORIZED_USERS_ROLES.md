# Authorized Users Sheet — Role Configuration

## Where to Put User Roles

The **Authorized Users** sheet in your Google Spreadsheet stores user credentials and optional roles. Add a **Role** column to control who can perform privileged actions.

### Sheet Structure

| Column | Required | Description |
|--------|----------|-------------|
| **ID** (Column A) | Yes | User identifier — used for login and role checks. Must match exactly. |
| **Name** (Column B) | Yes | Display name |
| **Passcode** (Column C) | Yes | Password for login |
| **Role** (optional) | No | `Supervisor`, `QA`, or `Zone Clerk` |

### Role Column

1. Add a new column header **Role** to your Authorized Users sheet (any position; header name must be exactly `Role`).
2. In each user row, enter one of:
   - `Supervisor` — Can cancel in-transit movements (escalation required)
   - `QA` — Same privileges as Supervisor for Cancel Transit
   - `Zone Clerk` — Can initiate moves and receive pallets; cannot cancel transit
   - *(blank)* — Treated as Zone Clerk (receive only, no cancel)

### Permissions by Role

| Action | Zone Clerk | Supervisor | QA |
|--------|------------|------------|-----|
| Initiate Move | ✓ | ✓ | ✓ |
| Receive Pallet | ✓ | ✓ | ✓ |
| Cancel Transit | ✗ | ✓ | ✓ |

### Example Layout

```
| ID      | Name          | Passcode | Role      |
|---------|----------------|----------|-----------|
| SUP001  | Jane Supervisor| ****    | Supervisor|
| QA002   | Bob QA        | ****     | QA        |
| CLK003  | Sam Clerk     | ****     | Zone Clerk|
```

### Notes

- Role checks are case-insensitive (`supervisor`, `Supervisor`, `SUPERVISOR` all work).
- If the Role column is missing, everyone is treated as Zone Clerk (no Cancel Transit).
- **Receive** and **Cancel Transit** use your logged-in identity — no manual “Receiving as” input.
