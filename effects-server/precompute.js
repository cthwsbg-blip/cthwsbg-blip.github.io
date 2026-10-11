#!/usr/bin/env node
/** Precompute top-50 rankings for every course → data/rankings/*.json (for static hosting or Worker KV). */
'use strict';
const fs = require('fs');
const path = require('path');
const { rankCourse } = require('./bashin');

const ROOT = process.env.EFFECTS_ROOT || __dirname;
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'effects_db.json'), 'utf8'));
const outDir = path.join(ROOT, 'data', 'rankings');
fs.mkdirSync(outDir, { recursive: true });

const styles = [0, 1, 2, 3, 4];
const modes = ['inherent'];
let n = 0;
for (const course of db.courses) {
  for (const mode of modes) {
    for (const style of styles) {
      const result = rankCourse(db, course.id, { style, limit: 50, mode });
      const name = `${course.id}_s${style}_${mode}.json`;
      fs.writeFileSync(path.join(outDir, name), JSON.stringify(result));
      n++;
    }
  }
}
const index = {
  generatedAt: new Date().toISOString(),
  meta: db.meta,
  files: n,
  pattern: '{courseId}_s{style}_{mode}.json',
  styles: { 0: 'all', 1: 'nige', 2: 'senko', 3: 'sashi', 4: 'oikomi' },
};
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`precomputed ${n} ranking files → ${outDir}`);
const sibling = path.resolve(ROOT, '..', 'effects', 'data', 'rankings');
if (fs.existsSync(path.dirname(sibling)) || true) {
  fs.mkdirSync(sibling, { recursive: true });
  for (const f of fs.readdirSync(outDir)) {
    fs.copyFileSync(path.join(outDir, f), path.join(sibling, f));
  }
  console.log(`mirrored → ${sibling}`);
}
