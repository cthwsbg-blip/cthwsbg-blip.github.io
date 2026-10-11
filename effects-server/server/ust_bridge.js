'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UST_ROOT = path.resolve(ROOT, '..', 'uma-skill-tools');
const CACHE_DIR = path.join(ROOT, 'data', 'rankings_ust');
const TS = path.join(__dirname, 'ust_rank.ts');

function cacheKey(course, style, limit, nsamples) {
  return `${course}_s${style}_n${nsamples}_l${limit}_inherent.json`;
}

function rankWithUst(dbPath, courseId, opts = {}) {
  const style = Number(opts.style) || 0;
  const limit = Number(opts.limit) || 50;
  const nsamples = Number(opts.nsamples) || 12;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const key = cacheKey(courseId, style, limit, nsamples);
  const cachePath = path.join(CACHE_DIR, key);
  if (fs.existsSync(cachePath) && !opts.force) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      cached.source = 'ust-cache';
      return cached;
    } catch (_) {}
  }

  const args = [
    '--yes',
    'ts-node',
    '-T',
    TS,
    dbPath,
    String(courseId),
    String(limit),
    String(nsamples),
    String(style),
  ];
  const r = spawnSync('npx', args, {
    cwd: UST_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
    timeout: 10 * 60 * 1000,
  });
  if (r.status !== 0) {
    return {
      ok: false,
      error: 'ust_rank_failed',
      detail: (r.stderr || r.stdout || '').slice(-2000),
      status: r.status,
    };
  }
  const out = (r.stdout || '').trim();
  // last JSON object in stdout
  const start = out.indexOf('{');
  if (start < 0) return { ok: false, error: 'ust_rank_no_json', detail: out.slice(-1000) };
  const result = JSON.parse(out.slice(start));
  if (result.ok) {
    fs.writeFileSync(cachePath, JSON.stringify(result), 'utf8');
    // also mirror under public for static fallback
    const pub = path.join(ROOT, 'public', 'effects', 'data', 'rankings');
    fs.mkdirSync(pub, { recursive: true });
    fs.writeFileSync(
      path.join(pub, `${courseId}_s${style}_inherent.json`),
      JSON.stringify(result),
      'utf8'
    );
  }
  result.source = 'ust-live';
  return result;
}

module.exports = { rankWithUst, CACHE_DIR };
