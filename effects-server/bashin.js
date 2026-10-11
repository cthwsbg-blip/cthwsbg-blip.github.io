/**
 * Approximate bashin (馬身) gain from a character's inherent skills on a course.
 *
 * This is NOT a full RaceSolver (U-tools / uma-skill-tools). See docs/FORMULA.md.
 * Production ranking must call this (or a UST-backed scorer) on the backend only.
 */

'use strict';

const REF_SPEED = 20.0; // m/s mid-race reference for converting Δv·t → meters
const BASHIN_M = 2.5;   // 1 馬身 ≈ 2.5 m (same as UST gain.ts)
// Scale approx toward U-tools RaceSolver means (unique golds often ~3–6 バ on short dirt).
const CALIBRATION = 0.38;

const STYLE_KEYS = { 1: 'nige', 2: 'senko', 3: 'sashi', 4: 'oikomi' };
const DIST_KEYS = { 1: 'short', 2: 'mile', 3: 'middle', 4: 'long' };
const GROUND_KEYS = { 1: 'turf', 2: 'dirt' };

function parseAtom(atom) {
  const m = String(atom).match(/^([a-zA-Z0-9_]+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { key: m[1], op: m[2], val: Number(m[3]) };
}

function evalOp(left, op, right) {
  switch (op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>=': return left >= right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '<': return left < right;
    default: return false;
  }
}

/** Build static course context. runningStyle 1–4 or 0 for "any / best". */
function courseContext(course, runningStyle) {
  return {
    distance_type: course.distType,
    ground_type: course.ground,
    rotation: course.turn, // 1 right, 2 left (matches skillselect)
    course_distance: course.distance,
    running_style: runningStyle || 0,
    track_id: course.track,
  };
}

/**
 * Evaluate a condition string against context.
 * Returns { ok, expect, styleLocked }
 * - ok: can ever be true on this course (ignoring dynamic race state)
 * - expect: activation expectation multiplier for random/dynamic parts
 * - styleLocked: condition requires a specific running_style
 */
function evalCondition(cond, ctx) {
  if (!cond || cond === '') return { ok: true, expect: 1, styleLocked: null };

  // Split top-level OR (@) then AND (&) — same convention as skillselect / UST
  const orParts = String(cond).split('@');
  let best = null;

  for (const orPart of orParts) {
    const andParts = orPart.split('&').filter(Boolean);
    let ok = true;
    let expect = 1;
    let styleLocked = null;
    let rejected = false;

    for (const raw of andParts) {
      const atom = parseAtom(raw);
      if (!atom) {
        // Unparsed dynamic atom → assume satisfiable with mild expectation discount
        if (/_random|random|change_order|bashin_diff|order|phase|is_|remain_|distance_rate|blocked_|overtake|accumulatetime|corner|straight|hp_|near_|temptation|popularity/.test(raw)) {
          if (/_random|phase_.*random|straight_random|all_corner_random|is_finalcorner_random/.test(raw)) {
            expect *= 0.55;
          } else if (/order_rate|order==|order<=|order>=/.test(raw)) {
            expect *= 0.85;
          } else {
            expect *= 0.9;
          }
          continue;
        }
        // Unknown static-looking token: keep but discount
        expect *= 0.8;
        continue;
      }

      const { key, op, val } = atom;

      if (key === 'running_style') {
        styleLocked = val;
        if (ctx.running_style && ctx.running_style !== 0) {
          if (!evalOp(ctx.running_style, op, val)) {
            rejected = true;
            break;
          }
        }
        // style not fixed → keep, expectation applied later when picking best style
        continue;
      }

      if (key === 'distance_type') {
        if (!evalOp(ctx.distance_type, op, val)) { rejected = true; break; }
        continue;
      }
      if (key === 'ground_type') {
        if (!evalOp(ctx.ground_type, op, val)) { rejected = true; break; }
        continue;
      }
      if (key === 'rotation') {
        if (!evalOp(ctx.rotation, op, val)) { rejected = true; break; }
        continue;
      }
      if (key === 'track_id') {
        if (!evalOp(ctx.track_id, op, val)) { rejected = true; break; }
        continue;
      }
      if (key === 'course_distance' || key === 'distance') {
        if (!evalOp(ctx.course_distance, op, val)) { rejected = true; break; }
        continue;
      }
      // Season / weather / ground_condition need explicit context; otherwise not applicable
      if (key === 'season' || key === 'weather' || key === 'ground_condition' || key === 'time' || key === 'popularity') {
        if (ctx[key] == null || ctx[key] === 0) { rejected = true; break; }
        if (!evalOp(ctx[key], op, val)) { rejected = true; break; }
        continue;
      }

      // Other keys treated as dynamic
      if (/_random|phase|order|bashin|remain|is_|change_order|distance_rate|corner|straight/.test(key)) {
        if (/random/.test(key)) expect *= 0.55;
        else expect *= 0.9;
        continue;
      }
      expect *= 0.85;
    }

    if (rejected) continue;
    if (!ok) continue;
    const cand = { ok: true, expect, styleLocked };
    if (!best || cand.expect > best.expect) best = cand;
  }

  return best || { ok: false, expect: 0, styleLocked: null };
}

function effectBashin(stat, value, durationSec) {
  const v = Number(value) || 0;
  const dur = durationSec == null || durationSec === '' ? null : Number(durationSec);

  // Passive flat speed (値 like 40/60/80): small continuous contribution
  if (stat === '速度') {
    // map 40 → ~0.15 目標速度-equivalent over late race ~5s → rough
    const equiv = (v / 40) * 0.05;
    const d = dur && dur > 0 ? dur : Math.min(8, 1200 / REF_SPEED * 0.25);
    return (equiv * d * REF_SPEED) / BASHIN_M;
  }

  if (stat === '目标速度') {
    const d = dur && dur > 0 ? dur : 2.4;
    return (v * d * REF_SPEED) / BASHIN_M;
  }

  if (stat === '当前速度' || stat === '当前速度(推测)') {
    const d = dur && dur > 0 ? dur : 1.2;
    // Current-speed spikes convert more directly but shorter; use 0.85 scale
    return (Math.abs(v) * d * REF_SPEED * 0.85) / BASHIN_M * Math.sign(v || 1);
  }

  if (stat === '加速度') {
    const d = dur && dur > 0 ? dur : 1.8;
    // Accel helps reach target sooner — approximate as 0.4× target-speed of same magnitude
    return (v * d * REF_SPEED * 0.4) / BASHIN_M;
  }

  // Heals / lane / stats other than 速度: negligible for pure bashin ranking
  if (stat && stat.includes('回复')) return 0.05 * (dur || 1);
  return 0;
}

function scoreSkillOnCourse(skill, course, runningStyle) {
  if (!skill || skill.neg || skill.db) {
    // allow debuff skills that also buff self; skip pure neg flag
  }
  const ctx = courseContext(course, runningStyle);
  const parts = [];
  let total = 0;
  let expectMul = 1;
  let any = false;
  const stylesNeeded = new Set();

  for (const eff of skill.e || []) {
    // eff: [precond, cond, duration, cd?, [[stat, val, ?, debuff], ...]]
    const pre = eff[0];
    const cond = eff[1];
    const duration = eff[2];
    const rows = eff[4] || [];

    // precondition: treat like condition (often phase / style gates)
    let preRes = { ok: true, expect: 1, styleLocked: null };
    if (pre) {
      // pre may use @ between style alternatives already
      preRes = evalCondition(String(pre).replace(/@/g, '@'), ctx);
      if (!preRes.ok) continue;
    }

    const res = evalCondition(cond, ctx);
    if (!res.ok) continue;

    if (res.styleLocked) stylesNeeded.add(res.styleLocked);
    if (preRes.styleLocked) stylesNeeded.add(preRes.styleLocked);

    let partSum = 0;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const [stat, val, , debuffFlag] = row;
      // Skip pure enemy debuffs for self-gain ranking (debuffFlag==1 and negative current speed on others)
      if (debuffFlag === 1 && Number(val) < 0) {
        // still counts as interference value at ~30%
        partSum += Math.abs(effectBashin(stat, val, duration)) * 0.3;
        continue;
      }
      partSum += effectBashin(stat, val, duration);
    }

    const expect = (res.expect || 1) * (preRes.expect || 1);
    const weighted = partSum * expect;
    if (weighted === 0 && partSum === 0) continue;
    any = true;
    parts.push({
      cond: cond || '',
      duration: duration,
      raw: partSum,
      expect,
      bashin: weighted,
    });
    total += weighted;
    expectMul = Math.min(expectMul, expect);
  }

  total *= CALIBRATION;
  for (const p of parts) p.bashin *= CALIBRATION;

  return {
    skillId: skill.id,
    name: skill.n,
    cls: skill.c,
    rarity: skill.r,
    bashin: total,
    expect: any ? expectMul : 0,
    parts,
    stylesNeeded: [...stylesNeeded],
    applicable: any,
  };
}

/**
 * Score a card on a course using inherent skills: unique (固有) + si (初期所持).
 * mode: 'inherent' (default) | 'si' | 'unique'
 * style: 0 = all (pick best style for style-gated skills) | 1–4
 */
function scoreCard(card, skillsById, course, opts = {}) {
  const mode = opts.mode || 'inherent';
  const styleFilter = opts.style || 0;

  const skillIds = [];
  if (mode === 'inherent' || mode === 'unique') {
    if (card.uniqueId) skillIds.push(card.uniqueId);
  }
  if (mode === 'inherent' || mode === 'si') {
    for (const id of card.si || []) skillIds.push(String(id));
  }

  // Deduplicate
  const seen = new Set();
  const uniqIds = [];
  for (const id of skillIds) {
    const k = String(id);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqIds.push(k);
  }

  const stylesToTry = styleFilter ? [styleFilter] : [0, 1, 2, 3, 4];

  let best = null;
  for (const st of stylesToTry) {
    const breakdown = [];
    let sum = 0;
    for (const sid of uniqIds) {
      const sk = skillsById[sid];
      if (!sk) continue;
      const scored = scoreSkillOnCourse(sk, course, st);
      if (!scored.applicable && scored.bashin === 0) continue;
      // If style filter set, drop skills that require a different style
      if (styleFilter && scored.stylesNeeded.length && !scored.stylesNeeded.includes(styleFilter)) {
        continue;
      }
      breakdown.push(scored);
      sum += scored.bashin;
    }
    breakdown.sort((a, b) => b.bashin - a.bashin);
    const cand = { style: st || card.st || 0, bashin: sum, breakdown };
    if (!best || cand.bashin > best.bashin) best = cand;
  }

  const apt = card.ap || {};
  const distKey = DIST_KEYS[course.distType];
  const groundKey = GROUND_KEYS[course.ground];

  return {
    cardId: card.id,
    title: card.t,
    name: card.n,
    nameZh: card.zn,
    icon: card.i,
    color: card.col,
    preferredStyle: card.st,
    uniqueId: card.uniqueId,
    apt: {
      dist: distKey ? apt[distKey] : null,
      ground: groundKey ? apt[groundKey] : null,
      styles: {
        nige: apt.nige, senko: apt.senko, sashi: apt.sashi, oikomi: apt.oikomi,
      },
    },
    bashin: best ? best.bashin : 0,
    styleUsed: best ? best.style : 0,
    skills: best ? best.breakdown : [],
    expect: best && best.breakdown.length
      ? best.breakdown.reduce((a, s) => a + s.expect, 0) / best.breakdown.length
      : 0,
  };
}

function rankCourse(db, courseId, opts = {}) {
  const course = db.courses.find((c) => c.id === Number(courseId) || c.id === courseId);
  if (!course) return { error: 'course_not_found', courseId };

  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const style = Number(opts.style) || 0;
  const mode = opts.mode || 'inherent';

  const rows = db.cards.map((card) => scoreCard(card, db.skills, course, { style, mode }));
  rows.sort((a, b) => b.bashin - a.bashin || a.cardId - b.cardId);

  return {
    ok: true,
    course,
    mode,
    style,
    formula: 'approx-v1',
    totalCards: rows.length,
    ranking: rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })),
  };
}

module.exports = {
  scoreCard,
  scoreSkillOnCourse,
  rankCourse,
  courseContext,
  evalCondition,
  REF_SPEED,
  BASHIN_M,
  STYLE_KEYS,
  DIST_KEYS,
  GROUND_KEYS,
};
