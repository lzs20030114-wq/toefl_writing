#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import imageSize from 'next/dist/compiled/image-size/index.js';
import { fileURLToPath } from 'node:url';
import helpers from './scene_repairs.js';

const args = process.argv.slice(2);
if (args.some(arg => !['--dry', '--write'].includes(arg)) || (args.includes('--dry') && args.includes('--write'))) throw new Error('Usage: node scripts/realbank/repair_repeat_scenes.mjs [--dry | --write]');
const bankPath = fileURLToPath(new URL('../../data/realBank/speaking/repeat.json', import.meta.url));
const ledgerPath = fileURLToPath(new URL('../../data/realBank/speaking/scene-repairs.json', import.meta.url));
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const crossSource = helpers.applyCrossSourceRepairs(bank, ledger);
const result = helpers.applyOriginalSourceRepairs(crossSource.bank, ledger);
// Original recovered assets are tracked; reject missing/changed bytes even in dry mode.
for (const entry of ledger.original_source || []) {
  const assetPath = new URL(`../../public${entry.url}`, import.meta.url);
  const bytes = fs.readFileSync(assetPath);
  if (crypto.createHash('sha1').update(bytes).digest('hex') !== entry.sha1) throw new Error(`Original source asset hash changed: ${entry.url}`);
  const dimensions = imageSize(bytes);
  if (dimensions.type !== 'webp' || dimensions.width !== entry.w || dimensions.height !== entry.h) throw new Error(`Original source asset dimensions changed: ${entry.url}`);
}
if (args.includes('--write') && (crossSource.added || result.added || result.addedBases)) {
  const temporary = `${bankPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(result.bank, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, bankPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
console.log(JSON.stringify({ mode: args.includes('--write') ? 'write' : 'dry', added_frames: crossSource.added + result.added, added_bases: result.addedBases, cross_source_added: crossSource.added, original_source_added: result.added, unchanged_repairs: crossSource.unchanged + result.unchanged, total_frames: result.bank.items.reduce((n, item) => n + (item.sentence_frames || []).length, 0) }, null, 2));
