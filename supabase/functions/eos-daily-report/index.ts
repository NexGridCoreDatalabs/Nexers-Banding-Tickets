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
//   4. Materials        — Outer cartons, sachets, tablets consumed
//   5. Hourly 24h       — Hour-by-hour pallet counts across the full day (07:00–06:59 EAT)
//   6. Intelligence     — KPI scoring, downtime log, 7-day forward signal
//   7. 7-Day Trend      — 7 calendar days of combined output (full day, not per-shift)
//   8. Audit Trail      — Voided tickets from both shifts
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

// ── RAG / sparkline helpers (shared with Trend Intelligence) ─────────────────
const RAG = {
  green: { bg:"FF14532D", text:"FF86EFAC" },
  amber: { bg:"FF78350F", text:"FFFDE68A" },
  red:   { bg:"FF7F1D1D", text:"FFFCA5A5" },
  blue:  { bg:"FF1E3A5F", text:C.gold     },
  gold:  { bg:C.gold,     text:C.navy     },
} as const;

const SPARKS = ["▁","▂","▃","▄","▅","▆","▇","█"];
function spark(values: number[]): string {
  const max = Math.max(...values, 0.01);
  return values.map(v => v===0?"·":SPARKS[Math.min(7,Math.floor((v/max)*8))]).join("");
}
function linearSlope(values: number[]): number {
  const n=values.length; if(n<2) return 0;
  const xm=(n-1)/2, ym=values.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0;
  for(let i=0;i<n;i++){num+=(i-xm)*(values[i]-ym);den+=(i-xm)**2;}
  return den>0?num/den:0;
}

const DAY_TARGET_MIN_T    = 85.0;   // combined both shifts
const DAY_TARGET_KAIZEN_T = 100.0;

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
  voided_at:       string | null;
  voided_reason:   string | null;
  voided_by:       string | null;
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
  from: Date, to: Date,
  includeVoided = false
): Promise<TicketRow[]> {
  let q = sb.from("tickets")
    .select("id,serial,production_line,sku,qty,uom,pallet_color,group_leader,created_at,voided,voided_at,voided_reason,voided_by")
    .gte("created_at", from.toISOString())
    .lt("created_at",  to.toISOString())
    .not("production_line", "is", null);
  if (!includeVoided) q = q.eq("voided", false);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TicketRow[];
}

interface DowntimeEvent {
  production_line: string;
  gap_start:       string;
  gap_end:         string;
  gap_minutes:     number;
  category:        string;
  sub_category:    string;
  description:     string | null;
  logged_by:       string;
}
async function fetchDowntimeEvents(
  sb: ReturnType<typeof createClient>,
  from: Date, to: Date
): Promise<DowntimeEvent[]> {
  const { data, error } = await sb.from("downtime_events")
    .select("production_line,gap_start,gap_end,gap_minutes,category,sub_category,description,logged_by")
    .gte("gap_start", from.toISOString())
    .lt("gap_end",   to.toISOString())
    .order("gap_start", { ascending:true });
  if (error) { console.warn("downtime_events fetch:", error.message); return []; }
  return (data ?? []) as DowntimeEvent[];
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

// ── TAB 5: Materials (Daily) ──────────────────────────────────────────────────
function buildDailyMaterialsSheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  allTickets: TicketRow[],    // combined day + night, non-voided
  skuMeta: Record<string, SkuMeta>
): void {
  const ws = wb.addWorksheet("Materials", {
    properties:{ tabColor:{ argb:"FF10B981" } }
  });
  ws.properties.defaultColWidth = 18;
  const maxCol = 7;
  addSheetTitle(ws, "Materials Consumed — Full Day", `${fmtDateFull(dateEAT)}  ·  Day + Night Combined`, maxCol);

  function secBanner(label: string) {
    const r = ws.addRow([label]);
    ws.mergeCells(r.number,1,r.number,maxCol);
    const c = ws.getCell(r.number,1);
    c.fill=solidFill(C.gold); c.font={bold:true,size:10,color:{argb:C.navy},name:"Consolas"};
    c.alignment={horizontal:"left",vertical:"middle",indent:1}; r.height=20;
  }

  // ── Outer cartons ─────────────────────────────────────────────────────────
  secBanner("OUTER CARTONS");
  applyHeaderRow(ws.addRow([]), ["Line","SKU","Product","Pallets","Cartons Used","UOM"], C.navyMid, C.gold);
  const cartonMap: Record<string,Record<string,{pallets:number;cartons:number;uom:string}>> = {};
  for (const t of allTickets) {
    const l = t.production_line?.trim()||"UNKNOWN";
    if (!cartonMap[l]) cartonMap[l]={};
    if (!cartonMap[l][t.sku]) cartonMap[l][t.sku]={pallets:0,cartons:0,uom:t.uom};
    cartonMap[l][t.sku].pallets++;
    cartonMap[l][t.sku].cartons+=Number(t.qty)||0;
  }
  let cartonTotal=0, ri=0;
  for (const line of LINES) {
    for (const [sku,d] of Object.entries(cartonMap[line]||{})) {
      cartonTotal+=d.cartons;
      const bg=ri%2===0?C.navyMid:C.navyLight;
      const row=ws.addRow(["",line,sku,skuMeta[sku]?.product_name||sku,d.pallets,d.cartons,d.uom]);
      row.height=18;
      [2,3,4,5,6,7].forEach((col,i)=>{
        const cell=ws.getCell(row.number,col);
        cell.fill=solidFill(bg); cell.font=cellFont(false,10,C.textLight);
        cell.border=thinBorder(); cell.alignment={horizontal:i<3?"left":"center",vertical:"middle"};
      }); ri++;
    }
  }
  const ctTot=ws.addRow(["","TOTAL","","","",cartonTotal,""]);
  ctTot.height=20;
  [2,3,4,5,6].forEach(col=>{
    const cell=ws.getCell(ctTot.number,col);
    cell.fill=solidFill(C.navyLight); cell.font={bold:true,size:10,color:{argb:C.gold},name:"Consolas"};
    cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
  });
  addSeparator(ws, maxCol);

  // ── Sachets ───────────────────────────────────────────────────────────────
  secBanner("SACHETS (Inner Units)");
  applyHeaderRow(ws.addRow([]), ["Line","SKU","Product","Sachet Type","Pallets","Sachets Used"], C.navyMid, C.gold);
  let sachetTotal=0; ri=0;
  for (const t of allTickets) {
    const meta=skuMeta[t.sku];
    if (!meta?.sachet_type||!meta?.units_per_carton) continue;
    const used=(Number(t.qty)||0)*meta.units_per_carton;
    sachetTotal+=used;
    const bg=ri%2===0?C.navyMid:C.navyLight;
    const row=ws.addRow(["",t.production_line,t.sku,meta.product_name,meta.sachet_type,1,used]);
    row.height=18;
    [2,3,4,5,6,7].forEach((col,i)=>{
      const cell=ws.getCell(row.number,col);
      cell.fill=solidFill(bg); cell.font=cellFont(false,10,C.textLight);
      cell.border=thinBorder(); cell.alignment={horizontal:i<4?"left":"center",vertical:"middle"};
    }); ri++;
  }
  if (sachetTotal===0) {
    const nr=ws.addRow(["  — No sachet products this day"]);
    ws.mergeCells(nr.number,1,nr.number,maxCol);
    ws.getCell(nr.number,1).fill=solidFill(C.navyMid);
    ws.getCell(nr.number,1).font={italic:true,size:10,color:{argb:C.textMuted},name:"Consolas"}; nr.height=18;
  } else {
    const sTot=ws.addRow(["","TOTAL","","","",sachetTotal,""]);
    [2,3,4,5,6].forEach(col=>{
      const cell=ws.getCell(sTot.number,col);
      cell.fill=solidFill(C.navyLight); cell.font={bold:true,size:10,color:{argb:C.gold},name:"Consolas"};
      cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
    });
  }
  addSeparator(ws, maxCol);

  // ── Tablets ───────────────────────────────────────────────────────────────
  secBanner("TABLETS");
  applyHeaderRow(ws.addRow([]), ["Line","SKU","Product","Tablet Type","Pallets","Tablets Used"], C.navyMid, C.gold);
  let tabletTotal=0; ri=0;
  for (const t of allTickets) {
    const meta=skuMeta[t.sku];
    if (!meta?.tablet_type||!meta?.units_per_carton) continue;
    const used=(Number(t.qty)||0)*meta.units_per_carton;
    tabletTotal+=used;
    const bg=ri%2===0?C.navyMid:C.navyLight;
    const row=ws.addRow(["",t.production_line,t.sku,meta.product_name,meta.tablet_type,1,used]);
    row.height=18;
    [2,3,4,5,6,7].forEach((col,i)=>{
      const cell=ws.getCell(row.number,col);
      cell.fill=solidFill(bg); cell.font=cellFont(false,10,C.textLight);
      cell.border=thinBorder(); cell.alignment={horizontal:i<4?"left":"center",vertical:"middle"};
    }); ri++;
  }
  if (tabletTotal===0) {
    const nr=ws.addRow(["  — No tablet products this day"]);
    ws.mergeCells(nr.number,1,nr.number,maxCol);
    ws.getCell(nr.number,1).fill=solidFill(C.navyMid);
    ws.getCell(nr.number,1).font={italic:true,size:10,color:{argb:C.textMuted},name:"Consolas"}; nr.height=18;
  } else {
    const tTot=ws.addRow(["","TOTAL","","","",tabletTotal,""]);
    [2,3,4,5,6].forEach(col=>{
      const cell=ws.getCell(tTot.number,col);
      cell.fill=solidFill(C.navyLight); cell.font={bold:true,size:10,color:{argb:C.gold},name:"Consolas"};
      cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
    });
  }
  ws.columns=[{width:2},{width:16},{width:12},{width:28},{width:18},{width:8},{width:16}];
}

// ── TAB 6: Hourly 24h ─────────────────────────────────────────────────────────
function buildDailyHourlySheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  allTickets: TicketRow[],    // combined day + night, non-voided
  skuMeta: Record<string, SkuMeta>
): void {
  const ws = wb.addWorksheet("Hourly 24h", {
    properties:{ tabColor:{ argb:"FFF59E0B" } }
  });
  ws.properties.defaultColWidth = 13;
  addSheetTitle(ws, "Hourly Breakdown — Full Day (24h)", `${fmtDateFull(dateEAT)}  ·  07:00 EAT → 06:59 EAT`, LINES.length+3);

  // 24-hour window starting at 07:00 EAT: 7..18 (day shift), 19..23, 0..6 (night shift)
  const hours = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6];
  const DAY_HOURS = new Set([7,8,9,10,11,12,13,14,15,16,17,18]);

  applyHeaderRow(ws.addRow([]), ["Hour (EAT)", "Shift", "Total Pallets", ...LINES, "Tonnage"], C.navy, C.gold);
  ws.views = [{ state:"frozen", ySplit: ws.rowCount }];

  const hrLine: Record<number, Record<string,number>> = {};
  const hrTonnes: Record<number,number> = {};
  for (const t of allTickets) {
    const eatT=toEAT(new Date(t.created_at));
    const h=eatT.getUTCHours();
    if (!hrLine[h]) hrLine[h]={};
    hrLine[h][t.production_line?.trim()||"UNKNOWN"]=(hrLine[h][t.production_line?.trim()||"UNKNOWN"]||0)+1;
    hrTonnes[h]=(hrTonnes[h]||0)+calcTonnes(t,skuMeta[t.sku]);
  }

  const totals=hours.map(h=>Object.values(hrLine[h]||{}).reduce((s,v)=>s+v,0));
  const maxVal=Math.max(...totals,1);

  totals.forEach((tot,i)=>{
    const h=hours[i];
    const isDay=DAY_HOURS.has(h);
    const isPeak=tot===Math.max(...totals)&&tot>0;
    // Day-shift rows: slightly blue tint; night-shift rows: standard
    const bg=tot===0?"FF0E1420":isPeak?"FF1C2A00":isDay?(i%2===0?C.navyMid:C.navyLight):(i%2===0?"FF1A2236":"FF1E293B");
    const label=`${String(h).padStart(2,"0")}:00`;
    const lineCounts=LINES.map(l=>hrLine[h]?.[l]||0);
    const row=ws.addRow(["",label,isDay?"☀ Day":"🌙 Night",tot,...lineCounts,r5(hrTonnes[h]||0)+" t"]);
    row.height=20;
    const colsCount=3+1+LINES.length+1;
    for(let c=2;c<=colsCount;c++){
      const cell=ws.getCell(row.number,c);
      cell.fill=solidFill(bg);
      cell.font={bold:isPeak||tot===0,size:10,
        color:{argb:tot===0?C.textMuted:isPeak?C.gold:isDay?C.textLight:"FFB8D4F0"},name:"Consolas"};
      cell.border=thinBorder();
      cell.alignment={horizontal:c===2?"left":"center",vertical:"middle"};
    }
    if(tot>0){
      const bars=Math.round((tot/maxVal)*10);
      ws.getCell(row.number,2).value=`${label}  ${"█".repeat(bars)}${"░".repeat(10-bars)}`;
    }
  });

  // Day sub-total
  const dayHrs=[7,8,9,10,11,12,13,14,15,16,17,18];
  const nightHrs=[19,20,21,22,23,0,1,2,3,4,5,6];
  function subTotal(hrs: number[], label: string, bg: string) {
    const tot=hrs.reduce((s,h)=>s+Object.values(hrLine[h]||{}).reduce((a,b)=>a+b,0),0);
    const cols=LINES.map(l=>hrs.reduce((s,h)=>s+(hrLine[h]?.[l]||0),0));
    const tonnes=r5(hrs.reduce((s,h)=>s+(hrTonnes[h]||0),0));
    const row=ws.addRow(["",label,"",tot,...cols,tonnes+" t"]);
    row.height=22;
    for(let c=2;c<=3+1+LINES.length+1;c++){
      const cell=ws.getCell(row.number,c);
      cell.fill=solidFill(bg); cell.font={bold:true,size:10,color:{argb:C.navy},name:"Consolas"};
      cell.alignment={horizontal:c===2?"left":"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
    }
  }
  subTotal(dayHrs,   "☀ DAY TOTAL",   C.amber);
  subTotal(nightHrs, "🌙 NIGHT TOTAL", C.teal);
  subTotal(hours,    "FULL DAY TOTAL", C.gold);

  ws.columns=[{width:2},{width:22},{width:11},{width:14},...LINES.map(()=>({width:12})),{width:12}];
}

// ── TAB 7: Daily Trend Intelligence ──────────────────────────────────────────
function buildDailyTrendIntelligenceSheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  agg: DailyAgg,
  skuMeta: Record<string, SkuMeta>,
  history: { dateEAT: Date; agg: DailyAgg }[],
  downtimeDay: DowntimeEvent[],
  downtimeNight: DowntimeEvent[]
): void {
  const ws = wb.addWorksheet("Intelligence", {
    properties:{ tabColor:{ argb:"FF06B6D4" } }
  });
  ws.properties.defaultColWidth = 14;
  const MAX = 11;

  addSheetTitle(ws,
    "RetiFlux™  ·  Daily Intelligence Briefing",
    `Full Day  ·  Board-Level Review  ·  ${fmtDateFull(dateEAT)}`,
    MAX
  );

  const combined  = combinedAgg(agg.day, agg.night);
  const totalPallets = LINES.reduce((s,l)=>s+combined[l].pallets,0);
  const totalTonnes  = r5(LINES.reduce((s,l)=>s+combined[l].tonnes,0));
  const dayPallets   = LINES.reduce((s,l)=>s+agg.day[l].pallets,0);
  const nightPallets = LINES.reduce((s,l)=>s+agg.night[l].pallets,0);
  const linesActive  = LINES.filter(l=>combined[l].pallets>0).length;

  function intelSection(label: string) {
    const r=ws.addRow([label]);
    ws.mergeCells(r.number,1,r.number,MAX);
    const c=ws.getCell(r.number,1);
    c.fill=solidFill(C.navy); c.font={bold:true,size:11,color:{argb:C.gold},name:"Consolas"};
    c.alignment={horizontal:"left",vertical:"middle",indent:1}; r.height=24;
  }
  function ragCell(cell: ExcelJS.Cell, label: string, rag: keyof typeof RAG) {
    cell.value=label; cell.fill=solidFill(RAG[rag].bg);
    cell.font={bold:true,size:10,color:{argb:RAG[rag].text},name:"Consolas"};
    cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder();
  }

  // ── Section 1: KPI Summary ────────────────────────────────────────────────
  intelSection("  ① DAILY KPIs");
  const kpiData = [
    { label:"Total Pallets", val:`${totalPallets}`, rag:(totalPallets>=240?"green":totalPallets>=180?"amber":"red") as keyof typeof RAG },
    { label:"Total Tonnes",  val:`${totalTonnes} t`, rag:(totalTonnes>=DAY_TARGET_KAIZEN_T?"green":totalTonnes>=DAY_TARGET_MIN_T?"amber":"red") as keyof typeof RAG },
    { label:"☀ Day Pallets", val:`${dayPallets}`, rag:"blue" as keyof typeof RAG },
    { label:"🌙 Night Pallets", val:`${nightPallets}`, rag:"blue" as keyof typeof RAG },
    { label:"Lines Active",  val:`${linesActive} / ${LINES.length}`, rag:(linesActive>=5?"green":linesActive>=3?"amber":"red") as keyof typeof RAG },
    { label:"vs Min Target", val:`${Math.round(totalTonnes/DAY_TARGET_MIN_T*100)}%`, rag:(totalTonnes>=DAY_TARGET_MIN_T?"green":totalTonnes>=DAY_TARGET_MIN_T*0.85?"amber":"red") as keyof typeof RAG },
    { label:"vs Kaizen",     val:`${Math.round(totalTonnes/DAY_TARGET_KAIZEN_T*100)}%`, rag:(totalTonnes>=DAY_TARGET_KAIZEN_T?"green":totalTonnes>=DAY_TARGET_KAIZEN_T*0.85?"amber":"red") as keyof typeof RAG },
  ];
  const kpiLabelRow = ws.addRow(["", ...kpiData.map(k=>k.label)]);
  kpiLabelRow.height=18;
  [2,3,4,5,6,7,8].forEach((c,i)=>{
    const cell=ws.getCell(kpiLabelRow.number,c);
    cell.fill=solidFill(C.navyMid); cell.font=cellFont(true,9,C.textMuted);
    cell.alignment={horizontal:"center",vertical:"middle"};
  });
  const kpiValRow = ws.addRow(["", ...kpiData.map(k=>k.val)]);
  kpiValRow.height=28;
  kpiData.forEach((k,i)=>{
    const cell=ws.getCell(kpiValRow.number,i+2);
    ragCell(cell, k.val, k.rag);
    cell.font={...cell.font, size:13};
  });
  addSeparator(ws, MAX);

  // ── Section 2: Per-line scoring ───────────────────────────────────────────
  intelSection("  ② PER-LINE DAILY SCORECARD");
  applyHeaderRow(ws.addRow([]),
    ["Line","Day Pallets","Night Pallets","Total","Tonnes","Top SKU","☀ Sparkline","🌙 Sparkline"],
    C.navyMid, C.gold
  );

  const dayMetrics  = LINES.map(l => agg.day[l]);
  const nightMetrics = LINES.map(l => agg.night[l]);

  LINES.forEach((line,li) => {
    const d=agg.day[line]; const n=agg.night[line]; const tot=combined[line];
    const bg=li%2===0?C.navyMid:C.navyLight;
    let topSku="—"; let topP=0;
    for(const [sku,s] of Object.entries(tot.skus)) if(s.pallets>topP){topP=s.pallets;topSku=skuMeta[sku]?.product_name||sku;}

    // Sparkline across hours for this line
    const dayHrSpark  = [7,8,9,10,11,12,13,14,15,16,17,18].map(()=>0);
    const nightHrSpark= [19,20,21,22,23,0,1,2,3,4,5,6].map(()=>0);

    const row=ws.addRow(["",line,
      d.pallets||"—", n.pallets||"—", tot.pallets||"—",
      tot.pallets?`${r5(tot.tonnes)} t`:"—",
      topSku,"—","—"
    ]);
    row.height=18;
    [2,3,4,5,6,7,8,9].forEach((c,j)=>{
      const cell=ws.getCell(row.number,c);
      cell.fill=solidFill(bg);
      cell.font=cellFont(c===5||c===6,10,tot.pallets===0?C.textMuted:C.textLight);
      cell.border=thinBorder();
      cell.alignment={horizontal:j===0||j===5?"left":"center",vertical:"middle"};
    });
  });
  addSeparator(ws, MAX);

  // ── Section 3: Downtime log (combined both shifts) ───────────────────────
  intelSection("  ③ IDLE & DOWNTIME LOG  (☀ Day + 🌙 Night combined)");
  applyHeaderRow(ws.addRow([]),
    ["Shift","Line","Start (EAT)","End (EAT)","Mins","Category","Sub-Category","Description","Logged By"],
    C.navyMid, C.gold
  );
  const allDowntime = [
    ...downtimeDay.map(e=>({...e,shift:"☀ Day"})),
    ...downtimeNight.map(e=>({...e,shift:"🌙 Night"})),
  ].sort((a,b)=>new Date(a.gap_start).getTime()-new Date(b.gap_start).getTime());

  if (allDowntime.length===0) {
    const r=ws.addRow(["  ✓ No logged downtime events this day"]);
    ws.mergeCells(r.number,1,r.number,MAX);
    const rc=ws.getCell(r.number,1);
    rc.fill=solidFill(C.navyMid); rc.font={bold:true,size:10,color:{argb:C.green},name:"Consolas"};
    rc.alignment={horizontal:"center",vertical:"middle"}; r.height=22;
  } else {
    allDowntime.forEach((ev,i)=>{
      const bg=i%2===0?C.navyMid:C.navyLight;
      const row=ws.addRow(["",
        ev.shift, ev.production_line,
        fmtTime(toEAT(new Date(ev.gap_start))),
        fmtTime(toEAT(new Date(ev.gap_end))),
        ev.gap_minutes+" mins",
        ev.category, ev.sub_category,
        ev.description||"—", ev.logged_by
      ]);
      row.height=18;
      [2,3,4,5,6,7,8,9,10].forEach((c,j)=>{
        const cell=ws.getCell(row.number,c);
        cell.fill=solidFill(bg); cell.font=cellFont(false,10,C.textLight);
        cell.border=thinBorder(); cell.alignment={horizontal:j<3?"left":"center",vertical:"middle"};
      });
    });
    const totalMins=allDowntime.reduce((s,e)=>s+e.gap_minutes,0);
    const totRow=ws.addRow(["","","","","",`${totalMins} mins total`,"","","",""]);
    totRow.height=20;
    [2,3,4,5,6,7,8,9,10].forEach(c=>{
      const cell=ws.getCell(totRow.number,c);
      cell.fill=solidFill(C.navyLight); cell.font={bold:true,size:10,color:{argb:C.gold},name:"Consolas"};
      cell.alignment={horizontal:"center",vertical:"middle"}; cell.border=thinBorder(C.goldDim);
    });
  }
  addSeparator(ws, MAX);

  // ── Section 4: 7-day forward signal ─────────────────────────────────────
  intelSection("  ④ 7-DAY FORWARD SIGNAL");
  const sevenTonnesArr=history.map(h=>r5(LINES.reduce((s,l)=>s+(h.agg.day[l]?.tonnes||0)+(h.agg.night[l]?.tonnes||0),0)));
  const slope=linearSlope([...sevenTonnesArr.slice().reverse(), totalTonnes]);
  const [sigEmoji,sigWord,sigDetail,sigRag]:(["📈"|"📉"|"➡","IMPROVING"|"DECLINING"|"STABLE",string,keyof typeof RAG]) =
    slope>1
      ? ["📈","IMPROVING",`Daily tonnage has trended upward at +${r2(slope)} t/day over the last 7 days. Momentum is building — keep staffing and material supply consistent.`,"green"]
      : slope<-1
      ? ["📉","DECLINING",`Daily output has slipped at ${r2(slope)} t/day across the last 7 days. Without intervention output risks falling below the ${DAY_TARGET_MIN_T} MT daily floor. Review line availability and staffing before tomorrow.`,"red"]
      : ["➡","STABLE",`Daily production has been broadly steady over the last 7 days (slope: ${r2(slope)} t/day). The operation is consistent — focus next day on pushing toward the ${DAY_TARGET_KAIZEN_T} MT kaizen target.`,"amber"];

  const sigHead=ws.addRow([`${sigEmoji}  ${sigWord}`]);
  ws.mergeCells(sigHead.number,1,sigHead.number,MAX);
  const shc=ws.getCell(sigHead.number,1);
  shc.fill=solidFill(RAG[sigRag].bg); shc.font={bold:true,size:16,color:{argb:RAG[sigRag].text},name:"Consolas"};
  shc.alignment={horizontal:"center",vertical:"middle"}; sigHead.height=36;

  const sigDetail2=ws.addRow([sigDetail]);
  ws.mergeCells(sigDetail2.number,1,sigDetail2.number,MAX);
  const sdc=ws.getCell(sigDetail2.number,1);
  sdc.fill=solidFill(C.navyMid); sdc.font={size:11,color:{argb:C.textLight},name:"Consolas"};
  sdc.alignment={horizontal:"left",vertical:"top",wrapText:true,indent:1}; sigDetail2.height=60;

  addSeparator(ws, MAX);
  const foot=ws.addRow(["RetiFlux™  ·  NexGridCore DataLabs  ·  Daily Intelligence Briefing  ·  Confidential"]);
  ws.mergeCells(foot.number,1,foot.number,MAX);
  const fc=ws.getCell(foot.number,1);
  fc.fill=solidFill(C.navy); fc.font={size:9,color:{argb:C.textMuted},name:"Consolas",italic:true};
  fc.alignment={horizontal:"center",vertical:"middle"}; foot.height=18;
  ws.columns=[{width:2},{width:12},{width:14},{width:12},{width:12},{width:10},{width:18},{width:18},{width:30},{width:18},{width:10}];
}

// ── TAB 8: Audit Trail (Daily) ────────────────────────────────────────────────
function buildDailyAuditTrailSheet(
  wb: ExcelJS.Workbook,
  dateEAT: Date,
  allTickets: TicketRow[],   // includes voided (both shifts)
  skuMeta: Record<string, SkuMeta>
): void {
  const ws = wb.addWorksheet("Audit Trail", {
    properties:{ tabColor:{ argb:"FFEF4444" } }
  });
  ws.properties.defaultColWidth = 16;
  const maxCol = 12;
  addSheetTitle(ws, "Audit Trail — Voided Tickets", `Full Day  ·  ${fmtDateFull(dateEAT)}`, maxCol);

  const voided = allTickets.filter(t => t.voided);

  if (voided.length === 0) {
    const nr=ws.addRow(["  ✓ No voided tickets today — clean run across both shifts"]);
    ws.mergeCells(nr.number,1,nr.number,maxCol);
    const nc=ws.getCell(nr.number,1);
    nc.fill=solidFill(C.navyMid); nc.font={bold:true,size:11,color:{argb:C.green},name:"Consolas"};
    nc.alignment={horizontal:"center",vertical:"middle"}; nr.height=28;
    ws.columns=[{width:2},...Array(maxCol-1).fill({width:18})];
    return;
  }

  const warnRow=ws.addRow([`⚠  ${voided.length} voided ticket${voided.length!==1?"s":""} today — EXCLUDED from all other tabs`]);
  ws.mergeCells(warnRow.number,1,warnRow.number,maxCol);
  const wc=ws.getCell(warnRow.number,1);
  wc.fill=solidFill("FF7F1D1D"); wc.font={bold:true,size:11,color:{argb:"FFFCA5A5"},name:"Consolas"};
  wc.alignment={horizontal:"center",vertical:"middle"}; warnRow.height=26;
  ws.addRow([]);

  applyHeaderRow(ws.addRow([]),
    ["Ticket Serial","Line","SKU","Product","Qty","UOM","Pallet Color","Clerk","Voided By","Void Reason","Voided At (EAT)"],
    "FF7F1D1D", "FFFCA5A5"
  );

  voided.forEach((t,i)=>{
    const meta=skuMeta[t.sku];
    const vAt=t.voided_at?fmtTime(toEAT(new Date(t.voided_at)))+" "+fmtDateShort(toEAT(new Date(t.voided_at))):"—";
    const bg=i%2===0?"FF2D0A0A":"FF3D1212";
    const row=ws.addRow(["",
      t.serial,t.production_line,t.sku,meta?.product_name||t.sku,
      t.qty,t.uom,t.pallet_color||"—",
      t.group_leader||"—",t.voided_by||"—",t.voided_reason||"—",vAt
    ]);
    row.height=18;
    [2,3,4,5,6,7,8,9,10,11,12].forEach((col,j)=>{
      const cell=ws.getCell(row.number,col);
      cell.fill=solidFill(bg); cell.font=cellFont(false,10,"FFFCA5A5");
      cell.border=thinBorder("FF7F1D1D");
      cell.alignment={horizontal:j<4?"left":"center",vertical:"middle"};
    });
  });
  ws.columns=[{width:2},{width:20},{width:14},{width:22},{width:28},{width:8},{width:8},{width:14},{width:16},{width:16},{width:30},{width:22}];
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

  // Fetch all data in parallel
  const prevDate = new Date(reportDateEAT.getTime() - 86400000);
  const [
    dayTickets, nightTickets,
    dayTicketsAll, nightTicketsAll,    // includes voided — for Audit Trail
    skuMeta,
    downtimeDay, downtimeNight,
    prevDayT, prevNightT,
    ...historyTickets
  ] = await Promise.all([
    fetchTickets(sb, dayStart,   dayEnd,   false),
    fetchTickets(sb, nightStart, nightEnd, false),
    fetchTickets(sb, dayStart,   dayEnd,   true),
    fetchTickets(sb, nightStart, nightEnd, true),
    fetchSkuMeta(sb),
    fetchDowntimeEvents(sb, dayStart,   dayEnd),
    fetchDowntimeEvents(sb, nightStart, nightEnd),
    fetchTickets(sb, dayShiftBounds(prevDate)[0],   dayShiftBounds(prevDate)[1]),
    fetchTickets(sb, nightShiftBounds(prevDate)[0], nightShiftBounds(prevDate)[1]),
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

  const allTickets    = [...dayTickets,    ...nightTickets];
  const allTicketsAll = [...dayTicketsAll, ...nightTicketsAll]; // includes voided

  // Build Excel workbook
  const wb = new ExcelJS.Workbook();
  wb.creator  = "RetiFlux™ · NexGridCore DataLabs";
  wb.created  = new Date();
  wb.properties.date1904 = false;

  buildDailyOverviewSheet(wb, reportDateEAT, agg, skuMeta, prevAgg);
  buildDailyByLineSheet(wb, reportDateEAT, agg, skuMeta);
  buildDailySkuSheet(wb, reportDateEAT, agg, skuMeta);
  buildDailyMaterialsSheet(wb, reportDateEAT, allTickets, skuMeta);
  buildDailyHourlySheet(wb, reportDateEAT, allTickets, skuMeta);
  buildDailyTrendIntelligenceSheet(wb, reportDateEAT, agg, skuMeta, history, downtimeDay, downtimeNight);
  buildSevenDayTrendSheet(wb, reportDateEAT, agg, history);
  buildDailyAuditTrailSheet(wb, reportDateEAT, allTicketsAll, skuMeta);

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
