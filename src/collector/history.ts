import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDbPool } from '../db/index.js';

const HISTORY_FILE = join(process.cwd(), '.sent-history.json');
const PRICE_HISTORY_FILE = join(process.cwd(), '.price-history.json');

export interface HistoryItem {
  id: string;
  permalink: string;
  title: string;
  sentAt: string;
}

export interface PriceRecord {
  price: number;
  date: string;
}

export interface ProductPriceHistory {
  [titleKey: string]: PriceRecord[];
}

/**
 * Normaliza o título para gerar uma chave comparável.
 */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]/g, ' ')       // remove caracteres especiais
    .replace(/\s+/g, ' ')             // remove espaços duplicados
    .trim();
}

/**
 * Carrega a lista de links e títulos de produtos já enviados nos últimos 7 dias.
 * Tenta carregar do Neon PostgreSQL primeiro (persiste entre deploys do Render),
 * depois faz fallback para o arquivo local .sent-history.json.
 */
export async function loadSentHistoryFromDb(): Promise<Set<string>> {
  const db = getDbPool();
  if (!db) return new Set<string>();

  try {
    const res = await db.query(
      `SELECT id, title FROM sent_history WHERE sent_at > NOW() - INTERVAL '7 days'`
    );
    const keys = new Set<string>();
    for (const row of res.rows) {
      keys.add(row.id);
      keys.add(normalizeTitleKey(row.title));
    }
    return keys;
  } catch {
    return new Set<string>();
  }
}

/**
 * Carrega histórico de envios (síncrono — arquivo local).
 * Mantido para compatibilidade com o coletor que chama de forma síncrona.
 */
export function loadSentHistory(): Set<string> {
  // Tenta carregar do arquivo local
  const localKeys = loadSentHistoryFromFile();

  return localKeys;
}

function loadSentHistoryFromFile(): Set<string> {
  if (!existsSync(HISTORY_FILE)) {
    return new Set<string>();
  }

  try {
    const raw = readFileSync(HISTORY_FILE, 'utf-8');
    const items: HistoryItem[] = JSON.parse(raw);

    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    const historyKeys = new Set<string>();
    for (const item of items) {
      const itemTime = new Date(item.sentAt).getTime();
      if (now - itemTime < SEVEN_DAYS_MS) {
        historyKeys.add(item.permalink);
        historyKeys.add(normalizeTitleKey(item.title));
      }
    }
    return historyKeys;
  } catch {
    return new Set<string>();
  }
}

/**
 * Salva as ofertas recém-enviadas no histórico (arquivo local + Neon PostgreSQL).
 */
export function saveSentOffersToHistory(offers: { permalink: string; title: string; currentPrice?: number }[]): void {
  // --- Arquivo local (compatibilidade e cache rápido) ---
  let items: HistoryItem[] = [];

  if (existsSync(HISTORY_FILE)) {
    try {
      const raw = readFileSync(HISTORY_FILE, 'utf-8');
      items = JSON.parse(raw);
    } catch {
      items = [];
    }
  }

  const now = new Date().toISOString();
  for (const offer of offers) {
    items.push({
      id: offer.permalink.split('/p/')[1] || offer.permalink,
      permalink: offer.permalink,
      title: offer.title,
      sentAt: now,
    });
  }

  // Mantém registros dos últimos 30 dias para não crescer indefinidamente
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  items = items.filter((item) => new Date(item.sentAt).getTime() > cutoff);

  writeFileSync(HISTORY_FILE, JSON.stringify(items, null, 2), 'utf-8');

  // --- Neon PostgreSQL (persiste entre deploys/containers) ---
  saveSentOffersToDb(offers).catch((err) => {
    console.error('[HISTORY] Erro ao sincronizar historico com Neon:', err);
  });

  // Atualiza histórico de preços dos últimos 30 dias
  const priceOffers = offers.filter(o => typeof o.currentPrice === 'number' && o.currentPrice > 0) as { title: string; currentPrice: number }[];
  if (priceOffers.length > 0) {
    updatePriceHistory(priceOffers);
  }
}

/**
 * Salva ofertas enviadas no Neon PostgreSQL.
 */
async function saveSentOffersToDb(offers: { permalink: string; title: string; currentPrice?: number }[]): Promise<void> {
  const db = getDbPool();
  if (!db) return;

  try {
    const client = await db.connect();
    try {
      for (const offer of offers) {
        const id = offer.permalink.split('/p/')[1] || offer.permalink;
        const price = typeof offer.currentPrice === 'number' ? offer.currentPrice : 0;
        await client.query(
          `INSERT INTO sent_history (id, title, current_price) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET sent_at = CURRENT_TIMESTAMP`,
          [id, offer.title, price]
        );
      }
      console.log(`[DB] ${offers.length} oferta(s) registrada(s) no Neon PostgreSQL.`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB] Erro ao salvar historico no Neon:', err);
  }
}

/**
 * Verifica se o preço atual de um produto é o menor preço registrado nos últimos 30 dias.
 */
export function isLowestPriceIn30Days(titleKey: string, currentPrice: number, mlBadgeDetected = false): boolean {
  // Se o próprio Mercado Livre tem o selo oficial "Menor preço nos últimos 30 dias", confirma 100%
  if (mlBadgeDetected) return true;

  if (!existsSync(PRICE_HISTORY_FILE)) {
    return true; // Se ainda não há banco histórico, aceita como menor preço
  }

  try {
    const raw = readFileSync(PRICE_HISTORY_FILE, 'utf-8');
    const history: ProductPriceHistory = JSON.parse(raw);
    const records = history[titleKey] || [];

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const recentRecords = records.filter(r => new Date(r.date).getTime() > cutoff);

    if (recentRecords.length === 0) return true;

    const minHistoricalPrice = Math.min(...recentRecords.map(r => r.price));
    return currentPrice <= minHistoricalPrice;
  } catch {
    return true;
  }
}

/**
 * Atualiza o banco de dados de preços dos últimos 30 dias (arquivo local + Neon).
 */
export function updatePriceHistory(offers: { title: string; currentPrice: number }[]): void {
  // --- Arquivo local ---
  let history: ProductPriceHistory = {};

  if (existsSync(PRICE_HISTORY_FILE)) {
    try {
      const raw = readFileSync(PRICE_HISTORY_FILE, 'utf-8');
      history = JSON.parse(raw);
    } catch {
      history = {};
    }
  }

  const now = new Date().toISOString();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THIRTY_DAYS_MS;

  for (const offer of offers) {
    const key = normalizeTitleKey(offer.title);
    if (!history[key]) history[key] = [];

    history[key].push({ price: offer.currentPrice, date: now });
    history[key] = history[key].filter(r => new Date(r.date).getTime() > cutoff);
  }

  writeFileSync(PRICE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');

  // --- Neon PostgreSQL ---
  savePriceHistoryToDb(offers).catch((err) => {
    console.error('[HISTORY] Erro ao sincronizar precos com Neon:', err);
  });
}

/**
 * Salva histórico de preços no Neon PostgreSQL.
 */
async function savePriceHistoryToDb(offers: { title: string; currentPrice: number }[]): Promise<void> {
  const db = getDbPool();
  if (!db) return;

  try {
    const client = await db.connect();
    try {
      for (const offer of offers) {
        const key = normalizeTitleKey(offer.title);
        await client.query(
          `INSERT INTO price_history (product_key, price) VALUES ($1, $2)`,
          [key, offer.currentPrice]
        );
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[DB] Erro ao salvar historico de precos no Neon:', err);
  }
}

