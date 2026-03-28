import { execSync } from 'child_process';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { homedir, platform, tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import logger from './logger.js';

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

// -- Chrome -------------------------------------------------------------------

function chromeCookiePath(): string | null {
  const home = homedir();
  const paths =
    platform() === 'darwin'
      ? [join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies')]
      : platform() === 'linux'
        ? [
            join(home, '.config', 'google-chrome', 'Default', 'Cookies'),
            join(home, '.config', 'chromium', 'Default', 'Cookies'),
          ]
        : [];

  return paths.find((p) => existsSync(p)) ?? null;
}

function chromeDecryptionKey(): Buffer | null {
  try {
    if (platform() === 'darwin') {
      const password = execSync(
        'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    }

    if (platform() === 'linux') {
      return pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
    }
  } catch {}
  return null;
}

function decryptChromeValue(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length === 0) return '';

  const tag = encrypted.slice(0, 3).toString('ascii');
  if (tag !== 'v10' && tag !== 'v11') return encrypted.toString('utf-8');

  const iv = Buffer.alloc(16, 0x20);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);

  let decrypted = Buffer.concat([decipher.update(encrypted.slice(3)), decipher.final()]);

  const pad = decrypted[decrypted.length - 1];
  if (pad > 0 && pad <= 16) {
    decrypted = decrypted.subarray(0, decrypted.length - pad);
  }

  return decrypted.toString('utf-8');
}

/** Copy a SQLite DB (plus WAL/SHM) to a temp path so we can read it while the browser holds a lock. */
function copyDbToTemp(dbPath: string, label: string): string | null {
  const tmpPath = join(tmpdir(), `sawbuck-${label}-${Date.now()}.db`);
  try {
    copyFileSync(dbPath, tmpPath);
    if (existsSync(dbPath + '-wal')) copyFileSync(dbPath + '-wal', tmpPath + '-wal');
    if (existsSync(dbPath + '-shm')) copyFileSync(dbPath + '-shm', tmpPath + '-shm');
    return tmpPath;
  } catch {
    return null;
  }
}

function cleanupTemp(tmpPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(tmpPath + suffix); } catch {}
  }
}

function readChromeCookies(domain: string): BrowserCookie[] | null {
  const dbPath = chromeCookiePath();
  if (!dbPath) return null;

  const key = chromeDecryptionKey();
  if (!key) return null;

  const tmpPath = copyDbToTemp(dbPath, 'chrome-cookies');
  if (!tmpPath) return null;

  try {
    const db = new Database(tmpPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare('SELECT name, encrypted_value, host_key, path FROM cookies WHERE host_key LIKE ?')
      .all(`%${domain}%`) as Array<{
      name: string;
      encrypted_value: Buffer;
      host_key: string;
      path: string;
    }>;
    db.close();

    const cookies: BrowserCookie[] = [];
    for (const row of rows) {
      const value = decryptChromeValue(row.encrypted_value, key);
      if (value) {
        cookies.push({ name: row.name, value, domain: row.host_key, path: row.path });
      }
    }

    return cookies.length > 0 ? cookies : null;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to read Chrome cookies');
    return null;
  } finally {
    cleanupTemp(tmpPath);
  }
}

// -- Firefox ------------------------------------------------------------------

function firefoxCookiePath(): string | null {
  const home = homedir();
  const profilesDir =
    platform() === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')
      : platform() === 'linux'
        ? join(home, '.mozilla', 'firefox')
        : null;

  if (!profilesDir || !existsSync(profilesDir)) return null;

  try {
    const profiles = readdirSync(profilesDir);
    const defaultProfile = profiles.find(
      (p) => p.endsWith('.default-release') || p.endsWith('.default'),
    );
    if (!defaultProfile) return null;

    const cookiePath = join(profilesDir, defaultProfile, 'cookies.sqlite');
    return existsSync(cookiePath) ? cookiePath : null;
  } catch {
    return null;
  }
}

function readFirefoxCookies(domain: string): BrowserCookie[] | null {
  const dbPath = firefoxCookiePath();
  if (!dbPath) return null;

  const tmpPath = copyDbToTemp(dbPath, 'firefox-cookies');
  if (!tmpPath) return null;

  try {
    const db = new Database(tmpPath, { readonly: true, fileMustExist: true });
    const rows = db
      .prepare('SELECT name, value, host, path FROM moz_cookies WHERE host LIKE ?')
      .all(`%${domain}%`) as Array<{ name: string; value: string; host: string; path: string }>;
    db.close();

    const cookies: BrowserCookie[] = rows
      .filter((r) => r.value)
      .map((r) => ({ name: r.name, value: r.value, domain: r.host, path: r.path }));

    return cookies.length > 0 ? cookies : null;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to read Firefox cookies');
    return null;
  } finally {
    cleanupTemp(tmpPath);
  }
}

// -- Public -------------------------------------------------------------------

export function getSystemBrowserCookies(domain: string): BrowserCookie[] | null {
  const chrome = readChromeCookies(domain);
  if (chrome) {
    logger.debug({ domain, count: chrome.length, source: 'chrome' }, 'Loaded browser cookies');
    return chrome;
  }

  const firefox = readFirefoxCookies(domain);
  if (firefox) {
    logger.debug({ domain, count: firefox.length, source: 'firefox' }, 'Loaded browser cookies');
    return firefox;
  }

  return null;
}
