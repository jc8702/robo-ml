import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
 */
export function loadSentHistory(): Set<string> {
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
 * Salva as ofertas recém-enviadas no histórico.
 */
export function saveSentOffersToHistory(offers: { permalink: string; title: string; currentPrice?: number }[]): void {
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

  // Atualiza histórico de preços dos últimos 30 dias
  const priceOffers = offers.filter(o => typeof o.currentPrice === 'number' && o.currentPrice > 0) as { title: string; currentPrice: number }[];
  if (priceOffers.length > 0) {
    updatePriceHistory(priceOffers);
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
 * Atualiza o banco de dados de preços dos últimos 30 dias.
 */
export function updatePriceHistory(offers: { title: string; currentPrice: number }[]): void {
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
}
