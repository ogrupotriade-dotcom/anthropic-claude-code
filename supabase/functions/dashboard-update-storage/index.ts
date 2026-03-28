// VDB Dashboard - Storage Updater
// This Edge Function generates a complete static HTML dashboard with embedded data
// and uploads it to Supabase Storage. Can be called via cron or webhook.
//
// Usage: POST/GET https://<project>.supabase.co/functions/v1/dashboard-update-storage?token=vdb2026
// This updates the file at: https://<project>.supabase.co/storage/v1/object/public/dashboard/index.html

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const TOKEN = "vdb2026";
const BUCKET = "dashboard";
const FILE_PATH = "index.html";

async function buildDashboardData(sb: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  // Meta Ads daily (filter level='ad')
  const { data: metaRaw } = await sb
    .from("bi_meta_insights")
    .select("date_start, campaign_name, spend, impressions, reach, clicks, leads, purchases, revenue")
    .eq("level", "ad");

  const metaDailyMap = new Map<string, Record<string, number>>();
  const campaignMap = new Map<string, Record<string, number>>();

  for (const row of metaRaw || []) {
    // Daily aggregation
    const d = row.date_start;
    const cur = metaDailyMap.get(d) || { spend: 0, impr: 0, reach: 0, clicks: 0, leads: 0, purch: 0, rev: 0 };
    cur.spend += Number(row.spend) || 0;
    cur.impr += Number(row.impressions) || 0;
    cur.reach += Number(row.reach) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.purch += Number(row.purchases) || 0;
    cur.rev += Number(row.revenue) || 0;
    metaDailyMap.set(d, cur);

    // Campaign aggregation
    const name = row.campaign_name || "Desconhecida";
    const cc = campaignMap.get(name) || { spend: 0, impr: 0, clicks: 0, leads: 0, purch: 0 };
    cc.spend += Number(row.spend) || 0;
    cc.impr += Number(row.impressions) || 0;
    cc.clicks += Number(row.clicks) || 0;
    cc.leads += Number(row.leads) || 0;
    cc.purch += Number(row.purchases) || 0;
    campaignMap.set(name, cc);
  }

  const metaDaily = Array.from(metaDailyMap.entries())
    .map(([d, v]) => ({ d, ...v }))
    .sort((a, b) => a.d.localeCompare(b.d));

  const campaigns = Array.from(campaignMap.entries())
    .map(([campaign_name, v]) => ({ campaign_name, ...v }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 20);

  // GA4
  const { data: ga4Daily } = await sb.from("bi_ga4_daily").select("*").order("date", { ascending: true });
  const { data: ga4Sources } = await sb.from("bi_ga4_traffic_sources").select("*");
  const { data: ga4Pages } = await sb.from("bi_ga4_pages").select("*");

  const sourceMap = new Map<string, Record<string, number>>();
  for (const row of ga4Sources || []) {
    const src = row.source || row.session_source || "direct";
    const cur = sourceMap.get(src) || { sessions: 0, users: 0, new_users: 0 };
    cur.sessions += Number(row.sessions) || 0;
    cur.users += Number(row.users) || 0;
    cur.new_users += Number(row.new_users) || 0;
    sourceMap.set(src, cur);
  }

  const pageMap = new Map<string, Record<string, unknown>>();
  for (const row of ga4Pages || []) {
    const path = row.page_path || "/";
    const cur = pageMap.get(path) as Record<string, unknown> || { page_title: row.page_title || path, views: 0, users: 0, eng: 0 };
    cur.views = (Number(cur.views) || 0) + (Number(row.views || row.screen_page_views) || 0);
    cur.users = (Number(cur.users) || 0) + (Number(row.users || row.total_users) || 0);
    cur.eng = (Number(cur.eng) || 0) + (Number(row.engagement_rate || row.eng) || 0);
    pageMap.set(path, cur);
  }

  // Instagram
  const { data: igDaily } = await sb.from("bi_instagram_daily").select("*").order("date", { ascending: true });
  const { data: igPosts } = await sb.from("bi_instagram_posts").select("*").order("total_interactions", { ascending: false }).limit(50);

  // Leads & Sales
  const { data: leads } = await sb.from("bi_leads").select("*").order("lead_captured_at", { ascending: false });
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
    distributions[q.key] = Array.from(countMap.entries())
      .map(([ans, cnt]) => ({ ans, cnt }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 10);
  }

  return {
    generated: new Date().toISOString(),
    meta: { daily: metaDaily, campaigns },
    ga4: {
      daily: (ga4Daily || []).map((r) => ({ date: r.date, sessions: Number(r.sessions) || 0, new_users: Number(r.new_users) || 0 })),
      sources: Array.from(sourceMap.entries()).map(([src, v]) => ({ src, ...v })).sort((a, b) => b.sessions - a.sessions),
      pages: Array.from(pageMap.entries()).map(([page_path, v]) => ({ page_path, ...v })).sort((a, b) => Number(b.views) - Number(a.views)),
    },
    ig: {
      daily: (igDaily || []).map((r) => ({ date: r.date, reach: Number(r.reach) || 0, views: Number(r.views || r.impressions) || 0, total_interactions: Number(r.total_interactions) || 0, like_count: Number(r.like_count || r.likes) || 0, saves: Number(r.saves) || 0 })),
      posts: (igPosts || []).map((r) => ({ media_type: r.media_type || "IMAGE", caption: r.caption || "", reach: Number(r.reach) || 0, views: Number(r.views || r.impressions) || 0, like_count: Number(r.like_count || r.likes) || 0, saves: Number(r.saves) || 0, total_interactions: Number(r.total_interactions) || 0 })),
    },
    leads: (leads || []).map((r) => ({ name: r.name || "", email: r.email || "", utm_source: r.utm_source || "", utm_medium: r.utm_medium || "", utm_campaign: r.utm_campaign || "", utm_content: r.utm_content || "", utm_term: r.utm_term || "", device: r.device || "", landing_page: r.landing_page || "", city: r.city || "", lead_captured_at: r.lead_captured_at || "" })),
    sales: (sales || []).map((r) => ({ revenue: Number(r.revenue) || 0, sale_at: r.sale_at || "", email: r.email || "", buyer_name: r.buyer_name || "", product_name: r.product_name || "", lead_id: r.lead_id || null, utm_source: r.utm_source || "", utm_medium: r.utm_medium || "", utm_campaign: r.utm_campaign || "", utm_content: r.utm_content || "", utm_term: r.utm_term || "", landing_page: r.landing_page || "", device: r.device || "", city: r.city || "", payment_method: r.payment_method || "", time_to_sale_hours: Number(r.time_to_sale_hours) || null, status: r.status || "" })),
    survey: { total: (surveyRows || []).length, questions: surveyQuestions, distributions },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Token validation
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token !== TOKEN) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // 1. Read HTML template
    const { data: row, error: htmlErr } = await sb
      .from("bi_dashboard_html")
      .select("html")
      .eq("id", 1)
      .single();

    if (htmlErr || !row?.html) {
      throw new Error("HTML template not found: " + JSON.stringify(htmlErr));
    }

    // 2. Build data
    const dashboardData = await buildDashboardData(sb);
    const jsonStr = JSON.stringify(dashboardData);

    // 3. Inject data into HTML
    let html: string = row.html;
    const dataScript = `<script>window.__DASHBOARD_DATA__=${jsonStr};</script>`;

    if (html.includes("<body>")) {
      html = html.replace("<body>", "<body>\n" + dataScript);
    } else {
      html = html.replace(/<body([^>]*)>/, "<body$1>\n" + dataScript);
    }

    html = html.replace(/var\s+D\s*=\s*null\s*[,;]/, "var D=window.__DASHBOARD_DATA__||null;");
    html = html.replace(
      /fetch\s*\(\s*['"`]https:\/\/bxpk[^)]*\)/g,
      "Promise.resolve({ok:true,json:()=>Promise.resolve(window.__DASHBOARD_DATA__)})"
    );
    html = html.replace(
      /fetch\s*\(\s*API_URL[^)]*\)/g,
      "Promise.resolve({ok:true,json:()=>Promise.resolve(window.__DASHBOARD_DATA__)})"
    );

    // Safety render script
    const safetyScript = `<script>
document.addEventListener('DOMContentLoaded',function(){
  if(window.__DASHBOARD_DATA__ && typeof ren==='function'){
    try{
      if(!document.querySelector('#tab-overview') || document.querySelector('#tab-overview').innerHTML===''){
        var m=document.getElementById('main');
        if(m){
          m.innerHTML='<div id="tab-overview"></div><div id="tab-meta" class="hidden"></div><div id="tab-website" class="hidden"></div><div id="tab-ig" class="hidden"></div><div id="tab-survey" class="hidden"></div><div id="tab-leads" class="hidden"></div>';
          D=window.__DASHBOARD_DATA__;
          ren();
        }
      }
    }catch(e){console.error('Safety render error:',e);}
  }
});
</script>`;
    html = html.replace("</body>", safetyScript + "\n</body>");

    // 4. Upload to Storage
    const htmlBlob = new Blob([html], { type: "text/html; charset=utf-8" });

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(FILE_PATH, htmlBlob, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
        cacheControl: "public, max-age=300",
      });

    if (uploadErr) {
      throw new Error("Storage upload failed: " + JSON.stringify(uploadErr));
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${FILE_PATH}`;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Dashboard updated successfully",
        url: publicUrl,
        generated: dashboardData.generated,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      }
    );
  }
});
