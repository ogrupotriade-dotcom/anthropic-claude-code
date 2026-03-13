# VDB Command Center Dashboard - Guia de Deploy

## Problema Resolvido

O dashboard HTML funciona localmente mas falhava quando servido via Edge Function porque:
1. **Inter-function HTTP fetch falha**: A Edge Function v11 chamava `dashboard-data` via HTTP, o que é instável entre Edge Functions no Supabase.
2. **HTML grande em template literals**: Deno bundler quebra com >10KB de HTML inline.
3. **CORS/CSP**: Fetch client-side para APIs do mesmo domínio é bloqueado por políticas do navegador.

**Solução**: A Edge Function agora consulta o banco de dados diretamente (sem HTTP fetch entre funções) e injeta os dados JSON no HTML antes de servir ao navegador. Zero fetch client-side.

---

## Arquitetura

```
Navegador → Edge Function "dashboard"
                ↓
        1. Lê HTML de bi_dashboard_html (via Supabase client)
        2. Consulta todas as tabelas de dados diretamente
        3. Injeta JSON no HTML como window.__DASHBOARD_DATA__
        4. Desabilita fetch() client-side
        5. Retorna HTML completo com dados embutidos
```

---

## Opção A: Edge Function (Recomendada)

### Deploy

```bash
# Login no Supabase CLI
supabase login

# Link ao projeto
supabase link --project-ref bxpkdevwsvmwuctgixnz

# Deploy da Edge Function
supabase functions deploy dashboard --no-verify-jwt
```

### URL de Acesso
```
https://bxpkdevwsvmwuctgixnz.supabase.co/functions/v1/dashboard
```

### Características
- Dados atualizados a cada acesso (consulta ao banco em tempo real)
- Cache de 5 minutos via `Cache-Control: max-age=300`
- Sem dependência de fetch entre Edge Functions
- Suporta iframe (X-Frame-Options: ALLOWALL)

---

## Opção B: Storage Estático (Fallback)

Para quem prefere HTML estático com atualização periódica.

### Deploy

```bash
supabase functions deploy dashboard-update-storage --no-verify-jwt
```

### Atualizar o Dashboard

Chamar a função para gerar e subir o HTML estático:
```bash
curl "https://bxpkdevwsvmwuctgixnz.supabase.co/functions/v1/dashboard-update-storage?token=vdb2026"
```

### URL de Acesso (Storage)
```
https://bxpkdevwsvmwuctgixnz.supabase.co/storage/v1/object/public/dashboard/index.html
```

### Atualização Automática via Cron

Use o [pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron) do Supabase ou um serviço externo para chamar a função periodicamente:

```sql
-- No SQL Editor do Supabase, habilitar pg_cron:
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Atualizar a cada 1 hora:
SELECT cron.schedule(
  'update-dashboard-hourly',
  '0 * * * *',
  $$
  SELECT net.http_get(
    'https://bxpkdevwsvmwuctgixnz.supabase.co/functions/v1/dashboard-update-storage?token=vdb2026'
  );
  $$
);
```

Ou via cron externo (GitHub Actions, cron-job.org, etc.):
```bash
# Crontab
0 * * * * curl -s "https://bxpkdevwsvmwuctgixnz.supabase.co/functions/v1/dashboard-update-storage?token=vdb2026"
```

---

## Embed no WordPress

```html
<iframe
  src="https://bxpkdevwsvmwuctgixnz.supabase.co/functions/v1/dashboard"
  width="100%"
  height="900"
  frameborder="0"
  style="border:none; border-radius:12px;"
></iframe>
```

Ou com a URL do Storage:
```html
<iframe
  src="https://bxpkdevwsvmwuctgixnz.supabase.co/storage/v1/object/public/dashboard/index.html"
  width="100%"
  height="900"
  frameborder="0"
  style="border:none; border-radius:12px;"
></iframe>
```

---

## Estrutura dos Dados

A Edge Function monta o objeto `D` com esta estrutura, consultando as tabelas diretamente:

| Tabela | Dados | Notas |
|--------|-------|-------|
| `bi_meta_insights` | Meta Ads diário + campanhas | Filtrar `level='ad'` |
| `bi_ga4_daily` | Sessões diárias | - |
| `bi_ga4_traffic_sources` | Fontes de tráfego | Agregado por source |
| `bi_ga4_pages` | Páginas mais acessadas | Agregado por path |
| `bi_instagram_daily` | Métricas diárias IG | - |
| `bi_instagram_posts` | Posts do Instagram | Top 50 |
| `bi_leads` | Leads capturados | - |
| `bi_sales` | Vendas | - |
| `bi_survey_responses` | Pesquisa (9 campos) | Distribuição top 10 |

---

## Troubleshooting

### "HTML template não encontrado"
- Verificar que `bi_dashboard_html` tem uma row com `id=1` e coluna `html` populada.
- Se RLS está habilitado, a Edge Function usa `SUPABASE_SERVICE_ROLE_KEY` que faz bypass.

### Caracteres portugueses quebrados
- O Content-Type inclui `charset=utf-8`.
- Se ainda houver problemas, usar HTML entities no HTML salvo no banco (`&aacute;` etc.).

### Dashboard não renderiza os dados
- Verificar no DevTools do navegador se `window.__DASHBOARD_DATA__` está definido.
- Checar se a função `ren()` existe no HTML do dashboard.
- O safety script no final do `<body>` tenta forçar a renderização como fallback.
