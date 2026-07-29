import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatIndividualOffer } from '../formatter/whatsapp.js';
import { getDbPool } from '../db/index.js';

const AUTH_DIR = join(process.cwd(), '.wa-auth');

let sock: WASocket | null = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 15000;

export let currentPairingCode: string | null = null;
export let pairingCodeRequestedAt: Date | null = null;
export let currentQrRaw: string | null = null;

// --- Persistencia de sessao no Neon ---

async function restoreWaAuthFromDb() {
  const db = getDbPool();
  if (!db) return;
  try {
    const res = await db.query("SELECT key, value FROM app_settings WHERE key LIKE 'WA_AUTH_%'");
    if (res.rows.length > 0) {
      if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
      for (const row of res.rows) {
        const fileName = row.key.replace('WA_AUTH_', '');
        const filePath = join(AUTH_DIR, fileName);
        writeFileSync(filePath, row.value, 'utf-8');
      }
      console.log(`[DB] Sessao WhatsApp restaurada do Neon (${res.rows.length} arquivo(s)).`);
    } else {
      console.log('[DB] Nenhuma sessao salva no Neon. Inicializacao limpa.');
    }
  } catch (err) {
    console.error('[DB] Falha ao restaurar sessao do Neon:', err);
  }
}

async function saveWaAuthToDb() {
  const db = getDbPool();
  if (!db || !existsSync(AUTH_DIR)) return;
  try {
    const files = readdirSync(AUTH_DIR);
    if (files.length === 0) return;

    await db.query("DELETE FROM app_settings WHERE key LIKE 'WA_AUTH_%'");

    for (const file of files) {
      const filePath = join(AUTH_DIR, file);
      const content = readFileSync(filePath, 'utf-8');
      const key = `WA_AUTH_${file}`;
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, content]
      );
    }
    console.log(`[DB] Sessao WhatsApp salva no Neon (${files.length} arquivo(s)).`);
  } catch (err) {
    console.error('[DB] Falha ao salvar sessao no Neon:', err);
  }
}

async function clearWaAuthFromDb() {
  const db = getDbPool();
  if (!db) return;
  try {
    await db.query("DELETE FROM app_settings WHERE key LIKE 'WA_AUTH_%'");
    console.log('[DB] Sessao WhatsApp invalida/antiga removida do Neon PostgreSQL com sucesso.');
  } catch (err) {
    console.error('[DB] Falha ao limpar sessao do Neon:', err);
  }
}

function clearLocalAuth() {
  if (existsSync(AUTH_DIR)) {
    try {
      rmSync(AUTH_DIR, { recursive: true, force: true });
      mkdirSync(AUTH_DIR, { recursive: true });
      console.log('[WA] Sessao local limpa.');
    } catch (err) {
      console.error('[WA] Falha ao limpar sessao local:', err);
    }
  }
}

function printPairingCode(code: string) {
  console.log('\n========================================');
  console.log('  VINCULAR WHATSAPP - PAIRING CODE');
  console.log('========================================');
  console.log(`  Codigo: ${code}`);
  console.log('----------------------------------------');
  console.log('  No WhatsApp:');
  console.log('  Configuracoes -> Dispositivos vinculados');
  console.log('  -> Vincular com numero de telefone');
  console.log('  -> Digite o codigo acima');
  console.log('========================================');
  console.log('[WA] Codigo disponivel em: /api/pairing-code');
  console.log('[WA] QR Code visual disponivel em: /qr\n');
}

// --- Cliente WhatsApp ---

export async function initWhatsAppClient(): Promise<WASocket> {
  if (sock && isConnected) return sock;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[WA] Maximo de tentativas atingido. Aguardando 60s...');
    await new Promise((r) => setTimeout(r, 60000));
    reconnectAttempts = 0;
  }

  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
  await restoreWaAuthFromDb();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  // Número de telefone para Pairing Code (com DDI, ex: 5547997896229)
  const phoneNumber = (process.env.WHATSAPP_PHONE || '').replace(/\D/g, '');
  const usePairingCode = phoneNumber.length >= 10;

  return new Promise((resolve, reject) => {
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      // CRÍTICO: Usa a assinatura oficial de navegador do Baileys (Ubuntu / Chrome)
      // Necessário para o WhatsApp aceitar a validação do Pairing Code no celular
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
    });

    // Se nao estiver registrado e tiver telefone configurado, pede o Pairing Code
    if (usePairingCode && !state.creds.registered) {
      console.log(`[WA] Solicitando Pairing Code oficial para +${phoneNumber}...`);
      setTimeout(async () => {
        if (!sock) return;
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          currentPairingCode = code;
          pairingCodeRequestedAt = new Date();
          printPairingCode(code);
        } catch (err) {
          console.error('[WA] Erro ao solicitar Pairing Code:', err);
        }
      }, 3000);
    }

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await saveWaAuthToDb();
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Guarda o QR Code bruto caso emitido, para exibir em /qr no navegador em alta definicao
      if (qr) {
        currentQrRaw = qr;
        console.log('[WA] Novo QR Code capturado! Acesse /qr no navegador para escanear.');
      }

      if (connection === 'open') {
        console.log('[WA] ✅ WhatsApp conectado com sucesso!');
        currentPairingCode = null;
        currentQrRaw = null;
        isConnected = true;
        reconnectAttempts = 0;
        resolve(sock!);
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WA] Conexao fechada. Codigo: ${statusCode}. Reconectando: ${shouldReconnect}`);

        if (shouldReconnect) {
          reconnectAttempts++;
          console.log(`[WA] Aguardando ${RECONNECT_DELAY_MS / 1000}s antes de reconectar (tentativa ${reconnectAttempts})...`);
          setTimeout(() => {
            initWhatsAppClient().then(resolve).catch(reject);
          }, RECONNECT_DELAY_MS);
        } else {
          // 401 = logged out (sessao invalida ou encerrada)
          console.error('[WA] Sessao encerrada (logged out). Limpando credenciais invalidas...');
          sock = null;
          isConnected = false;
          clearLocalAuth();
          clearWaAuthFromDb().then(() => {
            console.log('[WA] Sessao limpa. Reiniciando para gerar novo Pairing Code / QR Code...');
            reconnectAttempts = 0;
            initWhatsAppClient().then(resolve).catch(reject);
          });
        }
      }
    });
  });
}

// --- Envio de Ofertas ---

export async function sendOfferWithPhoto(
  offer: AffiliateOffer,
  targetJid: string
): Promise<boolean> {
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
    console.error(`  [WA] Erro ao enviar oferta:`, error);
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
