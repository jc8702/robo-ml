import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatIndividualOffer } from '../formatter/whatsapp.js';
import { getDbPool } from '../db/index.js';

const AUTH_DIR = join(process.cwd(), '.wa-auth');

let sock: WASocket | null = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 15000;

// Exposto para o endpoint GET /api/pairing-code
export let currentPairingCode: string | null = null;
export let pairingCodeRequestedAt: Date | null = null;

// ── Persistência de sessão no Neon ─────────────────────────────────────────

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
    console.log('[DB] Sessao WhatsApp salva no Neon.');
  } catch (err) {
    console.error('[DB] Falha ao salvar sessao no Neon:', err);
  }
}

function printPairingCode(code: string) {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   VINCULAR WHATSAPP — PAIRING CODE       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Codigo: ${code.padEnd(32)}║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  No WhatsApp:                            ║');
  console.log('║  ⚙ Configuracoes → Dispositivos           ║');
  console.log('║  vinculados → Vincular com numero        ║');
  console.log('║  de telefone → Digite o codigo acima     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('[WA] Codigo tambem disponivel em: GET /api/pairing-code\n');
}

// ── Cliente WhatsApp ───────────────────────────────────────────────────────

export async function initWhatsAppClient(): Promise<WASocket> {
  if (sock && isConnected) return sock;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[WA] Maximo de tentativas atingido. Aguardando 60s...`);
    await new Promise((r) => setTimeout(r, 60000));
    reconnectAttempts = 0;
  }

  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
  await restoreWaAuthFromDb();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  // Número de telefone para Pairing Code (apenas dígitos, com DDI)
  const phoneNumber = (process.env.WHATSAPP_PHONE || '').replace(/\D/g, '');
  const usePairingCode = phoneNumber.length >= 10;

  return new Promise((resolve, reject) => {
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['ML Ofertas Bot', 'Chrome', '1.0.0'],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
    });

    // ── CRÍTICO: Solicita Pairing Code IMEDIATAMENTE após criar o socket,
    //            ANTES do evento QR ser emitido. Isso é obrigatório pelo Baileys.
    if (usePairingCode && !state.creds.registered) {
      console.log(`[WA] Solicitando Pairing Code para +${phoneNumber}...`);
      // Pequeno delay para o socket inicializar a conexão com os servidores WA
      setTimeout(async () => {
        if (!sock) return;
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          currentPairingCode = code;
          pairingCodeRequestedAt = new Date();
          printPairingCode(code);
        } catch (err) {
          console.error('[WA] Erro ao solicitar Pairing Code:', err);
          console.log('[WA] Verifique se WHATSAPP_PHONE esta correto e tente novamente.');
        }
      }, 3000);
    } else if (!usePairingCode) {
      console.log('[WA] ATENCAO: Configure WHATSAPP_PHONE=5547XXXXXXXXX no Render!');
    } else {
      console.log('[WA] Credenciais existentes encontradas — reconectando sem Pairing Code...');
    }

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await saveWaAuthToDb();
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log('[WA] ✅ WhatsApp conectado com sucesso!');
        currentPairingCode = null;
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
          console.error('[WA] Sessao encerrada (logged out). Reconecte pelo pairing code.');
          // Limpa sessão local e tenta nova autenticação
          sock = null;
          isConnected = false;
          reject(new Error('Sessao encerrada. Reconecte via /api/pairing-code'));
        }
      }
    });
  });
}

// ── Envio de Ofertas ───────────────────────────────────────────────────────

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
