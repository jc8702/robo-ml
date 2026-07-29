import type { VercelRequest, VercelResponse } from '@vercel/node';
import pg from 'pg';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const dbUrl = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_0SIXLDvOk3tl@ep-sparkling-silence-ac0kw825-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';

  if (dbUrl) {
    try {
      const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      const dbRes = await pool.query('SELECT id, title, current_price, sent_at FROM sent_history ORDER BY sent_at DESC LIMIT 30');
      await pool.end();

      const items = dbRes.rows.map(r => ({
        id: r.id,
        title: r.title,
        currentPrice: Number(r.current_price),
        sentAt: r.sent_at,
      }));

      return res.status(200).json(items);
    } catch {
      return res.status(200).json([]);
    }
  }

  return res.status(200).json([]);
}
