import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { exec } from 'node:child_process';
import { loadConfig, loadConfigAsync, type AppConfig } from './config/settings.js';
import { runAutomaticCycle, startScheduler } from './scheduler/cron.js';
import { dbSaveMultipleSettings, initDb } from './db/index.js';
import { currentPairingCode, pairingCodeRequestedAt, currentQrRaw } from './whatsapp/client.js';

// initDb sera chamado apos o servidor subir (ver callback do listen abaixo)

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PUBLIC_DIR = join(process.cwd(), 'public');
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
  const url = req.url || '/';
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

  // Health check endpoint para Render
  if (method === 'GET' && url === '/') {
    sendJson({ status: 'ok', bot: isBotRunning ? 'running' : 'stopped' });
    return;
  }

  // Static Files (HTML / CSS / JS)
  if (method === 'GET' && !url.startsWith('/api/')) {
    let filePath = join(PUBLIC_DIR, url === '/' ? 'index.html' : url);
    if (!existsSync(filePath)) {
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
    return sendJson({
      categories: config.filters.categories,
      queries: config.queries,
      minPrice: config.filters.minPrice,
      maxPrice: config.filters.maxPrice,
      minDiscount: config.filters.minDiscount,
      maxResults: config.filters.maxResults,
      cronSchedule: process.env.AUTO_SCHEDULE_CRON || '0 */3 * * *',
      affiliateId: config.affiliate.id,
      groupId: process.env.WHATSAPP_GROUP_ID || '',
      isRunning: isBotRunning,
      fbEnabled: config.facebook.enabled,
      fbGroupUrls: config.facebook.groupUrls,
      fbMaxGroupsPerCycle: config.facebook.maxGroupsPerCycle,
      fbDelayBetweenPosts: config.facebook.delayBetweenPostsSec,
      fbWaGroupLink: config.facebook.waGroupLink,
      fbAutoJoin: config.facebook.autoJoin,
    });
  }

  // POST /api/config
  if (method === 'POST' && (url === '/api/config' || url.endsWith('/config'))) {
    try {
      const body = await parseJsonBody(req);
      const updates: Record<string, string> = {};

      if (Array.isArray(body.categories)) {
        updates.ML_CATEGORIES = body.categories.join(',');
      }
      if (typeof body.minPrice === 'number') updates.ML_MIN_PRICE = String(body.minPrice);
      if (typeof body.maxPrice === 'number') updates.ML_MAX_PRICE = String(body.maxPrice);
      if (typeof body.minDiscount === 'number') updates.ML_MIN_DISCOUNT = String(body.minDiscount);
      if (typeof body.maxResults === 'number') updates.ML_MAX_RESULTS = String(body.maxResults);
      if (typeof body.cronSchedule === 'string') updates.AUTO_SCHEDULE_CRON = body.cronSchedule;
      if (typeof body.fbEnabled === 'boolean') updates.FB_ENABLED = body.fbEnabled ? 'true' : 'false';
      if (Array.isArray(body.fbGroupUrls)) updates.FB_GROUP_URLS = body.fbGroupUrls.join(',');
      if (typeof body.fbMaxGroupsPerCycle === 'number') updates.FB_MAX_GROUPS_PER_CYCLE = String(body.fbMaxGroupsPerCycle);
      if (typeof body.fbDelayBetweenPosts === 'number') updates.FB_DELAY_BETWEEN_POSTS = String(body.fbDelayBetweenPosts);
      if (typeof body.fbWaGroupLink === 'string') updates.FB_WA_GROUP_LINK = body.fbWaGroupLink;
      if (typeof body.fbAutoJoin === 'boolean') updates.FB_AUTO_JOIN = body.fbAutoJoin ? 'true' : 'false';

      await dbSaveMultipleSettings(updates);
      updateEnvFile(updates);

      return sendJson({ success: true, message: 'Configuracoes atualizadas no Neon PostgreSQL' });
    } catch (err) {
      return sendJson({ success: false, error: String(err) }, 400);
    }
  }

  // GET /api/history
  if (method === 'GET' && (url === '/api/history' || url.endsWith('/history'))) {
    if (!existsSync(HISTORY_FILE)) {
      return sendJson([]);
    }
    try {
      const historyContent = readFileSync(HISTORY_FILE, 'utf-8');
      const items = JSON.parse(historyContent);
      return sendJson(items.reverse());
    } catch {
      return sendJson([]);
    }
  }

  // POST /api/bot/start
  if (method === 'POST' && (url === '/api/bot/start' || url.endsWith('/start'))) {
    if (!isBotRunning) {
      isBotRunning = true;
      const config = loadConfig();
      startScheduler(config).catch((err) => console.error('Erro ao iniciar agendador:', err));
    }
    return sendJson({ isRunning: true, message: 'Automacao iniciada com sucesso!' });
  }

  // POST /api/bot/stop
  if (method === 'POST' && (url === '/api/bot/stop' || url.endsWith('/stop'))) {
    isBotRunning = false;
    return sendJson({ isRunning: false, message: 'Automacao pausada.' });
  }

  // POST /api/bot/run-now
  if (method === 'POST' && (url === '/api/bot/run-now' || url.endsWith('/run-now'))) {
    try {
      const config = loadConfig();
      runAutomaticCycle(config)
        .then(() => {})
        .catch((err) => console.error('Erro na execucao manual:', err));

      return sendJson({ success: true, message: 'Busca executada! Verifique seu grupo do WhatsApp.' });
    } catch (err) {
      return sendJson({ success: false, message: 'Erro na execucao: ' + String(err) }, 500);
    }
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
    .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); border: 1px solid #334155; }
    h1 { font-size: 22px; margin-top: 0; color: #38bdf8; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .qr-container { background: #ffffff; padding: 16px; border-radius: 12px; display: inline-block; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2); }
    img { display: block; width: 280px; height: 280px; }
    .code-box { background: #0f172a; border: 2px dashed #0ea5e9; border-radius: 12px; padding: 16px; margin-top: 16px; }
    .code { font-family: monospace; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #4ade80; margin: 8px 0; }
    .step { text-align: left; background: #0f172a; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #cbd5e1; margin-top: 16px; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    .status { font-size: 12px; color: #64748b; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
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
      <div style="padding: 40px 0;">
        <p style="color: #4ade80; font-size: 18px; font-weight: bold;">✅ WhatsApp Conectado ou Carregando...</p>
        <p>Se você já vinculou seu aparelho, o robô está ativo e pronto!</p>
      </div>
    ` : ''}

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

  // Fallback 404
  res.writeHead(404);
  res.end('Endpoint nao encontrado.');
}

const server = createServer(handleRequest);

// Inicia o servidor (local ou Render)
if (process.env.VERCEL !== '1') {
  // CRÍTICO: Render exige bind em 0.0.0.0, não em localhost
  server.listen(PORT, '0.0.0.0', async () => {
    const url = `http://0.0.0.0:${PORT}`;
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

    // Auto-inicia o bot no Render (ou se AUTO_START=true)
    if (process.env.RENDER || process.env.AUTO_START === 'true') {
      console.log('[BOT] Auto-iniciando bot de ofertas...');
      isBotRunning = true;
      const config = loadConfig();
      startScheduler(config).catch((err) => console.error('Erro ao iniciar agendador:', err));
    }
  });
}

export default handleRequest;
