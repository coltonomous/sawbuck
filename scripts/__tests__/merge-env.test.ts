import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve('scripts/merge-env.sh');

let dir: string;
let envFile: string;
let updatesFile: string;

function merge(env: string | null, updates: string): string {
  if (env !== null) fs.writeFileSync(envFile, env);
  fs.writeFileSync(updatesFile, updates);
  execFileSync('bash', [SCRIPT, envFile, updatesFile]);
  return fs.readFileSync(envFile, 'utf8');
}

describe('merge-env.sh', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-env-'));
    envFile = path.join(dir, '.env');
    updatesFile = path.join(dir, '.env.deploy');
  });

  it('replaces an existing value in place (secret rotation)', () => {
    const out = merge('A=1\nFAL_KEY=old\nB=2\n', 'FAL_KEY=new\n');
    expect(out).toBe('A=1\nFAL_KEY=new\nB=2\n');
  });

  it('appends keys the env file does not have yet', () => {
    expect(merge('A=1\n', 'C=3\n')).toBe('A=1\nC=3\n');
  });

  it('keeps comments and keys not in the updates', () => {
    const out = merge('# admin-only\nADMIN_EMAIL=me@example.com\nX=1\n', 'X=2\n');
    expect(out).toBe('# admin-only\nADMIN_EMAIL=me@example.com\nX=2\n');
  });

  it('leaves the env file alone when there are no updates', () => {
    expect(merge('A=1\nB=2\n', '')).toBe('A=1\nB=2\n');
  });

  it('creates the env file if missing', () => {
    expect(merge(null, 'A=1\n')).toBe('A=1\n');
  });

  it('keeps values with =, $, quotes and backslashes literal', () => {
    const value = `p@ss=w$rd'"\\n\`x\``;
    expect(merge('S=old\n', `S=${value}\n`)).toBe(`S=${value}\n`);
  });

  it('does not treat a key that is a prefix of another as a match', () => {
    expect(merge('AWS_REGION=a\nAWS_REGION_X=b\n', 'AWS_REGION=c\n')).toBe('AWS_REGION=c\nAWS_REGION_X=b\n');
  });

  it('preserves the env file permissions', () => {
    fs.writeFileSync(envFile, 'A=1\n');
    fs.chmodSync(envFile, 0o600);
    merge(null, 'A=2\n');
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir).sort()).toEqual(['.env', '.env.deploy']);
  });
});
