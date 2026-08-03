import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Detecta se o ambiente é cloud/servidor (sem GUI).
 */
export function isCloudEnvironment(): boolean {
  return !!process.env.RENDER || process.env.HEADLESS === 'true' || process.platform !== 'win32';
}

/**
 * Encontra o Chrome/Chromium no sistema (Windows + Linux/Docker/Render).
 * Módulo unificado — usado pelo coletor ML e pelo Facebook Poster.
 */
export function findBrowserPath(): string | undefined {
  if (process.env.EXECUTABLE_PATH && existsSync(process.env.EXECUTABLE_PATH)) {
    return process.env.EXECUTABLE_PATH;
  }

  const homeDir = homedir();
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    // Playwright Chromium (Windows)
    const pwDir = join(homeDir, 'AppData', 'Local', 'ms-playwright');
    if (existsSync(pwDir)) {
      const dirs = readdirSync(pwDir)
        .filter((d: string) => d.startsWith('chromium'))
        .sort();
      for (const dir of dirs.reverse()) {
        candidates.push(join(pwDir, dir, 'chrome-win', 'chrome.exe'));
      }
    }
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  } else {
    // Linux / Docker / Render
    const pwDir = '/ms-playwright';
    if (existsSync(pwDir)) {
      try {
        const dirs = readdirSync(pwDir)
          .filter((d: string) => d.startsWith('chromium'))
          .sort();
        for (const dir of dirs.reverse()) {
          candidates.push(join(pwDir, dir, 'chrome-linux', 'chrome'));
        }
      } catch { /* ignore */ }
    }
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    );
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return undefined;
}
