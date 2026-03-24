// VDB Sales Webhook - Receives sales from HeroSpark and manual input
// Inserts into bi_sales table
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const TOKEN = "vdb2026";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token !== TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  // GET: list all sales
  if (req.method === "GET") {
    const { data, error } = await sb
      .from("bi_sales")
      .select("*")
      .order("sale_at", { ascending: false });

    return new Response(JSON.stringify({ sales: data, error }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // POST: insert sale(s)
  if (req.method === "POST") {
    const body = await req.json();
    const source = url.searchParams.get("source") || "manual";

    // HeroSpark webhook format
    if (source === "herospark") {
      const sale = parseHeroSparkWebhook(body);
      if (!sale) {
        return new Response(JSON.stringify({ error: "Could not parse HeroSpark webhook" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await sb.from("bi_sales").upsert(sale, {
        onConflict: "external_id",
      });
      return new Response(JSON.stringify({ ok: !error, inserted: sale, error }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Manual insert: accept single sale or array
    const sales = Array.isArray(body) ? body : [body];
    const rows = sales.map((s: Record<string, unknown>) => ({
      revenue: Number(s.revenue) || 0,
      sale_at: s.sale_at || new Date().toISOString(),
      product: s.product || null,
      customer_name: s.customer_name || null,
      customer_email: s.customer_email || null,
      payment_method: s.payment_method || null,
      status: s.status || "approved",
      source: s.source || "manual",
      external_id: s.external_id || null,
    }));

    const { data, error } = await sb.from("bi_sales").insert(rows);
    return new Response(
      JSON.stringify({ ok: !error, inserted: rows.length, error }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});

function parseHeroSparkWebhook(body: Record<string, unknown>): Record<string, unknown> | null {
  try {
    // HeroSpark sends different formats depending on the event
    // Common fields: purchase, subscriber, product
    const purchase = (body.purchase || body) as Record<string, unknown>;
    const subscriber = (body.subscriber || body.buyer || {}) as Record<string, unknown>;
    const product = (body.product || {}) as Record<string, unknown>;

    const revenue =
      Number(purchase.price) ||
      Number(purchase.original_offer_price) ||
      Number(purchase.value) ||
      Number(body.price) ||
      Number(body.value) ||
      0;

    const saleAt =
      purchase.order_date ||
      purchase.created_at ||
      purchase.approved_date ||
      body.created_at ||
      new Date().toISOString();

    const externalId =
      String(purchase.transaction || purchase.id || body.transaction || body.id || "");

    return {
      revenue: revenue / 100, // HeroSpark sends cents
      sale_at: saleAt,
      product: product.name || purchase.product_name || body.product_name || null,
      customer_name: subscriber.name || body.name || null,
      customer_email: subscriber.email || body.email || null,
      payment_method: purchase.payment_type || purchase.payment_method || body.payment_type || null,
      status: "approved",
      source: "herospark",
      external_id: externalId || null,
    };
  } catch {
    return null;
  }
}
