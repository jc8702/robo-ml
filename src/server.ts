import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { exec } from 'node:child_process';
import { loadConfig, loadConfigAsync, type AppConfig } from './config/settings.js';
import { runAutomaticCycle, startScheduler } from './scheduler/cron.js';
import { dbSaveMultipleSettings, initDb } from './db/index.js';

// Auto-inicializa tabelas do Neon na inicialização do servidor HTTP
initDb().catch(console.error);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PUBLIC_DIR = join(process.cwd(), 'public');
const ENV_FILE = join(process.cwd(), '.env');
const HISTORY_FILE = join(process.cwd(), '.sent-history.json');

let isBotRunning = false;

/**
 * Lê o corpo JSON de requisições POST.
 */
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

/**
 * Atualiza chaves específicas no arquivo .env se estiver em ambiente local com escrita
 */
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

/**
 * Servidor HTTP Principal & Handler para Vercel Serverless
 */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // Helper para JSON response
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

  // Static Files (HTML / CSS / JS) - Apenas se não for endpoint de API
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

  // --- API ENDPOINTS ---

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

      // Salva no banco de dados Neon (PostgreSQL na Nuvem)
      await dbSaveMultipleSettings(updates);

      // Também tenta salvar no arquivo .env se estiver em sistema de arquivos gravável
      updateEnvFile(updates);

      return sendJson({ success: true, message: 'Configurações atualizadas no Neon PostgreSQL' });
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
    return sendJson({ isRunning: true, message: '🤖 Automação iniciada com sucesso!' });
  }

  // POST /api/bot/stop
  if (method === 'POST' && (url === '/api/bot/stop' || url.endsWith('/stop'))) {
    isBotRunning = false;
    return sendJson({ isRunning: false, message: '⏹️ Automação pausada.' });
  }

  // POST /api/bot/run-now
  if (method === 'POST' && (url === '/api/bot/run-now' || url.endsWith('/run-now'))) {
    try {
      const config = loadConfig();
      runAutomaticCycle(config)
        .then(() => {})
        .catch((err) => console.error('Erro na execução manual:', err));

      return sendJson({ success: true, message: '⚡ Busca executada! Verifique seu grupo do WhatsApp.' });
    } catch (err) {
      return sendJson({ success: false, message: 'Erro na execução: ' + String(err) }, 500);
    }
  }

  // Fallback 404
  res.writeHead(404);
  res.end('Endpoint não encontrado.');
}

const server = createServer(handleRequest);

// Inicia o servidor localmente (apenas fora da Vercel)
if (process.env.VERCEL !== '1') {
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log('\n======================================================');
    console.log(`🚀 Painel de Controle ML Ofertas Bot rodando em:`);
    console.log(`👉 ${url}`);
    console.log('======================================================\n');

    // Abre navegador padrão automaticamente no Windows se for execução local CLI
    if (process.argv.includes('--open')) {
      const openCmd = process.platform === 'win32' ? `start ${url}` : `open ${url}`;
      exec(openCmd, () => {});
    }
  });
}

export default handleRequest;
