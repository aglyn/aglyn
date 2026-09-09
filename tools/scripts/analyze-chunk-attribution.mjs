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
 * What is actually inside a built route's JavaScript, and what is in there
 * twice (AGL-2682).
 *
 * ```
 * npx nx build tenant --configuration=production
 * npm run analyze:chunks
 * npm run analyze:chunks -- --top 30
 * npm run analyze:chunks -- --next dist/apps/console/.next --route '(app)/[orgSlug]'
 * npm run analyze:chunks -- --json > before.json     # then rebuild, and:
 * npm run analyze:chunks -- --json --against before.json
 * ```
 *
 * `--against` is the whole point of the script. A single report says the page
 * carries `@mui/material` in eleven chunks; only two reports either side of a
 * change say whether anything you did about it worked, and in which units.
 * It compares package sets, so "60 packages left, none arrived" is a sentence
 * the tool says rather than one a person assembles from two listings.
 *
 * The measurement itself, and why source maps are the right instrument for a
 * Turbopack build when the module registry and a grep are both not, is in
 * `lib/chunk-attribution.mjs`. This file is the route resolution, the gzip,
 * and the report.
 *
 * ⚠️ This reads BUILD OUTPUT. It cannot run in CI as a gate the way
 * `check:tenant-page-weight` does, because it needs a production build first —
 * and that is the trade that makes it worth having: it is the only instrument
 * here that measures what the chunker did rather than what the import graph
 * implies.
 *
 * Exit codes: 0 reported · 1 no build found, or the route named no chunks.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { attributeChunk, summarize } from './lib/chunk-attribution.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
// `resolve`, not `join`: an absolute --next or --against (a build kept aside
// under /tmp while you rebuild) has to survive being handed a repo root.
const NEXT_DIR = resolve(REPO_ROOT, flag('--next', 'dist/apps/tenant/.next'))
/**
 * The published page. Every customer site is served by this one route.
 *
 * The `[scheme]` segment is the visitor's resolved light/dark, spent as a path
 * so the page stays cacheable (AGL-2708). It splits the CACHE, not the client
 * graph: both schemes are the same build output, so weighing either one weighs
 * the page.
 */
const ROUTE = flag('--route', '[host]/[scheme]/[[...slug]]')
const TOP = Number(flag('--top', '15'))
const asJson = args.includes('--json')
const AGAINST = flag('--against', null)

const die = (message) => {
  console.error(message)
  process.exit(1)
}

if (!existsSync(join(NEXT_DIR, 'build-manifest.json')))
  die(
    `No build at ${NEXT_DIR}. Run \`npx nx build tenant --configuration=production\` first.`,
  )

/**
 * The chunks a visitor to this route downloads EAGERLY.
 *
 * Two sources, because Turbopack splits the answer in two: `rootMainFiles` is
 * the framework and app shell every route shares, and the route's own
 * client-reference manifest names a chunk for each `'use client'` boundary the
 * page renders. Scraped rather than imported — the manifest is a JS file that
 * assigns a global, so requiring it would mean standing up its expected host.
 *
 * ⚠️ NOT the whole page. Anything behind a dynamic `import()` — the plugin
 * bundles, most of all — arrives later and is invisible here, which is why a
 * live Lighthouse run counts more scripts than this does. Both numbers are
 * right; they answer different questions.
 */
function chunkFilesFor(route) {
  const manifest = JSON.parse(
    readFileSync(join(NEXT_DIR, 'build-manifest.json'), 'utf8'),
  )
  const files = new Set(manifest.rootMainFiles ?? [])
  const reference = join(
    NEXT_DIR,
    'server',
    'app',
    route,
    'page_client-reference-manifest.js',
  )
  if (!existsSync(reference))
    die(`No client-reference manifest for route ${route} at ${reference}`)
  const source = readFileSync(reference, 'utf8')
  for (const match of source.matchAll(/static\/chunks\/[A-Za-z0-9_\-.]+\.js/g))
    files.add(match[0])
  return [...files]
}

const perChunk = {}
let raw = 0
let gzip = 0
let unattributed = 0
let mapless = 0
for (const file of chunkFilesFor(ROUTE)) {
  const path = join(NEXT_DIR, file)
  if (!existsSync(path)) continue
  const code = readFileSync(path, 'utf8')
  raw += code.length
  gzip += gzipSync(code, { level: 9 }).length
  const marker = code.match(/\/\/# sourceMappingURL=(\S+)/)
  const mapPath = marker && join(path, '..', marker[1])
  if (!mapPath || !existsSync(mapPath)) {
    mapless += code.length
    continue
  }
  const attributed = attributeChunk(
    code,
    JSON.parse(readFileSync(mapPath, 'utf8')),
  )
  perChunk[file.split('/').pop()] = attributed.bytes
  unattributed += attributed.unattributed
}

const chunks = Object.keys(perChunk).length
if (!chunks) die(`Route ${ROUTE} resolved to no mapped chunks.`)

const report = summarize(perChunk)
const packageNames = report.packages.map((one) => one.name).filter((n) => n !== '(first-party)')
const result = {
  route: ROUTE,
  chunks,
  raw,
  gzip,
  mapless,
  unattributed,
  packageCount: packageNames.length,
  packages: packageNames,
  redundantBytes: report.redundantBytes,
  duplicateModules: report.duplicates.length,
  topPackages: report.packages.slice(0, TOP),
  topDuplicates: report.duplicates.slice(0, TOP),
}

if (asJson && !AGAINST) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const strip = (source) =>
  source.replace(/^.*?:\/\/\/\[project\]\//, '').replace(/^node_modules\//, '')

console.log(`route ${ROUTE} — ${chunks} eager chunk(s)`)
console.log(`  raw ${kb(raw)} · gzip ${kb(gzip)} · ${packageNames.length} package(s)`)
console.log(
  `  ${report.duplicates.length} module(s) emitted more than once, ` +
    `${kb(report.redundantBytes)} raw of it redundant`,
)
if (mapless) console.log(`  ⚠️ ${kb(mapless)} in chunks with no source map — not attributed`)
console.log('')

console.log(`  WEIGHT   top ${TOP} by emitted bytes`)
for (const one of report.packages.slice(0, TOP))
  console.log(
    `    ${kb(one.bytes).padStart(9)}  ${one.name}` +
      (one.redundant ? `  (${kb(one.redundant)} redundant)` : ''),
  )
console.log('')

console.log(`  DUPLICATE   top ${TOP} by redundant bytes`)
for (const one of report.duplicates.slice(0, TOP))
  console.log(
    `    ${kb(one.redundant).padStart(9)}  ×${one.copies}  ${strip(one.source)}`,
  )

if (AGAINST) {
  const before = JSON.parse(readFileSync(resolve(REPO_ROOT, AGAINST), 'utf8'))
  const removed = before.packages.filter((p) => !result.packages.includes(p))
  const added = result.packages.filter((p) => !before.packages.includes(p))
  const delta = (now, then, unit = kb) =>
    `${then === undefined ? '?' : unit(then)} -> ${unit(now)} (${now - then >= 0 ? '+' : ''}${unit(now - then)})`
  console.log('')
  console.log(`  AGAINST  ${AGAINST}`)
  console.log(`    chunks     ${before.chunks} -> ${result.chunks}`)
  console.log(`    raw        ${delta(result.raw, before.raw)}`)
  console.log(`    gzip       ${delta(result.gzip, before.gzip)}`)
  console.log(
    `    packages   ${before.packageCount} -> ${result.packageCount}` +
      ` (${removed.length} removed, ${added.length} added)`,
  )
  console.log(`    redundant  ${delta(result.redundantBytes, before.redundantBytes)}`)
  if (removed.length) console.log(`    REMOVED    ${removed.join(' ')}`)
  if (added.length) console.log(`    ADDED      ${added.join(' ')}`)
}
