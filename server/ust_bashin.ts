/**
 * Bashin scoring via uma-skill-tools RaceSolver (same family as /skill/ / U-tools).
 * Compares with-skills vs without-skills position: (pos_with - pos_without) / 2.5
 */
import * as fs from 'fs';
import * as path from 'path';

import { RaceSolver } from '../../uma-skill-tools/RaceSolver';
import { NoopHpPolicy } from '../../uma-skill-tools/HpPolicy';
import { Rule30CARng } from '../../uma-skill-tools/Random';
import { CourseHelpers } from '../../uma-skill-tools/CourseData';
import { SkillRarity, PendingSkill } from '../../uma-skill-tools/RaceSolver';
import { ToolCLI, SkillData } from '../../uma-skill-tools/tools/ToolCLI';
import { parseStrategy, parseAptitude } from '../../uma-skill-tools/RaceSolverBuilder';

// ToolCLI is CLI-oriented; instead load skill JSON like ToolCLI does via dynamic require of builder helpers.
import { RaceSolverBuilder } from '../../uma-skill-tools/RaceSolverBuilder';

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
  ap?: any;
};

const STYLE_MAP: Record<number, string> = { 1: 'Nige', 2: 'Senkou', 3: 'Sasi', 4: 'Oikomi' };

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

function meanBashin(opts: {
  courseId: number;
  skillIds: string[];
  strategy: string;
  nsamples: number;
  seed: number;
}): { mean: number; median: number; min: number; max: number; n: number } {
  const builder = new RaceSolverBuilder(opts.nsamples)
    .seed(opts.seed)
    .course(opts.courseId)
    .horse({
      speed: 2200,
      stamina: 1600,
      power: 1700,
      guts: 1200,
      wisdom: 1800,
      strategy: opts.strategy,
      distanceAptitude: 'A',
      surfaceAptitude: 'A',
      strategyAptitude: 'A',
    })
    .mood(2)
    .ground(1);

  // with skills
  for (const sid of opts.skillIds) {
    try {
      builder.addSkill(sid);
    } catch {
      /* skill missing in UST data */
    }
  }

  const withIter = builder.build();
  // without: rebuild without skills
  const builder2 = new RaceSolverBuilder(opts.nsamples)
    .seed(opts.seed)
    .course(opts.courseId)
    .horse({
      speed: 2200,
      stamina: 1600,
      power: 1700,
      guts: 1200,
      wisdom: 1800,
      strategy: opts.strategy,
      distanceAptitude: 'A',
      surfaceAptitude: 'A',
      strategyAptitude: 'A',
    })
    .mood(2)
    .ground(1);
  const withoutIter = builder2.build();

  const gains: number[] = [];
  // RaceSolverBuilder build() returns iterator of solvers — follow compare/gain patterns
  // Fallback: if API differs, throw clearly
  if (typeof (withIter as any)[Symbol.iterator] !== 'function') {
    throw new Error('RaceSolverBuilder.build() did not return iterable; check UST API');
  }

  const withArr = [...(withIter as Iterable<RaceSolver>)];
  const withoutArr = [...(withoutIter as Iterable<RaceSolver>)];
  const n = Math.min(withArr.length, withoutArr.length);
  for (let i = 0; i < n; i++) {
    const s = withArr[i];
    const s2 = withoutArr[i];
    while (s.pos < (s as any).course.distance) s.step(1 / 60);
    while (s2.accumulatetime.t < s.accumulatetime.t) s2.step(1 / 60);
    gains.push((s.pos - s2.pos) / 2.5);
  }
  gains.sort((a, b) => a - b);
  const mid = Math.floor(gains.length / 2);
  const median = gains.length % 2 === 0 ? (gains[mid - 1] + gains[mid]) / 2 : gains[mid];
  const mean = gains.reduce((a, b) => a + b, 0) / gains.length;
  return { mean, median, min: gains[0], max: gains[gains.length - 1], n: gains.length };
}

async function main() {
  const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'effects_db.json');
  const courseId = Number(process.argv[3] || 11101);
  const limit = Number(process.argv[4] || 50);
  const nsamples = Number(process.argv[5] || 12);
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const rows = [];
  for (const card of db.cards as Card[]) {
    const skills = inherentIds(card);
    const styles = card.st ? [STYLE_MAP[card.st] || 'Senkou'] : ['Nige', 'Senkou', 'Sasi', 'Oikomi'];
    let best = { mean: -Infinity, style: styles[0], skills };
    for (const st of styles) {
      try {
        const g = meanBashin({
          courseId,
          skillIds: skills,
          strategy: st,
          nsamples,
          seed: 614tools ^ courseId ^ card.id,
        });
        if (g.mean > best.mean) best = { mean: g.mean, style: st, skills };
      } catch (e) {
        // skip broken
      }
    }
    rows.push({
      cardId: card.id,
      name: card.n,
      nameZh: card.zn,
      title: card.t,
      icon: card.i,
      bashin: best.mean,
      styleUsed: best.style,
      skillIds: best.skills,
    });
  }
  rows.sort((a, b) => b.bashin - a.bashin);
  const out = {
    ok: true,
    courseId,
    formula: 'uma-skill-tools RaceSolver (pos_diff/2.5 mean)',
    nsamples,
    totalCards: rows.length,
    ranking: rows.slice(0, limit),
  };
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
