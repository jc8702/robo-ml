import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
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
const RECONNECT_DELAY_MS = 10000;

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
      console.log(`[DB] Sessao do WhatsApp restaurada do Neon PostgreSQL (${res.rows.length} arquivo(s)).`);
    }
  } catch (err) {
    console.error('[DB] Nao foi possivel restaurar sessao do WhatsApp do Neon:', err);
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
        `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, content]
      );
    }
  } catch (err) {
    console.error('[DB] Erro ao persistir sessao do WhatsApp no Neon:', err);
  }
}

export async function initWhatsAppClient(): Promise<WASocket> {
  if (sock && isConnected) return sock;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[WA] Maximo de tentativas de reconexao atingido (${MAX_RECONNECT_ATTEMPTS}). Aguardando 60s...`);
    await new Promise((r) => setTimeout(r, 60000));
    reconnectAttempts = 0;
  }

  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }

  await restoreWaAuthFromDb();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

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

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await saveWaAuthToDb();
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        reconnectAttempts++;
        console.log(`\n[WA] Escaneie o QR Code abaixo com seu WhatsApp para conectar (tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}):\n`);
        qrcode.generate(qr, { small: true });
        console.log('\n[WA] QR Code expira em 20 segundos. Escaneie rapido!\n');
      }

      if (connection === 'open') {
        console.log('[WA] WhatsApp conectado com sucesso!');
        isConnected = true;
        reconnectAttempts = 0;
        resolve(sock!);
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WA] Conexao fechada. Motivo: ${statusCode}. Reconectando: ${shouldReconnect}`);

        if (shouldReconnect) {
          console.log(`[WA] Aguardando ${RECONNECT_DELAY_MS / 1000}s antes de reconectar...`);
          setTimeout(() => {
            initWhatsAppClient().then(resolve).catch(reject);
          }, RECONNECT_DELAY_MS);
        } else {
          reject(new Error('Sessao encerrada (logged out). Remova a pasta .wa-auth e rode novamente.'));
        }
      }
    });
  });
}

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
    console.error(`  [WA] Erro ao enviar oferta para WhatsApp:`, error);
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
