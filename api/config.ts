import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadConfigAsync } from '../src/config/settings.js';
import { dbSaveMultipleSettings, initDb } from '../src/db/index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  await initDb().catch(() => {});

  if (req.method === 'GET') {
    const config = await loadConfigAsync();
    return res.status(200).json({
      categories: config.filters.categories,
      queries: config.queries,
      minPrice: config.filters.minPrice,
      maxPrice: config.filters.maxPrice,
      minDiscount: config.filters.minDiscount,
      maxResults: config.filters.maxResults,
      cronSchedule: process.env.AUTO_SCHEDULE_CRON || '0 */3 * * *',
      affiliateId: config.affiliate.id,
      groupId: process.env.WHATSAPP_GROUP_ID || '',
      isRunning: false,
      fbEnabled: config.facebook.enabled,
      fbGroupUrls: config.facebook.groupUrls,
      fbMaxGroupsPerCycle: config.facebook.maxGroupsPerCycle,
      fbDelayBetweenPosts: config.facebook.delayBetweenPostsSec,
      fbWaGroupLink: config.facebook.waGroupLink,
      fbAutoJoin: config.facebook.autoJoin,
    });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const updates: Record<string, string> = {};

      if (Array.isArray(body.categories)) {
        updates.ML_CATEGORIES = body.categories.join(',');
      }
      if (typeof body.minPrice === 'number') updates.ML_MIN_PRICE = String(body.minPrice);
      if (typeof body.maxPrice === 'number') updates.ML_MAX_PRICE = String(body.maxPrice);
      if (typeof body.minDiscount === 'number') updates.ML_MIN_DISCOUNT = String(body.minDiscount);
      if (typeof body.maxResults === 'number') updates.ML_MAX_RESULTS = String(body.maxResults);

      await dbSaveMultipleSettings(updates);
      return res.status(200).json({ success: true, message: 'Configurações atualizadas no Neon PostgreSQL' });
    } catch (err) {
      return res.status(400).json({ success: false, error: String(err) });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
