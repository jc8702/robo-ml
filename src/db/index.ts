import pg from 'pg';
const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Retorna a instância do pool do PostgreSQL se DATABASE_URL estiver configurada.
 */
export function getDbPool(): pg.Pool | null {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith('postgres')) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

/**
 * Inicializa automaticamente as tabelas sent_history e price_history no Neon/PostgreSQL.
 */
export async function initDb(): Promise<boolean> {
  const db = getDbPool();
  if (!db) return false;

  try {
    const client = await db.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sent_history (
          id VARCHAR(255) PRIMARY KEY,
          title TEXT NOT NULL,
          current_price NUMERIC(10, 2) NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS price_history (
          id SERIAL PRIMARY KEY,
          product_key VARCHAR(255) NOT NULL,
          price NUMERIC(10, 2) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sent_history_sent_at ON sent_history(sent_at);
        CREATE INDEX IF NOT EXISTS idx_price_history_product_key ON price_history(product_key);
      `);
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('⚠️ Erro ao inicializar tabelas no Neon PostgreSQL:', error);
    return false;
  }
}
