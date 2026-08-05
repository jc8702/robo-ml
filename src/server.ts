import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { exec, execSync } from 'node:child_process';
import { loadConfig, loadConfigAsync, type AppConfig } from './config/settings.js';
import { runAutomaticCycle, startScheduler, stopScheduler } from './scheduler/cron.js';
import { dbSaveMultipleSettings, dbGetSettings, initDb } from './db/index.js';
import { currentPairingCode, pairingCodeRequestedAt, currentQrRaw } from './whatsapp/client.js';
import { getSentOffersHistoryFromDb, clearSentHistory } from './collector/history.js';
import { checkWhatsAppSessionStatus, ensureWhatsAppLoggedIn } from './whatsapp/wa-playwright.js';
import { checkFacebookSessionStatus, openFacebookBrowser } from './facebook/fb-poster.js';
import { checkInstagramSessionStatus, openInstagramBrowser } from './instagram/ig-poster.js';



// initDb sera chamado apos o servidor subir (ver callback do listen abaixo)

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPublicDir(): string {
  const candidates = [
    join(__dirname, 'public'),
    join(__dirname, '..', 'public'),
    join(process.cwd(), 'dist', 'public'),
    join(process.cwd(), 'public'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) {
      return dir;
    }
  }
  return join(process.cwd(), 'public');
}

const PUBLIC_DIR = getPublicDir();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const ENV_FILE = join(process.cwd(), '.env');
const HISTORY_FILE = join(process.cwd(), '.sent-history.json');

let isBotRunning = false;

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function updateEnvFile(updates: Record<string, string | number>): void {
  if (!existsSync(ENV_FILE)) return;

  try {
    let content = readFileSync(ENV_FILE, 'utf-8');

    for (const [key, value] of Object.entries(updates)) {
      const valStr = String(value);
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${valStr}`);
      } else {
        content += `\n${key}=${valStr}`;
      }
    }

    writeFileSync(ENV_FILE, content, 'utf-8');
  } catch { /* ignora erro de sistema de arquivos em nuvem somente leitura */ }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawUrl = req.url || '/';
  const url = rawUrl.split('?')[0].replace(/\/+$/, '') || '/';
  const method = req.method || 'GET';

  const sendJson = (data: any, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(data));
  };

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // GET /qr - Rota visual para escanear QR Code em HD ou ver Pairing Code no navegador
  if (method === 'GET' && (url === '/qr' || url === '/qr/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const qrImgUrl = currentQrRaw
      ? `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(currentQrRaw)}`
      : '';

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="6">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vincular WhatsApp - ML Ofertas Bot</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 460px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { font-size: 22px; margin-top: 8px; color: #38bdf8; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .qr-container { background: #ffffff; padding: 16px; border-radius: 12px; display: inline-block; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
    img { display: block; width: 280px; height: 280px; }
    .code-box { background: #0f172a; border: 2px dashed #0ea5e9; border-radius: 12px; padding: 16px; margin-top: 16px; }
    .code { font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #4ade80; margin: 8px 0; }
    .step { text-align: left; background: #0f172a; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #cbd5e1; margin-top: 16px; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    .btn-nav { display: inline-block; width: 100%; margin-top: 20px; padding: 14px 20px; background: linear-gradient(135deg, #0284c7, #2563eb); color: white; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4); box-sizing: border-box; transition: transform 0.2s; }
    .btn-nav:hover { transform: translateY(-2px); }
    .nav-back { display: inline-block; margin-bottom: 16px; color: #38bdf8; font-size: 13px; text-decoration: none; font-weight: 600; }
    .nav-back:hover { text-decoration: underline; }
    .status { font-size: 12px; color: #64748b; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <a href="/" class="nav-back">← Voltar para o Painel de Controle / Configurações</a><br>
    <span class="badge">🤖 ML Ofertas Bot</span>
    <h1>Vincular WhatsApp</h1>
    
    ${currentQrRaw ? `
      <p>Abra o WhatsApp no seu celular, vá em <b>Dispositivos Vinculados > Vincular um dispositivo</b> e escaneie a imagem abaixo:</p>
      <div class="qr-container">
        <img src="${qrImgUrl}" alt="QR Code WhatsApp" />
      </div>
    ` : ''}

    ${currentPairingCode ? `
      <div class="code-box">
        <div style="font-size: 12px; color: #94a3b8;">CÓDIGO DE PAREAMENTO:</div>
        <div class="code">${currentPairingCode}</div>
      </div>
      <div class="step">
        <b>📱 Como usar o código:</b><br>
        1. No WhatsApp: ⚙ <b>Configurações</b><br>
        2. Clique em <b>Dispositivos vinculados</b><br>
        3. Clique em <b>Vincular com número de telefone</b><br>
        4. Digite o código de 8 dígitos acima.
      </div>
    ` : ''}

    ${!currentQrRaw && !currentPairingCode ? `
      <div style="padding: 24px 0 10px 0;">
        <p style="color: #4ade80; font-size: 18px; font-weight: bold; margin-bottom: 8px;">✅ WhatsApp Conectado ou Carregando...</p>
        <p style="margin-bottom: 0;">Se você já vinculou seu aparelho, o robô está ativo e pronto!</p>
      </div>
    ` : ''}

    <a href="/" class="btn-nav">⚙️ Ir para o Painel de Configurações</a>

    <div class="status">🔄 Esta página atualiza automaticamente a cada 6 segundos.</div>
  </div>
</body>
</html>`;
    res.end(html);
    return;
  }

  // GET /api/pairing-code - retorna o Pairing Code atual para vincular o WhatsApp
  if (method === 'GET' && (url === '/api/pairing-code' || url.endsWith('/pairing-code'))) {
    if (currentPairingCode) {
      return sendJson({
        code: currentPairingCode,
        requestedAt: pairingCodeRequestedAt?.toISOString(),
        instructions: 'Abra o WhatsApp > Configuracoes > Dispositivos vinculados > Vincular com numero de telefone > Digite este codigo',
      });
    }
    return sendJson({ code: null, message: 'Nenhum codigo pendente. WhatsApp ja esta conectado ou ainda nao inicializou.' });
  }

  // Static Files (HTML / CSS / JS)
  if (method === 'GET' && !url.startsWith('/api/')) {
    let filePath = join(PUBLIC_DIR, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!existsSync(filePath) || url === '/') {
      filePath = join(PUBLIC_DIR, 'index.html');
    }


    const ext = extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    };

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
      return;
    } catch {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
  }

  // GET /api/config
  if (method === 'GET' && (url === '/api/config' || url.endsWith('/config'))) {
    const config = await loadConfigAsync();
    const dbSettings = await dbGetSettings();

    return sendJson({
      categories: config.filters.categories,
      queries: config.queries,
      minPrice: config.filters.minPrice,
      maxPrice: config.filters.maxPrice,
      minDiscount: config.filters.minDiscount,
      maxResults: config.filters.maxResults,
      cronSchedule: dbSettings.AUTO_SCHEDULE_CRON || process.env.AUTO_SCHEDULE_CRON || '0 */3 * * *',
      affiliateId: config.affiliate.id,
      groupId: dbSettings.WHATSAPP_GROUP_ID || process.env.WHATSAPP_GROUP_ID || '',
      groupName: dbSettings.WHATSAPP_GROUP_NAME || process.env.WHATSAPP_GROUP_NAME || '',
      isRunning: isBotRunning,
      fbEnabled: config.facebook.enabled,
      fbGroupUrls: config.facebook.groupUrls,
      fbMaxGroupsPerCycle: config.facebook.maxGroupsPerCycle,
      fbDelayBetweenPosts: config.facebook.delayBetweenPostsSec,
      fbWaGroupLink: config.facebook.waGroupLink,
      fbAutoJoin: config.facebook.autoJoin,
      igEnabled: config.instagram.enabled,
      igUsername: config.instagram.username,
      igPassword: dbSettings.INSTAGRAM_PASSWORD || process.env.INSTAGRAM_PASSWORD || '',
      igMaxPostsPerCycle: config.instagram.maxPostsPerCycle,
      igBioLink: config.instagram.bioLink,
      igCustomHashtags: config.instagram.customHashtags,
      igAutoDmEnabled: config.instagram.autoDmEnabled,
      igTriggerWord: config.instagram.triggerWord,
      igDmTemplate: config.instagram.dmTemplate,
    });
  }

  // POST /api/config
  if (method === 'POST' && (url === '/api/config' || url.endsWith('/config'))) {
    try {
      const body = await parseJsonBody(req);
      const updates: Record<string, string> = {};

      if (Array.isArray(body.categories)) updates.ML_CATEGORIES = body.categories.join(',');
      if (Array.isArray(body.queries)) updates.ML_SEARCH_QUERIES = body.queries.join(',');
      if (typeof body.affiliateId === 'string' && body.affiliateId.trim()) updates.ML_AFFILIATE_ID = body.affiliateId.trim();
      if (typeof body.groupId === 'string') updates.WHATSAPP_GROUP_ID = body.groupId.trim();
      if (typeof body.groupName === 'string') updates.WHATSAPP_GROUP_NAME = body.groupName.trim();
      if (body.minPrice !== undefined && body.minPrice !== '') updates.ML_MIN_PRICE = String(body.minPrice);
      if (body.maxPrice !== undefined && body.maxPrice !== '') updates.ML_MAX_PRICE = String(body.maxPrice);
      if (body.minDiscount !== undefined && body.minDiscount !== '') updates.ML_MIN_DISCOUNT = String(body.minDiscount);
      if (body.maxResults !== undefined && body.maxResults !== '') updates.ML_MAX_RESULTS = String(body.maxResults);
      if (typeof body.cronSchedule === 'string' && body.cronSchedule.trim()) updates.AUTO_SCHEDULE_CRON = body.cronSchedule.trim();
      if (body.fbEnabled !== undefined) updates.FB_ENABLED = body.fbEnabled ? 'true' : 'false';
      if (Array.isArray(body.fbGroupUrls)) updates.FB_GROUP_URLS = body.fbGroupUrls.join(',');
      if (body.fbMaxGroupsPerCycle !== undefined && body.fbMaxGroupsPerCycle !== '') updates.FB_MAX_GROUPS_PER_CYCLE = String(body.fbMaxGroupsPerCycle);
      if (body.fbDelayBetweenPosts !== undefined && body.fbDelayBetweenPosts !== '') updates.FB_DELAY_BETWEEN_POSTS = String(body.fbDelayBetweenPosts);
      if (typeof body.fbWaGroupLink === 'string') updates.FB_WA_GROUP_LINK = body.fbWaGroupLink.trim();
      if (body.fbAutoJoin !== undefined) updates.FB_AUTO_JOIN = body.fbAutoJoin ? 'true' : 'false';

      // Instagram
      if (body.igEnabled !== undefined) updates.INSTAGRAM_ENABLED = body.igEnabled ? 'true' : 'false';
      if (typeof body.igUsername === 'string') updates.INSTAGRAM_USERNAME = body.igUsername.trim();
      if (typeof body.igPassword === 'string') updates.INSTAGRAM_PASSWORD = body.igPassword.trim();
      if (body.igMaxPostsPerCycle !== undefined && body.igMaxPostsPerCycle !== '') updates.INSTAGRAM_MAX_POSTS_PER_CYCLE = String(body.igMaxPostsPerCycle);
      if (typeof body.igBioLink === 'string') updates.INSTAGRAM_BIO_LINK = body.igBioLink.trim();
      if (typeof body.igCustomHashtags === 'string') updates.INSTAGRAM_HASHTAGS = body.igCustomHashtags.trim();
      if (body.igAutoDmEnabled !== undefined) updates.INSTAGRAM_AUTO_DM = body.igAutoDmEnabled ? 'true' : 'false';
      if (typeof body.igTriggerWord === 'string' && body.igTriggerWord.trim()) updates.INSTAGRAM_TRIGGER_WORD = body.igTriggerWord.trim().toUpperCase();
      if (typeof body.igDmTemplate === 'string' && body.igDmTemplate.trim()) updates.INSTAGRAM_DM_TEMPLATE = body.igDmTemplate.trim();

      // 1. Grava no Neon PostgreSQL
      await dbSaveMultipleSettings(updates);

      // 2. Atualiza variáveis de ambiente em memória
      for (const [k, v] of Object.entries(updates)) {
        process.env[k] = v;
      }
      updateEnvFile(updates);

      // 3. Se o bot estiver rodando, reinicia o agendador imediatamente com a nova cronSchedule
      if (isBotRunning) {
        stopScheduler();
        const updatedConfig = await loadConfigAsync();
        startScheduler(updatedConfig).catch((err) => console.error('Erro ao reiniciar agendador:', err));
      }

      return sendJson({ success: true, message: 'Configurações salvas e aplicadas imediatamente!' });
    } catch (err) {
      return sendJson({ success: false, error: String(err) }, 400);
    }
  }

  // GET /api/history
  if (method === 'GET' && (url === '/api/history' || url.endsWith('/history'))) {
    try {
      const items = await getSentOffersHistoryFromDb();
      return sendJson(items);
    } catch {
      return sendJson([]);
    }
  }

  // POST /api/history/clear
  if (method === 'POST' && (url === '/api/history/clear' || url.endsWith('/history/clear'))) {
    try {
      await clearSentHistory();
      return sendJson({ success: true, message: 'Histórico de envios limpo com sucesso!' });
    } catch (err) {
      return sendJson({ success: false, error: String(err) }, 400);
    }
  }

  // POST /api/bot/start
  if (method === 'POST' && (url === '/api/bot/start' || url.endsWith('/start'))) {
    if (!isBotRunning) {
      isBotRunning = true;
      await dbSaveMultipleSettings({ AUTO_BOT_RUNNING: 'true' }).catch(() => {});
      process.env.AUTO_BOT_RUNNING = 'true';
      const config = await loadConfigAsync();
      startScheduler(config).catch((err) => console.error('Erro ao iniciar agendador:', err));
    }
    return sendJson({ isRunning: true, message: '⚡ Automação iniciada com sucesso! O robô executará nos horários agendados.' });
  }

  // POST /api/bot/stop
  if (method === 'POST' && (url === '/api/bot/stop' || url.endsWith('/stop'))) {
    isBotRunning = false;
    await dbSaveMultipleSettings({ AUTO_BOT_RUNNING: 'false' }).catch(() => {});
    process.env.AUTO_BOT_RUNNING = 'false';
    stopScheduler();
    return sendJson({ isRunning: false, message: '⏸️ Automação pausada e agendador cancelado.' });
  }

  // POST /api/bot/run-now
  if (method === 'POST' && (url === '/api/bot/run-now' || url.endsWith('/run-now'))) {
    try {
      const config = await loadConfigAsync();
      await runAutomaticCycle(config);
      return sendJson({ success: true, message: '⚡ Varredura executada com sucesso! Ofertas enviadas para WhatsApp, Facebook e Instagram.' });
    } catch (err) {
      console.error('[SERVER] Erro na execução manual:', err);
      return sendJson({ success: false, message: 'Erro na execução da varredura: ' + String(err) }, 500);
    }
  }

  // POST /api/bot/test-instagram (ou /api/instagram/test)
  if (method === 'POST' && (url === '/api/bot/test-instagram' || url === '/api/instagram/test' || url.endsWith('/test-instagram'))) {
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const config = await loadConfigAsync();
      const { postOfferToInstagram } = await import('./instagram/ig-poster.js');

      const username = (body.username || config.instagram.username || process.env.INSTAGRAM_USERNAME || '').trim();
      const password = (body.password || config.instagram.password || process.env.INSTAGRAM_PASSWORD || '').trim();
      const bioLink = (body.bioLink || config.instagram.bioLink || '').trim();
      const hashtags = (body.hashtags || config.instagram.customHashtags || '').trim();
      const triggerWord = (body.triggerWord || config.instagram.triggerWord || 'PASSE').trim();

      const history = await getSentOffersHistoryFromDb();
      const testOffer: any = history.length > 0 ? {
        id: history[0].id,
        title: history[0].title,
        currentPrice: history[0].currentPrice || history[0].price || 199.90,
        originalPrice: history[0].originalPrice || 299.90,
        discountPercent: history[0].discountPercent || 33,
        permalink: history[0].permalink || history[0].link,
        affiliateLink: history[0].permalink || history[0].link,
        thumbnail: history[0].imageUrl || history[0].thumbnail || 'https://http2.mlstatic.com/D_NQ_NP_2X_704701-MLA45648833919_042021-F.webp',
        freeShipping: true,
        seller: 'Loja Oficial Mercado Livre',
        condition: 'new',
        soldQuantity: 100,
      } : {
        id: 'test-ig-' + Date.now(),
        title: 'Fone de Ouvido Bluetooth Sem Fio Estéreo HD',
        currentPrice: 99.90,
        originalPrice: 199.90,
        discountPercent: 50,
        permalink: 'https://www.mercadolivre.com.br/p/MLB66328445',
        affiliateLink: 'https://www.mercadolivre.com.br/p/MLB66328445',
        thumbnail: 'https://http2.mlstatic.com/D_Q_NP_2X_696276-MLA107581697270_032026-F.webp',
        freeShipping: true,
        seller: 'Vendedor Oficial',
        condition: 'new',
        soldQuantity: 100
      };

      console.log(`[SERVER] 📸 Disparando teste isolado de postagem no Instagram para @${username}...`);
      const result = await postOfferToInstagram(testOffer, {
        bioLink,
        hashtags,
        username,
        password,
        triggerWord,
      });

      if (result.success) {
        return sendJson({ success: true, message: '✅ Postagem enviada e publicada com sucesso no perfil do Instagram!' });
      } else {
        const detail = result.error ? ` Detalhes: ${result.error}` : '';
        return sendJson({ success: false, message: `❌ Falha ao publicar no Instagram.${detail}` }, 400);
      }
    } catch (err) {
      console.error('[SERVER] Erro ao testar Instagram:', err);
      return sendJson({ success: false, message: 'Erro ao executar teste do Instagram: ' + String(err) }, 500);
    }
  }

  // POST /api/bot/test-instagram-autodm - Teste isolado do monitor de comentários e resposta de Auto-DM
  if (method === 'POST' && (url === '/api/bot/test-instagram-autodm' || url.endsWith('/test-instagram-autodm'))) {
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const config = await loadConfigAsync();
      const { checkAndReplyInstagramComments } = await import('./instagram/ig-auto-reply.js');

      console.log('[SERVER] 💬 Disparando teste do monitor de comentários e Auto-DM do Instagram...');
      const resAuto = await checkAndReplyInstagramComments({
        triggerWord: body.triggerWord || config.instagram.triggerWord,
        dmTemplate: body.dmTemplate || config.instagram.dmTemplate,
        username: body.username || config.instagram.username,
        password: body.password || config.instagram.password,
      });

      const sendFailed = resAuto.repliesCount === 0 && resAuto.errors.some((error) => /Direct|autenticada|login|não localizado|não apareceu/i.test(error));
      return sendJson({
        success: !sendFailed,
        message: `🤖 Verificação concluída! ${resAuto.commentsScanned} comentário(s) lido(s), ${resAuto.repliesCount} Direct(s) enviado(s). Palavra: ${resAuto.triggerWord || 'configurada'}.`,
        details: resAuto,
      }, sendFailed ? 502 : 200);
    } catch (err) {
      console.error('[SERVER] Erro no teste de Auto-DM:', err);
      return sendJson({ success: false, message: 'Erro ao executar teste de Auto-DM: ' + String(err) }, 500);
    }
  }



  // GET /api/sessions/status - Retorna o status de conexão local de cada rede
  if (method === 'GET' && (url === '/api/sessions/status' || url.endsWith('/sessions/status'))) {
    return sendJson({
      wa: checkWhatsAppSessionStatus(),
      fb: checkFacebookSessionStatus(),
      ig: checkInstagramSessionStatus(),
    });
  }

  // POST /api/sessions/connect-wa - Abre conector local do WhatsApp
  if (method === 'POST' && (url === '/api/sessions/connect-wa' || url.endsWith('/connect-wa'))) {
    console.log('[SERVER] 🟢 Disparando abertura do Chrome para login no WhatsApp...');
    ensureWhatsAppLoggedIn().catch((err) => console.error('[SERVER] Erro no WhatsApp:', err));
    return sendJson({ success: true, message: '🟢 Janela do Chrome aberta para login no WhatsApp!' });
  }

  // POST /api/sessions/connect-fb - Abre conector local do Facebook
  if (method === 'POST' && (url === '/api/sessions/connect-fb' || url.endsWith('/connect-fb'))) {
    console.log('[SERVER] 📘 Disparando abertura do Chrome para login no Facebook...');
    openFacebookBrowser().then(async (ctx) => {
      const pages = ctx.pages();
      const page = pages.length > 0 ? pages[0] : await ctx.newPage();
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
    }).catch((err) => console.error('[SERVER] Erro no Facebook:', err));
    return sendJson({ success: true, message: '📘 Janela do Chrome aberta para login no Facebook!' });
  }

  // POST /api/sessions/connect-ig - Abre conector local do Instagram
  if (method === 'POST' && (url === '/api/sessions/connect-ig' || url.endsWith('/connect-ig'))) {
    console.log('[SERVER] 📸 Disparando abertura do Chrome para login no Instagram...');
    openInstagramBrowser().then(async (ctx) => {
      const pages = ctx.pages();
      const page = pages.length > 0 ? pages[0] : await ctx.newPage();
      await page.goto('https://www.instagram.com', { waitUntil: 'domcontentloaded' });
    }).catch((err) => console.error('[SERVER] Erro no Instagram:', err));
    return sendJson({ success: true, message: '📸 Janela do Chrome aberta para login no Instagram!' });
  }

  // Fallback 404
  res.writeHead(404);
  res.end('Endpoint nao encontrado.');
}

const server = createServer(handleRequest);

// Trata EADDRINUSE automaticamente liberando a porta 3000 se ocupada
server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[AVISO] Porta ${PORT} em uso. Liberando porta ${PORT}...`);
    try {
      if (process.platform === 'win32') {
        execSync(`for /f "tokens=5" %a in ('netstat -aon ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /f /pid %a`, { stdio: 'ignore' });
      }
    } catch {}
    setTimeout(() => {
      server.listen(PORT, '0.0.0.0', startServerCallback);
    }, 1000);
  } else {
    console.error('[FATAL] Erro no servidor HTTP:', err);
  }
});

async function startServerCallback() {
  console.log('\n======================================================');
  console.log(`Painel de Controle ML Ofertas Bot rodando em:`);
  console.log(`  http://localhost:${PORT}`);
  console.log('======================================================\n');

  // Inicializa banco de dados apos o servidor estar no ar
  await initDb().catch(console.error);

  // Abre navegador padrao automaticamente no Windows se for execucao local CLI
  if (process.argv.includes('--open')) {
    const openCmd = process.platform === 'win32' ? `start http://localhost:${PORT}` : `open http://localhost:${PORT}`;
    exec(openCmd, () => {});
  }

  // Auto-inicia o bot se estiver marcado como ativo no Neon DB ou RENDER/AUTO_START
  const dbSettings = (await dbGetSettings().catch(() => ({}))) as Record<string, string>;
  if (dbSettings.AUTO_BOT_RUNNING === 'true' || process.env.AUTO_BOT_RUNNING === 'true' || process.env.RENDER || process.env.AUTO_START === 'true') {
    console.log('[BOT] Restaurando estado ativo do bot de ofertas (24/7)...');
    isBotRunning = true;
    const config = await loadConfigAsync();
    startScheduler(config).catch((err) => console.error('Erro ao iniciar agendador:', err));
  }
}

// Handlers de exceção global para resiliência 24/7
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

// Inicia o servidor (local ou Render)
if (process.env.VERCEL !== '1') {
  server.listen(PORT, '0.0.0.0', startServerCallback);
}

export default handleRequest;
