/**
 * Effects UI — display only. All bashin math happens on the API server.
 */
(function () {
  const API_BASE = (function () {
    // Override: ?api=https://host  or  ?api=static (force precomputed JSON under ./data/)
    const q = new URLSearchParams(location.search).get('api');
    if (q === 'static') return 'static';
    if (q) return q.replace(/\/$/, '');
    // Local Node demo (effects-server): same origin
    if (location.port === '8787') return '';
    // Production: try Worker first; app falls back to ./data/rankings if 404
    if (location.hostname.endsWith('614tools.top') || location.hostname.endsWith('github.io')) {
      return 'https://api.614tools.top';
    }
    return '';
  })();
  const STATIC_BASE = new URL('./data/', location.href).pathname.replace(/\/$/, '');

  const IMG_BASE = 'https://614tools.top/skillselect/';

  const els = {
    courseList: document.getElementById('courseList'),
    coursePanel: document.getElementById('coursePanel'),
    rankPanel: document.getElementById('rankPanel'),
    rankGrid: document.getElementById('rankGrid'),
    rankStatus: document.getElementById('rankStatus'),
    rankTitle: document.getElementById('rankTitle'),
    rankSub: document.getElementById('rankSub'),
    groundFilter: document.getElementById('groundFilter'),
    distFilter: document.getElementById('distFilter'),
    courseSearch: document.getElementById('courseSearch'),
    backToCourses: document.getElementById('backToCourses'),
    styleTabs: document.getElementById('styleTabs'),
    trackDiagram: document.getElementById('trackDiagram'),
  };

  let tracks = [];
  let currentCourse = null;
  let currentStyle = 0;

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.json();
  }

  /** Prefer live API; fall back to precomputed JSON under ./data/ (Pages until Worker routes exist). */
  async function api(path) {
    if (API_BASE === 'static') {
      return staticApi(path);
    }
    if (API_BASE === '') {
      try {
        return await fetchJson(path);
      } catch (e) {
        return staticApi(path);
      }
    }
    try {
      return await fetchJson(API_BASE + path);
    } catch (e) {
      console.warn('API failed, using static rankings', e);
      return staticApi(path);
    }
  }

  async function staticApi(path) {
    if (path.indexOf('/api/effects/courses') === 0) {
      return fetchJson(STATIC_BASE + '/courses.json');
    }
    const m = path.match(/\/api\/effects\/rank\?([^#]*)/);
    if (m) {
      const sp = new URLSearchParams(m[1]);
      const course = sp.get('course');
      const style = sp.get('style') || '0';
      const mode = sp.get('mode') || 'inherent';
      const url = STATIC_BASE + '/rankings/' + course + '_s' + style + '_' + mode + '.json';
      const data = await fetchJson(url);
      // honor limit client-side for static files (full top50 stored)
      const limit = Math.min(Math.max(Number(sp.get('limit') || 50), 1), 200);
      if (data.ranking && data.ranking.length > limit) {
        data.ranking = data.ranking.slice(0, limit);
      }
      data.source = 'static-precompute';
      return data;
    }
    throw new Error('static fallback unsupported: ' + path);
  }

  function groundBadge(g) {
    return g === 2
      ? '<span class="badge dirt">ダート</span>'
      : '<span class="badge turf">芝</span>';
  }

  function renderCourses() {
    const g = els.groundFilter.value;
    const d = els.distFilter.value;
    const q = (els.courseSearch.value || '').trim().toLowerCase();

    const html = [];
    for (const tr of tracks) {
      const rows = tr.courses.filter((c) => {
        if (g && String(c.ground) !== g) return false;
        if (d && String(c.distType) !== d) return false;
        if (q) {
          const hay = `${tr.trackZh} ${tr.trackJa} ${c.distance} ${c.distLabel} ${c.turnLabel}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      if (!rows.length) continue;
      html.push(`<div class="track-block"><h3>${escapeHtml(tr.trackZh || tr.trackJa)}</h3>`);
      for (const c of rows) {
        const label = `${c.distance}m [${c.distLabel || ''}] ${c.turnLabel || ''}`.trim();
        html.push(
          `<button type="button" class="course-row" data-course="${c.id}">` +
            `<span>${escapeHtml(label)}</span>${groundBadge(c.ground)}` +
          `</button>`
        );
      }
      html.push('</div>');
    }
    els.courseList.innerHTML = html.join('') || '<p class="muted">没有匹配的赛道</p>';
    els.courseList.querySelectorAll('[data-course]').forEach((btn) => {
      btn.addEventListener('click', () => selectCourse(Number(btn.getAttribute('data-course'))));
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function styleName(st) {
    return ({ 0: '全部', 1: '逃げ', 2: '先行', 3: '差し', 4: '追込' })[st] || '';
  }

  function drawCourseGeo(course) {
    const geo = course.geo || {};
    const dist = course.distance || 1;
    const w = 640, h = 56, pad = 16;
    const x = (m) => pad + (m / dist) * (w - pad * 2);
    let shapes = '';
    (geo.straights || []).forEach((s) => {
      const [a, b] = s;
      shapes += `<rect x="${x(a)}" y="22" width="${Math.max(2, x(b) - x(a))}" height="12" rx="3" fill="#3d9a5f"/>`;
    });
    (geo.corners || []).forEach((c, i) => {
      const [start, len] = c;
      shapes += `<rect x="${x(start)}" y="18" width="${Math.max(2, x(start + len) - x(start))}" height="20" rx="6" fill="#6c8cff" opacity="0.85"/>`;
      shapes += `<text x="${x(start + len / 2)}" y="14" text-anchor="middle" fill="#cde" font-size="10">${i + 1}</text>`;
    });
    shapes += `<text x="${pad}" y="52" fill="#9ab" font-size="10">0m</text>`;
    shapes += `<text x="${w - pad}" y="52" text-anchor="end" fill="#9ab" font-size="10">${dist}m</text>`;
    els.trackDiagram.hidden = false;
    els.trackDiagram.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="赛道剖面">${shapes}</svg>`;
  }

  async function selectCourse(courseId) {
    currentCourse = courseId;
    els.coursePanel.classList.add('hidden');
    els.rankPanel.classList.remove('hidden');
    await loadRank();
  }

  async function loadRank() {
    if (!currentCourse) return;
    els.rankStatus.textContent = '正在从后端拉取 Top 50…';
    els.rankGrid.innerHTML = '';
    try {
      const data = await api(
        `/api/effects/rank?course=${encodeURIComponent(currentCourse)}&style=${currentStyle}&limit=50&mode=inherent`
      );
      if (!data.ok) throw new Error(data.error || 'rank failed');
      const c = data.course;
      const gLabel = c.ground === 2 ? 'ダート' : '芝';
      els.rankTitle.textContent = `${c.trackZh} ${c.distance}m（${gLabel}）· 有效马娘`;
      els.rankSub.textContent = `后端公式 ${data.formula} · 共评估 ${data.totalCards} 名 · 展示 Top ${data.ranking.length} · 跑法 ${styleName(currentStyle)}`;
      drawCourseGeo(c);
      els.rankStatus.textContent = '';
      els.rankGrid.innerHTML = data.ranking.map(renderCard).join('');
    } catch (err) {
      els.rankStatus.textContent = '加载失败：' + err.message + '（请确认后端已启动，或 ?api= 指向可用服务）';
    }
  }

  function renderCard(row) {
    const icon = row.icon ? IMG_BASE + row.icon : '';
    const apt = [];
    if (row.apt && row.apt.dist) apt.push(`<span class="tag">${escapeHtml(row.apt.dist)}</span>`);
    if (row.apt && row.apt.ground) apt.push(`<span class="tag">${escapeHtml(row.apt.ground)}</span>`);
    if (row.styleUsed) apt.push(`<span class="tag style">${escapeHtml(styleName(row.styleUsed))}</span>`);
    const skills = (row.skills || []).slice(0, 4).map((s) => {
      return `<span class="skill-chip"><span>${escapeHtml(s.name)}</span><b>${Number(s.bashin).toFixed(3)} [バ]</b></span>`;
    }).join('');
    const displayName = row.nameZh || row.name;
    return (
      `<article class="rank-card">` +
        `<div><div class="rank">#${row.rank}</div>` +
        `<div class="avatar" style="background-image:url('${escapeHtml(icon)}')"></div></div>` +
        `<div>` +
          `<div class="meta-line">${apt.join('')}</div>` +
          `<div class="name">${escapeHtml(displayName)}</div>` +
          `<div class="title">${escapeHtml(row.title || row.name || '')}</div>` +
          `<div class="meta-line"><span class="bashin">${Number(row.bashin).toFixed(5)} <small>[バ]</small></span>` +
          `<span class="expect">×${Number(row.expect || 1).toFixed(2)}</span></div>` +
          `<div class="skill-parts">${skills}</div>` +
        `</div>` +
      `</article>`
    );
  }

  els.backToCourses.addEventListener('click', () => {
    els.rankPanel.classList.add('hidden');
    els.coursePanel.classList.remove('hidden');
  });
  ['groundFilter', 'distFilter', 'courseSearch'].forEach((id) => {
    els[id].addEventListener('input', renderCourses);
    els[id].addEventListener('change', renderCourses);
  });
  els.styleTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-style]');
    if (!btn) return;
    currentStyle = Number(btn.getAttribute('data-style'));
    els.styleTabs.querySelectorAll('.stab').forEach((b) => b.classList.toggle('active', b === btn));
    loadRank();
  });

  api('/api/effects/courses')
    .then((data) => {
      if (!data.ok) throw new Error(data.error || 'courses failed');
      tracks = data.tracks || [];
      renderCourses();
    })
    .catch((err) => {
      els.courseList.innerHTML = `<p class="muted">赛道列表加载失败：${escapeHtml(err.message)}</p>`;
    });
})();
