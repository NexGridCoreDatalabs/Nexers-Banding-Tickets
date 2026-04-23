// RetiFlux™ — End-of-Day Excel Report Generator
// Aggregates both Day Shift (07:00–19:00 EAT) and Night Shift (19:00–07:00 EAT)
// for a single calendar date into a unified daily production report.
//
// Invoke via HTTP POST:
//   {}                                      — Auto: reports on yesterday (use at 07:00 EAT cron)
//   { "date": "2026-04-22" }                — Explicit calendar date
//   { "mock_now": "2026-04-23T04:00:00Z" }  — Override clock for testing
//
// Tabs generated:
//   1. Daily Overview   — Combined KPIs, Day vs Night split, top lines
//   2. By Line          — Per-line with Day | Night | Total columns
//   3. SKU Breakdown    — Combined SKU output for the full day
//   4. 7-Day Trend      — 7 calendar days of combined output (full day, not per-shift)
//
// Auto-deploy: add to cron at 04:00 UTC (= 07:00 EAT) alongside Night Shift EOS

// @deno-types="https://esm.sh/exceljs@4.4.0/index.d.ts"
import ExcelJS from "https://esm.sh/exceljs@4.4.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM  = Deno.env.get("TWILIO_WHATSAPP_FROM")!;

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

// ── Brand palette ─────────────────────────────────────────────────────────────
const C = {
  navy:      "FF0F172A",
  navyMid:   "FF1E293B",
  navyLight: "FF334155",
  gold:      "FFF0C040",
  goldDim:   "FFCA9E15",
  white:     "FFFFFFFF",
  textLight: "FFE2E8F0",
  textMuted: "FF94A3B8",
  red:       "FFEF4444",
  green:     "FF22C55E",
  amber:     "FFF59E0B",
  teal:      "FF06B6D4",
  purple:    "FF8B5CF6",
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
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}
function fmtDateFile(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function r2(n: number): number { return Math.round(n*100)/100; }
function r5(n: number): number { return Math.round(n*100000)/100000; }
function pctStr(n: number): string { return `${r2(n)}%`; }
function pctVs(cur: number, prev: number): string {
  if (!prev) return "—";
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 1) return "stable";
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(Math.round(d))}%`;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface TicketRow {
  id:              string;
  serial:          string;
  production_line: string;
  sku:             string;
  qty:             number;
  uom:             string;
  pallet_color:    string | null;
  group_leader:    string | null;
  created_at:      string;
  voided:          boolean;
}
interface SkuMeta {
  sku:                    string;
  product_name:           string;
  units_per_carton:       number | null;
  net_weight_kg_per_unit: number | null;
  sachet_type:            string | null;
  tablet_type:            string | null;
  subdivision:            string;
}
interface LineAgg {
  pallets: number;
  units:   number;
  tonnes:  number;
  skus:    Record<string, { pallets: number; units: number; tonnes: number }>;
}
interface DailyAgg {
  day:   Record<string, LineAgg>;
  night: Record<string, LineAgg>;
}

// ── Data fetch ────────────────────────────────────────────────────────────────
async function fetchTickets(
  sb: ReturnType<typeof createClient>,
  from: Date, to: Date
): Promise<TicketRow[]> {
  const { data, error } = await sb.from("tickets")
    .select("id,serial,production_line,sku,qty,uom,pallet_color,group_leader,created_at,voided")
    .gte("created_at", from.toISOString())
    .lt("created_at",  to.toISOString())
    .eq("voided", false)
    .not("production_line", "is", null);
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

// ── Tonnage ───────────────────────────────────────────────────────────────────
function calcTonnes(ticket: TicketRow, meta: SkuMeta | undefined): number {
  if (!meta?.net_weight_kg_per_unit || !meta?.units_per_carton) return 0;
  return (ticket.qty * meta.units_per_carton * meta.net_weight_kg_per_unit) / 1000;
}

// ── Aggregation ───────────────────────────────────────────────────────────────
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
    const meta   = skuMeta[t.sku];
    const tonnes = calcTonnes(t, meta);
    result[l].pallets++;
    result[l].units  += Number(t.qty) || 0;
    result[l].tonnes  = r5(result[l].tonnes + tonnes);
    if (!result[l].skus[t.sku]) result[l].skus[t.sku] = { pallets:0, units:0, tonnes:0 };
    result[l].skus[t.sku].pallets++;
    result[l].skus[t.sku].units  += Number(t.qty) || 0;
    result[l].skus[t.sku].tonnes  = r5(result[l].skus[t.sku].tonnes + tonnes);
  }
  return result;
}

function combinedAgg(
  day: Record<string, LineAgg>,
  night: Record<string, LineAgg>
): Record<string, LineAgg> {
  const result: Record<string, LineAgg> = {};
  for (const l of LINES) {
    const d = day[l]   ?? { pallets:0, units:0, tonnes:0, skus:{} };
    const n = night[l] ?? { pallets:0, units:0, tonnes:0, skus:{} };
    const skus: Record<string, { pallets:number; units:number; tonnes:number }> = {};
    for (const sku of new Set([...Object.keys(d.skus), ...Object.keys(n.skus)])) {
      const ds = d.skus[sku] ?? { pallets:0, units:0, tonnes:0 };
      const ns = n.skus[sku] ?? { pallets:0, units:0, tonnes:0 };
      skus[sku] = {
        pallets: ds.pallets + ns.pallets,
        units:   ds.units   + ns.units,
        tonnes:  r5(ds.tonnes + ns.tonnes),
      };
    }
    result[l] = {
      pallets: d.pallets + n.pallets,
      units:   d.units   + n.units,
      tonnes:  r5(d.tonnes + n.tonnes),
      skus,
    };
  }
  return result;
}

// Calendar-day shift windows (UTC).
// "Date" here means the date in EAT that the factory recognises as the day:
//   Day shift:   07:00–19:00 EAT = 04:00–16:00 UTC on the same date
//   Night shift: 19:00 EAT date  → 07:00 EAT date+1
//              = 16:00 UTC date  → 04:00 UTC date+1
function dayShiftBounds(utcDate: Date): [Date, Date] {
  const base = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate()));
  return [new Date(base.getTime() + 4*3600000), new Date(base.getTime() + 16*3600000)];
}
function nightShiftBounds(utcDate: Date): [Date, Date] {
  const base = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate()));
  return [new Date(base.getTime() + 16*3600000), new Date(base.getTime() + 28*3600000)]; // +28h = +4h next day
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function solidFill(color: string): ExcelJS.Fill {
  return { type:"pattern", pattern:"solid", fgColor:{ argb: color } };
}
function thinBorder(color = "FF334155"): Partial<ExcelJS.Borders> {
  const s: ExcelJS.BorderStyle = "thin";
  const side = { style:s, color:{ argb: color } };
  return { top:side, bottom:side, left:side, right:side };
}
function cellFont(bold=false, size=10, color=C.textLight): Partial<ExcelJS.Font> {
  return { bold, size, color:{ argb: color }, name:"Consolas" };
}
function addSheetTitle(ws: ExcelJS.Worksheet, title: string, subtitle: string, maxCol: number) {
  const r1 = ws.addRow([title]);
  ws.mergeCells(r1.number, 1, r1.number, maxCol);
  const c1 = ws.getCell(r1.number, 1);
  c1.fill = solidFill(C.navy); c1.font = { bold:true, size:14, color:{argb:C.gold}, name:"Consolas" };
  c1.alignment = { horizontal:"center", vertical:"middle" }; r1.height = 32;
  const r2 = ws.addRow([subtitle]);
  ws.mergeCells(r2.number, 1, r2.number, maxCol);
  const c2 = ws.getCell(r2.number, 1);
  c2.fill = solidFill(C.navyMid); c2.font = { size:10, color:{argb:C.textMuted}, name:"Consolas" };
  c2.alignment = { horizontal:"center", vertical:"middle" }; r2.height = 20;
  ws.addRow([]);
}
function addSeparator(ws: ExcelJS.Worksheet, maxCol: number) {
  const row = ws.addRow([]);
  row.height = 5;
  for (let c = 1; c <= maxCol; c++) ws.getCell(row.number, c).fill = solidFill(C.navy);
}
function sectionHeader(ws: ExcelJS.Worksheet, label: string, maxCol: number) {
  const row = ws.addRow([label]);
  ws.mergeCells(row.number, 1, row.number, maxCol);
  const cell = ws.getCell(row.number, 1);
  cell.fill = solidFill(C.navy);
  cell.font = { bold:true, size:11, color:{argb:C.gold}, name:"Consolas" };
  cell.alignment = { horizontal:"left", vertical:"middle", indent:1 };
  row.height = 24;
}
function applyHeaderRow(row: ExcelJS.Row, cols: string[], bg=C.navy, fg=C.gold) {
  row.values = ["", ...cols];
  row.eachCell((cell, col) => {
    if (col === 1) return;
    cell.fill = solidFill(bg);
    cell.font = cellFont(true, 10, fg);
    cell.border = thinBorder(C.goldDim);
    cell.alignment = { horizontal:"center", vertical:"middle", wrapText:true };
  });
  row.height = 22;
}
function styleDataRow(
  ws: ExcelJS.Worksheet, rowNum: number, cols: number[],
  bg: string, fg=C.textLight, bold=false
) {
  cols.forEach(c => {
    const cell = ws.getCell(rowNum, c);
    cell.fill   = solidFill(bg);
    cell.font   = cellFont(bold, 10, fg);
    cell.border = thinBorder();
    cell.alignment = { horizontal:"center", vertical:"middle" };
  });
}

// ── WhatsApp delivery ─────────────────────────────────────────────────────────
function getRecipients(): string[] {
  const nums: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const v = Deno.env.get(`WHATSAPP_RECIPIENT_${i}`);
    if (v) nums.push(v);
  }
  return nums;
}
async function sendWhatsApp(to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body }).toString(),
  });
  if (!res.ok) console.error("WhatsApp send failed:", await res.text());
}
async function broadcast(message: string): Promise<void> {
  await Promise.all(getRecipients().map(r => sendWhatsApp(r, message)));
}

// ── TAB 1: Daily Overview ─────────────────────────────────────────────────────
function buildDailyOverviewSheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  agg: DailyAgg,
  skuMeta: Record<string, SkuMeta>,
  prevAgg: DailyAgg
): void {
  const ws = wb.addWorksheet("Daily Overview", {
    properties:{ tabColor:{ argb:C.gold } },
    views:[{ state:"frozen", ySplit:3 }]
  });
  ws.properties.defaultColWidth = 16;
  const MAX = 10;

  const dateLabel = fmtDateFull(dateEAT);
  addSheetTitle(ws, "RetiFlux™  ·  End-of-Day Production Report", `Full Day  ·  ${dateLabel}`, MAX);

  const dayAgg   = agg.day;
  const nightAgg = agg.night;
  const combined = combinedAgg(dayAgg, nightAgg);

  const dayPallets   = LINES.reduce((s,l) => s + dayAgg[l].pallets,   0);
  const nightPallets = LINES.reduce((s,l) => s + nightAgg[l].pallets, 0);
  const totalPallets = dayPallets + nightPallets;
  const dayTonnes    = r5(LINES.reduce((s,l) => s + dayAgg[l].tonnes,   0));
  const nightTonnes  = r5(LINES.reduce((s,l) => s + nightAgg[l].tonnes, 0));
  const totalTonnes  = r5(dayTonnes + nightTonnes);
  const dayUnits     = LINES.reduce((s,l) => s + dayAgg[l].units,   0);
  const nightUnits   = LINES.reduce((s,l) => s + nightAgg[l].units, 0);
  const totalUnits   = dayUnits + nightUnits;
  const dayLines     = LINES.filter(l => dayAgg[l].pallets   > 0).length;
  const nightLines   = LINES.filter(l => nightAgg[l].pallets > 0).length;

  const prevDayPallets   = LINES.reduce((s,l) => s + (prevAgg.day[l]?.pallets   || 0), 0);
  const prevNightPallets = LINES.reduce((s,l) => s + (prevAgg.night[l]?.pallets || 0), 0);
  const prevTotal        = prevDayPallets + prevNightPallets;
  const prevTonnes       = r5(LINES.reduce((s,l) => s + (prevAgg.day[l]?.tonnes||0) + (prevAgg.night[l]?.tonnes||0), 0));

  // ── KPI row ──────────────────────────────────────────────────────────────────
  sectionHeader(ws, "  DAILY TOTALS (Both Shifts Combined)", MAX);
  const kpiLabels = ws.addRow(["","Total Pallets","Total Units","Total Tonnes","vs Prev Day","Day Pallets","Night Pallets","Day Lines Active","Night Lines Active",""]);
  kpiLabels.height = 20;
  [2,3,4,5,6,7,8,9].forEach(c => {
    const cell = ws.getCell(kpiLabels.number, c);
    cell.fill = solidFill(C.navyMid); cell.font = cellFont(true, 9, C.textMuted);
    cell.alignment = { horizontal:"center", vertical:"middle" };
  });

  const kpiVals = ws.addRow(["",
    totalPallets, totalUnits.toLocaleString(), `${totalTonnes} t`,
    pctVs(totalPallets, prevTotal),
    dayPallets, nightPallets,
    `${dayLines} / ${LINES.length}`, `${nightLines} / ${LINES.length}`, ""
  ]);
  kpiVals.height = 28;
  [2,3,4,5,6,7,8,9].forEach(c => {
    const cell = ws.getCell(kpiVals.number, c);
    cell.fill = solidFill(C.navy);
    cell.font = { bold:true, size:13, color:{argb:c===5 ? C.amber : C.gold}, name:"Consolas" };
    cell.alignment = { horizontal:"center", vertical:"middle" };
    cell.border = thinBorder(C.goldDim);
  });

  addSeparator(ws, MAX);

  // ── Per-line breakdown ────────────────────────────────────────────────────────
  sectionHeader(ws, "  PRODUCTION BY LINE  ·  Day | Night | Total", MAX);
  applyHeaderRow(ws.addRow([]),
    ["Line","☀ Day Pallets","☀ Day Tonnes","🌙 Night Pallets","🌙 Night Tonnes","Total Pallets","Total Tonnes","vs Prev Day","Top SKU"],
    C.navyMid, C.gold
  );

  LINES.forEach((line, idx) => {
    const d = dayAgg[line];
    const n = nightAgg[line];
    const tot = combined[line];
    const bg = idx % 2 === 0 ? C.navyMid : C.navyLight;

    // Top SKU for the day (combined)
    let topSku = "—";
    let topPallets = 0;
    for (const [sku, s] of Object.entries(tot.skus)) {
      if (s.pallets > topPallets) { topPallets = s.pallets; topSku = skuMeta[sku]?.product_name || sku; }
    }

    // Prev day combined for this line
    const prevLinePallets = (prevAgg.day[line]?.pallets||0) + (prevAgg.night[line]?.pallets||0);

    const row = ws.addRow(["",
      line,
      d.pallets || "—", d.pallets ? `${r5(d.tonnes)} t` : "—",
      n.pallets || "—", n.pallets ? `${r5(n.tonnes)} t` : "—",
      tot.pallets || "—", tot.pallets ? `${r5(tot.tonnes)} t` : "—",
      pctVs(tot.pallets, prevLinePallets),
      topSku
    ]);
    row.height = 18;
    const fgCol = tot.pallets === 0 ? C.textMuted : C.textLight;
    [2,3,4,5,6,7,8,9,10].forEach(c => {
      const cell = ws.getCell(row.number, c);
      cell.fill = solidFill(bg);
      cell.font = cellFont(c === 2 || c === 6 || c === 7, 10, c===8 ? C.amber : fgCol);
      cell.border = thinBorder();
      cell.alignment = { horizontal: c === 2 || c === 10 ? "left" : "center", vertical:"middle" };
    });
    // Colour day/night sub-columns distinctly
    [3,4].forEach(c => ws.getCell(row.number, c).font = cellFont(false, 10, C.amber));
    [5,6].forEach(c => ws.getCell(row.number, c).font = cellFont(false, 10, C.teal));
  });

  // Totals footer
  const footRow = ws.addRow(["","TOTAL","","","","","",
    totalPallets, `${totalTonnes} t`,
    pctVs(totalPallets, prevTotal)
  ]);
  footRow.height = 22;
  [2,3,4,5,6,7,8,9,10].forEach(c => {
    const cell = ws.getCell(footRow.number, c);
    cell.fill = solidFill(C.navy);
    cell.font = cellFont(true, 11, C.gold);
    cell.border = thinBorder(C.goldDim);
    cell.alignment = { horizontal: c === 2 ? "left" : "center", vertical:"middle" };
  });

  addSeparator(ws, MAX);

  // ── Shift comparison ──────────────────────────────────────────────────────────
  sectionHeader(ws, "  SHIFT SPLIT", MAX);
  applyHeaderRow(ws.addRow([]),
    ["Shift","Pallets","% of Day","Tonnes","% of Day","Units","Lines Active"],
    C.navyMid, C.gold
  );
  [
    { label:"☀ Day Shift", pallets:dayPallets, tonnes:dayTonnes, units:dayUnits, lines:dayLines, bg:C.navyMid },
    { label:"🌙 Night Shift", pallets:nightPallets, tonnes:nightTonnes, units:nightUnits, lines:nightLines, bg:C.navyLight },
    { label:"COMBINED", pallets:totalPallets, tonnes:totalTonnes, units:totalUnits, lines:Math.max(dayLines,nightLines), bg:C.navy },
  ].forEach(r => {
    const palletPct = totalPallets > 0 ? pctStr(r.pallets/totalPallets*100) : "—";
    const tonnePct  = totalTonnes  > 0 ? pctStr(r.tonnes/totalTonnes*100)   : "—";
    const row = ws.addRow(["",
      r.label, r.pallets || "—", palletPct,
      r.pallets ? `${r.tonnes} t` : "—", tonnePct,
      r.units.toLocaleString(), `${r.lines} / ${LINES.length}`
    ]);
    row.height = 20;
    [2,3,4,5,6,7,8].forEach(c => {
      const cell = ws.getCell(row.number, c);
      cell.fill = solidFill(r.bg);
      cell.font = cellFont(r.label==="COMBINED", 10, r.label==="COMBINED" ? C.gold : C.textLight);
      cell.border = thinBorder(C.goldDim);
      cell.alignment = { horizontal: c === 2 ? "left" : "center", vertical:"middle" };
    });
  });
}

// ── TAB 2: By Line (Daily) ────────────────────────────────────────────────────
function buildDailyByLineSheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  agg: DailyAgg,
  skuMeta: Record<string, SkuMeta>
): void {
  const ws = wb.addWorksheet("By Line", {
    properties:{ tabColor:{ argb:C.teal } }
  });
  ws.properties.defaultColWidth = 15;
  const MAX = 9;

  addSheetTitle(ws, "Production — By Line (Daily)", `Full Day  ·  ${fmtDateFull(dateEAT)}`, MAX);

  const combined = combinedAgg(agg.day, agg.night);

  for (const line of LINES) {
    sectionHeader(ws, `  ${line}`, MAX);
    applyHeaderRow(ws.addRow([]),
      ["SKU","Product","☀ Day Pallets","☀ Day Tonnes","🌙 Night Pallets","🌙 Night Tonnes","Total Pallets","Total Tonnes"],
      C.navyMid, C.gold
    );

    const allSkus = new Set([
      ...Object.keys(agg.day[line]?.skus   || {}),
      ...Object.keys(agg.night[line]?.skus || {}),
    ]);
    const sorted = [...allSkus].sort((a,b) =>
      (combined[line]?.skus[b]?.pallets||0) - (combined[line]?.skus[a]?.pallets||0)
    );

    if (sorted.length === 0) {
      const r = ws.addRow(["","— No production this shift","","","","","",""]);
      ws.mergeCells(r.number, 2, r.number, MAX);
      ws.getCell(r.number, 2).fill = solidFill(C.navyMid);
      ws.getCell(r.number, 2).font = cellFont(false, 10, C.textMuted);
      ws.getCell(r.number, 2).alignment = { horizontal:"center", vertical:"middle" };
      r.height = 18;
      addSeparator(ws, MAX);
      continue;
    }

    sorted.forEach((sku, idx) => {
      const d = agg.day[line]?.skus[sku]   ?? { pallets:0, units:0, tonnes:0 };
      const n = agg.night[line]?.skus[sku] ?? { pallets:0, units:0, tonnes:0 };
      const tot = combined[line]?.skus[sku] ?? { pallets:0, units:0, tonnes:0 };
      const bg = idx % 2 === 0 ? C.navyMid : C.navyLight;
      const name = skuMeta[sku]?.product_name || sku;

      const row = ws.addRow(["",
        sku, name,
        d.pallets || "—", d.pallets ? `${r5(d.tonnes)} t` : "—",
        n.pallets || "—", n.pallets ? `${r5(n.tonnes)} t` : "—",
        tot.pallets, `${r5(tot.tonnes)} t`
      ]);
      row.height = 18;
      [2,3,4,5,6,7,8,9].forEach((c,j) => {
        const cell = ws.getCell(row.number, c);
        cell.fill = solidFill(bg);
        cell.font = cellFont(c===8||c===9, 10, C.textLight);
        cell.border = thinBorder();
        cell.alignment = { horizontal: j<=1 ? "left" : "center", vertical:"middle" };
      });
    });

    // Line subtotals
    const d = agg.day[line];
    const n = agg.night[line];
    const tot = combined[line];
    const subRow = ws.addRow(["","SUBTOTAL","",
      d.pallets||"—", d.pallets?`${r5(d.tonnes)} t`:"—",
      n.pallets||"—", n.pallets?`${r5(n.tonnes)} t`:"—",
      tot.pallets, `${r5(tot.tonnes)} t`
    ]);
    subRow.height = 20;
    [2,3,4,5,6,7,8,9].forEach(c => {
      const cell = ws.getCell(subRow.number, c);
      cell.fill = solidFill(C.navy);
      cell.font = cellFont(true, 10, C.gold);
      cell.border = thinBorder(C.goldDim);
      cell.alignment = { horizontal: c===2||c===3?"left":"center", vertical:"middle" };
    });
    addSeparator(ws, MAX);
  }
}

// ── TAB 3: SKU Breakdown ──────────────────────────────────────────────────────
function buildDailySkuSheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  agg: DailyAgg,
  skuMeta: Record<string, SkuMeta>
): void {
  const ws = wb.addWorksheet("SKU Breakdown", {
    properties:{ tabColor:{ argb:C.purple } }
  });
  ws.properties.defaultColWidth = 18;
  const MAX = 9;

  addSheetTitle(ws, "SKU Breakdown — Full Day", `${fmtDateFull(dateEAT)}  ·  All Lines Combined`, MAX);
  sectionHeader(ws, "  TOP SKUs — ranked by total pallets", MAX);
  applyHeaderRow(ws.addRow([]),
    ["SKU","Product","Total Pallets","Total Tonnes","☀ Day Pallets","🌙 Night Pallets","Lines Active","Subdivision"],
    C.navyMid, C.gold
  );

  const combined = combinedAgg(agg.day, agg.night);

  // Aggregate across all lines per SKU
  const skuTotals: Record<string, {
    pallets:number; tonnes:number;
    dayPallets:number; nightPallets:number;
    lines: Set<string>;
  }> = {};

  for (const line of LINES) {
    for (const [sku, s] of Object.entries(combined[line]?.skus || {})) {
      if (!skuTotals[sku]) skuTotals[sku] = { pallets:0, tonnes:0, dayPallets:0, nightPallets:0, lines:new Set() };
      skuTotals[sku].pallets  += s.pallets;
      skuTotals[sku].tonnes    = r5(skuTotals[sku].tonnes + s.tonnes);
      skuTotals[sku].dayPallets   += agg.day[line]?.skus[sku]?.pallets   || 0;
      skuTotals[sku].nightPallets += agg.night[line]?.skus[sku]?.pallets || 0;
      skuTotals[sku].lines.add(line);
    }
  }

  const sorted = Object.entries(skuTotals).sort((a,b) => b[1].pallets - a[1].pallets);
  sorted.forEach(([sku, s], idx) => {
    const meta = skuMeta[sku];
    const bg = idx % 2 === 0 ? C.navyMid : C.navyLight;
    const row = ws.addRow(["",
      sku, meta?.product_name || sku,
      s.pallets, `${s.tonnes} t`,
      s.dayPallets || "—", s.nightPallets || "—",
      s.lines.size, meta?.subdivision || "—"
    ]);
    row.height = 18;
    [2,3,4,5,6,7,8,9].forEach((c,j) => {
      const cell = ws.getCell(row.number, c);
      cell.fill = solidFill(bg);
      cell.font = cellFont(c===4||c===5, 10, C.textLight);
      cell.border = thinBorder();
      cell.alignment = { horizontal: j<=1 ? "left" : "center", vertical:"middle" };
    });
  });

  if (sorted.length === 0) {
    const r = ws.addRow(["  — No tickets recorded today"]);
    ws.mergeCells(r.number, 1, r.number, MAX);
    ws.getCell(r.number, 1).fill = solidFill(C.navyMid);
    ws.getCell(r.number, 1).font = cellFont(false, 10, C.textMuted);
    r.height = 20;
  }
}

// ── TAB 4: 7-Day Trend (Full Day) ─────────────────────────────────────────────
function buildSevenDayTrendSheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  todayAgg: DailyAgg,
  history: { dateEAT: Date; agg: DailyAgg }[]
): void {
  const ws = wb.addWorksheet("7-Day Trend", {
    properties:{ tabColor:{ argb:"FF22C55E" } }
  });
  ws.properties.defaultColWidth = 14;
  const MAX = 2 + history.length + 1 + LINES.length; // date cols + lines

  addSheetTitle(ws, "7-Day Production Trend — Full Day", `Showing 7 previous days + today  ·  ${fmtDateFull(dateEAT)}`, MAX);
  sectionHeader(ws, "  Combined output per calendar day (Day Shift + Night Shift)", MAX);

  // Build date list: oldest → newest → today
  const allDays = [
    ...history.slice().reverse(),
    { dateEAT, agg: todayAgg }
  ];

  // Header: dates
  const dateLabels = allDays.map(d => fmtDateShort(d.dateEAT));
  applyHeaderRow(ws.addRow([]), ["Metric", ...dateLabels], C.navyMid, C.gold);

  // Rows: Total Pallets, Day Pallets, Night Pallets, Total Tonnes, Day Tonnes, Night Tonnes
  type DayMetric = { label: string; fn: (a: DailyAgg) => string | number; bold?: boolean };
  const metrics: DayMetric[] = [
    { label:"Total Pallets",    fn: a => LINES.reduce((s,l)=>s+(a.day[l]?.pallets||0)+(a.night[l]?.pallets||0),0), bold:true },
    { label:"  ☀ Day Pallets",  fn: a => LINES.reduce((s,l)=>s+(a.day[l]?.pallets||0),0) },
    { label:"  🌙 Night Pallets",fn: a => LINES.reduce((s,l)=>s+(a.night[l]?.pallets||0),0) },
    { label:"Total Tonnes",     fn: a => `${r5(LINES.reduce((s,l)=>s+(a.day[l]?.tonnes||0)+(a.night[l]?.tonnes||0),0))} t`, bold:true },
    { label:"  ☀ Day Tonnes",   fn: a => `${r5(LINES.reduce((s,l)=>s+(a.day[l]?.tonnes||0),0))} t` },
    { label:"  🌙 Night Tonnes", fn: a => `${r5(LINES.reduce((s,l)=>s+(a.night[l]?.tonnes||0),0))} t` },
    { label:"Lines Active",     fn: a => LINES.filter(l=>(a.day[l]?.pallets||0)+(a.night[l]?.pallets||0)>0).length },
  ];

  metrics.forEach((m, mi) => {
    const isBold = m.bold ?? false;
    const isHeader = isBold;
    const bg = isHeader ? C.navyLight : C.navyMid;
    const row = ws.addRow(["", m.label, ...allDays.map(d => m.fn(d.agg))]);
    row.height = isHeader ? 22 : 18;
    [2, ...allDays.map((_,i) => 3+i)].forEach((c,j) => {
      const cell = ws.getCell(row.number, c);
      const isToday = j === allDays.length; // last column = today
      cell.fill = solidFill(isToday ? C.navy : bg);
      cell.font = cellFont(isBold, 10, isToday ? C.gold : C.textLight);
      cell.border = thinBorder();
      cell.alignment = { horizontal: j===0 ? "left" : "center", vertical:"middle" };
    });
    if (mi === 2 || mi === 5) addSeparator(ws, 2 + allDays.length);
  });

  addSeparator(ws, 2 + allDays.length);
  sectionHeader(ws, "  PER-LINE DAILY TOTALS (pallets)", 2 + allDays.length);
  applyHeaderRow(ws.addRow([]), ["Line", ...dateLabels], C.navyMid, C.gold);

  LINES.forEach((line, li) => {
    const bg = li % 2 === 0 ? C.navyMid : C.navyLight;
    const row = ws.addRow(["", line,
      ...allDays.map(d => {
        const t = (d.agg.day[line]?.pallets||0) + (d.agg.night[line]?.pallets||0);
        return t || "—";
      })
    ]);
    row.height = 18;
    [2, ...allDays.map((_,i)=>3+i)].forEach((c,j) => {
      const cell = ws.getCell(row.number, c);
      const isToday = j === allDays.length;
      cell.fill = solidFill(isToday ? C.navy : bg);
      cell.font = cellFont(j===0, 10, isToday ? C.gold : C.textLight);
      cell.border = thinBorder();
      cell.alignment = { horizontal: j===0 ? "left" : "center", vertical:"middle" };
    });
  });
}

// ── WhatsApp summary text ─────────────────────────────────────────────────────
function buildSummaryMessage(
  dateEAT: Date,
  agg: DailyAgg,
  prevAgg: DailyAgg,
  fileUrl: string
): string {
  const combined = combinedAgg(agg.day, agg.night);
  const totalPallets = LINES.reduce((s,l)=>s+combined[l].pallets,0);
  const totalTonnes  = r5(LINES.reduce((s,l)=>s+combined[l].tonnes,0));
  const dayPallets   = LINES.reduce((s,l)=>s+agg.day[l].pallets,0);
  const nightPallets = LINES.reduce((s,l)=>s+agg.night[l].pallets,0);
  const prevTotal    = LINES.reduce((s,l)=>s+(prevAgg.day[l]?.pallets||0)+(prevAgg.night[l]?.pallets||0),0);
  const diffStr      = prevTotal ? `${totalPallets>=prevTotal?"▲":"▼"} ${Math.abs(totalPallets-prevTotal)} vs yesterday` : "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  let msg  = `📅 RetiFlux™ · End-of-Day Report\n`;
  msg     += `${days[dateEAT.getUTCDay()]} ${dateEAT.getUTCDate()} ${months[dateEAT.getUTCMonth()]} ${dateEAT.getUTCFullYear()}\n\n`;
  msg     += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg     += `🏭 Total Day Output\n`;
  msg     += `   Pallets : ${totalPallets}  ${diffStr}\n`;
  msg     += `   Tonnage : ${totalTonnes} t\n`;
  msg     += `   ☀ Day Shift   : ${dayPallets} pallets\n`;
  msg     += `   🌙 Night Shift : ${nightPallets} pallets\n\n`;
  msg     += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg     += `📊 Per-Line Combined:\n`;
  for (const line of LINES) {
    const t = combined[line].pallets;
    if (t > 0) msg += `  ${line}: ${t} pallets · ${r5(combined[line].tonnes)} t\n`;
  }
  msg     += `\n📎 Full Daily Report:\n${fileUrl}`;
  return msg;
}

// ── Main buildReport ──────────────────────────────────────────────────────────
async function buildReport(dateOverride?: string): Promise<void> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Determine which calendar date to report on.
  // Auto: at 07:00 EAT (cron fires at 04:00 UTC), report on "yesterday" EAT.
  // If an explicit date is given, parse it.
  let reportDateEAT: Date;
  if (dateOverride) {
    const [y, m, d] = dateOverride.split("-").map(Number);
    reportDateEAT = new Date(Date.UTC(y, m-1, d));
  } else {
    const now = eatNow();
    // Subtract 1 day: at 07:00 EAT on Apr 23, report date is Apr 22
    reportDateEAT = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1
    ));
  }

  // Build UTC windows for both shifts on this date
  const [dayStart, dayEnd]     = dayShiftBounds(reportDateEAT);
  const [nightStart, nightEnd] = nightShiftBounds(reportDateEAT);

  // 7 prior days for trend
  const historyDates: Date[] = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(reportDateEAT.getUTCFullYear(), reportDateEAT.getUTCMonth(), reportDateEAT.getUTCDate() - (i+1)))
  );

  // Fetch all tickets in parallel
  const [dayTickets, nightTickets, skuMeta, prevDayT, prevNightT, ...historyTickets] =
    await Promise.all([
      fetchTickets(sb, dayStart, dayEnd),
      fetchTickets(sb, nightStart, nightEnd),
      fetchSkuMeta(sb),
      fetchTickets(sb, dayShiftBounds(new Date(reportDateEAT.getTime() - 86400000))[0],
                       dayShiftBounds(new Date(reportDateEAT.getTime() - 86400000))[1]),
      fetchTickets(sb, nightShiftBounds(new Date(reportDateEAT.getTime() - 86400000))[0],
                       nightShiftBounds(new Date(reportDateEAT.getTime() - 86400000))[1]),
      ...historyDates.flatMap(hd => [
        fetchTickets(sb, dayShiftBounds(hd)[0],   dayShiftBounds(hd)[1]),
        fetchTickets(sb, nightShiftBounds(hd)[0], nightShiftBounds(hd)[1]),
      ])
    ]);

  const agg: DailyAgg = {
    day:   aggregateByLine(dayTickets,   skuMeta),
    night: aggregateByLine(nightTickets, skuMeta),
  };
  const prevAgg: DailyAgg = {
    day:   aggregateByLine(prevDayT,   skuMeta),
    night: aggregateByLine(prevNightT, skuMeta),
  };

  // Pair up history (day, night) per date
  const history: { dateEAT: Date; agg: DailyAgg }[] = historyDates.map((hd, i) => ({
    dateEAT: hd,
    agg: {
      day:   aggregateByLine(historyTickets[i*2],   skuMeta),
      night: aggregateByLine(historyTickets[i*2+1], skuMeta),
    }
  }));

  // Build Excel workbook
  const wb = new ExcelJS.Workbook();
  wb.creator  = "RetiFlux™ · NexGridCore DataLabs";
  wb.created  = new Date();
  wb.properties.date1904 = false;

  buildDailyOverviewSheet(wb, reportDateEAT, agg, skuMeta, prevAgg);
  buildDailyByLineSheet(wb, reportDateEAT, agg, skuMeta);
  buildDailySkuSheet(wb, reportDateEAT, agg, skuMeta);
  buildSevenDayTrendSheet(wb, reportDateEAT, agg, history);

  // Upload
  const fileName = `RetiFlux_DAILY_${fmtDateFile(reportDateEAT)}.xlsx`;
  const buffer   = await wb.xlsx.writeBuffer() as ArrayBuffer;
  const filePath = `daily-reports/${fmtDateFile(reportDateEAT)}/${fileName}`;

  const { error: uploadErr } = await (createClient(SUPABASE_URL, SUPABASE_KEY))
    .storage.from("eos-reports")
    .upload(filePath, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

  const { data: { publicUrl } } = createClient(SUPABASE_URL, SUPABASE_KEY)
    .storage.from("eos-reports")
    .getPublicUrl(filePath);

  const message = buildSummaryMessage(reportDateEAT, agg, prevAgg, publicUrl);
  await broadcast(message);
  console.log(`Daily report for ${fmtDateFile(reportDateEAT)} delivered. URL: ${publicUrl}`);
}

// ── Edge function entry ───────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }
  try {
    let body: { mock_now?: string; date?: string } = {};
    try {
      const text = await req.text();
      if (text.trim().startsWith("{")) body = JSON.parse(text);
    } catch { /* ignore */ }

    _mockNowUtc = body.mock_now ? new Date(body.mock_now) : null;

    await buildReport(body.date);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("eos-daily-report error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
