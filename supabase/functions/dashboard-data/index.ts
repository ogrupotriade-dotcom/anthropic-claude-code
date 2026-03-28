// VDB Dashboard Data API - Returns JSON for GitHub Pages dashboard
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const TOKEN = "vdb2026";

async function buildDashboardData(sb: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  // Meta Ads daily - use ad level where available, campaign level as fallback
  const { data: metaAd, error: metaAdErr } = await sb
    .from("bi_meta_insights")
    .select("date_start, spend, impressions, reach, clicks, leads, purchases, purchase_value")
    .eq("level", "ad");
  const adDates = new Set((metaAd || []).map((r) => r.date_start));
  const { data: metaCampaign, error: metaCampErr } = await sb
    .from("bi_meta_insights")
    .select("date_start, spend, impressions, reach, clicks, leads, purchases, purchase_value")
    .eq("level", "campaign");
  const campaignOnly = (metaCampaign || []).filter((r) => !adDates.has(r.date_start));
  const metaDaily = [...(metaAd || []), ...campaignOnly];
  // Debug: log if queries failed
  if (metaAdErr || metaCampErr) {
    console.error("Meta query errors:", { metaAdErr, metaCampErr });
  }

  const metaDailyMap = new Map<string, Record<string, number>>();
  for (const row of metaDaily) {
    const d = row.date_start;
    const cur = metaDailyMap.get(d) || { spend: 0, impr: 0, reach: 0, clicks: 0, leads: 0, purch: 0, rev: 0 };
    cur.spend += Number(row.spend) || 0;
    cur.impr += Number(row.impressions) || 0;
    cur.reach += Number(row.reach) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.purch += Number(row.purchases) || 0;
    cur.rev += Number(row.purchase_value) || 0;
    metaDailyMap.set(d, cur);
  }
  const metaDailyArr = Array.from(metaDailyMap.entries())
    .map(([d, v]) => ({ d, ...v }))
    .sort((a, b) => a.d.localeCompare(b.d));

  // Campaigns (use campaign level for complete data)
  const { data: metaWithCampaign } = await sb
    .from("bi_meta_insights")
    .select("campaign_name, spend, impressions, clicks, leads, purchases")
    .eq("level", "campaign");
  const campaignMap = new Map<string, Record<string, number>>();
  for (const row of metaWithCampaign || []) {
    const name = row.campaign_name || "Desconhecida";
    const cur = campaignMap.get(name) || { spend: 0, impr: 0, clicks: 0, leads: 0, purch: 0 };
    cur.spend += Number(row.spend) || 0;
    cur.impr += Number(row.impressions) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.purch += Number(row.purchases) || 0;
    campaignMap.set(name, cur);
  }
  const campaigns = Array.from(campaignMap.entries())
    .map(([campaign_name, v]) => ({ campaign_name, ...v }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 20);

  // GA4
  const { data: ga4Daily } = await sb.from("bi_ga4_daily").select("*").order("date", { ascending: true });
  const { data: ga4Sources } = await sb.from("bi_ga4_traffic_sources").select("*");
  const sourceMap = new Map<string, Record<string, number>>();
  for (const row of ga4Sources || []) {
    const src = row.source || row.session_source || "direct";
    const cur = sourceMap.get(src) || { sessions: 0, users: 0, new_users: 0 };
    cur.sessions += Number(row.sessions) || 0;
    cur.users += Number(row.users) || 0;
    cur.new_users += Number(row.new_users) || 0;
    sourceMap.set(src, cur);
  }
  const sources = Array.from(sourceMap.entries()).map(([src, v]) => ({ src, ...v })).sort((a, b) => b.sessions - a.sessions);

  const { data: ga4Pages } = await sb.from("bi_ga4_pages").select("*");
  const pageMap = new Map<string, Record<string, unknown>>();
  for (const row of ga4Pages || []) {
    const path = row.page_path || "/";
    const cur = pageMap.get(path) || { page_title: row.page_title || path, views: 0, users: 0, eng: 0 };
    (cur as Record<string, unknown>).views = (Number((cur as Record<string, unknown>).views) || 0) + (Number(row.views || row.screen_page_views) || 0);
    (cur as Record<string, unknown>).users = (Number((cur as Record<string, unknown>).users) || 0) + (Number(row.users || row.total_users) || 0);
    (cur as Record<string, unknown>).eng = (Number((cur as Record<string, unknown>).eng) || 0) + (Number(row.engagement_rate || row.eng) || 0);
    pageMap.set(path, cur);
  }
  const pages = Array.from(pageMap.entries()).map(([page_path, v]) => ({ page_path, ...v })).sort((a, b) => Number(b.views) - Number(a.views));

  // Instagram
  const { data: igDaily } = await sb.from("bi_instagram_daily").select("*").order("date", { ascending: true });
  const { data: igPosts } = await sb.from("bi_instagram_posts").select("*").order("total_interactions", { ascending: false }).limit(50);

  // Leads
  const { data: leads } = await sb.from("bi_leads").select("*").order("lead_captured_at", { ascending: false });

  // Sales
  const { data: sales } = await sb.from("bi_sales").select("*");

  // Survey
  const { data: surveyRows } = await sb.from("bi_survey_responses").select("*");
  const surveyQuestions = [
    { key: "p1_receio", label: "Qual seu maior receio?" },
    { key: "p5_cenario", label: "Qual cen\u00e1rio mais se parece com o seu?" },
    { key: "p6_area_dificuldade", label: "\u00c1rea de maior dificuldade" },
    { key: "p7_ponto_urgente", label: "Ponto mais urgente" },
    { key: "p8_carteira_atual", label: "Carteira atual" },
    { key: "p9_experiencia_anterior", label: "Experi\u00eancia anterior" },
    { key: "p10_capital_disponivel", label: "Capital dispon\u00edvel" },
    { key: "p11_maior_incomodo", label: "Maior inc\u00f4modo" },
    { key: "p12_meta_financeira", label: "Meta financeira" },
  ];
  const distributions: Record<string, { ans: string; cnt: number }[]> = {};
  for (const q of surveyQuestions) {
    const countMap = new Map<string, number>();
    for (const row of surveyRows || []) {
      const val = (row as Record<string, unknown>)[q.key];
      if (val && String(val).trim()) {
        const ans = String(val).trim();
        countMap.set(ans, (countMap.get(ans) || 0) + 1);
      }
    }
    distributions[q.key] = Array.from(countMap.entries()).map(([ans, cnt]) => ({ ans, cnt })).sort((a, b) => b.cnt - a.cnt).slice(0, 10);
  }

  return {
    generated: new Date().toISOString(),
    meta: { daily: metaDailyArr, campaigns },
    ga4: {
      daily: (ga4Daily || []).map((r) => ({ date: r.date, sessions: Number(r.sessions) || 0, new_users: Number(r.new_users) || 0 })),
      sources,
      pages,
    },
    ig: {
      daily: (igDaily || []).map((r) => ({ date: r.date, reach: Number(r.reach) || 0, views: Number(r.views || r.impressions) || 0, total_interactions: Number(r.total_interactions) || 0, like_count: Number(r.like_count || r.likes) || 0, saves: Number(r.saves) || 0 })),
      posts: (igPosts || []).map((r) => ({ media_type: r.media_type || "IMAGE", caption: r.caption || "", reach: Number(r.reach) || 0, views: Number(r.views || r.impressions) || 0, like_count: Number(r.like_count || r.likes) || 0, saves: Number(r.saves) || 0, total_interactions: Number(r.total_interactions) || 0 })),
    },
    leads: (leads || []).map((r) => ({ name: r.name || "", email: r.email || "", utm_source: r.utm_source || "", utm_medium: r.utm_medium || "", utm_campaign: r.utm_campaign || "", device: r.device || "", lead_captured_at: r.lead_captured_at || "" })),
    sales: (sales || []).map((r) => ({ revenue: Number(r.revenue) || 0, sale_at: r.sale_at || "", email: r.email || "", buyer_name: r.buyer_name || "", product_name: r.product_name || "", lead_id: r.lead_id || null, utm_source: r.utm_source || "", utm_medium: r.utm_medium || "", utm_campaign: r.utm_campaign || "", status: r.status || "" })),
    survey: { total: (surveyRows || []).length, questions: surveyQuestions, distributions },
  };
}

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

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      db: { schema: "public" },
      auth: { persistSession: false },
    });
    const data = await buildDashboardData(sb);
    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
