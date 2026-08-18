/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Pins the AGL-1431 detectors — all three halves of them.
 *
 *   node --test tools/scripts/lib/retired-colours.test.mjs
 *
 * A detector for a defect that shows up 176 times has one dangerous failure
 * mode: reporting a small number, or zero, and being believed. Every case
 * here is built from bytes actually observed live — the `/pricing` payload on
 * 2026-08-11 and the marketing node corpus on 2026-08-12 — and the counting
 * cases assert the FULL multiplicity, because a detector that deduped to
 * distinct rules would report 6 where the page has 170, which is exactly how
 * this regression stayed invisible.
 *
 * This file is everything about AGL-1431 that CI can actually run. The two
 * measuring halves cannot: the rendered census needs the published site (its
 * own scheduled workflow) and the data audit needs ADC on `aglyn-main`. What
 * runs here is the pure decision-making of both, plus the source sweep — the
 * one part where the failure is committable and therefore gateable.
 */

import { strict as assert } from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { encode } from '@msgpack/msgpack'

import {
  decodeNodesField,
  findRetiredColoursInNodes,
} from './retired-colours-nodes.mjs'
import {
  RETIRED_COLOURS,
  auditRenderedPage,
  findColourOccurrences,
  findSourceOccurrences,
  splitSourceComments,
} from './retired-colours.mjs'

/** The escaped-JSON shape the flight payload uses. 143 of these on /pricing. */
const authoredNode = (hex) =>
  `{\\"fontSize\\":\\"15px\\",\\"fontWeight\\":600,\\"color\\":\\"${hex}\\",\\"@scheme dark\\":{}}`

/** The emitted emotion rule for the same node. Only 6 distinct on /pricing. */
const emittedRule = (hex) => `line-height:1.5;font-size:15px;color:${hex};`

/** The theme describing its own dark-scheme primary.dark. Present everywhere. */
const themePalette = `\\"primary\\":{\\"main\\":\\"#00b0ff\\",\\"dark\\":\\"#4fc3f7\\",\\"contrastText\\":\\"#FFF\\"}`

test('counts every occurrence, not every distinct rule', () => {
  // The shape that made this invisible: one authored decision duplicated
  // across the compare table's ✓ glyphs, deduped by emotion to one rule.
  const html = `${authoredNode('#0090d9').repeat(163)}${emittedRule('#0090d9')}`
  const found = findColourOccurrences(html, '#0090d9')

  assert.equal(found.total, 164)
  assert.equal(found.violations, 164, 'must not dedupe to distinct rules')
  assert.equal(found.byKey.color, 164)
})

test('finds the hex in all three delivered shapes', () => {
  for (const html of [
    `\\"color\\":\\"#0090d9\\"`, // escaped JSON, flight payload
    `"color":"#0090d9"`, // plain JSON, script tag
    `color:#0090d9;`, // emitted CSS
    `"backgroundColor": "#0090D9"`, // spaced, and uppercase
  ])
    assert.equal(
      findColourOccurrences(html, '#0090d9').violations,
      1,
      `missed the hex in: ${html}`,
    )
})

test('exempts the theme palette slot but not an authored pin', () => {
  // Both on one page, which is precisely the live /pricing situation.
  const html = `${themePalette}${themePalette}${authoredNode('#4fc3f7').repeat(19)}`
  const found = findColourOccurrences(html, '#4fc3f7')

  assert.equal(found.total, 21)
  assert.equal(
    found.exempt,
    2,
    'the two palette slots are the theme, not an author',
  )
  assert.equal(found.exemptByKey.dark, 2)
  assert.equal(found.violations, 19)
})

test('a page carrying only the theme palette is clean', () => {
  // `/` and `/product/media` measured exactly this on 2026-08-11: two
  // occurrences of #4fc3f7, zero authored. If this ever reports a violation
  // the check would cry wolf on the pages the migration got right.
  const { clean, findings } = auditRenderedPage(
    `${themePalette}${themePalette}`,
  )

  assert.equal(clean, true)
  const dark = findings.find((f) => f.hex === '#4fc3f7')
  assert.equal(dark.total, 2)
  assert.equal(dark.violations, 0)
})

test('an unattributed occurrence still counts', () => {
  // Bias is deliberate: a hex we cannot explain is a hex we report. The
  // opposite bias is what a broken check looks like.
  const found = findColourOccurrences('<p>brand blue is #0090d9</p>', '#0090d9')

  assert.equal(found.violations, 1)
  assert.equal(found.byKey['(unattributed)'], 1)
})

test('does not match a longer hex token', () => {
  // #0090d9ff is a different colour; matching it would be a false positive.
  assert.equal(findColourOccurrences('color:#0090d9ff;', '#0090d9').total, 0)
  assert.equal(findColourOccurrences('color:#0090d9;', '#0090d9').total, 1)
})

test('the retired set stays small and self-describing', () => {
  // This is a named-set check, not a palette linter. Growing it silently is
  // how it turns into a sweep nobody can act on.
  assert.deepEqual(
    RETIRED_COLOURS.map((c) => c.hex),
    ['#0090d9', '#4fc3f7'],
  )
  for (const colour of RETIRED_COLOURS) {
    assert.ok(
      colour.retiredBy,
      `${colour.hex} must name the issue that retired it`,
    )
    assert.ok(colour.replacement, `${colour.hex} must name a replacement`)
  }
})

test('the AA replacement is never itself reported', () => {
  // #0073ae is the migration target — 22 occurrences on live /pricing.
  const { clean } = auditRenderedPage(`\\"color\\":\\"#0073ae\\"`.repeat(22))
  assert.equal(clean, true)
})

// ─────────────────────────────────────────────────────────────────────────────
// The DATA half. `findRetiredColoursInNodes` reads stored besigner nodes and
// names the one to open; `decodeNodesField` is the step that decides whether
// the whole corpus reads as clean.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The live shape. `hosts/DXnRbPH4CQ/screens/AGSSMcO-Xc/versions/iwP-3G8PTb`
 * node `JOPekm0oyE` on 2026-08-12 — a 120×32 rounded rect in the Bento
 * section, carrying the retired blue as a fill.
 */
const liveNode = {
  $id: 'JOPekm0oyE',
  type: 'node',
  parentId: 'AuYlx2g2GQ',
  pluginId: 'mui',
  componentId: 'muiStack',
  props: { direction: 'row' },
  sx: {
    position: 'absolute',
    left: 189,
    top: 99,
    width: 120,
    height: 32,
    borderRadius: '4px',
    bgcolor: '#0090d9',
  },
}

test('a msgpack `nodes` blob is decoded, never read as an empty document', () => {
  // EVERY marketing screen version measured on 2026-08-12 was msgpack, and the
  // parent screen documents carry no `nodes` at all. A scan that treats bytes
  // as "not a node map" reports a clean zero across the entire corpus — which
  // is the single most dangerous way this check could fail.
  const blob = encode({ JOPekm0oyE: liveNode })
  const decoded = decodeNodesField(blob)

  assert.equal(decoded.form, 'msgpack')
  const { findings, nodesWalked } = findRetiredColoursInNodes(decoded.nodes)
  assert.equal(nodesWalked, 1)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].nodeId, 'JOPekm0oyE')
  assert.equal(findings[0].path, 'sx.bgcolor')
  assert.equal(findings[0].hex, '#0090d9')
  assert.equal(findings[0].scope, 'base')
  assert.equal(findings[0].retiredBy, 'AGL-1293')
})

test('bytes that will not decode THROW rather than reporting clean', () => {
  // 0xc1 is msgpack's never-used byte. The caller reports an ERROR for the
  // document; a `catch` returning `{}` here would report it as clean.
  assert.throws(() => decodeNodesField(new Uint8Array([0xc1])))
})

test('a decoded value that is not a node collection THROWS', () => {
  assert.throws(() => decodeNodesField(encode('not nodes')))
  assert.throws(() => decodeNodesField(42))
})

test('a document with no `nodes` field is absent, not an error', () => {
  // The 62 marketing parent screens. They hold a `versionId` and nothing else,
  // so this must be an ordinary outcome — and the caller must keep walking to
  // the versions, which is where the nodes are.
  assert.deepEqual(decodeNodesField(undefined), { form: 'absent', nodes: {} })
  assert.deepEqual(decodeNodesField(null), { form: 'absent', nodes: {} })
})

test('both storage forms produce the same finding', () => {
  // The form is a property of the DOCUMENT, not of the host, so the two paths
  // have to agree or the verdict depends on how a page happened to be saved.
  const nodes = { JOPekm0oyE: liveNode }
  const fromMap = findRetiredColoursInNodes(decodeNodesField(nodes).nodes)
  const fromBytes = findRetiredColoursInNodes(
    decodeNodesField(encode(nodes)).nodes,
  )

  assert.equal(decodeNodesField(nodes).form, 'map')
  assert.deepEqual(fromMap.findings, fromBytes.findings)
})

test('locates a dark-slice pin separately from a base value', () => {
  // Removing the `@scheme dark` slices that pinned the dark blue was HALF of
  // 64a945bc5. A finding that could not tell the two apart would report the
  // repair as one edit when it is two.
  const { findings } = findRetiredColoursInNodes({
    n1: { sx: { color: '#0073ae', '@scheme dark': { color: '#4fc3f7' } } },
  })

  assert.equal(findings.length, 1)
  assert.equal(findings[0].path, 'sx.@scheme dark.color')
  assert.equal(findings[0].scope, 'dark-slice')
  assert.equal(findings[0].hex, '#4fc3f7')
})

test('finds the hex inside a compound value, not only as the whole value', () => {
  // `linear-gradient(...)` and `1px solid #…` are both authored shapes and
  // both put the retired colour in front of a visitor. An equality check on
  // the value misses every one of them.
  const { findings } = findRetiredColoursInNodes({
    n1: {
      sx: {
        background: 'linear-gradient(90deg,#0090d9 0%,#0090d9 100%)',
        border: '1px solid #0090d9',
      },
    },
  })

  const total = findings.reduce((sum, f) => sum + f.occurrences, 0)
  assert.equal(total, 3, 'two in the gradient, one in the border shorthand')
})

test('walks props, not only sx', () => {
  // The AGL-1293 population lived in `sx`. A walker that only looks where the
  // last regression sat is a hand-listed set of files wearing a different hat.
  const { findings } = findRetiredColoursInNodes({
    n1: { props: { htmlColor: '#0090d9' }, sx: {} },
  })

  assert.equal(findings.length, 1)
  assert.equal(findings[0].path, 'props.htmlColor')
})

test('exempts a palette slot in node data, as the rendered census does', () => {
  // Same exemption, same reason, one definition — so the two halves cannot
  // drift into disagreeing about what counts as authored.
  const { findings, exempt } = findRetiredColoursInNodes({
    n1: { theme: { primary: { main: '#00b0ff', dark: '#4fc3f7' } } },
  })

  assert.equal(exempt, 1)
  assert.deepEqual(findings, [])
})

test('does not match a longer hex token in node data', () => {
  const { findings } = findRetiredColoursInNodes({
    n1: { sx: { color: '#0090d9ff' } },
  })
  assert.deepEqual(findings, [])
})

// ─────────────────────────────────────────────────────────────────────────────
// The SOURCE half — the only part of AGL-1431 a PR gate can see.
//
// The regression itself arrived as data, but one of its two halves had a
// generator sitting in source: `backfill-scheme-dark.mjs` carried a curated
// map from the old brand blue to the dark pin, in a script the repo keeps
// specifically to be RE-RUN after data changes. A single re-run would have
// re-minted the `@scheme dark` slices that 64a945bc5 deleted — silently, on
// pages nobody edited, with no authoring pass involved at all.
//
// Six authoring notes under `tools/marketing/product-copy` were the other
// shape of the same thing: prose instructing whoever builds the stat row to
// use the retired hex, read by a human or an agent immediately before they
// author it.
//
// So the rule is stated over the CORPUS rather than over a list of files:
// nothing under `apps/`, `libs/` or `tools/` may write a retired colour down,
// except where we can say why. A hand-listed set has the blind spot the next
// generator is by definition in.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

/**
 * Ships, or writes data. `.github` is deliberately outside: a workflow comment
 * cannot mint a colour, and the census workflow explains itself in hexes.
 */
const SWEEP_ROOTS = ['apps', 'libs', 'tools']

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.nx',
  'tmp',
  '.turbo',
])

/** Code, config, content and instructions. The last one is not optional. */
const SWEPT = /\.(?:tsx?|jsx?|mjs|cjs|json|css|scss|html|md)$/

function sweptFiles(dir) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...sweptFiles(full))
      continue
    }
    if (SWEPT.test(entry.name)) found.push(full)
  }
  return found
}

const sourceCorpus = SWEEP_ROOTS.flatMap((root) =>
  sweptFiles(join(REPO_ROOT, root)),
).map((file) => ({
  path: relative(REPO_ROOT, file).split(sep).join('/'),
  text: readFileSync(file, 'utf8'),
}))

/**
 * Files allowed to write a retired hex, and why. A reason is mandatory and is
 * asserted to still apply — an exemption for a file that no longer contains
 * one is an exemption nobody has read since it was added.
 */
const EXEMPT = {
  'tools/scripts/lib/retired-colours.mjs':
    'Defines the retired set. Something has to name the colours, and this is the one file whose job that is; every other detector imports RETIRED_COLOURS from here.',
  'tools/scripts/lib/retired-colours-nodes.mjs':
    'The node-data walker. Names the hexes only in its header, illustrating the authored shapes it has to match — a gradient, a border shorthand, a dark slice.',
  'tools/scripts/lib/retired-colours.test.mjs':
    'This file. Pinning a detector means writing down the thing it detects, including the live node and payload bytes the cases were built from.',
  'tools/scripts/audit-retired-colours-data.mjs':
    'The data audit CLI. Its header explains why the sweep defaults to the marketing host, which needs the hex to make the point that the same colour is unremarkable on a customer site.',
  'libs/shared/ui/theme/src/lib/util/create-responsive-theme.spec.ts':
    'Pins the THEME palette, where the lighter blue is the generated dark-scheme primary.dark and is correct. That is the palette-slot exemption both detectors carry, asserted at its source rather than assumed.',
}

test('the source sweep reads the corpus, not a hand-listed set of files', () => {
  // Guards the premise. A sweep that read nothing would pass in silence, and
  // "no violations" is the answer this whole issue exists because of.
  assert.ok(
    sourceCorpus.length > 3000,
    `swept only ${sourceCorpus.length} files — the walk is not reaching the corpus`,
  )
  const paths = new Set(sourceCorpus.map((file) => file.path))
  for (const path of Object.keys(EXEMPT))
    assert.ok(paths.has(path), `sweep missed an exempt file: ${path}`)
})

test('no source file writes a retired colour down', () => {
  const offenders = []
  for (const { path, text } of sourceCorpus) {
    if (path in EXEMPT) continue
    for (const colour of RETIRED_COLOURS) {
      // AUTHORED, not merely present: a hex assigned in code, or assigned
      // inside a commented-out block, is authored colour; a hex NAMED in a
      // doc comment is documentation. See `findSourceOccurrences`.
      const found = findSourceOccurrences(text, colour.hex, path)
      if (found.authored)
        offenders.push(`${path} — ${colour.hex} ×${found.authored}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a retired colour is written into source:\n  ${offenders.join('\n  ')}\n` +
      'A hex here becomes node data the moment the file is a mapping a ' +
      'back-fill applies, or an instruction an author follows. Use the token, ' +
      'or add a path to EXEMPT with a reason.',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// The source sweep's own split, pinned BOTH WAYS (AGL-1939)
//
// The sweep went red on the AGL-1293 doc comments — prose explaining which
// colour was retired — and the cheap greens on offer were to delete the
// documentation or to exempt the file. Teaching it about comments is the right
// fix and also the dangerous one: a scanner that stops seeing comments must
// not thereby stop seeing code, and a commented-out `sx` block is code that is
// one keystroke from rendering.
//
// So every case below is paired. Each prose case that must be GREEN sits next
// to the same hex, in the same syntax, written as an assignment, which must
// stay RED.
// ─────────────────────────────────────────────────────────────────────────────

const RETIRED = RETIRED_COLOURS[1].hex // #4fc3f7 — the one the docblocks name

/** Authored count for a synthetic file. */
const authored = (text, path = 'libs/x/src/thing.ts') =>
  findSourceOccurrences(text, RETIRED, path).authored

test('a docblock that NAMES a retired colour is documentation, not colour', () => {
  // The exact shape that made this red: `libs/shared/ui/theme/src/lib/util/
  // accent-text.ts`, AGL-1293's explanation of what was retired.
  const docblock = [
    '/**',
    ' * `dark` is deliberately overloaded rather than a new slot being',
    ' * invented, and the marketing host already pins it explicitly',
    ' * (`#0073ae` light / `' + RETIRED + '` dark). A second slot would have',
    ' * to be whitelisted in `host-theme.ts`.',
    ' */',
    "export const ACCENT_TEXT_SHADE = 'dark' as const",
  ].join('\n')
  assert.equal(authored(docblock), 0)
  // …and it is SEEN, not skipped: the scanner still counts it, it just does
  // not call it authored. A zero here would mean the split stopped reading.
  assert.equal(findSourceOccurrences(docblock, RETIRED, 'a.ts').documented, 1)
})

test('a line comment that NAMES one is documentation too', () => {
  const line = `// keeps the marketing host's hand-pinned #0073ae / ${RETIRED} stable\nexport const x = 1\n`
  assert.equal(authored(line), 0)
})

test('a COMMENTED-OUT assignment is still authored colour', () => {
  // The failure mode the widening could have introduced. Someone told to stop
  // using the hex comments the slice out rather than deleting it.
  assert.equal(authored(`// color: '${RETIRED}',\n`), 1)
  assert.equal(authored(`  // '@scheme dark': { color: '${RETIRED}' },\n`), 1)
  assert.equal(authored(`/*\n * background: ${RETIRED};\n */\n`), 1)
  assert.equal(authored(`/* "color":"${RETIRED}" */`), 1)
  assert.equal(authored(`// --brand-accent: ${RETIRED};\n`, 'apps/x/a.css'), 1)
})

test('a bare quoted literal inside a comment is authored, backticks are prose', () => {
  // Straight quotes are how code writes a colour; backticks are how a
  // docblock writes markdown. The distinction is the whole rule.
  assert.equal(authored(`// '${RETIRED}',\n`), 1)
  assert.equal(authored(`// the retired \`${RETIRED}\` dark accent\n`), 0)
})

test('the comment split does not blind the scanner to real code', () => {
  // The control the whole widening lives or dies on.
  assert.equal(authored(`export const BRAND = '${RETIRED}'\n`), 1)
  assert.equal(authored(`const sx = { color: '${RETIRED}' }\n`), 1)
  // Unattributed, unassigned, in code — still counted, exactly as before.
  assert.equal(authored(`const shades = ['${RETIRED}']\n`), 1)
  assert.equal(authored(`<div style="color:${RETIRED}" />\n`, 'a.tsx'), 1)
  // A URL's `//` must not be mistaken for a comment and swallow the line.
  assert.equal(
    authored(`fetch('https://example.com'); const c = '${RETIRED}'\n`),
    1,
  )
  // Nor may a regex literal.
  assert.equal(authored(`const re = /\\/\\//; const c = '${RETIRED}'\n`), 1)
  // A file type with no comment syntax we honour keeps the strict behaviour.
  assert.equal(authored(`{ "color": "${RETIRED}" }`, 'a.json'), 1)
  assert.equal(authored(`Use ${RETIRED} for the dark accent.`, 'a.md'), 1)
})

test('the split is complementary and offset-preserving', () => {
  // Guards the premise of every case above: a split that dropped or shifted
  // bytes would make the lookback read the wrong context and quietly decide
  // everything is prose.
  const text = `const a = 1 // note ${RETIRED}\n/* block ${RETIRED} */\nconst b = '${RETIRED}'\n`
  const { code, comments } = splitSourceComments(text, 'a.ts')
  assert.equal(code.length, text.length)
  assert.equal(comments.length, text.length)
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') continue
    // Exactly one region carries each byte.
    assert.equal(
      Number(code[i] === text[i]) + Number(comments[i] === text[i]),
      text[i] === ' ' ? 2 : 1,
      `byte ${i} (${JSON.stringify(text[i])}) is in neither region or both`,
    )
  }
  assert.equal(findColourOccurrences(code, RETIRED).total, 1)
  assert.equal(findColourOccurrences(comments, RETIRED).total, 2)
})

test('every exemption still applies', () => {
  for (const [path, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 80, `${path}: an exemption owes a real reason`)
    const text = readFileSync(join(REPO_ROOT, path), 'utf8')
    const mentions = RETIRED_COLOURS.some(
      (colour) => findColourOccurrences(text, colour.hex).total > 0,
    )
    assert.ok(mentions, `${path} no longer names a retired colour — drop it`)
  }
})
