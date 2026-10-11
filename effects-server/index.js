#!/usr/bin/env node
/**
 * Effects ranking API (local / box).
 * Intended to be mirrored onto api.614tools.top (Cloudflare Worker uma-breeding-jobs)
 * as GET /api/effects/courses and GET /api/effects/rank.
 *
 * Frontend must only display results — never reimplement scoring in the browser.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { rankCourse, STYLE_KEYS, DIST_KEYS, GROUND_KEYS } = require('./bashin');

const ROOT = process.env.EFFECTS_ROOT || __dirname;
const DB_PATH = process.env.EFFECTS_DB || path.join(ROOT, 'data', 'effects_db.json');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' && !extraHeaders['Content-Type']
      ? 'text/plain; charset=utf-8'
      : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

function listCourses() {
  const byTrack = new Map();
  for (const c of db.courses) {
    if (!byTrack.has(c.track)) {
      byTrack.set(c.track, {
        track: c.track,
        trackZh: c.trackZh,
        trackJa: c.trackJa,
        courses: [],
      });
    }
    byTrack.get(c.track).courses.push({
      id: c.id,
      distance: c.distance,
      ground: c.ground,
      groundLabel: c.ground === 2 ? 'ダート' : '芝',
      distType: c.distType,
      distLabel: ({ 1: '短距離', 2: 'マイル', 3: '中距離', 4: '長距離' })[c.distType] || '',
      turn: c.turn,
      turnLabel: c.turnLabel,
      inout: c.inout,
      inoutLabel: c.inoutLabel,
      dirtgrade: c.dirtgrade,
    });
  }
  return {
    ok: true,
    meta: db.meta,
    tracks: [...byTrack.values()],
    styleKeys: STYLE_KEYS,
    distKeys: DIST_KEYS,
    groundKeys: GROUND_KEYS,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

function publicRoots() {
  const roots = [];
  // Pages layout: effects-server/ next to effects/
  const sibling = path.resolve(ROOT, '..', 'effects');
  if (fs.existsSync(sibling)) roots.push(sibling);
  // Standalone: effects-server/public/effects
  const bundled = path.join(ROOT, 'public', 'effects');
  if (fs.existsSync(bundled)) roots.push(bundled);
  return roots;
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath;
  if (rel === '/' || rel === '') rel = '/';
  if (rel === '/effects') rel = '/effects/';
  // Map /effects/... → files under the effects public root
  if (rel.startsWith('/effects/')) rel = rel.slice('/effects'.length);
  if (rel.endsWith('/')) rel += 'index.html';
  if (rel.startsWith('/')) rel = rel.slice(1);
  const roots = publicRoots();
  let file = null;
  for (const root of roots) {
    const cand = path.join(root, rel);
    if (cand.startsWith(root) && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      file = cand;
      break;
    }
  }
  if (!file) {
    send(res, 404, { ok: false, error: '未找到' });
    return;
  }
  const ext = path.extname(file);
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=60' });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  if (p === '/api' || p === '/') {
    // Keep shape similar to api.614tools.top root
    if (p === '/api' || u.searchParams.get('format') === 'json') {
      send(res, 200, {
        ok: true,
        service: 'uma-effects-rank',
        endpoints: [
          'GET /api/effects/courses',
          'GET /api/effects/rank?course=&style=&limit=&mode=',
          'GET /api/effects/health',
        ],
        note: 'Bashin scoring runs server-side only. Deploy beside uma-breeding-jobs on api.614tools.top.',
      });
      return;
    }
  }

  if (p === '/api/effects/health') {
    send(res, 200, { ok: true, meta: db.meta, port: PORT });
    return;
  }

  if (p === '/api/effects/courses') {
    send(res, 200, listCourses());
    return;
  }

  if (p === '/api/effects/rank') {
    const course = u.searchParams.get('course');
    if (!course) {
      send(res, 400, { ok: false, error: 'missing course' });
      return;
    }
    const result = rankCourse(db, course, {
      style: u.searchParams.get('style') || 0,
      limit: u.searchParams.get('limit') || 50,
      mode: u.searchParams.get('mode') || 'inherent',
    });
    if (result.error) {
      send(res, 404, { ok: false, error: result.error, courseId: result.courseId });
      return;
    }
    send(res, 200, result);
    return;
  }

  // Static demo pages under public/
  if (p.startsWith('/effects') || p === '/') {
    serveStatic(req, res, p === '/' ? '/effects/' : p);
    return;
  }

  send(res, 404, { ok: false, error: '未找到' });
});

server.listen(PORT, HOST, () => {
  console.log(`[uma-effects-rank] http://${HOST}:${PORT}/effects/`);
  console.log(`[uma-effects-rank] API  http://${HOST}:${PORT}/api/effects/courses`);
  console.log(`[uma-effects-rank] db   ${DB_PATH} (${db.meta.cardCount} cards, ${db.meta.courseCount} courses)`);
});
