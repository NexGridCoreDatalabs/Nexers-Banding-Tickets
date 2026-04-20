// RetiFlux™ — End-of-Shift Excel Report Generator
// Generates a branded .xlsx file and delivers the download link via WhatsApp.
//
// Invoke via HTTP POST:
//   { "type": "end_of_shift", "shift": "day" }    -- Day shift   07:00–19:00 EAT
//   { "type": "end_of_shift", "shift": "night" }   -- Night shift 19:00–07:00 EAT
//   { "mock_now": "2026-04-13T16:00:00Z" }         -- Optional: override clock for testing
//
// Tabs generated:
//   1. Summary          — KPIs, per-line overview, shift flags
//   2. By Line          — Per-line per-SKU breakdown with tonnage
//   3. SKU Comparisons  — Cross-line SKU performance vs last shift + 7-day avg
//   4. Materials        — Cartons / sachets / tablets consumed
//   5. Hourly           — Hour-by-hour pallet counts per line
//   6. Trend (7-Day)    — Same shift type for the past 7 occurrences
//   7. Audit Trail      — Voided tickets this shift (excluded from all other tabs)
//
// Required Supabase secrets:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//   WHATSAPP_RECIPIENT_1 … WHATSAPP_RECIPIENT_N

// @deno-types="https://esm.sh/exceljs@4.4.0/index.d.ts"
import ExcelJS from "https://esm.sh/exceljs@4.4.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID     = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN   = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM    = Deno.env.get("TWILIO_WHATSAPP_FROM")!;

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

// ── Brand palette (RetiFlux dark-navy / gold theme) ───────────────────────────
const C = {
  navy:        "FF0F172A",   // bg dark navy
  navyMid:     "FF1E293B",   // card bg
  navyLight:   "FF334155",   // lighter row
  gold:        "FFF0C040",   // gold accent
  goldDim:     "FFCA9E15",   // dimmer gold for borders
  white:       "FFFFFFFF",
  offWhite:    "FFF8FAFC",
  textLight:   "FFE2E8F0",
  textMuted:   "FF94A3B8",
  red:         "FFEF4444",
  green:       "FF22C55E",
  amber:       "FFF59E0B",
  voidRed:     "FF7F1D1D",   // dark red for voided rows
  voidText:    "FFFCA5A5",   // light red text
} as const;

const LINES = ["SP", "PKN", "MB-250", "AL", "MB-150", "Offline Banding"];

// ── Clock helpers ─────────────────────────────────────────────────────────────

let _mockNowUtc: Date | null = null;

function eatNow(): Date {
  const base = _mockNowUtc ?? new Date();
  return new Date(base.getTime() + EAT_OFFSET_MS);
}
function toEAT(d: Date): Date { return new Date(d.getTime() + EAT_OFFSET_MS); }
function fmtTime(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
}
function fmtDateFull(d: Date): string {
  const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtDateShort(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtDateFile(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function pctVs(cur: number, prev: number): string {
  if (!prev) return "—";
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 1) return "stable";
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(Math.round(d))}%`;
}

// ── Supabase data types ───────────────────────────────────────────────────────

interface TicketRow {
  id:              string;
  serial:          string;
  production_line: string;
  sku:             string;
  qty:             number;
  uom:             string;
  pallet_color:    string | null;
  clerk_name:      string | null;
  created_at:      string;
  voided:          boolean;
  voided_at:       string | null;
  voided_reason:   string | null;
  voided_by:       string | null;
}

interface SkuMeta {
  sku:                   string;
  product_name:          string;
  units_per_carton:      number | null;
  net_weight_kg_per_unit: number | null;
  sachet_type:           string | null;
  tablet_type:           string | null;
  subdivision:           string;
}

// ── Data fetch ────────────────────────────────────────────────────────────────

async function fetchTickets(
  sb: ReturnType<typeof createClient>,
  from: Date, to: Date,
  includeVoided = false
): Promise<TicketRow[]> {
  let q = sb.from("tickets")
    .select("id,serial,production_line,sku,qty,uom,pallet_color,clerk_name,created_at,voided,voided_at,voided_reason,voided_by")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .not("production_line", "is", null);

  if (!includeVoided) q = q.eq("voided", false);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TicketRow[];
}

async function fetchSkuMeta(
  sb: ReturnType<typeof createClient>
): Promise<Record<string, SkuMeta>> {
  const { data } = await sb.from("skus")
    .select("sku,product_name,units_per_carton,net_weight_kg_per_unit,sachet_type,tablet_type,subdivision");
  const map: Record<string, SkuMeta> = {};
  (data ?? []).forEach((r: SkuMeta) => { map[r.sku] = r; });
  return map;
}

// ── Tonnage helpers ───────────────────────────────────────────────────────────

function calcTonnes(ticket: TicketRow, meta: SkuMeta | undefined): number {
  if (!meta?.net_weight_kg_per_unit || !meta?.units_per_carton) return 0;
  // Each ticket = qty cartons × units/carton × kg/unit ÷ 1000 → tonnes
  return (ticket.qty * meta.units_per_carton * meta.net_weight_kg_per_unit) / 1000;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ── Aggregation helpers ───────────────────────────────────────────────────────

interface LineAgg {
  pallets:  number;
  units:    number;
  tonnes:   number;
  skus:     Record<string, { pallets: number; units: number; tonnes: number }>;
}

function aggregateByLine(
  tickets: TicketRow[],
  skuMeta: Record<string, SkuMeta>
): Record<string, LineAgg> {
  const result: Record<string, LineAgg> = {};
  for (const l of LINES) result[l] = { pallets:0, units:0, tonnes:0, skus:{} };

  for (const t of tickets) {
    const l = t.production_line?.trim();
    if (!l) continue;
    if (!result[l]) result[l] = { pallets:0, units:0, tonnes:0, skus:{} };
    const meta = skuMeta[t.sku];
    const tonnes = calcTonnes(t, meta);
    result[l].pallets++;
    result[l].units   += Number(t.qty) || 0;
    result[l].tonnes  += tonnes;
    if (!result[l].skus[t.sku]) result[l].skus[t.sku] = { pallets:0, units:0, tonnes:0 };
    result[l].skus[t.sku].pallets++;
    result[l].skus[t.sku].units   += Number(t.qty) || 0;
    result[l].skus[t.sku].tonnes  += tonnes;
  }
  return result;
}

// ── Shift bounds ──────────────────────────────────────────────────────────────

function shiftBounds(shift: "day"|"night", offsetDays: number, baseEAT: Date): [Date, Date] {
  const base = new Date(Date.UTC(baseEAT.getUTCFullYear(), baseEAT.getUTCMonth(), baseEAT.getUTCDate()));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  if (shift === "day") {
    return [new Date(base.getTime() + 4*3600000), new Date(base.getTime() + 16*3600000)];
  } else {
    return [new Date(base.getTime() - 8*3600000), new Date(base.getTime() + 4*3600000)];
  }
}

// ── ExcelJS style helpers ─────────────────────────────────────────────────────

function headerFill(color: string): ExcelJS.Fill {
  return { type:"pattern", pattern:"solid", fgColor:{ argb: color } };
}
function solidFill(color: string): ExcelJS.Fill {
  return { type:"pattern", pattern:"solid", fgColor:{ argb: color } };
}
function thinBorder(color = "FF334155"): Partial<ExcelJS.Borders> {
  const s: ExcelJS.BorderStyle = "thin";
  const side = { style: s, color:{ argb: color } };
  return { top:side, bottom:side, left:side, right:side };
}
function cellFont(bold=false, size=10, color=C.textLight): Partial<ExcelJS.Font> {
  return { bold, size, color:{ argb: color }, name:"Calibri" };
}

function applyHeaderRow(
  row: ExcelJS.Row,
  cols: string[],
  bgColor = C.navy,
  textColor = C.gold
): void {
  row.values = ["", ...cols];
  row.eachCell((cell, colNum) => {
    if (colNum === 1) return;
    cell.fill  = headerFill(bgColor);
    cell.font  = cellFont(true, 10, textColor);
    cell.border = thinBorder(C.goldDim);
    cell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
  });
  row.height = 24;
}

function dataCell(
  cell: ExcelJS.Cell,
  value: ExcelJS.CellValue,
  bg = C.navyMid,
  bold = false,
  align: ExcelJS.Alignment["horizontal"] = "left",
  textColor = C.textLight
): void {
  cell.value  = value;
  cell.fill   = solidFill(bg);
  cell.font   = cellFont(bold, 10, textColor);
  cell.border = thinBorder();
  cell.alignment = { horizontal: align, vertical:"middle" };
}

// Thin separator row (full-width dark band)
function addSeparator(ws: ExcelJS.Worksheet, maxCol: number): ExcelJS.Row {
  const row = ws.addRow([]);
  row.height = 6;
  for (let c = 1; c <= maxCol; c++) {
    ws.getCell(row.number, c).fill = solidFill(C.navy);
  }
  return row;
}

// Merge + style a sheet title cell
function addSheetTitle(ws: ExcelJS.Worksheet, title: string, subtitle: string, maxCol: number): void {
  // Title row
  const r1 = ws.addRow([title]);
  ws.mergeCells(r1.number, 1, r1.number, maxCol);
  const c1 = ws.getCell(r1.number, 1);
  c1.fill  = solidFill(C.navy);
  c1.font  = { bold:true, size:14, color:{argb:C.gold}, name:"Calibri" };
  c1.alignment = { horizontal:"center", vertical:"middle" };
  r1.height = 32;

  // Subtitle row
  const r2 = ws.addRow([subtitle]);
  ws.mergeCells(r2.number, 1, r2.number, maxCol);
  const c2 = ws.getCell(r2.number, 1);
  c2.fill  = solidFill(C.navyMid);
  c2.font  = { bold:false, size:10, color:{argb:C.textMuted}, name:"Calibri" };
  c2.alignment = { horizontal:"center", vertical:"middle" };
  r2.height = 20;

  ws.addRow([]); // spacer
}

// ── TAB 1: Summary ────────────────────────────────────────────────────────────

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  shift: "day"|"night",
  curTickets: TicketRow[],
  prevTickets: TicketRow[],
  sevenTickets: TicketRow[][],
  skuMeta: Record<string, SkuMeta>,
  shiftStart: Date, shiftEnd: Date
): void {
  const ws = wb.addWorksheet("Summary", {
    properties:{ tabColor:{ argb:C.gold } },
    views:[{ state:"frozen", ySplit:1 }]
  });
  ws.properties.defaultColWidth = 20;

  const maxCol = 6;
  const shiftLabel = shift === "day" ? "Day Shift  ·  07:00–19:00 EAT" : "Night Shift  ·  19:00–07:00 EAT";
  const eatDate = toEAT(shiftEnd);

  addSheetTitle(ws,
    "RetiFlux™  ·  End of Shift Production Report",
    `${shiftLabel}  ·  ${fmtDateFull(eatDate)}`,
    maxCol
  );

  const cur  = aggregateByLine(curTickets,  skuMeta);
  const prev = aggregateByLine(prevTickets, skuMeta);
  const seven = sevenTickets.map(t => aggregateByLine(t, skuMeta));

  const totalPallets = LINES.reduce((s,l) => s + cur[l].pallets, 0);
  const totalUnits   = LINES.reduce((s,l) => s + cur[l].units,   0);
  const totalTonnes  = r2(LINES.reduce((s,l) => s + cur[l].tonnes, 0));
  const linesActive  = LINES.filter(l => cur[l].pallets > 0).length;

  // KPI boxes row
  const kpiRow = ws.addRow(["", "Total Pallets", "Total Units", "Total Tonnage", "Lines Active", "Shift"]);
  kpiRow.height = 22;
  [[2,totalPallets],[3,totalUnits],[4,totalTonnes+" t"],[5,`${linesActive} / ${LINES.length}`],
   [6,shiftLabel.split("·")[0].trim()]].forEach(([col,val]) => {
    const cell = ws.getCell(kpiRow.number, col as number);
    cell.value = val as ExcelJS.CellValue;
    cell.fill  = solidFill(C.navyMid);
    cell.font  = { bold:true, size:13, color:{argb:C.gold}, name:"Calibri" };
    cell.alignment = { horizontal:"center", vertical:"middle" };
    cell.border = thinBorder(C.goldDim);
  });
  const kpiLabelRow = ws.addRow(["", "PALLETS", "UNITS", "TONNAGE", "ACTIVE LINES", "SHIFT TYPE"]);
  kpiLabelRow.height = 16;
  for (let c = 2; c <= maxCol; c++) {
    const cell = ws.getCell(kpiLabelRow.number, c);
    cell.fill  = solidFill(C.navy);
    cell.font  = { bold:false, size:8, color:{argb:C.textMuted}, name:"Calibri" };
    cell.alignment = { horizontal:"center", vertical:"middle" };
  }

  addSeparator(ws, maxCol);

  // Per-line summary table
  applyHeaderRow(ws.addRow([]), ["Line","Pallets","Units","Tonnes","vs Last Shift","vs 7-Day Avg"], C.navy, C.gold);

  for (const l of LINES) {
    const c = cur[l];
    const p = prev[l];
    const avg7Pallets = (() => {
      const vals = seven.map(s => s[l]?.pallets || 0).filter(v => v > 0);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
    })();
    const vsLast = pctVs(c.pallets, p.pallets);
    const vs7    = pctVs(c.pallets, avg7Pallets);
    const isZero = c.pallets === 0;
    const bg     = isZero ? "FF1C0000" : (LINES.indexOf(l) % 2 === 0 ? C.navyMid : C.navyLight);
    const tc     = isZero ? C.voidText : C.textLight;

    const row = ws.addRow(["", l, c.pallets, c.units, r2(c.tonnes)+" t", vsLast, vs7]);
    row.height = 20;
    [2,3,4,5,6,7].forEach((col,i) => {
      const cell = ws.getCell(row.number, col);
      cell.fill  = solidFill(bg);
      cell.font  = { bold: i===0, size:10, color:{argb:tc}, name:"Calibri" };
      cell.border = thinBorder();
      cell.alignment = { horizontal: i===0?"left":"center", vertical:"middle" };
    });
    if (isZero) {
      const fl = ws.getCell(row.number, 7);
      fl.value = "⚠ No production";
      fl.font  = { bold:true, size:10, color:{argb:C.amber}, name:"Calibri" };
    }
  }

  addSeparator(ws, maxCol);

  // Shift totals row
  const totRow = ws.addRow(["", "SHIFT TOTAL", totalPallets, totalUnits, totalTonnes+" t",
    pctVs(totalPallets, LINES.reduce((s,l)=>s+prev[l].pallets,0)), ""]);
  totRow.height = 22;
  [2,3,4,5,6].forEach((col,i) => {
    const cell = ws.getCell(totRow.number, col);
    cell.fill  = solidFill(C.gold);
    cell.font  = { bold:true, size:11, color:{argb:C.navy}, name:"Calibri" };
    cell.alignment = { horizontal: i===0?"left":"center", vertical:"middle" };
    cell.border = thinBorder(C.goldDim);
  });

  ws.columns = [
    { width:2 },{ width:18 },{ width:12 },{ width:14 },{ width:14 },{ width:16 },{ width:16 }
  ];
}

// ── TAB 2: By Line ────────────────────────────────────────────────────────────

function buildByLineSheet(
  wb: ExcelJS.Workbook,
  shift: "day"|"night",
  curTickets: TicketRow[],
  prevTickets: TicketRow[],
  skuMeta: Record<string, SkuMeta>,
  shiftEnd: Date
): void {
  const ws = wb.addWorksheet("By Line", {
    properties:{ tabColor:{ argb:"FF3B82F6" } }
  });
  ws.properties.defaultColWidth = 16;

  const maxCol = 9;
  const shiftLabel = shift==="day" ? "Day Shift" : "Night Shift";
  addSheetTitle(ws, "Production — By Line", `${shiftLabel}  ·  ${fmtDateShort(toEAT(shiftEnd))}`, maxCol);

  const cur  = aggregateByLine(curTickets,  skuMeta);
  const prev = aggregateByLine(prevTickets, skuMeta);

  for (const line of LINES) {
    const lagg = cur[line];

    // Line header band
    const lhRow = ws.addRow([`LINE: ${line}`]);
    ws.mergeCells(lhRow.number, 1, lhRow.number, maxCol);
    const lhCell = ws.getCell(lhRow.number, 1);
    lhCell.fill  = solidFill(C.gold);
    lhCell.font  = { bold:true, size:11, color:{argb:C.navy}, name:"Calibri" };
    lhCell.alignment = { horizontal:"left", vertical:"middle", indent:1 };
    lhRow.height = 20;

    if (lagg.pallets === 0) {
      const emptyRow = ws.addRow(["  — No production this shift"]);
      ws.mergeCells(emptyRow.number, 1, emptyRow.number, maxCol);
      const ec = ws.getCell(emptyRow.number, 1);
      ec.fill = solidFill(C.navyMid);
      ec.font = { italic:true, size:10, color:{argb:C.textMuted}, name:"Calibri" };
      emptyRow.height = 18;
      addSeparator(ws, maxCol);
      continue;
    }

    // Column headers
    applyHeaderRow(ws.addRow([]),
      ["SKU","Product Name","Pallets","Units","Tonnes","Cartons Used","Sachets Used","Tablets Used","vs Last Shift"],
      C.navyMid, C.gold
    );

    let linePallets=0, lineUnits=0, lineTonnes=0;

    for (const [sku, agg] of Object.entries(lagg.skus)) {
      const meta     = skuMeta[sku];
      const prevAgg  = prev[line]?.skus[sku];
      const cartons  = agg.units;
      const sachets  = (meta?.sachet_type && meta?.units_per_carton)
        ? agg.units * meta.units_per_carton : 0;
      const tablets  = (meta?.tablet_type && meta?.units_per_carton)
        ? agg.units * meta.units_per_carton : 0;

      linePallets += agg.pallets;
      lineUnits   += agg.units;
      lineTonnes  += agg.tonnes;

      const bg = linePallets % 2 === 0 ? C.navyMid : C.navyLight;
      const row = ws.addRow(["", sku, meta?.product_name||sku,
        agg.pallets, agg.units, r2(agg.tonnes)>0 ? r2(agg.tonnes)+" t" : "—",
        cartons, sachets||"—", tablets||"—",
        prevAgg ? pctVs(agg.pallets, prevAgg.pallets) : "— (new)"
      ]);
      row.height = 18;
      [2,3,4,5,6,7,8,9,10].forEach((col,i) => {
        const cell = ws.getCell(row.number, col);
        cell.fill  = solidFill(bg);
        cell.font  = cellFont(false, 10, C.textLight);
        cell.border = thinBorder();
        cell.alignment = { horizontal: i<2?"left":"center", vertical:"middle" };
      });
    }

    // Line subtotal row
    const stRow = ws.addRow(["", `${line} SUBTOTAL`, "",
      linePallets, lineUnits, r2(lineTonnes)+" t", "", "", "", ""]);
    stRow.height = 20;
    [2,3,4,5,6].forEach((col,i) => {
      const cell = ws.getCell(stRow.number, col);
      cell.fill  = solidFill(C.navyLight);
      cell.font  = { bold:true, size:10, color:{argb:C.gold}, name:"Calibri" };
      cell.alignment = { horizontal: i===0?"left":"center", vertical:"middle" };
      cell.border = thinBorder(C.goldDim);
    });

    addSeparator(ws, maxCol);
  }

  ws.columns = [
    {width:2},{width:22},{width:28},{width:10},{width:10},
    {width:12},{width:13},{width:13},{width:13},{width:14}
  ];
}

// ── TAB 3: SKU Comparisons ────────────────────────────────────────────────────

function buildSkuComparisonsSheet(
  wb: ExcelJS.Workbook,
  shift: "day"|"night",
  curTickets: TicketRow[],
  prevTickets: TicketRow[],
  sevenTickets: TicketRow[][],
  skuMeta: Record<string, SkuMeta>,
  shiftEnd: Date
): void {
  const ws = wb.addWorksheet("SKU Comparisons", {
    properties:{ tabColor:{ argb:"FF8B5CF6" } }
  });
  ws.properties.defaultColWidth = 14;

  const maxCol = 10;
  const shiftLabel = shift==="day" ? "Day Shift" : "Night Shift";
  addSheetTitle(ws, "SKU Comparisons — Per Line", `${shiftLabel}  ·  ${fmtDateShort(toEAT(shiftEnd))}`, maxCol);

  const cur   = aggregateByLine(curTickets,  skuMeta);
  const prev  = aggregateByLine(prevTickets, skuMeta);
  const seven = sevenTickets.map(t => aggregateByLine(t, skuMeta));

  applyHeaderRow(ws.addRow([]),
    ["Line","SKU","Product","This Shift (Pallets)","This Shift (Tonnes)","Last Shift","vs Last","7-Day Avg","vs 7-Day","Subdivision"],
    C.navy, C.gold
  );
  ws.views = [{ state:"frozen", ySplit: ws.rowCount }];

  let rowIdx = 0;
  for (const line of LINES) {
    const lagg = cur[line];
    if (lagg.pallets === 0) continue;

    // Sort SKUs by pallets desc
    const sorted = Object.entries(lagg.skus).sort((a,b) => b[1].pallets - a[1].pallets);

    for (const [sku, agg] of sorted) {
      const meta  = skuMeta[sku];
      const pAgg  = prev[line]?.skus[sku];
      const avg7Pallets = (() => {
        const vals = seven.map(s => s[line]?.skus[sku]?.pallets||0).filter(v=>v>0);
        return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
      })();

      const bg = rowIdx % 2 === 0 ? C.navyMid : C.navyLight;
      const row = ws.addRow(["",
        line, sku, meta?.product_name||sku,
        agg.pallets,
        r2(agg.tonnes)>0 ? r2(agg.tonnes)+" t" : "—",
        pAgg?.pallets ?? "—",
        pAgg ? pctVs(agg.pallets, pAgg.pallets) : "—",
        avg7Pallets || "—",
        avg7Pallets ? pctVs(agg.pallets, avg7Pallets) : "—",
        meta?.subdivision || ""
      ]);
      row.height = 18;
      [2,3,4,5,6,7,8,9,10,11].forEach((col,i) => {
        const cell = ws.getCell(row.number, col);
        cell.fill   = solidFill(bg);
        cell.font   = cellFont(false, 10, C.textLight);
        cell.border = thinBorder();
        cell.alignment = { horizontal: i<3?"left":"center", vertical:"middle" };
        // Colour trend cells
        if (i===6 || i===8) {
          const v = String(cell.value);
          if (v.startsWith("▲")) cell.font = { ...cell.font, color:{argb:C.green} };
          if (v.startsWith("▼")) cell.font = { ...cell.font, color:{argb:C.red} };
        }
      });
      rowIdx++;
    }

    // Line divider
    addSeparator(ws, maxCol);
  }

  ws.columns = [
    {width:2},{width:14},{width:22},{width:28},{width:16},
    {width:14},{width:14},{width:12},{width:13},{width:12},{width:18}
  ];
}

// ── TAB 4: Materials ──────────────────────────────────────────────────────────

function buildMaterialsSheet(
  wb: ExcelJS.Workbook,
  shift: "day"|"night",
  curTickets: TicketRow[],
  skuMeta: Record<string, SkuMeta>,
  shiftEnd: Date
): void {
  const ws = wb.addWorksheet("Materials", {
    properties:{ tabColor:{ argb:"FF10B981" } }
  });
  ws.properties.defaultColWidth = 18;
  const maxCol = 7;
  const shiftLabel = shift==="day" ? "Day Shift" : "Night Shift";
  addSheetTitle(ws, "Materials Consumed", `${shiftLabel}  ·  ${fmtDateShort(toEAT(shiftEnd))}`, maxCol);

  // ── Section 1: Outer Cartons ──
  const secRow1 = ws.addRow(["OUTER CARTONS"]);
  ws.mergeCells(secRow1.number, 1, secRow1.number, maxCol);
  const sc1 = ws.getCell(secRow1.number, 1);
  sc1.fill = solidFill(C.gold); sc1.font = { bold:true, size:10, color:{argb:C.navy}, name:"Calibri" };
  sc1.alignment = { horizontal:"left", vertical:"middle", indent:1 }; secRow1.height = 20;

  applyHeaderRow(ws.addRow([]), ["Line","SKU","Product","Pallets","Cartons Used","UOM"], C.navyMid, C.gold);

  // Aggregate carton usage per line+sku
  const cartonMap: Record<string, Record<string, { pallets:number; cartons:number; uom:string }>> = {};
  for (const t of curTickets) {
    const l = t.production_line?.trim() || "UNKNOWN";
    if (!cartonMap[l]) cartonMap[l] = {};
    if (!cartonMap[l][t.sku]) cartonMap[l][t.sku] = { pallets:0, cartons:0, uom: t.uom };
    cartonMap[l][t.sku].pallets++;
    cartonMap[l][t.sku].cartons += Number(t.qty)||0;
  }
  let cartonTotal = 0;
  let rowIdx = 0;
  for (const line of LINES) {
    for (const [sku, d] of Object.entries(cartonMap[line]||{})) {
      cartonTotal += d.cartons;
      const bg = rowIdx%2===0 ? C.navyMid : C.navyLight;
      const row = ws.addRow(["", line, sku, skuMeta[sku]?.product_name||sku, d.pallets, d.cartons, d.uom]);
      row.height = 18;
      [2,3,4,5,6,7].forEach((col,i) => {
        const cell = ws.getCell(row.number, col);
        cell.fill = solidFill(bg); cell.font = cellFont(false,10,C.textLight);
        cell.border = thinBorder();
        cell.alignment = { horizontal: i<3?"left":"center", vertical:"middle" };
      }); rowIdx++;
    }
  }
  const ctTot = ws.addRow(["", "TOTAL","","", "", cartonTotal, ""]);
  ctTot.height=20;
  [2,3,4,5,6].forEach(col=>{
    const cell=ws.getCell(ctTot.number,col);
    cell.fill=solidFill(C.navyLight); cell.font={bold:true,size:10,color:{argb:C.gold},name:"Calibri"};
    cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
  });

  addSeparator(ws, maxCol);

  // ── Section 2: Sachets ──
  const secRow2 = ws.addRow(["SACHETS (Inner Units)"]);
  ws.mergeCells(secRow2.number, 1, secRow2.number, maxCol);
  const sc2 = ws.getCell(secRow2.number, 1);
  sc2.fill = solidFill(C.gold); sc2.font = { bold:true, size:10, color:{argb:C.navy}, name:"Calibri" };
  sc2.alignment = { horizontal:"left", vertical:"middle", indent:1 }; secRow2.height = 20;

  applyHeaderRow(ws.addRow([]), ["Line","SKU","Product","Sachet Type","Pallets","Sachets Used"], C.navyMid, C.gold);
  let sachetTotal = 0; rowIdx = 0;
  for (const t of curTickets) {
    const meta = skuMeta[t.sku];
    if (!meta?.sachet_type || !meta?.units_per_carton) continue;
    const used = (Number(t.qty)||0) * meta.units_per_carton;
    sachetTotal += used;
    const bg = rowIdx%2===0 ? C.navyMid : C.navyLight;
    const row = ws.addRow(["", t.production_line, t.sku, meta.product_name, meta.sachet_type, 1, used]);
    row.height = 18;
    [2,3,4,5,6,7].forEach((col,i) => {
      const cell=ws.getCell(row.number,col);
      cell.fill=solidFill(bg); cell.font=cellFont(false,10,C.textLight);
      cell.border=thinBorder();
      cell.alignment={horizontal:i<4?"left":"center",vertical:"middle"};
    }); rowIdx++;
  }
  if (sachetTotal === 0) {
    const nr=ws.addRow(["  — No sachet products this shift"]);
    ws.mergeCells(nr.number,1,nr.number,maxCol);
    const nc=ws.getCell(nr.number,1);
    nc.fill=solidFill(C.navyMid); nc.font={italic:true,size:10,color:{argb:C.textMuted},name:"Calibri"};
  } else {
    const sTot=ws.addRow(["","TOTAL","","","",sachetTotal, ""]);
    [2,3,4,5,6].forEach(col=>{
      const cell=ws.getCell(sTot.number,col);
      cell.fill=solidFill(C.navyLight); cell.font={bold:true,size:10,color:{argb:C.gold},name:"Calibri"};
      cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
    });
  }

  addSeparator(ws, maxCol);

  // ── Section 3: Tablets ──
  const secRow3 = ws.addRow(["TABLETS"]);
  ws.mergeCells(secRow3.number, 1, secRow3.number, maxCol);
  const sc3 = ws.getCell(secRow3.number, 1);
  sc3.fill = solidFill(C.gold); sc3.font = { bold:true, size:10, color:{argb:C.navy}, name:"Calibri" };
  sc3.alignment = { horizontal:"left", vertical:"middle", indent:1 }; secRow3.height = 20;

  applyHeaderRow(ws.addRow([]), ["Line","SKU","Product","Tablet Type","Pallets","Tablets Used"], C.navyMid, C.gold);
  let tabletTotal = 0; rowIdx = 0;
  for (const t of curTickets) {
    const meta = skuMeta[t.sku];
    if (!meta?.tablet_type || !meta?.units_per_carton) continue;
    const used = (Number(t.qty)||0) * meta.units_per_carton;
    tabletTotal += used;
    const bg = rowIdx%2===0 ? C.navyMid : C.navyLight;
    const row = ws.addRow(["", t.production_line, t.sku, meta.product_name, meta.tablet_type, 1, used]);
    row.height = 18;
    [2,3,4,5,6,7].forEach((col,i) => {
      const cell=ws.getCell(row.number,col);
      cell.fill=solidFill(bg); cell.font=cellFont(false,10,C.textLight);
      cell.border=thinBorder();
      cell.alignment={horizontal:i<4?"left":"center",vertical:"middle"};
    }); rowIdx++;
  }
  if (tabletTotal === 0) {
    const nr=ws.addRow(["  — No tablet products this shift"]);
    ws.mergeCells(nr.number,1,nr.number,maxCol);
    const nc=ws.getCell(nr.number,1);
    nc.fill=solidFill(C.navyMid); nc.font={italic:true,size:10,color:{argb:C.textMuted},name:"Calibri"};
  } else {
    const tTot=ws.addRow(["","TOTAL","","","",tabletTotal,""]);
    [2,3,4,5,6].forEach(col=>{
      const cell=ws.getCell(tTot.number,col);
      cell.fill=solidFill(C.navyLight); cell.font={bold:true,size:10,color:{argb:C.gold},name:"Calibri"};
      cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
    });
  }

  ws.columns = [{width:2},{width:16},{width:22},{width:28},{width:22},{width:10},{width:14},{width:10}];
}

// ── TAB 5: Hourly ─────────────────────────────────────────────────────────────

function buildHourlySheet(
  wb: ExcelJS.Workbook,
  shift: "day"|"night",
  curTickets: TicketRow[],
  skuMeta: Record<string, SkuMeta>,
  shiftEnd: Date
): void {
  const ws = wb.addWorksheet("Hourly", {
    properties:{ tabColor:{ argb:"FFF59E0B" } }
  });
  ws.properties.defaultColWidth = 13;
  const shiftLabel = shift==="day" ? "Day Shift" : "Night Shift";
  const hours = shift==="day"
    ? [7,8,9,10,11,12,13,14,15,16,17,18]
    : [19,20,21,22,23,0,1,2,3,4,5,6];

  addSheetTitle(ws, "Hourly Breakdown", `${shiftLabel}  ·  ${fmtDateShort(toEAT(shiftEnd))}`, LINES.length+3);

  // Header: Hour | Total | Line1 | Line2 | ...
  applyHeaderRow(ws.addRow([]), ["Hour (EAT)", "Total Pallets", ...LINES, "Tonnage"], C.navy, C.gold);
  ws.views = [{ state:"frozen", ySplit: ws.rowCount }];

  // Build hour → line count map
  const hrLine: Record<number, Record<string,number>> = {};
  const hrTonnes: Record<number, number> = {};
  for (const t of curTickets) {
    const eatT = toEAT(new Date(t.created_at));
    const h = eatT.getUTCHours();
    if (!hrLine[h]) hrLine[h] = {};
    hrLine[h][t.production_line?.trim()||"UNKNOWN"] =
      (hrLine[h][t.production_line?.trim()||"UNKNOWN"]||0) + 1;
    const meta = skuMeta[t.sku];
    hrTonnes[h] = (hrTonnes[h]||0) + calcTonnes(t, meta);
  }

  const totals = hours.map(h => Object.values(hrLine[h]||{}).reduce((s,v)=>s+v,0));
  const maxVal = Math.max(...totals, 1);

  totals.forEach((tot, i) => {
    const h = hours[i];
    const isPeak = tot === Math.max(...totals) && tot > 0;
    const bg = tot === 0 ? "FF1C0B00" :
               isPeak    ? "FF1C2A00" :
               i%2===0   ? C.navyMid : C.navyLight;

    const label = `${String(h).padStart(2,"0")}:00`;
    const lineCounts = LINES.map(l => hrLine[h]?.[l]||0);
    const row = ws.addRow(["", label, tot, ...lineCounts, r2(hrTonnes[h]||0)+" t"]);
    row.height = 20;

    const colsCount = 2 + 1 + LINES.length + 1;
    for (let c = 2; c <= colsCount; c++) {
      const cell = ws.getCell(row.number, c);
      cell.fill  = solidFill(bg);
      cell.font  = {
        bold: isPeak || tot===0,
        size: 10,
        color: { argb: tot===0 ? C.voidText : isPeak ? C.gold : C.textLight },
        name: "Calibri"
      };
      cell.border = thinBorder();
      cell.alignment = { horizontal: c===2?"left":"center", vertical:"middle" };
    }

    // Mini bar in the hour label column
    if (tot > 0) {
      const bars = Math.round((tot / maxVal) * 10);
      const barStr = "█".repeat(bars) + "░".repeat(10 - bars);
      const barCell = ws.getCell(row.number, 2);
      barCell.value = `${label}  ${barStr}`;
    }
  });

  // Totals row
  const colTotals = LINES.map(l =>
    hours.reduce((s,h) => s+(hrLine[h]?.[l]||0), 0)
  );
  const shiftTotal = totals.reduce((s,v)=>s+v,0);
  const shiftTonnes = r2(Object.values(hrTonnes).reduce((s,v)=>s+v,0));
  const totRow = ws.addRow(["","SHIFT TOTAL", shiftTotal, ...colTotals, shiftTonnes+" t"]);
  totRow.height = 22;
  for (let c=2; c<=2+1+LINES.length+1; c++) {
    const cell = ws.getCell(totRow.number,c);
    cell.fill  = solidFill(C.gold);
    cell.font  = {bold:true,size:11,color:{argb:C.navy},name:"Calibri"};
    cell.alignment={horizontal:c===2?"left":"center",vertical:"middle"};
    cell.border=thinBorder(C.goldDim);
  }

  ws.columns = [{width:2},{width:22},{width:14}, ...LINES.map(()=>({width:12})),{width:12}];
}

// ── TAB 6: Trend (7-Day) ──────────────────────────────────────────────────────

function buildTrendSheet(
  wb: ExcelJS.Workbook,
  shift: "day"|"night",
  curTickets: TicketRow[],
  sevenTickets: TicketRow[][],
  sevenDates: Date[],
  skuMeta: Record<string, SkuMeta>,
  shiftEnd: Date
): void {
  const ws = wb.addWorksheet("Trend (7-Day)", {
    properties:{ tabColor:{ argb:"FF06B6D4" } }
  });
  ws.properties.defaultColWidth = 15;
  const shiftLabel = shift==="day" ? "Day Shift" : "Night Shift";
  const maxCol = LINES.length + 4;

  addSheetTitle(ws, "7-Day Trend Analysis", `${shiftLabel}  ·  last 7 same-shift occurrences`, maxCol);
  applyHeaderRow(ws.addRow([]),
    ["Shift Date","Total Pallets","Total Tonnes", ...LINES, "Best Line"],
    C.navy, C.gold
  );
  ws.views = [{ state:"frozen", ySplit: ws.rowCount }];

  const allSeries = [
    { tickets: curTickets, date: toEAT(shiftEnd), isCurrent: true },
    ...sevenTickets.map((t,i) => ({ tickets:t, date: toEAT(sevenDates[i]), isCurrent:false }))
  ];

  allSeries.forEach((s, idx) => {
    const agg   = aggregateByLine(s.tickets, skuMeta);
    const total = LINES.reduce((sum,l) => sum + agg[l].pallets, 0);
    const tonnes = r2(LINES.reduce((sum,l) => sum + agg[l].tonnes, 0));
    const best  = LINES.reduce((b,l) => agg[l].pallets > agg[b].pallets ? l : b, LINES[0]);
    const lineCounts = LINES.map(l => agg[l].pallets);

    const bg = s.isCurrent ? "FF1C2A00" : idx%2===0 ? C.navyMid : C.navyLight;
    const tc = s.isCurrent ? C.gold     : C.textLight;

    const row = ws.addRow(["",
      fmtDateShort(s.date) + (s.isCurrent ? " ← TODAY" : ""),
      total, tonnes+" t", ...lineCounts, best
    ]);
    row.height = 20;
    for (let c=2; c<=maxCol+1; c++) {
      const cell=ws.getCell(row.number,c);
      cell.fill=solidFill(bg);
      cell.font={bold:s.isCurrent,size:10,color:{argb:tc},name:"Calibri"};
      cell.border=thinBorder();
      cell.alignment={horizontal:c===2?"left":"center",vertical:"middle"};
    }
  });

  ws.columns=[{width:2},{width:22},{width:14},{width:14},...LINES.map(()=>({width:12})),{width:16}];
}

// ── TAB 7: Audit Trail (Voided) ───────────────────────────────────────────────

function buildAuditTrailSheet(
  wb: ExcelJS.Workbook,
  shift: "day"|"night",
  allTickets: TicketRow[],   // includes voided
  skuMeta: Record<string, SkuMeta>,
  shiftEnd: Date
): void {
  const ws = wb.addWorksheet("Audit Trail", {
    properties:{ tabColor:{ argb:C.red } }
  });
  ws.properties.defaultColWidth = 16;
  const maxCol = 11;
  const shiftLabel = shift==="day" ? "Day Shift" : "Night Shift";

  addSheetTitle(ws, "Audit Trail — Voided Tickets", `${shiftLabel}  ·  ${fmtDateShort(toEAT(shiftEnd))}`, maxCol);

  const voided = allTickets.filter(t => t.voided);

  if (voided.length === 0) {
    const nr = ws.addRow(["  ✓ No voided tickets this shift — clean run"]);
    ws.mergeCells(nr.number, 1, nr.number, maxCol);
    const nc = ws.getCell(nr.number, 1);
    nc.fill = solidFill(C.navyMid);
    nc.font = { bold:true, italic:false, size:11, color:{argb:C.green}, name:"Calibri" };
    nc.alignment = { horizontal:"center", vertical:"middle" };
    nr.height = 28;
    ws.columns = [{width:2},...Array(maxCol-1).fill({width:18})];
    return;
  }

  // Warning banner
  const warnRow = ws.addRow([`⚠  ${voided.length} voided ticket${voided.length!==1?"s":""} this shift — EXCLUDED from all other tabs`]);
  ws.mergeCells(warnRow.number, 1, warnRow.number, maxCol);
  const wc = ws.getCell(warnRow.number, 1);
  wc.fill = solidFill(C.voidRed);
  wc.font = { bold:true, size:11, color:{argb:C.voidText}, name:"Calibri" };
  wc.alignment = { horizontal:"center", vertical:"middle" };
  warnRow.height = 26;

  ws.addRow([]);

  applyHeaderRow(ws.addRow([]),
    ["Ticket Serial","Line","SKU","Product","Qty","UOM","Pallet Color","Clerk","Voided By","Void Reason","Voided At (EAT)"],
    C.voidRed, C.voidText
  );

  voided.forEach((t,i) => {
    const meta = skuMeta[t.sku];
    const voidedAtEAT = t.voided_at ? fmtTime(toEAT(new Date(t.voided_at))) + " " + fmtDateShort(toEAT(new Date(t.voided_at))) : "—";
    const bg = i%2===0 ? "FF2D0A0A" : "FF3D1212";

    const row = ws.addRow(["",
      t.serial, t.production_line, t.sku, meta?.product_name||t.sku,
      t.qty, t.uom, t.pallet_color||"—",
      t.clerk_name||"—", t.voided_by||"—", t.voided_reason||"—", voidedAtEAT
    ]);
    row.height = 18;
    [2,3,4,5,6,7,8,9,10,11,12].forEach((col,j) => {
      const cell = ws.getCell(row.number, col);
      cell.fill  = solidFill(bg);
      cell.font  = cellFont(false, 10, C.voidText);
      cell.border = thinBorder("FF7F1D1D");
      cell.alignment = { horizontal: j<4?"left":"center", vertical:"middle" };
    });
  });

  ws.columns=[{width:2},{width:20},{width:14},{width:22},{width:28},
    {width:8},{width:8},{width:14},{width:16},{width:16},{width:30},{width:22}];
}

// ── WhatsApp helpers ──────────────────────────────────────────────────────────

function getRecipients(): string[] {
  const nums: string[] = [];
  for (let i=1; i<=20; i++) {
    const v = Deno.env.get(`WHATSAPP_RECIPIENT_${i}`);
    if (v) nums.push(v); else break;
  }
  return nums;
}

async function sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const params = new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body });
  if (mediaUrl) params.append("MediaUrl", mediaUrl);
  const res = await fetch(url, {
    method:"POST",
    headers:{
      "Authorization":"Basic "+btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      "Content-Type":"application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
}

// ── Upload to Supabase Storage ────────────────────────────────────────────────

async function uploadExcel(
  sb: ReturnType<typeof createClient>,
  buffer: ArrayBuffer,
  fileName: string
): Promise<string> {
  const { error } = await sb.storage
    .from("eos-reports")
    .upload(fileName, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true
    });
  if (error) throw error;

  const { data } = sb.storage.from("eos-reports").getPublicUrl(fileName);
  return data.publicUrl;
}

// ── Main build orchestrator ───────────────────────────────────────────────────

async function buildReport(
  sb: ReturnType<typeof createClient>,
  shift: "day"|"night"
): Promise<void> {
  const now = eatNow();
  const [curStart, curEnd] = shiftBounds(shift, 0, now);
  const [prevStart, prevEnd] = shiftBounds(shift, -1, now);
  const sevenWindows: [Date, Date][] = [];
  const sevenDates:  Date[]          = [];
  for (let d=1; d<=7; d++) {
    const [s,e] = shiftBounds(shift, -d, now);
    sevenWindows.push([s,e]);
    sevenDates.push(e);
  }

  // Fetch data in parallel
  const [
    curTickets,
    curTicketsAll,   // includes voided — for Audit Trail
    prevTickets,
    skuMeta
  ] = await Promise.all([
    fetchTickets(sb, curStart, curEnd, false),
    fetchTickets(sb, curStart, curEnd, true),
    fetchTickets(sb, prevStart, prevEnd, false),
    fetchSkuMeta(sb)
  ]);

  const sevenTickets = await Promise.all(
    sevenWindows.map(([s,e]) => fetchTickets(sb, s, e, false))
  );

  // Build workbook
  const wb = new ExcelJS.Workbook();
  wb.creator  = "RetiFlux™ · NexGridCore DataLabs";
  wb.created  = new Date();
  wb.modified = new Date();

  buildSummarySheet(wb, shift, curTickets, prevTickets, sevenTickets, skuMeta, curStart, curEnd);
  buildByLineSheet(wb, shift, curTickets, prevTickets, skuMeta, curEnd);
  buildSkuComparisonsSheet(wb, shift, curTickets, prevTickets, sevenTickets, skuMeta, curEnd);
  buildMaterialsSheet(wb, shift, curTickets, skuMeta, curEnd);
  buildHourlySheet(wb, shift, curTickets, skuMeta, curEnd);
  buildTrendSheet(wb, shift, curTickets, sevenTickets, sevenDates, skuMeta, curEnd);
  buildAuditTrailSheet(wb, shift, curTicketsAll, skuMeta, curEnd);

  // Serialize to buffer
  const buffer = await wb.xlsx.writeBuffer();

  // Build filename
  const shiftTag = shift === "day" ? "DayShift" : "NightShift";
  const dateTag  = fmtDateFile(toEAT(curEnd));
  const fileName = `RetiFlux_EOS_${shiftTag}_${dateTag}.xlsx`;

  // Upload to storage
  const publicUrl = await uploadExcel(sb, buffer as ArrayBuffer, fileName);

  // WhatsApp notification
  const shiftLabel = shift==="day" ? "Day Shift ☀" : "Night Shift 🌙";
  const totalPallets = curTickets.length;
  const totalTonnes  = r2(curTickets.reduce((s,t) => {
    const meta = skuMeta[t.sku];
    return s + calcTonnes(t, meta);
  }, 0));
  const voidedCount = curTicketsAll.filter(t=>t.voided).length;

  const msg =
    `📊 RetiFlux™ · EOS Excel Report\n` +
    `${shiftLabel} · ${fmtDateShort(toEAT(curEnd))}\n\n` +
    `📦 ${totalPallets} pallets  ·  ${totalTonnes} tonnes\n` +
    (voidedCount > 0 ? `⚠ ${voidedCount} voided ticket${voidedCount!==1?"s":""} in Audit Trail\n\n` : `✅ No voided tickets\n\n`) +
    `📥 Download Report:\n${publicUrl}\n\n` +
    `Tabs: Summary · By Line · SKU Comparisons · Materials · Hourly · Trend · Audit Trail\n` +
    `RetiFlux™ · NexGridCore DataLabs`;

  const recipients = getRecipients();
  await Promise.all(recipients.map(r => sendWhatsApp(r, msg)));
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers:{ "Access-Control-Allow-Origin":"*" } });
  }
  try {
    const body  = await req.json() as { shift?: string; mock_now?: string };
    const shift = ((body.shift || "day") as "day"|"night");
    _mockNowUtc = body.mock_now ? new Date(body.mock_now) : null;

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    await buildReport(sb, shift);

    return new Response(JSON.stringify({ ok:true, shift, sent_to: getRecipients().length }),
      { headers:{ "Content-Type":"application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok:false, error: String(e) }),
      { status:500, headers:{ "Content-Type":"application/json" } });
  }
});
