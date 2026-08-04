import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import qrcodeTerminal from 'qrcode-terminal';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatIndividualOffer } from '../formatter/whatsapp.js';
import { getDbPool } from '../db/index.js';

const AUTH_DIR = join(process.cwd(), '.wa-auth');

let sock: WASocket | null = null;
let isConnected = false;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

export let currentPairingCode: string | null = null;
export let pairingCodeRequestedAt: Date | null = null;
export let currentQrRaw: string | null = null;

// --- Persistencia completa de todos os arquivos de sessão (.wa-auth/*.json) no Neon DB ---
import { readdirSync } from 'node:fs';

async function restoreCredsFromDb() {
  const db = getDbPool();
  if (!db) return;
  try {
    const res = await db.query("SELECT key, value FROM app_settings WHERE key LIKE 'WA_AUTH_%'");
    if (res.rows.length > 0) {
      if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
      for (const row of res.rows) {
        const fileName = row.key.replace('WA_AUTH_', '');
        writeFileSync(join(AUTH_DIR, fileName), row.value, 'utf-8');
      }
      console.log(`[DB] 🔑 ${res.rows.length} arquivo(s) de sessão do WhatsApp restaurado(s) do Neon PostgreSQL.`);
    }
  } catch (err) {
    console.error('[DB] Erro ao restaurar sessão do WhatsApp:', err);
  }
}

async function saveCredsToDb() {
  const db = getDbPool();
  if (!db || !existsSync(AUTH_DIR)) return;
  try {
    const credsPath = join(AUTH_DIR, 'creds.json');
    if (!existsSync(credsPath)) return;
    const content = readFileSync(credsPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed.registered) return;

    const files = readdirSync(AUTH_DIR);
    const client = await db.connect();
    try {
      for (const file of files) {
        if (file.endsWith('.json')) {
          const fileContent = readFileSync(join(AUTH_DIR, file), 'utf-8');
          await client.query(
            `INSERT INTO app_settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [`WA_AUTH_${file}`, fileContent]
          );
        }
      }
      console.log(`[DB] 💾 ${files.length} arquivo(s) de sessão do WhatsApp salvos no Neon PostgreSQL.`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB] Erro ao salvar sessão do WhatsApp no Neon:', err);
  }
}

async function clearCredsFromDb() {
  const db = getDbPool();
  if (!db) return;
  try {
    await db.query("DELETE FROM app_settings WHERE key LIKE 'WA_AUTH_%'");
    console.log('[DB] Credenciais do WhatsApp removidas do Neon.');
  } catch {
    // Ignora erros
  }
}

function clearLocalAuth() {
  currentPairingCode = null;
  pairingCodeRequestedAt = null;
  currentQrRaw = null;
  if (existsSync(AUTH_DIR)) {
    try {
      rmSync(AUTH_DIR, { recursive: true, force: true });
      mkdirSync(AUTH_DIR, { recursive: true });
      console.log('[WA] Sessao local (.wa-auth/) limpa com sucesso.');
    } catch (err) {
      console.error('[WA] Falha ao limpar sessao local:', err);
    }
  }
}

function printPairingCodeBanner(code: string) {
  console.log('\n========================================');
  console.log('  📱 VINCULAR WHATSAPP - PAIRING CODE');
  console.log('========================================');
  console.log(`  CÓDIGO:  ${code}`);
  console.log('----------------------------------------');
  console.log('  No WhatsApp do seu celular:');
  console.log('  1. Abra Configurações');
  console.log('  2. Dispositivos vinculados');
  console.log('  3. Vincular um dispositivo');
  console.log('  4. "Vincular com número de telefone"');
  console.log(`  5. Digite: ${code}`);
  console.log('========================================');
  console.log('[WA] Código também em: /api/pairing-code\n');
}

// --- Cliente WhatsApp ---

let reconnectTimer: NodeJS.Timeout | null = null;

function scheduleReconnect(delayMs: number, reason: string) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delaySec = (delayMs / 1000).toFixed(1);
  if (reason) console.log(`[WA] ${reason} Reconectando em ${delaySec}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initWhatsAppClient().catch(() => {});
  }, delayMs);
}

export async function initWhatsAppClient(): Promise<WASocket> {
  if (sock && isConnected) return sock;

  if (isConnecting) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (sock && isConnected) {
          clearInterval(check);
          resolve(sock);
        }
      }, 1000);
      setTimeout(() => { clearInterval(check); }, 60_000);
    });
  }

  isConnecting = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
  await restoreCredsFromDb();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const rawPhone = process.env.WHATSAPP_PHONE || '';
  const phoneNumber = rawPhone.replace(/\D/g, '');
  const usePairingCode = process.env.WHATSAPP_USE_PAIRING_CODE === 'true';
  const isRegistered = state.creds.registered;

  return new Promise((resolve) => {
    if (sock) {
      try { sock.end(undefined); } catch {}
      sock = null;
    }

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: !usePairingCode,
      logger: pino({ level: 'silent' }),
      browser: ['Mac OS', 'Chrome', '10.0.0'],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false,
    });

    const currentSockInstance = sock;

    const hasWaProfile = existsSync(join(process.cwd(), '.wa-profile'));

    // Se NÃO está registrado E ainda NÃO solicitou um código ativo neste ciclo E NÃO usa sessão do Playwright
    if (usePairingCode && !isRegistered && !currentPairingCode && !hasWaProfile) {
      console.log(`[WA] Iniciando solicitação de Pairing Code para +${phoneNumber}...`);
      setTimeout(async () => {
        if (sock !== currentSockInstance || isConnected) return;
        try {
          const code = await currentSockInstance.requestPairingCode(phoneNumber);
          currentPairingCode = code;
          pairingCodeRequestedAt = new Date();
          printPairingCodeBanner(code);
        } catch (err) {
          console.error('[WA] Erro ao obter Pairing Code:', (err as Error)?.message || err);
        }
      }, 4000);
    }

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      saveCredsToDb().catch(() => {});
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQrRaw = qr;
        if (!usePairingCode) {
          console.log('\n========================================');
          console.log('  📷 ESCANEIE O QR CODE NO WHATSAPP DO CELULAR');
          console.log('========================================');
          try {
            qrcodeTerminal.generate(qr, { small: true });
          } catch {
            console.log(qr);
          }
          console.log('========================================');
          console.log('[WA] QR Code HD no navegador: /qr\n');
        }
      }

      if (connection === 'open') {
        console.log('[WA] ✅ WHATSAPP CONECTADO COM SUCESSO!');
        currentPairingCode = null;
        pairingCodeRequestedAt = null;
        currentQrRaw = null;
        isConnected = true;
        isConnecting = false;
        reconnectAttempts = 0;
        resolve(sock!);
      }

      if (connection === 'close') {
        isConnected = false;
        isConnecting = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const isUnauthorized = loggedOut || statusCode === 401;

        if (process.env.IS_TEST_MODE === 'true') {
          console.log(`[WA] [MODO TESTE] Conexão encerrada (código: ${statusCode}).`);
          return;
        }

        // Se deslogou ou foi rejeitado com erro 401 (unauthorized / loggedOut), expurga sessão corrompida
        if (isUnauthorized) {
          console.error(`[WA] Sessão desvinculada ou rejeitada (status: ${statusCode || 401}). Limpando credenciais locais e do Neon DB...`);
          clearLocalAuth();
          clearCredsFromDb().catch(() => {});
          reconnectAttempts = 0;
          scheduleReconnect(5000, 'Reiniciando para novo pareamento do zero...');
          return;
        }

        // Se a conexão fechar durante o pareamento inicial (protocolo normal do Baileys ao alternar fluxos),
        // RECONECTA IMEDIATAMENTE (3s) mantendo o pairing code para escutar a confirmação do celular!
        if (!isRegistered) {
          reconnectAttempts++;
          console.log(`[WA] Conexão alternada durante pareamento (status: ${statusCode || 'desconectado'}). Mantendo socket de escuta... (tentativa ${reconnectAttempts})`);
          
          // Se falhou mais de 8 vezes sem o usuário digitar o código, invalida o código antigo para pedir um novo
          if (reconnectAttempts > 8) {
            console.log('[WA] Tempo limite de pareamento excedido. Gerando novo código...');
            currentPairingCode = null;
            pairingCodeRequestedAt = null;
            reconnectAttempts = 0;
          }

          scheduleReconnect(3000, '');
          return;
        }

        // Queda de conexão genérica de sessão já registrada
        reconnectAttempts++;
        console.log(`[WA] Conexão interrompida (código: ${statusCode || 'desconhecido'}). Tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
        scheduleReconnect(5000, '');
      }
    });
  });
}

// --- Envio de Ofertas ---

import { sendOfferWithPhotoPlaywright } from './wa-playwright.js';

export async function sendOfferWithPhoto(
  offer: AffiliateOffer,
  targetJid: string
): Promise<boolean> {
  const caption = formatIndividualOffer(offer);

  // 1. Tenta enviar via Baileys se a conexão já estiver aberta
  if (sock && isConnected) {
    try {
      if (offer.thumbnail && offer.thumbnail.startsWith('http')) {
        await sock.sendMessage(targetJid, {
          image: { url: offer.thumbnail },
          caption: caption,
        });
      } else {
        await sock.sendMessage(targetJid, { text: caption });
      }
      console.log(`  [WA] ✅ Foto + Oferta enviada via Baileys: "${offer.title.substring(0, 30)}..."`);
      return true;
    } catch (err) {
      console.error(`  [WA] Tentativa via Baileys falhou, alternando para Playwright:`, (err as Error)?.message || err);
    }
  }

  // 2. Se existir perfil do Playwright (.wa-profile), tenta via WhatsApp Web Chrome
  if (existsSync(join(process.cwd(), '.wa-profile'))) {
    try {
      console.log('[WA] Usando motor Playwright WhatsApp Web para envio...');
      const ok = await sendOfferWithPhotoPlaywright(offer, targetJid);
      if (ok) return true;
    } catch (pwErr) {
      console.error('[WA] Playwright falhou, tentando inicializar Baileys:', pwErr);
    }
  }

  // 3. Fallback: Tenta inicializar / conectar o cliente Baileys
  try {
    const client = await initWhatsAppClient();
    if (offer.thumbnail && offer.thumbnail.startsWith('http')) {
      await client.sendMessage(targetJid, {
        image: { url: offer.thumbnail },
        caption: caption,
      });
      console.log(`  [WA] ✅ Foto + Oferta enviada via Baileys (init): "${offer.title.substring(0, 30)}..."`);
    } else {
      await client.sendMessage(targetJid, { text: caption });
      console.log(`  [WA] ✅ Oferta enviada via Baileys (init): "${offer.title.substring(0, 30)}..."`);
    }
    return true;
  } catch (error) {
    console.error(`  [WA] ❌ Não foi possível enviar no WhatsApp (Baileys & Playwright falharam). Vincule com: npm run wa:connect`);
    return false;
  }
}

export async function listGroups(): Promise<void> {
  const client = await initWhatsAppClient();
  const groupMetadata = await client.groupFetchAllParticipating();

  console.log('\n[WA] Grupos de WhatsApp Encontrados:');
  console.log('--------------------------------------');

  const groups = Object.values(groupMetadata);
  if (groups.length === 0) {
    console.log('Nenhum grupo encontrado.');
    return;
  }

  for (const group of groups) {
    console.log(`Nome: ${group.subject}`);
    console.log(`ID:   ${group.id}`);
    console.log('--------------------------------------');
  }
}
