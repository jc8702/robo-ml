import type { VercelRequest, VercelResponse } from '@vercel/node';
import pg from 'pg';

const DEFAULT_CATEGORIES = [
  'iphone', 'samsung galaxy', 'xiaomi', 'motorola', 'realme', 'smartwatch', 'airpods', 'carregador celular', 'capinha celular',
  'notebook gamer', 'pc gamer', 'monitor gamer', 'placa de video', 'processador intel ryzen', 'ssd nvme', 'teclado mecanico', 'impressora', 'roteador wifi',
  'playstation 5', 'xbox series', 'nintendo switch', 'steam deck', 'cadeira gamer', 'volante logitech',
  'smart tv', 'caixa de som jbl', 'fone bluetooth', 'soundbar', 'drone dji', 'camera de seguranca', 'fire tv stick',
  'air fryer', 'cafeteira', 'aspirador robo', 'geladeira', 'lava e seca', 'cooktop', 'ar condicionado', 'liquidificador',
  'sofa retratil', 'colchao queen king', 'guarda roupa', 'mesa de jantar', 'lampada smart', 'jogo de cama',
  'parafusadeira', 'jogo de ferramentas', 'serra tico tico', 'inversora de solda', 'chuveiro lorenzetti',
  'barbeador eletrico', 'secador de cabelo', 'perfume importado', 'skincare', 'maquiagem',
  'whey protein', 'creatina', 'pre treino', 'vitamina c d3',
  'bicicleta aro 29', 'kit halteres', 'tenis corrida', 'barraca camping', 'bola futebol',
  'tenis casual', 'camiseta masculina', 'vestido feminino', 'mochila notebook', 'relogio casio',
  'carrinho de bebe', 'brinquedo fisher price', 'lego', 'mamadeira avent',
  'pneu aro', 'multimidia android', 'oleo motor 5w30', 'estetica automotiva',
  'racao caes', 'racao gatos', 'caminha pet'
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const dbUrl = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_0SIXLDvOk3tl@ep-sparkling-silence-ac0kw825-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';

  let categories = DEFAULT_CATEGORIES;
  let minPrice = 30;
  let maxPrice = 10000;
  let minDiscount = 0;
  let maxResults = 35;

  if (dbUrl) {
    try {
      const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      const dbRes = await pool.query('SELECT key, value FROM app_settings');
      await pool.end();

      const settings: Record<string, string> = {};
      for (const row of dbRes.rows) {
        settings[row.key] = row.value;
      }

      if (settings.ML_CATEGORIES) {
        const parsed = settings.ML_CATEGORIES.split(',').map(s => s.trim()).filter(Boolean);
        if (parsed.length > 0) categories = parsed;
      }
      if (settings.ML_MIN_PRICE) minPrice = Number(settings.ML_MIN_PRICE);
      if (settings.ML_MAX_PRICE) maxPrice = Number(settings.ML_MAX_PRICE);
      if (settings.ML_MIN_DISCOUNT) minDiscount = Number(settings.ML_MIN_DISCOUNT);
      if (settings.ML_MAX_RESULTS) maxResults = Number(settings.ML_MAX_RESULTS);
    } catch { /* fallback padrao */ }
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      categories,
      minPrice,
      maxPrice,
      minDiscount,
      maxResults,
      cronSchedule: '0 */3 * * *',
      isRunning: false,
    });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      if (dbUrl) {
        const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
        if (Array.isArray(body.categories)) {
          await pool.query(
            'INSERT INTO app_settings (key, value) VALUES (\'ML_CATEGORIES\', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [body.categories.join(',')]
          );
        }
        if (typeof body.minPrice === 'number') {
          await pool.query(
            'INSERT INTO app_settings (key, value) VALUES (\'ML_MIN_PRICE\', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [String(body.minPrice)]
          );
        }
        if (typeof body.maxPrice === 'number') {
          await pool.query(
            'INSERT INTO app_settings (key, value) VALUES (\'ML_MAX_PRICE\', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [String(body.maxPrice)]
          );
        }
        await pool.end();
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: String(err) });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
