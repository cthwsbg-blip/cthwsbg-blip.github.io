'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UST_ROOT = path.resolve(ROOT, '..', 'uma-skill-tools');
const CACHE_DIR = path.join(ROOT, 'data', 'rankings_ust');
const TS = path.join(__dirname, 'ust_rank.ts');

function cacheKey(course, style, nsamples) {
  return `${course}_s${style}_n${nsamples}_inherent.json`;
}

function loadCompatibleCache(course, style, nsamples) {
  const exact = path.join(CACHE_DIR, cacheKey(course, style, nsamples));
  if (fs.existsSync(exact)) return exact;
  // accept older keys that included limit
  if (!fs.existsSync(CACHE_DIR)) return null;
  const prefix = `${course}_s${style}_n${nsamples}_`;
  const hit = fs.readdirSync(CACHE_DIR).find((f) => f.startsWith(prefix) && f.endsWith('_inherent.json'));
  return hit ? path.join(CACHE_DIR, hit) : null;
}

function rankWithUst(dbPath, courseId, opts = {}) {
  const style = Number(opts.style) || 0;
  const limit = Number(opts.limit) || 50;
  const nsamples = Number(opts.nsamples) || 12;
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const cachePath = loadCompatibleCache(courseId, style, nsamples);
  if (cachePath && !opts.force) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached && cached.ok && Array.isArray(cached.ranking)) {
        const out = { ...cached, ranking: cached.ranking.slice(0, limit) };
        out.source = 'ust-cache';
        return out;
      }
    } catch (_) {}
  }

  const args = [
    '--yes',
    'ts-node',
    '-T',
    TS,
    dbPath,
    String(courseId),
    String(Math.max(limit, 50)),
    String(nsamples),
    String(style),
  ];
  const r = spawnSync('npx', args, {
    cwd: fs.existsSync(UST_ROOT) ? UST_ROOT : ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
    timeout: 10 * 60 * 1000,
  });
  if (r.status !== 0) {
    // last-resort: any cache for this course/style
    const fallback = loadCompatibleCache(courseId, style, nsamples);
    if (fallback) {
      try {
        const cached = JSON.parse(fs.readFileSync(fallback, 'utf8'));
        if (cached && cached.ok) {
          cached.ranking = (cached.ranking || []).slice(0, limit);
          cached.source = 'ust-cache-fallback';
          cached.ustError = (r.stderr || r.stdout || '').slice(-500);
          return cached;
        }
      } catch (_) {}
    }
    return {
      ok: false,
      error: 'ust_rank_failed',
      detail: (r.stderr || r.stdout || '').slice(-2000),
      status: r.status,
    };
  }
  const out = (r.stdout || '').trim();
  const start = out.indexOf('{');
  if (start < 0) return { ok: false, error: 'ust_rank_no_json', detail: out.slice(-1000) };
  const result = JSON.parse(out.slice(start));
  if (result.ok) {
    const writePath = path.join(CACHE_DIR, cacheKey(courseId, style, nsamples));
    fs.writeFileSync(writePath, JSON.stringify(result), 'utf8');
    const pub = path.join(ROOT, 'public', 'effects', 'data', 'rankings');
    fs.mkdirSync(pub, { recursive: true });
    fs.writeFileSync(path.join(pub, `${courseId}_s${style}_inherent.json`), JSON.stringify(result), 'utf8');
  }
  result.source = 'ust-live';
  if (result.ranking && result.ranking.length > limit) {
    result.ranking = result.ranking.slice(0, limit);
  }
  return result;
}

module.exports = { rankWithUst, CACHE_DIR };
