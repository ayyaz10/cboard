import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

const codepoints = (...values) => String.fromCodePoint(...values);
const markers = [
  codepoints(0x00c3, 0x201a),
  codepoints(0x00c3, 0x0192),
  codepoints(0x00c3, 0x00a2, 0x00e2, 0x20ac),
  codepoints(0x00c3, 0x00a2, 0x00e2, 0x201a, 0x00ac),
  codepoints(0x00c3, 0x00a2, 0x00cb, 0x2020),
  codepoints(0x00ef, 0x00bc),
  codepoints(0x00c2, 0x00b7),
  codepoints(0x00c2, 0x00a3),
  codepoints(0x00e2, 0x20ac),
  codepoints(0x00e2, 0x2020),
  codepoints(0x00e2, 0x02c6),
  codepoints(0x00e2, 0x2021),
  codepoints(0x00c3, 0x2014),
  codepoints(0x00c2, 0x00b5),
  codepoints(0x00ef, 0x00bf, 0x00bd),
  codepoints(0xfffd),
  codepoints(0x00c3, 0x00ad),
  codepoints(0x00e2, 0x20ac, 0x2122),
];

// These source occurrences intentionally model or recognize malformed external text.
const exceptions = new Map([
  ['src/features/finance/receiptParser.js', new Set([codepoints(0x00c3, 0x2014)])],
  ['src/features/finance/fixtures/groupedBankStatement.txt', new Set([
    codepoints(0x00c3, 0x201a), codepoints(0x00c2, 0x00a3),
  ])],
  ['src/features/nutrition/nutritionLabelParser.js', new Set([codepoints(0x00c2, 0x00b5)])],
  ['src/features/nutrition/nutritionOcrDocument.test.js', new Set([codepoints(0x00c3, 0x00ad)])],
]);
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.json', '.txt', '.svg', '.sql']);
const roots = ['src', 'public', 'tests', 'scripts', 'supabase'];
const decoder = new TextDecoder('utf-8', { fatal: true });
const findings = [];

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(path);
      continue;
    }
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    if (!extensions.has(extension)) continue;
    const name = relative(process.cwd(), path).replaceAll('\\', '/');
    let contents;
    try {
      contents = decoder.decode(readFileSync(path));
    } catch {
      findings.push(`${name}:1 (source file is not valid UTF-8)`);
      continue;
    }
    const allowed = exceptions.get(name) || new Set();
    const lines = contents.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (markers.some(marker => !allowed.has(marker) && line.includes(marker))) {
        findings.push(`${name}:${index + 1}`);
      }
    });
  }
}

for (const root of roots) {
  const path = resolve(root);
  try { scan(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (findings.length) {
  process.stderr.write(`Possible mojibake found:\n${[...new Set(findings)].join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Source encoding check passed.\n');
}
