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
 * `check:tenant-wire-weight` (AGL-3082), driven over a SYNTHETIC build: a
 * manifest, a client-reference manifest, and chunks whose loader tables, call
 * sites and source maps have the shape Turbopack emits. The forced reds are
 * here rather than against a real build, which takes a production build to
 * make and cannot be doctored without editing the tree.
 *
 * The one real-build check is the CLI's own: it must refuse to pass with no
 * build to read, and pass saying so only under `--if-built`.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlib } from 'node:zlib'

import {
  asyncLoaders,
  callSpecifiers,
  budgetFor,
  decodeMappings,
  eagerChunks,
  evaluateWireWeight,
  explainWireVerdict,
  importSpecifiers,
  loaderCallSites,
  measureWireWeight,
  WIRE_HEADROOM,
  wireBytes,
} from './tenant-wire-weight.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-tenant-wire-weight.mjs')
const ROUTE = '[host]/[scheme]/[[...slug]]'

// ── a synthetic build ──────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function vlq(value) {
  let v = value < 0 ? (-value << 1) | 1 : value << 1
  let out = ''
  do {
    let digit = v & 31
    v >>>= 5
    if (v > 0) digit |= 32
    out += B64[digit]
  } while (v > 0)
  return out
}

/**
 * A chunk whose loader call `e.A(<id>)` maps to `line` of `source`, whose text
 * is `sourceText`. One segment at column 0 covers the whole generated line.
 */
function chunkWithCall({ id, source, sourceText, line, loaders = '' }) {
  const code =
    `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([null,1,e=>{e.A(${id})}${loaders}]);` +
    '\n//# sourceMappingURL=page.js.map'
  const map = {
    version: 3,
    sources: [`turbopack:///[project]/${source}`],
    sourcesContent: [sourceText],
    names: [],
    mappings: [vlq(0), vlq(0), vlq(line - 1), vlq(0)].join(''),
  }
  return { code, map }
}

const loaderTable = (id, chunks) =>
  `,${id},s=>{s.v(t=>Promise.all([${chunks
    .map((chunk) => `"static/chunks/${chunk}"`)
    .join(',')}].map(t=>s.l(t))).then(()=>t(900)))}`

const PLUGINS_SOURCE = [
  'export const TENANT_PLUGIN_MANIFEST = [',
  "  { id: 'mui', load: () => import('@aglyn/plugins-mui') },",
  "  { id: 'marketing', load: () => import('@aglyn/plugins-marketing') },",
  ']',
].join('\n')

/**
 * The files of a build, keyed by path under `.next`. `page.js` holds both
 * call sites (one per line of `plugins.client.generated.ts`) and the loader
 * tables; `other-group.js` defines the SAME mui loader with a different list,
 * the way the error boundary's chunk group does.
 */
function syntheticBuild({ muiChunks = ['mui.js'], pluginsSource = PLUGINS_SOURCE } = {}) {
  const mui = chunkWithCall({
    id: 101,
    source: 'apps/tenant/utils/plugins.client.generated.ts',
    sourceText: pluginsSource,
    line: 2,
    loaders: loaderTable(101, muiChunks) + loaderTable(202, ['marketing.js', 'shared.js']),
  })
  // A second call site, on the marketing line, in a chunk of its own map.
  const marketing = chunkWithCall({
    id: 202,
    source: 'apps/tenant/utils/plugins.client.generated.ts',
    sourceText: pluginsSource,
    line: 3,
  })
  const files = {
    'build-manifest.json': JSON.stringify({ rootMainFiles: ['static/chunks/root.js'] }),
    [`server/app/${ROUTE}/page_client-reference-manifest.js`]:
      'globalThis.__RSC_MANIFEST={"x":["static/chunks/page.js","static/chunks/calls.js"]}',
    'static/chunks/root.js': 'r'.repeat(4000),
    'static/chunks/page.js': mui.code,
    'static/chunks/page.js.map': JSON.stringify(mui.map),
    'static/chunks/calls.js': marketing.code.replace('page.js.map', 'calls.js.map'),
    'static/chunks/calls.js.map': JSON.stringify(marketing.map),
    'static/chunks/other-group.js': `(globalThis.TURBOPACK||[]).push([null${loaderTable(101, ['decoy.js'])}]);`,
    'static/chunks/mui.js': 'm'.repeat(9000),
    'static/chunks/mui-extra.js': 'x'.repeat(2000),
    'static/chunks/decoy.js': 'd'.repeat(50000),
    'static/chunks/marketing.js': 'k'.repeat(3000),
    'static/chunks/shared.js': 's'.repeat(1000),
  }
  return files
}

const ioFor = (files) => ({
  readJson: (path) => JSON.parse(files[path]),
  readText: (path) => files[path],
  readBuffer: (path) => Buffer.from(files[path]),
  exists: (path) => path in files,
})

const GROUPS = [
  {
    name: 'every published page',
    loads: [{ from: 'apps/tenant/utils/plugins.client.generated.ts', import: '@aglyn/plugins-mui' }],
  },
  {
    name: 'a site with the marketing plugin',
    loads: [{ from: 'apps/tenant/utils/plugins.client.generated.ts', import: '@aglyn/plugins-marketing' }],
  },
]

const measure = (files, groups = GROUPS) =>
  measureWireWeight({ route: ROUTE, groups, io: ioFor(files) })

// ── the parts ──────────────────────────────────────────────────────────────

test('wireBytes is brotli quality 3 with a 2^18 window — the production basis', () => {
  const buffer = Buffer.from('const a = 1;\n'.repeat(2000))
  const expected = brotliCompressSync(buffer, {
    params: { [zlib.BROTLI_PARAM_QUALITY]: 3, [zlib.BROTLI_PARAM_LGWIN]: 18 },
  }).length
  assert.equal(wireBytes(buffer), expected)
  // …and not the quality-11 figure a raw `brotli` call would give, which
  // understates what production serves by ~17%.
  assert.notEqual(wireBytes(buffer), brotliCompressSync(buffer).length)
})

test('eagerChunks is the root files plus every chunk the route manifest names', () => {
  assert.deepEqual(
    eagerChunks({
      buildManifest: { rootMainFiles: ['static/chunks/b.js'] },
      clientReferenceManifest: '{"a":["static/chunks/a.js","static/chunks/b.js"]}',
    }),
    ['static/chunks/a.js', 'static/chunks/b.js'],
  )
})

test('asyncLoaders reads a loader table, and loaderCallSites the calls into it', () => {
  const code = `[null${loaderTable(7, ['x.js', 'y.js'])},3,e=>{e.A(7);r.A(8)}]`
  assert.deepEqual(asyncLoaders(code), [
    { id: '7', chunks: ['static/chunks/x.js', 'static/chunks/y.js'] },
  ])
  assert.deepEqual(
    loaderCallSites(code).map((site) => site.id),
    ['7', '8'],
  )
})

test('decodeMappings and importSpecifiers read what the loader line names', () => {
  assert.deepEqual(decodeMappings([vlq(4), vlq(0), vlq(9), vlq(0)].join('')), [[0, 4, 0, 9]])
  assert.deepEqual(importSpecifiers("load: () => import('@aglyn/plugins-mui'),"), [
    '@aglyn/plugins-mui',
  ])
})

test('callSpecifiers reads the line a call maps to, and a wrapped call only once', () => {
  // A plugin manifest is a column of adjacent `import()` lines: each call
  // site claims its own line's specifier and never its neighbour's.
  assert.deepEqual(
    callSpecifiers({ text: "  load: () => import('a'),", after: "  load: () => import('b')," }),
    ['a'],
  )
  // A call whose arguments wrap names its specifier on the next line.
  assert.deepEqual(
    callSpecifiers({ text: 'const Lazy = dynamic(', after: "  () => import('c'),\n  () => import('d')" }),
    ['c'],
  )
})

test('a call site on the line beside a declared import does not stand in for it', () => {
  // The marketing call site is gone; the mui call on the adjacent line must
  // not satisfy the marketing group, which is red instead of weighing mui.
  const files = syntheticBuild()
  files[`server/app/${ROUTE}/page_client-reference-manifest.js`] =
    'globalThis.__RSC_MANIFEST={"x":["static/chunks/page.js"]}'
  const [, marketing] = measure(files).groups
  assert.deepEqual(marketing.missing, [
    { from: 'apps/tenant/utils/plugins.client.generated.ts', import: '@aglyn/plugins-marketing' },
  ])
})

// ── the measurement ────────────────────────────────────────────────────────

test('weighs the document plus each declared import, each group counting only what is new', () => {
  const files = syntheticBuild()
  const measured = measure(files)
  const [page, marketing] = measured.groups
  assert.deepEqual(page.chunks, [
    'static/chunks/calls.js',
    'static/chunks/mui.js',
    'static/chunks/page.js',
    'static/chunks/root.js',
  ])
  assert.deepEqual(marketing.chunks, ['static/chunks/marketing.js', 'static/chunks/shared.js'])
  const bytes = (paths) => paths.reduce((sum, path) => sum + wireBytes(Buffer.from(files[path])), 0)
  assert.equal(page.bytes, bytes(page.chunks))
  assert.equal(marketing.bytes, bytes(marketing.chunks))
  assert.deepEqual(page.missing, [])
})

test('reads a loader only from a chunk the page loads, never from another chunk group', () => {
  // `other-group.js` defines loader 101 with `decoy.js` — 50 KB the page never
  // fetches. Reading the build at large let exactly that list win for the real
  // always-on plugin (12 chunks where the page fetches 16).
  const measured = measure(syntheticBuild())
  assert.ok(!measured.groups.some((group) => group.chunks.includes('static/chunks/decoy.js')))
})

test('an import added to an always-on plugin shows up in the every-page group', () => {
  const before = measure(syntheticBuild()).groups[0].bytes
  const after = measure(syntheticBuild({ muiChunks: ['mui.js', 'mui-extra.js'] })).groups[0].bytes
  assert.ok(after > before)
})

// ── the verdict, and its forced reds ───────────────────────────────────────

const budgetOver = (measured, factor = 1) => ({
  groups: measured.groups.map((group) => ({
    name: group.name,
    baselineBytes: group.bytes,
    budgetBytes: Math.floor(group.bytes * factor),
  })),
})

test('GREEN: within budget', () => {
  const measured = measure(syntheticBuild())
  assert.equal(evaluateWireWeight(measured, budgetFor(measured)).ok, true)
})

test('RED: a group grew past its budget', () => {
  const baseline = measure(syntheticBuild())
  const grown = measure(syntheticBuild({ muiChunks: ['mui.js', 'mui-extra.js'] }))
  const verdict = evaluateWireWeight(grown, budgetOver(baseline))
  assert.equal(verdict.ok, false)
  assert.deepEqual(
    verdict.reasons.map((reason) => [reason.kind, reason.group]),
    [['over', 'every published page']],
  )
  assert.match(explainWireVerdict(verdict)[0], /grew past its budget/)
})

test('RED: a declared import that is not in the build, rather than an empty group', () => {
  // The import moved: the line that named it now names something else. A
  // group that silently weighed nothing would pass every ceiling.
  const moved = PLUGINS_SOURCE.replace('@aglyn/plugins-mui', '@aglyn/plugins-mui-renamed')
  const measured = measure(syntheticBuild({ pluginsSource: moved }))
  const verdict = evaluateWireWeight(measured, budgetFor(measure(syntheticBuild())))
  assert.equal(verdict.ok, false)
  assert.ok(
    verdict.reasons.some(
      (reason) => reason.kind === 'missing' && reason.import === '@aglyn/plugins-mui',
    ),
  )
})

test('RED: a group the budget names and the measurement does not', () => {
  const measured = measure(syntheticBuild())
  const budget = budgetFor(measured)
  budget.groups.push({ name: 'a group nobody weighs', baselineBytes: 1, budgetBytes: 1 })
  const verdict = evaluateWireWeight(measured, budget)
  assert.deepEqual(
    verdict.reasons.map((reason) => reason.kind),
    ['unmeasured'],
  )
})

test('a group that got LIGHTER is not red: this pins a ceiling', () => {
  const heavy = measure(syntheticBuild({ muiChunks: ['mui.js', 'mui-extra.js'] }))
  const light = measure(syntheticBuild())
  assert.equal(evaluateWireWeight(light, budgetFor(heavy)).ok, true)
})

test('budgetFor pins each group at its measurement plus the headroom, keeping what it declared', () => {
  const measured = measure(syntheticBuild())
  const previous = { route: ROUTE, groups: GROUPS.map((group) => ({ ...group, why: 'kept' })) }
  const budget = budgetFor(measured, previous)
  assert.equal(budget.route, ROUTE)
  for (const [index, group] of budget.groups.entries()) {
    assert.equal(group.baselineBytes, measured.groups[index].bytes)
    assert.equal(
      group.budgetBytes,
      Math.ceil((measured.groups[index].bytes * WIRE_HEADROOM) / 1024) * 1024,
    )
    assert.equal(group.why, 'kept')
    assert.deepEqual(group.loads, GROUPS[index].loads)
  }
})

// ── the CLI ────────────────────────────────────────────────────────────────

function writeBuild(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

function runCli(args) {
  try {
    return { code: 0, out: String(execFileSync('node', [CLI, ...args], { stdio: 'pipe' })) }
  } catch (error) {
    return { code: error.status, out: String(error.stdout) + String(error.stderr) }
  }
}

test('the CLI refuses to pass with no build to read, and skips only under --if-built', () => {
  const empty = mkdtempSync(join(tmpdir(), 'wire-weight-'))
  try {
    assert.equal(runCli(['--next', empty]).code, 2)
    const skipped = runCli(['--next', empty, '--if-built'])
    assert.equal(skipped.code, 0)
    assert.match(skipped.out, /Skipped/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('the CLI goes red over budget and green within it, on a build on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'wire-weight-'))
  try {
    const next = join(root, '.next')
    writeBuild(next, syntheticBuild())
    const budgetPath = join(root, 'budget.json')
    const measured = measure(syntheticBuild())
    writeFileSync(budgetPath, JSON.stringify(budgetFor(measured, { route: ROUTE, groups: GROUPS })))
    assert.equal(runCli(['--next', next, '--budget', budgetPath]).code, 0)
    writeFileSync(
      budgetPath,
      JSON.stringify({ route: ROUTE, groups: GROUPS.map((group, index) => ({
        ...group,
        baselineBytes: measured.groups[index].bytes,
        budgetBytes: measured.groups[index].bytes - 1,
      })) }),
    )
    const red = runCli(['--next', next, '--budget', budgetPath])
    assert.equal(red.code, 1)
    assert.match(red.out, /grew past its budget/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
