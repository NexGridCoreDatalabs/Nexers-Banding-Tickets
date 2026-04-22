// RetiFlux™ — WhatsApp Production Report Edge Function
// Handles both "hourly" and "end_of_shift" report types.
// All times are computed in EAT (UTC+3).
//
// Invoke via HTTP POST:
//   { "type": "hourly" }
//   { "type": "end_of_shift", "shift": "day" }   -- day shift  07:00–19:00 EAT
//   { "type": "end_of_shift", "shift": "night" }  -- night shift 19:00–07:00 EAT
//
// Required Supabase secrets:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//   WHATSAPP_RECIPIENT_1 (add WHATSAPP_RECIPIENT_2, _3 … as needed)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID         = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN       = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM        = Deno.env.get("TWILIO_WHATSAPP_FROM")!;

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3

// ── Helpers ──────────────────────────────────────────────────────────────────

// mock_now allows historical test runs — pass an ISO UTC string to override
let _mockNowUtc: Date | null = null;

function eatNow(): Date {
  const base = _mockNowUtc ? _mockNowUtc : new Date();
  return new Date(base.getTime() + EAT_OFFSET_MS);
}

function toEAT(d: Date): Date {
  return new Date(d.getTime() + EAT_OFFSET_MS);
}

function fmtTime(d: Date): string {
  // d is already in EAT
  return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
}

function fmtDate(d: Date): string {
  const days   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function pct(current: number, previous: number): string {
  if (!previous) return "—";
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 1) return "→ stable";
  const arrow = delta > 0 ? "▲" : "▼";
  return `${arrow} ${delta > 0 ? "+" : ""}${Math.round(delta)}%`;
}

function bar(count: number, max: number): string {
  if (max === 0) return "░░";
  const filled = Math.round((count / max) * 8);
  return filled === 0 ? "░░" : "█".repeat(filled);
}

// Collect all recipient numbers from env (WHATSAPP_RECIPIENT_1, _2, …)
function getRecipients(): string[] {
  const nums: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const v = Deno.env.get(`WHATSAPP_RECIPIENT_${i}`);
    if (v) nums.push(v);
    else break;
  }
  return nums;
}

// ── Twilio send ───────────────────────────────────────────────────────────────

async function sendWhatsApp(to: string, body: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const params = new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio error ${res.status}: ${err}`);
  }
}

// Split a long message into chunks at newline boundaries, max maxLen chars each
function chunkMessage(msg: string, maxLen = 1500): string[] {
  const lines = msg.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? current + "\n" + line : line;
    if (next.length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function broadcast(message: string): Promise<void> {
  const recipients = getRecipients();
  const chunks = chunkMessage(message, 1500);
  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1
      ? `[${i + 1}/${chunks.length}]\n${chunks[i]}`
      : chunks[i];
    await Promise.all(recipients.map((r) => sendWhatsApp(r, part)));
    if (i < chunks.length - 1) await new Promise((res) => setTimeout(res, 800));
  }
}

// ── Data queries ──────────────────────────────────────────────────────────────

const LINES = ["SP", "PKN", "MB-250", "AL", "MB-150", "Offline Banding"];

interface TicketRow {
  production_line: string;
  sku: string;
  qty: number;
  uom: string | null;
  created_at: string;
}

interface SkuRow {
  sku: string;
  product_name: string;
  units_per_carton: number | null;
  net_weight_kg_per_unit: number | null;
}

interface DowntimeEvent {
  production_line: string;
  gap_start: string;
  gap_end: string;
  gap_minutes: number;
  category: string;
  sub_category: string;
  description: string | null;
  logged_by: string;
}

async function fetchTickets(
  sb: ReturnType<typeof createClient>,
  from: Date,
  to: Date
): Promise<TicketRow[]> {
  // from/to are UTC Date objects
  const { data, error } = await sb
    .from("tickets")
    .select("production_line, sku, qty, uom, created_at")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .not("production_line", "is", null)
    .eq("voided", false);
  if (error) throw error;
  return (data ?? []) as TicketRow[];
}

// Returns { nameMap, weightMap } — weightMap[sku] = tonnes per carton (KAR) or per unit (PCS)
async function fetchSkuData(
  sb: ReturnType<typeof createClient>
): Promise<{
  names: Record<string, string>;
  weights: Record<string, number>;  // kg-per-carton for KAR tickets, kg-per-pcs for PCS
}> {
  const { data } = await sb
    .from("skus")
    .select("sku, product_name, units_per_carton, net_weight_kg_per_unit");
  const names: Record<string, string>  = {};
  const weights: Record<string, number> = {};
  (data ?? []).forEach((r: SkuRow) => {
    names[r.sku] = r.product_name || r.sku;
    if (r.net_weight_kg_per_unit != null) {
      const upc = r.units_per_carton ?? 1;
      // Store kg per carton; tonnage calc will use qty × this / 1000
      weights[r.sku] = Number(r.net_weight_kg_per_unit) * upc;
    }
  });
  return { names, weights };
}

// Kept for backward compatibility (end-of-shift path still calls this)
async function fetchSkuNames(
  sb: ReturnType<typeof createClient>
): Promise<Record<string, string>> {
  const { names } = await fetchSkuData(sb);
  return names;
}

async function fetchDowntimeEvents(
  sb: ReturnType<typeof createClient>,
  from: Date,
  to: Date
): Promise<DowntimeEvent[]> {
  const { data, error } = await sb
    .from("downtime_events")
    .select("production_line, gap_start, gap_end, gap_minutes, category, sub_category, description, logged_by")
    .gte("gap_start", from.toISOString())
    .lt("gap_start", to.toISOString())
    .order("gap_start", { ascending: true });
  if (error) {
    console.error("fetchDowntimeEvents error:", error.message);
    return [];
  }
  return (data ?? []) as DowntimeEvent[];
}

// ── Metric computation ────────────────────────────────────────────────────────

interface GapEntry {
  gapStartUtc: string;   // ISO UTC — last ticket before the gap (or window start)
  gapMins: number;
}

interface LineMetrics {
  line: string;
  pallets: number;
  units: number;
  tonnage: number;       // MT
  avgGapMins: number | null;
  gaps: GapEntry[];      // individual inter-ticket gaps (>= 5 min)
  skus: Record<string, { pallets: number; units: number; tonnage: number }>;
  lastTicketAt: Date | null;
}

function computeLineMetrics(
  tickets: TicketRow[],
  skuWeights: Record<string, number> = {}   // kg per carton
): Record<string, LineMetrics> {
  const result: Record<string, LineMetrics> = {};

  for (const line of LINES) {
    result[line] = {
      line, pallets: 0, units: 0, tonnage: 0,
      avgGapMins: null, gaps: [], skus: {}, lastTicketAt: null,
    };
  }

  // Group by line
  const byLine: Record<string, TicketRow[]> = {};
  for (const t of tickets) {
    const l = t.production_line?.trim() || "UNKNOWN";
    if (!byLine[l]) byLine[l] = [];
    byLine[l].push(t);
  }

  for (const line of LINES) {
    const rows = byLine[line] || [];
    rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    let pallets = 0, units = 0, tonnageLine = 0;
    const skuMap: Record<string, { pallets: number; units: number; tonnage: number }> = {};
    const gapsList: GapEntry[] = [];

    for (const r of rows) {
      pallets++;
      const qty = Number(r.qty) || 0;
      units += qty;

      // Tonnage: kg per carton × qty / 1000 → MT
      const kgPerCarton = skuWeights[r.sku] ?? 0;
      const mt = kgPerCarton > 0 ? (qty * kgPerCarton) / 1000 : 0;
      tonnageLine += mt;

      if (!skuMap[r.sku]) skuMap[r.sku] = { pallets: 0, units: 0, tonnage: 0 };
      skuMap[r.sku].pallets++;
      skuMap[r.sku].units += qty;
      skuMap[r.sku].tonnage += mt;
    }

    // Gaps between consecutive tickets (record any gap >= 5 min)
    let avgGapMins: number | null = null;
    if (rows.length >= 2) {
      const gapVals: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        const diff = (new Date(rows[i].created_at).getTime() - new Date(rows[i-1].created_at).getTime()) / 60000;
        gapVals.push(diff);
        if (diff >= 5) {
          gapsList.push({ gapStartUtc: rows[i-1].created_at, gapMins: Math.round(diff) });
        }
      }
      avgGapMins = Math.round(gapVals.reduce((a, b) => a + b, 0) / gapVals.length);
    }

    const lastRow = rows[rows.length - 1];
    result[line] = {
      line, pallets, units,
      tonnage: Math.round(tonnageLine * 100000) / 100000,
      avgGapMins, gaps: gapsList, skus: skuMap,
      lastTicketAt: lastRow ? new Date(lastRow.created_at) : null,
    };
  }

  return result;
}

// ── Idle detection ────────────────────────────────────────────────────────────

interface IdleFlag {
  line: string;
  idleMins: number;
}

function detectIdle(
  metrics: Record<string, LineMetrics>,
  windowEnd: Date,   // UTC
  thresholdMins = 30
): IdleFlag[] {
  const flags: IdleFlag[] = [];
  for (const line of LINES) {
    const m = metrics[line];
    const last = m.lastTicketAt;
    const idleMins = last
      ? Math.round((windowEnd.getTime() - last.getTime()) / 60000)
      : null;
    if (idleMins !== null && idleMins >= thresholdMins) {
      flags.push({ line, idleMins });
    } else if (!last) {
      // No tickets at all in this window
      flags.push({ line, idleMins: -1 }); // -1 = no tickets at all
    }
  }
  return flags;
}

// ── Hourly report ─────────────────────────────────────────────────────────────

async function buildHourlyReport(
  sb: ReturnType<typeof createClient>
): Promise<string> {
  const now = eatNow();
  // Cron fires at top of hour — report on the hour that just completed (look back 1hr)
  const eatHourEnd = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    now.getUTCHours(), 0, 0, 0
  ));
  const eatHourStart = new Date(eatHourEnd.getTime() - 60 * 60 * 1000);

  // Convert EAT window to UTC for query (subtract 3h offset)
  const utcHourStart = new Date(eatHourStart.getTime() - EAT_OFFSET_MS);
  const utcHourEnd   = new Date(eatHourEnd.getTime()   - EAT_OFFSET_MS);

  // Shift start in EAT
  const eatHour = now.getUTCHours();
  const isDay   = eatHour >= 7 && eatHour < 19;
  const shiftLabel = isDay ? "Day Shift" : "Night Shift";
  const shiftStartHour = isDay ? 7 : 19;
  const eatShiftStart = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    shiftStartHour, 0, 0, 0
  ));
  // Night shift may have started yesterday
  let utcShiftStart = new Date(eatShiftStart.getTime() - EAT_OFFSET_MS);
  if (!isDay && eatHour < 7) {
    utcShiftStart = new Date(utcShiftStart.getTime() - 24 * 60 * 60 * 1000);
  }

  // Prev hour for SKU comparison
  const utcPrevStart = new Date(utcHourStart.getTime() - 60 * 60 * 1000);
  const utcPrevEnd   = utcHourStart;

  const [thisHrTickets, prevHrTickets, shiftTickets, skuData, downtimeEvents] = await Promise.all([
    fetchTickets(sb, utcHourStart, utcHourEnd),
    fetchTickets(sb, utcPrevStart, utcPrevEnd),
    fetchTickets(sb, utcShiftStart, utcHourEnd),
    fetchSkuData(sb),
    fetchDowntimeEvents(sb, utcHourStart, utcHourEnd),
  ]);

  const { names: skuNames, weights: skuWeights } = skuData;

  const thisHrMetrics  = computeLineMetrics(thisHrTickets, skuWeights);
  const prevHrMetrics  = computeLineMetrics(prevHrTickets, skuWeights);
  const shiftMetrics   = computeLineMetrics(shiftTickets,  skuWeights);
  const idleFlags      = detectIdle(thisHrMetrics, utcHourEnd, 30);

  // Helper: find a logged downtime event for a given gap (10-sec tolerance)
  function findDt(line: string, gapStartUtc: string): DowntimeEvent | null {
    const ts = new Date(gapStartUtc).getTime();
    return downtimeEvents.find(ev =>
      ev.production_line === line &&
      Math.abs(new Date(ev.gap_start).getTime() - ts) < 10000
    ) ?? null;
  }

  const windowLabel = `${fmtTime(eatHourStart)}–${fmtTime(eatHourEnd)}`;
  const dateLabel   = fmtDate(now);

  let msg = `⚙️ RetiFlux™ · Production Pulse\n`;
  msg    += `🕐 ${windowLabel} · ${shiftLabel} · ${dateLabel}\n\n`;
  msg    += `──────────────────────\n`;

  let thisHrTotalPallets = 0, thisHrTotalUnits = 0;

  for (const line of LINES) {
    const cur  = thisHrMetrics[line];
    const prev = prevHrMetrics[line];
    const idle = idleFlags.find((f) => f.line === line);
    const isIdle = idle && (cur.pallets === 0);

    msg += `LINE: ${line}\n`;

    if (isIdle) {
      const mins = idle!.idleMins === -1 ? "60+" : String(idle!.idleMins);
      msg += `  ⚠️ No tickets · idle ${mins} mins\n`;
      // Show any logged downtime reason covering this idle window
      const dt = downtimeEvents.find(ev => ev.production_line === line);
      if (dt) {
        msg += `  📋 ${dt.category} › ${dt.sub_category}`;
        if (dt.description) msg += ` — ${dt.description}`;
        msg += `\n`;
      }
    } else {
      // ── Per-SKU breakdown ──
      for (const [sku, skuStat] of Object.entries(cur.skus)) {
        const skuName  = skuNames[sku] || sku;
        const prevSkuD = prev.skus[sku];
        const skuPct   = prevSkuD ? pct(skuStat.pallets, prevSkuD.pallets) : "new";
        msg += `  ${sku} · ${skuName}\n`;
        msg += `    ${skuStat.pallets} pallet${skuStat.pallets !== 1 ? "s" : ""} · ${skuStat.units.toLocaleString()} units`;
        if (skuStat.tonnage > 0) msg += ` · ${skuStat.tonnage.toFixed(5)} MT`;
        msg += `\n`;
        msg += `    vs last hr: ${prevSkuD ? `${prevSkuD.pallets} pal · ${prevSkuD.units.toLocaleString()} u` : "—"}  ${skuPct}\n`;
      }

      // ── Line totals ──
      const gapStr = cur.avgGapMins !== null ? `${cur.avgGapMins} min avg` : "—";
      const tonStr = cur.tonnage > 0 ? ` · ${cur.tonnage.toFixed(5)} MT` : "";
      msg += `  Total: ${cur.pallets} pallets · ${cur.units.toLocaleString()} units${tonStr}\n`;
      msg += `  Avg gap: ${gapStr}\n`;

      // ── Gap explanations ──
      if (cur.gaps.length > 0) {
        msg += `  ── Gaps ──\n`;
        for (const gap of cur.gaps) {
          const eatStart = toEAT(new Date(gap.gapStartUtc));
          const label = fmtTime(eatStart);
          const dt    = findDt(line, gap.gapStartUtc);
          if (dt) {
            msg += `  ${label} +${gap.gapMins}m: ${dt.category} › ${dt.sub_category}`;
            if (dt.description) msg += ` — ${dt.description}`;
            msg += `\n`;
          } else if (gap.gapMins >= 15) {
            // Only surface unlogged gaps >= 15 min to avoid noise
            msg += `  ${label} +${gap.gapMins}m: ⚠ No reason logged\n`;
          }
        }
      }
    }

    thisHrTotalPallets += cur.pallets;
    thisHrTotalUnits   += cur.units;
    msg += "\n";
  }

  const shiftTotalPallets = Object.values(shiftMetrics).reduce((a, m) => a + m.pallets, 0);
  const shiftTotalUnits   = Object.values(shiftMetrics).reduce((a, m) => a + m.units, 0);
  const thisHrTotalTonnage  = Object.values(thisHrMetrics).reduce((a, m) => a + m.tonnage, 0);
  const shiftTotalTonnage   = Object.values(shiftMetrics).reduce((a, m) => a + m.tonnage, 0);

  const hrTonStr    = thisHrTotalTonnage  > 0 ? ` · ${thisHrTotalTonnage.toFixed(5)} MT`  : "";
  const shiftTonStr = shiftTotalTonnage   > 0 ? ` · ${shiftTotalTonnage.toFixed(5)} MT`   : "";

  msg += `──────────────────────\n`;
  msg += `This hour:         ${thisHrTotalPallets} pallets · ${thisHrTotalUnits.toLocaleString()} units${hrTonStr}\n`;
  msg += `${shiftLabel} so far: ${shiftTotalPallets} pallets · ${shiftTotalUnits.toLocaleString()} units${shiftTonStr} (as of ${fmtTime(eatHourEnd)})\n`;
  msg += `──────────────────────\n`;

  // Idle flag summary
  const activeIdleFlags = idleFlags.filter((f) => f.idleMins !== 0 && thisHrMetrics[f.line].pallets === 0);
  if (activeIdleFlags.length === 0) {
    msg += `✅ All lines active\n`;
  } else if (activeIdleFlags.length === LINES.length) {
    msg += `🚨 FLOOR ALERT — ALL LINES QUIET\n`;
    msg += `  No tickets recorded across all lines\n`;
    const mins = activeIdleFlags[0].idleMins === -1 ? "60+" : String(Math.max(...activeIdleFlags.map((f) => f.idleMins)));
    msg += `  for ${mins}+ mins · Immediate attention required\n`;
  } else if (activeIdleFlags.length >= 2) {
    msg += `⚠️ MULTIPLE LINES QUIET\n`;
    for (const f of activeIdleFlags) {
      const mins = f.idleMins === -1 ? "60+" : String(f.idleMins);
      msg += `  ${f.line} · idle ${mins} mins\n`;
    }
  } else {
    msg += `⚠️ IDLE FLAGS\n`;
    for (const f of activeIdleFlags) {
      const mins = f.idleMins === -1 ? "60+" : String(f.idleMins);
      msg += `  ${f.line} · no ticket in ${mins} mins\n`;
    }
  }

  msg += `──────────────────────\n`;
  msg += `RetiFlux™ · NexGridCore DataLabs`;

  return msg;
}

// ── End-of-shift report ───────────────────────────────────────────────────────

async function buildShiftReport(
  sb: ReturnType<typeof createClient>,
  shift: "day" | "night"
): Promise<string> {
  const now = eatNow();

  // Shift window boundaries in EAT (as UTC Date objects for DB queries)
  function shiftBounds(shiftType: "day" | "night", offsetDays = 0): [Date, Date] {
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    base.setUTCDate(base.getUTCDate() + offsetDays);

    if (shiftType === "day") {
      // 07:00–19:00 EAT = 04:00–16:00 UTC same day
      return [
        new Date(base.getTime() + 4 * 3600000),
        new Date(base.getTime() + 16 * 3600000),
      ];
    } else {
      // 19:00–07:00 EAT = 16:00 UTC day-1 → 04:00 UTC day
      return [
        new Date(base.getTime() - 8 * 3600000),   // 16:00 UTC prev day
        new Date(base.getTime() + 4 * 3600000),   // 04:00 UTC today
      ];
    }
  }

  const [curStart, curEnd]   = shiftBounds(shift, 0);
  // Previous same-type shift (2 shifts back = 24h for same type)
  const [prevStart, prevEnd] = shiftBounds(shift, -1);

  // 7-day average: same shift type for the past 7 occurrences
  const sevenDayWindows: [Date, Date][] = [];
  for (let d = 1; d <= 7; d++) {
    sevenDayWindows.push(shiftBounds(shift, -d));
  }

  const [curTickets, prevTickets, skuNames] = await Promise.all([
    fetchTickets(sb, curStart, curEnd),
    fetchTickets(sb, prevStart, prevEnd),
    fetchSkuNames(sb),
  ]);

  const sevenDayTickets = await Promise.all(
    sevenDayWindows.map(([s, e]) => fetchTickets(sb, s, e))
  );

  const curMetrics  = computeLineMetrics(curTickets);
  const prevMetrics = computeLineMetrics(prevTickets);
  const sevenMetrics = sevenDayTickets.map((t) => computeLineMetrics(t));

  function avg7(fn: (m: Record<string, LineMetrics>) => number): number {
    const vals = sevenMetrics.map(fn).filter((v) => v > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }

  const shiftLabel = shift === "day" ? "Day Shift" : "Night Shift";
  const shiftTime  = shift === "day" ? "07:00 → 19:00" : "19:00 → 07:00";
  const emoji      = shift === "day" ? "🌅" : "🌙";

  let msg = `📋 RetiFlux™ · End of Shift Report\n`;
  msg    += `${emoji} ${shiftLabel} · ${shiftTime}\n`;
  msg    += `📅 ${fmtDate(now)}\n\n`;
  msg    += `━━━━━━━━━━━━━━━━━━━━━\n`;

  // Per-line + per-SKU breakdown
  for (const line of LINES) {
    const cur  = curMetrics[line];
    const prev = prevMetrics[line];

    msg += `LINE: ${line}\n`;

    if (cur.pallets === 0) {
      msg += `  — No production this shift\n`;
    } else {
      for (const [sku, skuData] of Object.entries(cur.skus)) {
        const skuName   = skuNames[sku] || sku;
        const prevSkuD  = prev.skus[sku];
        const avg7Sku   = Math.round(
          sevenMetrics
            .map((sm) => sm[line].skus[sku]?.pallets || 0)
            .filter((v) => v > 0)
            .reduce((a, b, _, arr) => a + b / arr.length, 0)
        );
        const avg7Units = Math.round(
          sevenMetrics
            .map((sm) => sm[line].skus[sku]?.units || 0)
            .filter((v) => v > 0)
            .reduce((a, b, _, arr) => a + b / arr.length, 0)
        );
        msg += `  ${sku} · ${skuName}\n`;
        msg += `    This shift:  ${skuData.pallets} pallets · ${skuData.units.toLocaleString()} units\n`;
        if (prevSkuD) {
          msg += `    Last shift:  ${prevSkuD.pallets} pallets · ${prevSkuD.units.toLocaleString()} units  ${pct(skuData.pallets, prevSkuD.pallets)}\n`;
        } else {
          msg += `    Last shift:  — (not run)\n`;
        }
        if (avg7Sku > 0) {
          msg += `    7-day avg:   ${avg7Sku} pallets · ${avg7Units.toLocaleString()} units  ${pct(skuData.pallets, avg7Sku)}\n`;
        }
      }
      const gapStr = cur.avgGapMins !== null ? `${cur.avgGapMins} mins` : "—";
      msg += `  Avg gap: ${gapStr}\n`;
      msg += `  Line total: ${cur.pallets} pallets · ${cur.units.toLocaleString()} units\n`;
    }

    msg += "\n";
  }

  // Hourly breakdown bar chart
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `⏱️ HOURLY BREAKDOWN\n`;

  const hours = shift === "day"
    ? [7,8,9,10,11,12,13,14,15,16,17,18]
    : [19,20,21,22,23,0,1,2,3,4,5,6];

  const hrCounts: Record<number, number> = {};
  for (const t of curTickets) {
    const eatT = toEAT(new Date(t.created_at));
    const h = eatT.getUTCHours();
    hrCounts[h] = (hrCounts[h] || 0) + 1;
  }

  const counts = hours.map((h) => hrCounts[h] || 0);
  const maxCount = Math.max(...counts, 1);
  let peakHours: number[] = [], slowHours: number[] = [];
  const maxVal = Math.max(...counts);
  const minVal = Math.min(...counts);
  peakHours = hours.filter((h) => (hrCounts[h] || 0) === maxVal);
  slowHours = hours.filter((h) => (hrCounts[h] || 0) === minVal);

  for (let i = 0; i < hours.length; i++) {
    const h = hours[i];
    const c = counts[i];
    const b = bar(c, maxCount);
    const label = `${String(h).padStart(2,"0")}:00`;
    const peak  = c === maxVal && maxVal > 0 ? "  ← PEAK"    : "";
    const slow  = c === minVal && i > 0      ? "  ← SLOWEST" : "";
    msg += `  ${label}  ${b.padEnd(8)} ${String(c).padStart(2)} tickets${peak || slow}\n`;
  }

  const peakStr = peakHours.map((h) => `${String(h).padStart(2,"0")}:00`).join(" & ");
  const slowStr = slowHours.map((h) => `${String(h).padStart(2,"0")}:00`).join(" & ");
  msg += `  Peak: ${peakStr} · ${maxVal} tickets\n`;
  msg += `  Slowest: ${slowStr} · ${minVal} tickets\n`;

  // Trend analysis
  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 TREND ANALYSIS\n`;

  const curTotal  = Object.values(curMetrics).reduce((a, m) => a + m.pallets, 0);
  const curUnits  = Object.values(curMetrics).reduce((a, m) => a + m.units, 0);
  const prevTotal = Object.values(prevMetrics).reduce((a, m) => a + m.pallets, 0);
  const prevUnits = Object.values(prevMetrics).reduce((a, m) => a + m.units, 0);
  const avg7Total = avg7((sm) => Object.values(sm).reduce((a, m) => a + m.pallets, 0));
  const avg7Units = avg7((sm) => Object.values(sm).reduce((a, m) => a + m.units, 0));
  const prevShiftLabel = shift === "day" ? "NS" : "DS";

  msg += `  Total this shift:  ${curTotal} pallets · ${curUnits.toLocaleString()} units\n`;
  msg += `  Last shift (${prevShiftLabel}):   ${prevTotal} pallets · ${prevUnits.toLocaleString()} units  ${pct(curTotal, prevTotal)}\n`;
  msg += `  7-day shift avg:   ${avg7Total} pallets · ${avg7Units.toLocaleString()} units\n`;
  msg += `  vs 7-day avg:      ${pct(curTotal, avg7Total)}\n\n`;

  for (const line of LINES) {
    const cur  = curMetrics[line];
    const prev = prevMetrics[line];
    const avg7Line = avg7((sm) => sm[line].pallets);
    const avg7LineUnits = avg7((sm) => sm[line].units);
    if (cur.pallets === 0 && prev.pallets === 0) continue;
    msg += `  ${line}: ${cur.pallets} pallets · ${cur.units.toLocaleString()} units\n`;
    if (prev.pallets > 0) {
      msg += `         Last shift: ${prev.pallets} pallets · ${prev.units.toLocaleString()} units  ${pct(cur.pallets, prev.pallets)}\n`;
    }
    if (avg7Line > 0) {
      msg += `         7-day avg:  ${avg7Line} pallets · ${avg7LineUnits.toLocaleString()} units  ${pct(cur.pallets, avg7Line)}\n`;
    }
  }

  // Flags
  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;

  // Compute idle periods during this shift — flag any gap of 60+ mins
  const idleEvents: string[] = [];
  for (const line of LINES) {
    const lineTickets = curTickets
      .filter((t) => t.production_line?.trim() === line)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (lineTickets.length === 0) continue;
    for (let i = 1; i < lineTickets.length; i++) {
      const gapMins = (new Date(lineTickets[i].created_at).getTime() - new Date(lineTickets[i-1].created_at).getTime()) / 60000;
      if (gapMins >= 60) {
        const gapStart = fmtTime(toEAT(new Date(lineTickets[i-1].created_at)));
        const gapEnd   = fmtTime(toEAT(new Date(lineTickets[i].created_at)));
        idleEvents.push(`  ${line} · idle ${gapStart}–${gapEnd} (${Math.round(gapMins)} mins)`);
      }
    }
  }

  // All-lines-quiet periods
  const sortedAll = curTickets.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  let quietEvents: string[] = [];
  if (sortedAll.length >= 2) {
    for (let i = 1; i < sortedAll.length; i++) {
      const gapMins = (new Date(sortedAll[i].created_at).getTime() - new Date(sortedAll[i-1].created_at).getTime()) / 60000;
      if (gapMins >= 30) {
        const gs = fmtTime(toEAT(new Date(sortedAll[i-1].created_at)));
        const ge = fmtTime(toEAT(new Date(sortedAll[i].created_at)));
        quietEvents.push(`  🚨 ALL LINES QUIET · ${gs}–${ge} (${Math.round(gapMins)} mins)`);
      }
    }
  }

  const zeroLines = LINES.filter((l) => curMetrics[l].pallets === 0);
  const hasFlags  = idleEvents.length > 0 || quietEvents.length > 0 || zeroLines.length > 0;

  if (!hasFlags) {
    msg += `✅ NO FLAGS THIS SHIFT\n`;
  } else {
    msg += `⚠️ FLAGS THIS SHIFT\n`;
    for (const e of quietEvents)  msg += `${e}\n`;
    for (const e of idleEvents)   msg += `${e}\n`;
    for (const l of zeroLines) {
      msg += `  ⚠️ ${l} · zero production this shift\n`;
    }
    // Large output drop
    if (prevTotal > 0 && pct(curTotal, prevTotal).includes("▼")) {
      const dropPct = Math.round(((prevTotal - curTotal) / prevTotal) * 100);
      if (dropPct >= 20) {
        msg += `  Output ▼ ${dropPct}% vs last shift\n`;
        if (avg7Total > 0 && curTotal < avg7Total * 0.85) {
          msg += `    Significantly below 7-day average\n`;
        }
      }
    }
  }

  // Shift totals
  const activeLinesCount = LINES.filter((l) => curMetrics[l].pallets > 0).length;
  const busiestLine = LINES.reduce((best, l) =>
    curMetrics[l].pallets > curMetrics[best].pallets ? l : best, LINES[0]);

  const firstTicket = curTickets.length
    ? fmtTime(toEAT(new Date(Math.min(...curTickets.map((t) => new Date(t.created_at).getTime())))))
    : "—";
  const lastTicket = curTickets.length
    ? fmtTime(toEAT(new Date(Math.max(...curTickets.map((t) => new Date(t.created_at).getTime())))))
    : "—";

  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `SHIFT TOTALS\n`;
  msg += `  Lines active: ${activeLinesCount} of ${LINES.length}\n`;
  msg += `  Total pallets: ${curTotal}\n`;
  msg += `  Total units: ${curUnits.toLocaleString()}\n`;
  msg += `  Busiest line: ${busiestLine} · ${curMetrics[busiestLine].pallets} pallets\n`;
  msg += `  First ticket: ${firstTicket} · Last: ${lastTicket}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `RetiFlux™ · NexGridCore DataLabs`;

  return msg;
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    let body: { type?: string; shift?: string; mock_now?: string } = {};
    try {
      const text = await req.text();
      if (text.trim().startsWith("{")) body = JSON.parse(text);
    } catch { /* ignore — use defaults */ }
    const type  = body.type  || "hourly";
    const shift = (body.shift || "day") as "day" | "night";

    // Optional: override "now" for historical test runs
    // mock_now should be a UTC ISO string, e.g. "2026-04-13T16:00:00Z" = 19:00 EAT Apr 13
    _mockNowUtc = body.mock_now ? new Date(body.mock_now) : null;

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    let message: string;
    if (type === "end_of_shift") {
      message = await buildShiftReport(sb, shift);
    } else {
      message = await buildHourlyReport(sb);
    }

    await broadcast(message);

    return new Response(JSON.stringify({ ok: true, type, sent_to: getRecipients().length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
