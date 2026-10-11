/**
 * Rank cards on a course using uma-skill-tools RaceSolver.
 * bashin = mean( (pos_with - pos_without) / 2.5 ) over N samples
 * Inherent skills = unique + evolution + awakening (from effects_db).
 */
import * as fs from 'fs';
import * as path from 'path';
import { RaceSolverBuilder } from '../../uma-skill-tools/RaceSolverBuilder';
import { RaceSolver } from '../../uma-skill-tools/RaceSolver';
import ustSkills from '../../uma-skill-tools/data/skill_data.json';

type Card = {
  id: number;
  inherent?: number[];
  uniqueId?: number;
  evo?: { id: number }[];
  awake?: { id: number }[];
  si?: number[];
  st?: number;
  n?: string;
  zn?: string;
  t?: string;
  i?: string;
  col?: string;
  ap?: any;
};

const STYLE: Record<number, string> = { 1: 'Nige', 2: 'Senkou', 3: 'Sasi', 4: 'Oikomi' };
const STYLE_NUM: Record<string, number> = { Nige: 1, Senkou: 2, Sasi: 3, Oikomi: 4 };

function inherentIds(card: Card): string[] {
  const raw =
    card.inherent && card.inherent.length
      ? card.inherent
      : ([] as number[]).concat(
          card.uniqueId ? [card.uniqueId] : [],
          (card.evo || []).map((e) => e.id),
          (card.awake || []).map((a) => a.id),
          card.si || []
        );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    const k = String(id);
    if (!id || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function meanBashin(
  courseId: number,
  skillIds: string[],
  strategy: string,
  nsamples: number,
  seed: number,
  ground: number
): number {
  const horse = {
    speed: 2200,
    stamina: 1600,
    power: 1700,
    guts: 1200,
    wisdom: 1800,
    strategy,
    distanceAptitude: 'A',
    surfaceAptitude: 'A',
    strategyAptitude: 'A',
  };
  const withB = new RaceSolverBuilder(nsamples).seed(seed).course(courseId).horse(horse).mood(2).ground(ground);
  const valid = skillIds.filter((sid) => Object.prototype.hasOwnProperty.call(ustSkills, sid));
  for (const sid of valid) {
    withB.addSkill(sid);
  }
  const withoutB = new RaceSolverBuilder(nsamples).seed(seed).course(courseId).horse(horse).mood(2).ground(ground);
  try {
    const withArr = [...withB.build()] as RaceSolver[];
    const withoutArr = [...withoutB.build()] as RaceSolver[];
    const n = Math.min(withArr.length, withoutArr.length);
    if (!n) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = withArr[i];
      const s2 = withoutArr[i];
      while (s.pos < s.course.distance) s.step(1 / 60);
      while (s2.accumulatetime.t < s.accumulatetime.t) s2.step(1 / 60);
      sum += (s.pos - s2.pos) / 2.5;
    }
    return sum / n;
  } catch (e) {
    // Some newer skill conditions are not parseable by current UST; skip.
    return 0;
  }
}

export function rankCourseUst(
  db: any,
  courseId: number,
  opts: { style?: number; limit?: number; nsamples?: number; seed?: number } = {}
) {
  const course = (db.courses as any[]).find((c) => c.id === Number(courseId));
  if (!course) return { ok: false, error: 'course_not_found', courseId };

  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 300);
  const styleFilter = Number(opts.style) || 0;
  const nsamples = Math.min(Math.max(Number(opts.nsamples) || 12, 2), 100);
  const seed = Number(opts.seed) || 6140011;
  const ground = course.ground === 2 ? 2 : 1;

  const rows = [];
  for (const card of db.cards as Card[]) {
    const skills = inherentIds(card);
    const tryStyles = styleFilter
      ? [STYLE[styleFilter]]
      : card.st && STYLE[card.st]
        ? [STYLE[card.st]]
        : ['Nige', 'Senkou', 'Sasi', 'Oikomi'];

    let bestMean = -Infinity;
    let bestStyle = tryStyles[0];
    for (const st of tryStyles) {
      if (!st) continue;
      const mean = meanBashin(course.id, skills, st, nsamples, seed ^ card.id, ground);
      if (mean > bestMean) {
        bestMean = mean;
        bestStyle = st;
      }
    }

    const skillBreakdown = skills.slice(0, 8).map((sid) => {
      const sk = db.skills[sid] || db.skills[String(sid)];
      return { skillId: sid, name: sk?.n || sid, bashin: null as number | null };
    });

    rows.push({
      cardId: card.id,
      title: card.t,
      name: card.n,
      nameZh: card.zn,
      icon: card.i,
      color: card.col,
      preferredStyle: card.st,
      styleUsed: STYLE_NUM[bestStyle] || 0,
      bashin: bestMean,
      expect: 1,
      apt: {
        dist: card.ap?.[`d${course.distType}`] || card.ap?.dist || '',
        ground: course.ground === 2 ? card.ap?.dirt || card.ap?.ground : card.ap?.turf || card.ap?.ground,
      },
      skills: skillBreakdown,
      skillIds: skills,
    });
  }

  rows.sort((a, b) => b.bashin - a.bashin || a.cardId - b.cardId);
  return {
    ok: true,
    course,
    mode: 'inherent',
    style: styleFilter,
    formula: 'uma-skill-tools RaceSolver (pos_diff/2.5 mean)',
    nsamples,
    totalCards: rows.length,
    ranking: rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })),
  };
}

// CLI: npx ts-node server/ust_rank.ts <db> <courseId> [limit] [nsamples] [style]
if (require.main === module) {
  const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'effects_db.json');
  const courseId = Number(process.argv[3] || 11101);
  const limit = Number(process.argv[4] || 50);
  const nsamples = Number(process.argv[5] || 12);
  const style = Number(process.argv[6] || 0);
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const t0 = Date.now();
  const result = rankCourseUst(db, courseId, { limit, nsamples, style });
  (result as any).elapsedMs = Date.now() - t0;
  process.stdout.write(JSON.stringify(result));
}
