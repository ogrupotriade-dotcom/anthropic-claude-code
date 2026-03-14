// VDB Command Center Dashboard - Edge Function v12
// Strategy: Query DB directly (no inter-function HTTP fetch), inject data into HTML, serve complete page.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function errorPage(msg: string): Response {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;padding:40px;background:#060a13;color:#ef4444">
<h2>Erro no Dashboard</h2><pre>${msg}</pre>
<p style="color:#888;margin-top:20px">Tente recarregar a p&aacute;gina. Se o erro persistir, entre em contato.</p>
</body></html>`;
  return new Response(html, {
    status: 500,
    headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
  });
}

// Build the dashboard data object by querying all tables directly
async function buildDashboardData(sb: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  // Meta Ads daily (filter level='ad' to avoid triple counting)
  const { data: metaDaily } = await sb
    .from("bi_meta_insights")
    .select("date_start, spend, impressions, reach, clicks, leads, purchases, revenue")
    .eq("level", "ad");

  // Aggregate meta daily by date
  const metaDailyMap = new Map<string, Record<string, number>>();
  for (const row of metaDaily || []) {
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
  }
  const metaDailyArr = Array.from(metaDailyMap.entries())
    .map(([d, v]) => ({ d, ...v }))
    .sort((a, b) => a.d.localeCompare(b.d));

  // Meta Ads campaigns
  const campaignMap = new Map<string, Record<string, number>>();
  for (const row of metaDaily || []) {
    const name = (row as Record<string, unknown>).campaign_name as string || "Desconhecida";
    const cur = campaignMap.get(name) || { spend: 0, impr: 0, clicks: 0, leads: 0, purch: 0 };
    cur.spend += Number(row.spend) || 0;
    cur.impr += Number(row.impressions) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.purch += Number(row.purchases) || 0;
    campaignMap.set(name, cur);
  }

  // Refetch with campaign_name included
  const { data: metaWithCampaign } = await sb
    .from("bi_meta_insights")
    .select("campaign_name, spend, impressions, clicks, leads, purchases")
    .eq("level", "ad");

  const campaignMap2 = new Map<string, Record<string, number>>();
  for (const row of metaWithCampaign || []) {
    const name = row.campaign_name || "Desconhecida";
    const cur = campaignMap2.get(name) || { spend: 0, impr: 0, clicks: 0, leads: 0, purch: 0 };
    cur.spend += Number(row.spend) || 0;
    cur.impr += Number(row.impressions) || 0;
    cur.clicks += Number(row.clicks) || 0;
    cur.leads += Number(row.leads) || 0;
    cur.purch += Number(row.purchases) || 0;
    campaignMap2.set(name, cur);
  }
  const campaigns = Array.from(campaignMap2.entries())
    .map(([campaign_name, v]) => ({ campaign_name, ...v }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 20);

  // GA4 daily
  const { data: ga4Daily } = await sb
    .from("bi_ga4_daily")
    .select("*")
    .order("date", { ascending: true });

  // GA4 traffic sources
  const { data: ga4Sources } = await sb
    .from("bi_ga4_traffic_sources")
    .select("*");

  // Aggregate sources
  const sourceMap = new Map<string, Record<string, number>>();
  for (const row of ga4Sources || []) {
    const src = row.source || row.session_source || "direct";
    const cur = sourceMap.get(src) || { sessions: 0, users: 0, new_users: 0 };
    cur.sessions += Number(row.sessions) || 0;
    cur.users += Number(row.users) || 0;
    cur.new_users += Number(row.new_users) || 0;
    sourceMap.set(src, cur);
  }
  const sources = Array.from(sourceMap.entries())
    .map(([src, v]) => ({ src, ...v }))
    .sort((a, b) => b.sessions - a.sessions);

  // GA4 pages
  const { data: ga4Pages } = await sb
    .from("bi_ga4_pages")
    .select("*");

  const pageMap = new Map<string, Record<string, unknown>>();
  for (const row of ga4Pages || []) {
    const path = row.page_path || "/";
    const cur = pageMap.get(path) || { page_title: row.page_title || path, views: 0, users: 0, eng: 0 };
    (cur as Record<string, unknown>).views = (Number((cur as Record<string, unknown>).views) || 0) + (Number(row.views || row.screen_page_views) || 0);
    (cur as Record<string, unknown>).users = (Number((cur as Record<string, unknown>).users) || 0) + (Number(row.users || row.total_users) || 0);
    (cur as Record<string, unknown>).eng = (Number((cur as Record<string, unknown>).eng) || 0) + (Number(row.engagement_rate || row.eng) || 0);
    pageMap.set(path, cur);
  }
  const pages = Array.from(pageMap.entries())
    .map(([page_path, v]) => ({ page_path, ...v }))
    .sort((a, b) => Number(b.views) - Number(a.views));

  // Instagram daily
  const { data: igDaily } = await sb
    .from("bi_instagram_daily")
    .select("*")
    .order("date", { ascending: true });

  // Instagram posts
  const { data: igPosts } = await sb
    .from("bi_instagram_posts")
    .select("*")
    .order("total_interactions", { ascending: false })
    .limit(50);

  // Leads
  const { data: leads } = await sb
    .from("bi_leads")
    .select("*")
    .order("lead_captured_at", { ascending: false });

  // Sales
  const { data: sales } = await sb
    .from("bi_sales")
    .select("*");

  // Survey
  const { data: surveyRows } = await sb
    .from("bi_survey_responses")
    .select("*");

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
    meta: {
      daily: metaDailyArr,
      campaigns,
    },
    ga4: {
      daily: (ga4Daily || []).map((r) => ({
        date: r.date,
        sessions: Number(r.sessions) || 0,
        new_users: Number(r.new_users) || 0,
      })),
      sources,
      pages,
    },
    ig: {
      daily: (igDaily || []).map((r) => ({
        date: r.date,
        reach: Number(r.reach) || 0,
        views: Number(r.views || r.impressions) || 0,
        total_interactions: Number(r.total_interactions) || 0,
        like_count: Number(r.like_count || r.likes) || 0,
        saves: Number(r.saves) || 0,
      })),
      posts: (igPosts || []).map((r) => ({
        media_type: r.media_type || "IMAGE",
        caption: r.caption || "",
        reach: Number(r.reach) || 0,
        views: Number(r.views || r.impressions) || 0,
        like_count: Number(r.like_count || r.likes) || 0,
        saves: Number(r.saves) || 0,
        total_interactions: Number(r.total_interactions) || 0,
      })),
    },
    leads: (leads || []).map((r) => ({
      name: r.name || "",
      email: r.email || "",
      utm_source: r.utm_source || "",
      utm_medium: r.utm_medium || "",
      utm_campaign: r.utm_campaign || "",
      device: r.device || "",
      lead_captured_at: r.lead_captured_at || "",
    })),
    sales: (sales || []).map((r) => ({
      revenue: Number(r.revenue) || 0,
      sale_at: r.sale_at || "",
    })),
    survey: {
      total: (surveyRows || []).length,
      questions: surveyQuestions,
      distributions,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // 1. Read HTML template from database
    const { data: row, error: htmlErr } = await sb
      .from("bi_dashboard_html")
      .select("html")
      .eq("id", 1)
      .single();

    if (htmlErr || !row?.html) {
      return errorPage("HTML template n&atilde;o encontrado no banco: " + JSON.stringify(htmlErr));
    }

    // 2. Query all data directly from DB (no HTTP fetch to other functions!)
    const dashboardData = await buildDashboardData(sb);
    const jsonStr = JSON.stringify(dashboardData);

    // 3. Inject data into HTML
    let html: string = row.html;

    // Strategy: Replace the data initialization in the script.
    // We inject a script tag right after <body> with the pre-loaded data,
    // and disable any client-side fetch by replacing the fetch URL.

    // Inject pre-loaded data as a global variable
    const dataScript = `<script>window.__DASHBOARD_DATA__=${jsonStr};</script>`;

    // Insert data script after <body> tag
    if (html.includes("<body>")) {
      html = html.replace("<body>", "<body>\n" + dataScript);
    } else if (html.includes("<body ")) {
      html = html.replace(/<body([^>]*)>/, "<body$1>\n" + dataScript);
    }

    // Patch the JS: if the code declares "var D=null," or "let D=null," or "var D = null",
    // replace so D picks up the pre-loaded data
    html = html.replace(
      /var\s+D\s*=\s*null\s*[,;]/,
      "var D=window.__DASHBOARD_DATA__||null;"
    );

    // Disable client-side fetch calls to dashboard-data API
    // Replace fetch('https://bxpk... with a no-op
    html = html.replace(
      /fetch\s*\(\s*['"`]https:\/\/bxpk[^)]*\)/g,
      "Promise.resolve({ok:true,json:()=>Promise.resolve(window.__DASHBOARD_DATA__)})"
    );

    // Also handle any fetch that uses the API URL variable
    html = html.replace(
      /fetch\s*\(\s*API_URL[^)]*\)/g,
      "Promise.resolve({ok:true,json:()=>Promise.resolve(window.__DASHBOARD_DATA__)})"
    );

    // If there's an init() call that tries to fetch, ensure rendering happens with existing data
    // Add a safety script at the end to force render if D is loaded but UI is empty
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

    return new Response(html, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; font-src * data:;",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Frame-Options": "ALLOWALL",
      },
    });
  } catch (e) {
    return errorPage(String(e));
  }
});
