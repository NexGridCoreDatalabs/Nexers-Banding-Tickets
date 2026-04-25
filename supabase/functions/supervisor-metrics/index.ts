import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

type Scope = "today" | "all";

interface TicketRow {
  sku: string | null;
  qty: number | null;
  uom: string | null;
  production_line: string | null;
  created_at: string;
}

interface SkuRow {
  sku: string;
  units_per_carton: number | null;
  net_weight_kg_per_unit: number | null;
  uom: string | null;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
}

function toEat(d: Date): Date {
  return new Date(d.getTime() + EAT_OFFSET_MS);
}

function startOfEatDayUtc(nowUtc: Date): Date {
  const eat = toEat(nowUtc);
  const utcMidnightOfEat = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate());
  return new Date(utcMidnightOfEat - EAT_OFFSET_MS);
}

function topOfCurrentHourUtc(nowUtc: Date): Date {
  return new Date(Date.UTC(
    nowUtc.getUTCFullYear(),
    nowUtc.getUTCMonth(),
    nowUtc.getUTCDate(),
    nowUtc.getUTCHours(),
    0,
    0,
    0,
  ));
}

function fmtAsOfEat(d: Date): string {
  const eat = toEat(d);
  const hh = String(eat.getUTCHours()).padStart(2, "0");
  const mm = String(eat.getUTCMinutes()).padStart(2, "0");
  const dd = String(eat.getUTCDate()).padStart(2, "0");
  const mo = String(eat.getUTCMonth() + 1).padStart(2, "0");
  const yy = eat.getUTCFullYear();
  return `${yy}-${mo}-${dd} ${hh}:${mm} EAT`;
}

function calcTonnes(ticket: TicketRow, skuMeta: Map<string, SkuRow>): number | null {
  const qty = Number(ticket.qty || 0);
  if (qty <= 0 || !ticket.sku) return 0;
  const meta = skuMeta.get(ticket.sku);
  if (!meta || meta.net_weight_kg_per_unit == null) return null;

  const net = Number(meta.net_weight_kg_per_unit);
  if (!isFinite(net) || net <= 0) return null;
  const skuUom = String(meta.uom || ticket.uom || "").trim().toUpperCase();
  if (skuUom === "BUCKET" || skuUom === "BKT") {
    return (qty * net) / 1000;
  }
  const upc = Number(meta.units_per_carton);
  if (!isFinite(upc) || upc <= 0) return null;
  return (qty * upc * net) / 1000;
}

function aggregateTickets(tickets: TicketRow[], skuMeta: Map<string, SkuRow>) {
  let units = 0;
  let pallets = 0;
  let tonnes = 0;
  let tonnesKnown = true;
  const bySku: Record<string, { units: number; pallets: number; tonnes: number; tonnesKnown: boolean; production_line: string | null }> = {};

  for (const t of tickets) {
    const qty = Number(t.qty || 0);
    units += qty;
    pallets += 1;
    const key = String(t.sku || "UNKNOWN");
    if (!bySku[key]) bySku[key] = { units: 0, pallets: 0, tonnes: 0, tonnesKnown: true, production_line: t.production_line || null };
    bySku[key].units += qty;
    bySku[key].pallets += 1;

    const tk = calcTonnes(t, skuMeta);
    if (tk == null) {
      tonnesKnown = false;
      bySku[key].tonnesKnown = false;
    } else {
      tonnes += tk;
      bySku[key].tonnes += tk;
    }
  }

  let topSku: null | { sku: string; units: number; pallets: number; tonnes: number | null; production_line: string | null } = null;
  for (const sku of Object.keys(bySku)) {
    const row = bySku[sku];
    if (!topSku || row.units > topSku.units) {
      topSku = {
        sku,
        units: row.units,
        pallets: row.pallets,
        tonnes: row.tonnesKnown ? row.tonnes : null,
        production_line: row.production_line,
      };
    }
  }

  const skuBreakdown = Object.keys(bySku)
    .map((sku) => {
      const row = bySku[sku];
      return {
        sku,
        units: row.units,
        pallets: row.pallets,
        tonnes: row.tonnesKnown ? row.tonnes : null,
        production_line: row.production_line,
      };
    })
    .sort((a, b) => b.units - a.units)
    .slice(0, 8);

  return { units, pallets, tonnes: tonnesKnown ? tonnes : null, topSku, skuBreakdown };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const scope = (String(body.scope || "today").toLowerCase() === "all" ? "all" : "today") as Scope;
    const lineFilter = body.line ? String(body.line) : null;

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const nowUtc = new Date();
    const officialAsOf = topOfCurrentHourUtc(nowUtc);
    const officialStart = scope === "today" ? startOfEatDayUtc(nowUtc) : new Date(nowUtc.getTime() - 24 * 60 * 60 * 1000);

    const baseQuery = sb
      .from("tickets")
      .select("sku, qty, uom, production_line, created_at")
      .eq("voided", false);

    const officialQuery = baseQuery
      .gte("created_at", officialStart.toISOString())
      .lt("created_at", officialAsOf.toISOString());

    const deltaQuery = sb
      .from("tickets")
      .select("sku, qty, uom, production_line, created_at")
      .eq("voided", false)
      .gte("created_at", officialAsOf.toISOString())
      .lt("created_at", nowUtc.toISOString());

    const skuQuery = sb
      .from("skus")
      .select("sku, units_per_carton, net_weight_kg_per_unit, uom");

    const [officialRes, deltaRes, skuRes] = await Promise.all([
      lineFilter ? officialQuery.eq("production_line", lineFilter) : officialQuery,
      lineFilter ? deltaQuery.eq("production_line", lineFilter) : deltaQuery,
      skuQuery,
    ]);

    if (officialRes.error) throw officialRes.error;
    if (deltaRes.error) throw deltaRes.error;
    if (skuRes.error) throw skuRes.error;

    const skuMap = new Map<string, SkuRow>();
    (skuRes.data || []).forEach((r: SkuRow) => skuMap.set(r.sku, r));

    const officialAgg = aggregateTickets((officialRes.data || []) as TicketRow[], skuMap);
    const deltaAgg = aggregateTickets((deltaRes.data || []) as TicketRow[], skuMap);

    return new Response(JSON.stringify({
      ok: true,
      scope,
      line: lineFilter,
      official_as_of: officialAsOf.toISOString(),
      official_as_of_eat: fmtAsOfEat(officialAsOf),
      official: {
        units: officialAgg.units,
        pallets: officialAgg.pallets,
        tonnes: officialAgg.tonnes,
        top_sku: officialAgg.topSku,
        sku_breakdown: officialAgg.skuBreakdown,
      },
      provisional_delta: {
        units: deltaAgg.units,
        pallets: deltaAgg.pallets,
        tonnes: deltaAgg.tonnes,
        sku_breakdown: deltaAgg.skuBreakdown,
      },
      now_utc: nowUtc.toISOString(),
    }), { headers: corsHeaders() });
  } catch (e) {
    console.error("supervisor-metrics error:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
});

