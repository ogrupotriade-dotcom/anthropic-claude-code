// VDB HeroSpark Webhook - Receives purchase events and inserts into bi_sales
// Replaces broken version that wasn't extracting revenue
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Save raw payload for debugging
  try {
    await sb.from("bi_webhook_log").insert({
      source: "herospark",
      payload: body,
      received_at: new Date().toISOString(),
    });
  } catch {
    // Log table may not exist, that's OK
  }

  // Extract sale data from HeroSpark payload
  // HeroSpark sends flat fields or nested under different keys depending on version
  const sale = extractSaleData(body);

  if (!sale.email) {
    return new Response(
      JSON.stringify({ success: true, email_found: false, message: "Raw saved, no email found" }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Try to match with existing lead for attribution
  let leadData: Record<string, unknown> | null = null;
  if (sale.email) {
    const { data } = await sb
      .from("bi_leads")
      .select("*")
      .eq("email", sale.email)
      .limit(1)
      .maybeSingle();
    leadData = data;
  }

  // Build bi_sales row
  const saleRow: Record<string, unknown> = {
    herospark_transaction_id: sale.transaction_id,
    email: sale.email,
    buyer_name: sale.buyer_name,
    product_name: sale.product_name,
    product_id: sale.product_id || "",
    revenue: sale.revenue,
    payment_method: sale.payment_method,
    status: sale.status || "approved",
    sale_at: sale.sale_at || new Date().toISOString(),
  };

  // Add lead attribution if found
  if (leadData) {
    saleRow.lead_id = leadData.id || null;
    saleRow.utm_source = leadData.utm_source || null;
    saleRow.utm_medium = leadData.utm_medium || null;
    saleRow.utm_campaign = leadData.utm_campaign || null;
    saleRow.utm_content = leadData.utm_content || null;
    saleRow.utm_term = leadData.utm_term || null;
    saleRow.ad_id = leadData.ad_id || null;
    saleRow.campaign_id = leadData.campaign_id || null;
    saleRow.landing_page = leadData.landing_page || null;
    saleRow.device = leadData.device || null;
    saleRow.city = leadData.city || null;

    // Calculate time to sale
    if (leadData.lead_captured_at && sale.sale_at) {
      const leadTime = new Date(leadData.lead_captured_at as string).getTime();
      const saleTime = new Date(sale.sale_at).getTime();
      if (leadTime > 0 && saleTime > leadTime) {
        saleRow.time_to_sale_hours = Math.round((saleTime - leadTime) / 3600000 * 10) / 10;
      }
    }
  }

  // Check for duplicate by transaction ID
  if (sale.transaction_id) {
    const { data: existing } = await sb
      .from("bi_sales")
      .select("id")
      .eq("herospark_transaction_id", sale.transaction_id)
      .maybeSingle();

    if (existing) {
      // Update existing record (in case it was saved with revenue=0 before)
      const { error } = await sb
        .from("bi_sales")
        .update(saleRow)
        .eq("id", existing.id);

      return new Response(
        JSON.stringify({
          success: true,
          email_found: true,
          attribution: leadData ? "matched" : "unmatched",
          action: "updated",
          revenue: sale.revenue,
          error,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  }

  // Insert new sale
  const { error } = await sb.from("bi_sales").insert(saleRow);

  return new Response(
    JSON.stringify({
      success: true,
      email_found: true,
      attribution: leadData ? "matched" : "unmatched",
      action: "inserted",
      revenue: sale.revenue,
      error,
    }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});

interface ExtractedSale {
  transaction_id: string;
  email: string;
  buyer_name: string;
  product_name: string;
  product_id: string;
  revenue: number;
  payment_method: string;
  status: string;
  sale_at: string;
}

function extractSaleData(body: Record<string, unknown>): ExtractedSale {
  // HeroSpark sends data in various formats. Try all known structures.
  const get = (obj: unknown, ...keys: string[]): unknown => {
    if (!obj || typeof obj !== "object") return undefined;
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
    }
    return undefined;
  };

  const purchase = (body.purchase || {}) as Record<string, unknown>;
  const subscriber = (body.subscriber || body.buyer || body.lead || {}) as Record<string, unknown>;
  const product = (body.product || body.offer || {}) as Record<string, unknown>;

  // Email: try subscriber, then body root, then purchase
  const email = String(
    get(subscriber, "email") ||
    get(body, "email", "buyer_email", "subscriber_email") ||
    get(purchase, "email", "buyer_email") ||
    ""
  );

  // Buyer name
  const buyerName = String(
    get(subscriber, "name", "full_name") ||
    get(body, "name", "buyer_name", "subscriber_name") ||
    ""
  );

  // Revenue: HeroSpark may send in cents (integer) or reais (decimal)
  let revenue = 0;
  const rawRevenue =
    get(purchase, "price", "original_offer_price", "total_value", "amount", "value") ||
    get(body, "price", "total_value", "amount", "value", "revenue") ||
    0;
  revenue = Number(rawRevenue) || 0;
  // If value > 10000, assume it's in cents (e.g., 192100 = R$ 1921.00)
  if (revenue > 10000) {
    revenue = revenue / 100;
  }

  // Transaction ID
  const transactionId = String(
    get(purchase, "transaction", "transaction_id", "code", "id") ||
    get(body, "transaction", "transaction_id", "code") ||
    `hs_${Date.now()}`
  );

  // Product
  const productName = String(
    get(product, "name", "title") ||
    get(purchase, "product_name", "offer_name") ||
    get(body, "product_name", "offer_name") ||
    ""
  );

  const productId = String(
    get(product, "id", "code") ||
    get(body, "product_id", "offer_id") ||
    ""
  );

  // Payment method
  const paymentMethod = String(
    get(purchase, "payment_type", "payment_method", "payment") ||
    get(body, "payment_type", "payment_method") ||
    ""
  );

  // Status
  const status = String(
    get(purchase, "status") ||
    get(body, "status") ||
    "approved"
  );

  // Sale date
  const saleAt = String(
    get(purchase, "order_date", "approved_date", "created_at", "confirmed_at") ||
    get(body, "created_at", "order_date", "approved_date", "confirmed_at") ||
    new Date().toISOString()
  );

  return {
    transaction_id: transactionId,
    email,
    buyer_name: buyerName,
    product_name: productName,
    product_id: productId,
    revenue,
    payment_method: paymentMethod,
    status,
    sale_at: saleAt,
  };
}
