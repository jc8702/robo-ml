import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HISTORY_FILE = join(process.cwd(), '.sent-history.json');

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!existsSync(HISTORY_FILE)) {
    return res.status(200).json([]);
  }

  try {
    const historyContent = readFileSync(HISTORY_FILE, 'utf-8');
    const items = JSON.parse(historyContent);
    return res.status(200).json(items.reverse());
  } catch {
    return res.status(200).json([]);
  }
}
