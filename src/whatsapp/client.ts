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

// --- Persistencia simplificada de creds no Neon DB ---

async function restoreCredsFromDb() {
  const db = getDbPool();
  if (!db) return;
  try {
    const res = await db.query("SELECT value FROM app_settings WHERE key = 'WA_AUTH_creds.json'");
    if (res.rows.length > 0 && res.rows[0].value) {
      if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
      writeFileSync(join(AUTH_DIR, 'creds.json'), res.rows[0].value, 'utf-8');
      console.log('[DB] Credenciais mestre do WhatsApp restauradas do Neon PostgreSQL.');
    }
  } catch {
    // Ignora erros de banco se desativado/não configurado
  }
}

async function saveCredsToDb() {
  const db = getDbPool();
  if (!db || !existsSync(join(AUTH_DIR, 'creds.json'))) return;
  try {
    const content = readFileSync(join(AUTH_DIR, 'creds.json'), 'utf-8');
    await db.query(
      `INSERT INTO app_settings (key, value) VALUES ('WA_AUTH_creds.json', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [content]
    );
    console.log('[DB] Credenciais mestre do WhatsApp salvas no Neon PostgreSQL.');
  } catch {
    // Ignora erros de banco
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
  const usePairingCode = phoneNumber.length >= 10;
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

    // Se NÃO está registrado E ainda NÃO solicitou um código ativo neste ciclo
    if (usePairingCode && !isRegistered && !currentPairingCode) {
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

        if (process.env.IS_TEST_MODE === 'true') {
          console.log(`[WA] [MODO TESTE] Conexão encerrada (código: ${statusCode}).`);
          return;
        }

        // Se deslogou explicitamente pelo celular (código 401 / loggedOut)
        if (loggedOut && isRegistered) {
          console.error('[WA] Sessão desvinculada no celular. Limpando credenciais...');
          clearLocalAuth();
          clearCredsFromDb().catch(() => {});
          scheduleReconnect(3000, 'Reiniciando para novo pareamento...');
          return;
        }

        // Se a conexão fechar durante o pareamento inicial (protocolo normal do Baileys ao alternar fluxos),
        // RECONECTA IMEDIATAMENTE (2s) mantendo o pairing code para escutar a confirmação do celular!
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
  // Se existir perfil do Playwright (.wa-profile), usa o motor Playwright 100% infalível
  if (existsSync(join(process.cwd(), '.wa-profile'))) {
    console.log('[WA] Usando motor Playwright WhatsApp Web para envio...');
    return sendOfferWithPhotoPlaywright(offer, targetJid);
  }

  try {
    const client = await initWhatsAppClient();
    const caption = formatIndividualOffer(offer);

    if (offer.thumbnail && offer.thumbnail.startsWith('http')) {
      await client.sendMessage(targetJid, {
        image: { url: offer.thumbnail },
        caption: caption,
      });
      console.log(`  [WA] Foto + Oferta enviada: "${offer.title.substring(0, 30)}..."`);
    } else {
      await client.sendMessage(targetJid, { text: caption });
      console.log(`  [WA] Oferta enviada (sem foto): "${offer.title.substring(0, 30)}..."`);
    }

    return true;
  } catch (error) {
    console.error(`  [WA] Erro ao enviar oferta via Baileys, tentando Playwright:`, error);
    return sendOfferWithPhotoPlaywright(offer, targetJid);
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
