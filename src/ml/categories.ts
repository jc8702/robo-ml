import { gunzipSync } from 'node:zlib';

export interface MercadoLivreCategoryLeaf {
  id: string;
  name: string;
  query: string;
  path: string[];
}

export interface MercadoLivreCategoryGroup {
  id: string;
  name: string;
  icon: string;
  subs: MercadoLivreCategoryLeaf[];
}

type RawCategory = {
  id: string;
  name: string;
  path_from_root?: Array<{ id: string; name: string }>;
  children_categories?: RawCategory[];
};

let cachedCatalog: { categories: MercadoLivreCategoryGroup[]; loadedAt: string } | null = null;
let loadingCatalog: Promise<MercadoLivreCategoryGroup[]> | null = null;
const CATEGORY_CACHE_MS = 6 * 60 * 60 * 1000;

function iconFor(name: string): string {
  const value = name.toLocaleLowerCase('pt-BR');
  if (value.includes('veículo') || value.includes('carro') || value.includes('moto')) return '🚗';
  if (value.includes('celular') || value.includes('telefon')) return '📱';
  if (value.includes('informática') || value.includes('comput')) return '💻';
  if (value.includes('casa') || value.includes('móvel') || value.includes('decora')) return '🏠';
  if (value.includes('moda') || value.includes('calçado')) return '👗';
  if (value.includes('esporte')) return '⚽';
  if (value.includes('beleza') || value.includes('saúde')) return '💄';
  if (value.includes('pet') || value.includes('animal')) return '🐶';
  return '📂';
}

function buildTreeFromFlatDump(items: RawCategory[]): RawCategory[] {
  const nodes = new Map<string, RawCategory>();
  const roots: RawCategory[] = [];
  const ensure = (id: string, name: string): RawCategory => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const created: RawCategory = { id, name, children_categories: [] };
    nodes.set(id, created);
    return created;
  };

  for (const item of items) {
    const path = item.path_from_root?.length ? item.path_from_root : [{ id: item.id, name: item.name }];
    let parent: RawCategory | null = null;
    for (const pathPart of path) {
      const current = ensure(pathPart.id, pathPart.name);
      if (!parent) {
        if (!roots.some((root) => root.id === current.id)) roots.push(current);
      } else if (!parent.children_categories!.some((child) => child.id === current.id)) {
        parent.children_categories!.push(current);
      }
      parent = current;
    }
  }
  return roots;
}

function directChildren(root: RawCategory): MercadoLivreCategoryLeaf[] {
  const children = root.children_categories || [];
  const direct = children.length > 0 ? children : [root];
  const rootPath = root.path_from_root?.map((part) => part.name) || [root.name];
  return direct.map((child) => ({
    id: child.id,
    name: child.name,
    query: child.name,
    path: [...rootPath, child.name].filter((value, index, values) => values.indexOf(value) === index),
  }));
}

function normalizeCatalog(payload: unknown): MercadoLivreCategoryGroup[] {
  const objectPayload = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  const candidate = Array.isArray(payload)
    ? payload
    : Array.isArray(objectPayload?.categories)
      ? objectPayload.categories
      : objectPayload ? Object.values(objectPayload).filter((value) => value && typeof value === 'object' && 'id' in (value as object) && 'name' in (value as object)) : [];
  if (!Array.isArray(candidate) || candidate.length === 0) throw new Error('Dump de categorias do Mercado Livre inválido');
  const items = candidate as RawCategory[];
  const nested = items.some((item) => (item.children_categories || []).length > 0);
  const roots = nested ? items : buildTreeFromFlatDump(items);
  const groups = roots
    .map((root) => ({ id: root.id, name: root.name, icon: iconFor(root.name), subs: directChildren(root) }))
    .filter((group) => group.subs.length > 0);
  if (groups.length === 0) throw new Error('Dump de categorias do Mercado Livre sem categorias folha');
  return groups;
}

export async function loadMercadoLivreCategoryCatalog(): Promise<MercadoLivreCategoryGroup[]> {
  if (cachedCatalog && Date.now() - Date.parse(cachedCatalog.loadedAt) < CATEGORY_CACHE_MS) return cachedCatalog.categories;
  if (loadingCatalog) return loadingCatalog;

  loadingCatalog = (async () => {
    const response = await fetch('https://api.mercadolibre.com/sites/MLB/categories/all', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Mercado Livre categorias respondeu HTTP ${response.status}`);
    const payloadBytes = Buffer.from(await response.arrayBuffer());
    // fetch/undici pode descomprimir Content-Encoding automaticamente; aceite
    // os dois formatos para manter o catálogo funcionando em Node e runtimes
    // que entregam o gzip bruto.
    let text: string;
    try {
      text = gunzipSync(payloadBytes).toString('utf8');
    } catch {
      text = payloadBytes.toString('utf8');
    }
    const categories = normalizeCatalog(JSON.parse(text));
    cachedCatalog = { categories, loadedAt: new Date().toISOString() };
    return categories;
  })().finally(() => { loadingCatalog = null; });

  return loadingCatalog;
}

export function getMercadoLivreCategoryQuery(categoryId: string): string | undefined {
  for (const group of cachedCatalog?.categories || []) {
    const found = group.subs.find((leaf) => leaf.id === categoryId);
    if (found) return found.query;
  }
  return undefined;
}

export function getMercadoLivreCategoryCacheInfo(): { loaded: boolean; loadedAt?: string; groups?: number; leaves?: number } {
  if (!cachedCatalog) return { loaded: false };
  return {
    loaded: true,
    loadedAt: cachedCatalog.loadedAt,
    groups: cachedCatalog.categories.length,
    leaves: cachedCatalog.categories.reduce((total, group) => total + group.subs.length, 0),
  };
}
