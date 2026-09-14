/**
 * @license
 * Copyright 2026 Aglyn LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Fail when AI lives outside its plugin (AGL-2939).
//
//   npm run check:ai-in-core
//   npm run check:ai-in-core -- --json
//   node tools/scripts/check-ai-in-core.mjs --fixture   # the forced-red self-test
//
// The owner directive of 2026-09-14: Aglyn AI is a plugin, `libs/plugins/ai`,
// and provider-generic. Two things would erode that silently and this guard
// refuses both:
//
//  1. A VENDOR literal outside the plugin's provider adapters — an API host,
//     a vendor header, a model id. The runtime, the gate, the jobs and the
//     meter import the provider contract and nothing else, and the catalog
//     and the adapters are the only places a model id is written. A literal
//     anywhere else is a door that has grown a vendor dependency of its own.
//
//  2. An app importing `@aglyn/plugins-ai` outside the generated manifests.
//     Apps reach every plugin through the loader manifests and the core
//     registries; a static import from a page or a route is the thing the
//     plugin boundary exists to prevent, and `@nx/enforce-module-boundaries`
//     does not see a relative path into `libs/plugins/ai`.
//
// ## The allowlist, and why it may only shrink
//
// `ai-in-core-allowlist.json` names the files that still carry a vendor
// literal while the last of the AI code moves (the usage meter's rate table
// waits for AGL-2928's rollups to settle). Each row names the file and the
// reason; a row for a file that no longer trips the guard is itself a red,
// so the list cannot outlive what it excuses, and a NEW file is refused
// rather than recorded.
//
// Exit codes: 0 clean · 1 a literal or an import is where it may not be.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ALLOWLIST = join(ROOT, 'tools/scripts/ai-in-core-allowlist.json')

/** Where a vendor literal MAY live: the adapters and the catalog. */
const PROVIDER_DIR = 'libs/plugins/ai/src/lib/providers/'

/** The one place an app may name the plugin: the generated manifests. */
const MANIFEST = /^apps\/[^/]+\/(?:constants|utils)\/plugins\.[a-z.]*generated\.ts$/

/**
 * A vendor's host, its versioning header, and its model-id family. Extend
 * this when a second adapter's vendor has literals of its own; the point is
 * the shape, not the one vendor.
 */
export const VENDOR_LITERALS = [
  { name: 'api host', pattern: /api\.anthropic\.com/ },
  { name: 'vendor header', pattern: /anthropic-version/ },
  { name: 'model id', pattern: /\bclaude-[a-z0-9-]+/ },
  { name: 'api host', pattern: /api\.openai\.com/ },
]

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/
const SPEC = /\.(?:spec|test)\.[tj]sx?$|\/fixtures\//
const DOC = /\.(?:md|mdx)$/

export function trackedFiles(root = ROOT) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
}

/** Which files a corpus of {path, text} violates, and how. */
export function findViolations(files, allowed = new Set()) {
  const literals = []
  const imports = []
  for (const { path, text } of files) {
    if (!SOURCE.test(path) || SPEC.test(path) || DOC.test(path)) continue
    if (path.startsWith(PROVIDER_DIR)) continue
    if (/\.generated\.ts$/.test(path)) continue
    if (path.startsWith('tools/')) continue
    for (const { name, pattern } of VENDOR_LITERALS) {
      const match = pattern.exec(text)
      if (!match) continue
      if (allowed.has(path)) continue
      literals.push({ path, kind: name, literal: match[0] })
      break
    }
    if (/^apps\//.test(path) && !MANIFEST.test(path)) {
      const hit = /from\s+['"](@aglyn\/plugins-ai(?:\/[^'"]*)?)['"]|import\(\s*['"]@aglyn\/plugins-ai|(?:\.\.\/)+libs\/plugins\/ai\//.exec(text)
      if (hit) imports.push({ path, specifier: hit[1] ?? hit[0] })
    }
  }
  return { literals, imports }
}

/** A row that no longer excuses anything is a red of its own. */
export function staleAllowlist(files, allowed) {
  const byPath = new Map(files.map((file) => [file.path, file.text]))
  return [...allowed].filter((path) => {
    const text = byPath.get(path)
    return text === undefined || !VENDOR_LITERALS.some(({ pattern }) => pattern.test(text))
  })
}

function readAllowlist() {
  const raw = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
  return new Set((raw.files ?? []).map((row) => row.path))
}

function loadCorpus(root) {
  const out = []
  for (const path of trackedFiles(root)) {
    if (!SOURCE.test(path)) continue
    try {
      out.push({ path, text: readFileSync(join(root, path), 'utf8') })
    } catch {
      // Unreadable — not source that names a vendor.
    }
  }
  return out
}

function selfTest() {
  // The forced-red fixture: a page that imports the plugin statically, a
  // core module that names a model id, a stale allowlist row — each must be
  // reported, and a clean corpus must not be.
  const corpus = [
    { path: 'apps/console/app/(app)/page.tsx', text: "import { x } from '@aglyn/plugins-ai'\n" },
    { path: 'libs/aglyn/src/lib/app-utils/thing.ts', text: "const model = 'claude-sonnet-5'\n" },
    { path: 'libs/plugins/ai/src/lib/providers/anthropic.ts', text: "fetch('https://api.anthropic.com/v1/messages')\n" },
    { path: 'apps/console/constants/plugins.client.generated.ts', text: "import('@aglyn/plugins-ai')\n" },
    { path: 'libs/plugins/ai/src/lib/runtime/thing.spec.ts', text: "'claude-haiku-4-5'\n" },
    { path: 'libs/plugins/ai/src/lib/jobs/text.ts', text: "import { aiModelForStep } from '../providers/routing'\n" },
  ]
  const { literals, imports } = findViolations(corpus, new Set())
  const ok = (label, condition) => {
    if (!condition) {
      console.error(`self-test FAILED: ${label}`)
      process.exit(2)
    }
  }
  ok('a core model literal is reported', literals.some((v) => v.path.endsWith('thing.ts') && v.kind === 'model id'))
  ok('the adapter is not reported', !literals.some((v) => v.path.includes('/providers/')))
  ok('a spec is not reported', !literals.some((v) => v.path.endsWith('.spec.ts')))
  ok('a page importing the plugin is reported', imports.some((v) => v.path.endsWith('page.tsx')))
  ok('the generated manifest is not reported', !imports.some((v) => v.path.includes('.generated.ts')))
  ok('an allowed file is not reported', findViolations(corpus, new Set(['libs/aglyn/src/lib/app-utils/thing.ts'])).literals.length === 0)
  ok('a stale allowlist row is reported', staleAllowlist(corpus, new Set(['libs/plugins/ai/src/lib/jobs/text.ts'])).length === 1)
  console.log('self-test ok')
}

const argv = process.argv.slice(2)
if (argv.includes('--fixture')) {
  selfTest()
  process.exit(0)
}

const corpus = loadCorpus(ROOT)
const allowed = readAllowlist()
const { literals, imports } = findViolations(corpus, allowed)
const stale = staleAllowlist(corpus, allowed)

if (argv.includes('--json')) {
  process.stdout.write(JSON.stringify({ literals, imports, stale }))
  process.exit(literals.length || imports.length || stale.length ? 1 : 0)
}

for (const v of literals) console.error(`  VENDOR LITERAL  ${v.path}: ${v.kind} "${v.literal}" — belongs in ${PROVIDER_DIR}`)
for (const v of imports) console.error(`  APP IMPORT      ${v.path}: ${v.specifier} — apps reach a plugin only through the generated manifests`)
for (const path of stale) console.error(`  STALE ALLOWLIST ${path}: names no vendor literal any more; remove its row`)

if (literals.length || imports.length || stale.length) {
  console.error(
    `\ncheck:ai-in-core: ${literals.length} vendor literal(s) outside the AI plugin's providers, ` +
      `${imports.length} app import(s) of the plugin, ${stale.length} stale allowlist row(s).`,
  )
  process.exit(1)
}
console.log(`check:ai-in-core: clean (${corpus.length} source files, ${allowed.size} allowed while the move completes)`)
