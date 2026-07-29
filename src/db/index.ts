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
 * Inicializa automaticamente as tabelas sent_history, price_history e app_settings no Neon/PostgreSQL.
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

        CREATE TABLE IF NOT EXISTS app_settings (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sent_history_sent_at ON sent_history(sent_at);
        CREATE INDEX IF NOT EXISTS idx_price_history_product_key ON price_history(product_key);
      `);

      // Popula configurações padrão no Neon se ainda não existirem
      const defaultCategories = 'samsung galaxy,iphone,xiaomi,motorola,realme,smartwatch,airpods,carregador celular,capinha celular,smart tv,caixa de som jbl,fone bluetooth,soundbar,drone dji,camera de seguranca,fire tv stick,parafusadeira,jogo de ferramentas,serra tico tico,inversora de solda,chuveiro lorenzetti';
      await client.query(`
        INSERT INTO app_settings (key, value)
        VALUES
          ('ML_CATEGORIES', $1),
          ('ML_MIN_PRICE', '30'),
          ('ML_MAX_PRICE', '10000'),
          ('ML_MIN_DISCOUNT', '0'),
          ('ML_MAX_RESULTS', '35'),
          ('AUTO_SCHEDULE_CRON', '0 */3 * * *')
        ON CONFLICT (key) DO NOTHING;
      `, [defaultCategories]);

      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('⚠️ Erro ao inicializar tabelas no Neon PostgreSQL:', error);
    return false;
  }
}

/**
 * Carrega todas as configurações salvas no banco Neon PostgreSQL.
 */
export async function dbGetSettings(): Promise<Record<string, string>> {
  const db = getDbPool();
  if (!db) return {};

  try {
    const res = await db.query('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    for (const row of res.rows) {
      settings[row.key] = row.value;
    }
    return settings;
  } catch (err) {
    console.error('⚠️ Erro ao buscar configurações do Neon:', err);
    return {};
  }
}

/**
 * Salva ou atualiza múltiplas configurações no Neon PostgreSQL.
 */
export async function dbSaveMultipleSettings(updates: Record<string, string>): Promise<boolean> {
  const db = getDbPool();
  if (!db) return false;

  try {
    const client = await db.connect();
    try {
      for (const [key, value] of Object.entries(updates)) {
        await client.query(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
          [key, String(value)]
        );
      }
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('⚠️ Erro ao salvar configurações no Neon:', err);
    return false;
  }
}
