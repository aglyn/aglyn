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

// Fail when a plugin's domain lives outside its plugin (AGL-3080, from AGL-2939).
//
//   npm run check:plugin-domain-in-core
//   npm run check:plugin-domain-in-core -- --json
//   npm run check:plugin-domain-in-core -- --prune     # drop rows that no longer excuse anything
//   node tools/scripts/check-plugin-domain-in-core.mjs --fixture   # the forced-red self-test
//
// docs/PACKAGES.md rule 3: a plugin's code lives only in its own plugin, and
// every tree below a plugin gets generic extension points only. Each package
// is meant to be taken on its own, so a core that names CRM, a renderer that
// names datasets or an app that names a video vendor is a package nobody can
// take without the rest. `check:lib-boundaries` judges the import graph and
// cannot see any of this, because a plugin's model parked in the core is a
// legal edge. Four things erode the rule silently and this guard refuses each:
//
//  1. DOMAIN NAME — a file or a route directory in a guarded tree named for a
//     plugin's domain (`crm-deals.ts`, `app/.../marketplace/`). The name is a
//     proxy, and a cheap one: nobody names a generic seam after one plugin.
//
//  2. VENDOR LITERAL — a named vendor's host, header, model id or SDK outside
//     the adapter that is its home. An AI vendor's literal is refused in every
//     tree, other plugins included; the rest are refused in the guarded trees.
//
//  3. PLUGIN ID — a quoted first-party plugin id in a guarded tree: a switch
//     over plugin ids, a hand-written catalog, a `requires: ['commerce']`.
//     Ids that are also ordinary words (`data`, `email`, `forms`, `logic`,
//     `ai`, `mui`) are not matched; the distinctive ones carry the rule.
//
//  4. PLUGIN IMPORT — a guarded tree importing `@aglyn/plugins-*`, or a
//     relative path into `libs/plugins/`, outside the generated manifests.
//     Apps reach every plugin through the loader manifests and the core
//     registries.
//
// ## The allowlist, and why it may only shrink
//
// `plugin-domain-in-core-allowlist.json` has one row per file that trips a
// rule today: the rules it trips and the `lane` of AGL-3080 that moves it. A
// row with `"lane": "stays"` is a binding argued to be the platform's own and
// carries its argument in `why` — rule 3 of the map asks for exactly that, in
// writing. The guard is red for a finding with no row AND for a row, or one
// rule on a row, that nothing trips any more, so the list cannot outlive what
// it excuses; `--prune` removes those and can never add one. A NEW file is
// refused rather than recorded.
//
// Exit codes: 0 clean · 1 a finding or a stale row · 2 the self-test failed.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const ALLOWLIST = join(ROOT, 'tools/scripts/plugin-domain-in-core-allowlist.json')

/** Every tree that is not a plugin. `libs/plugins/**` is where a domain belongs. */
const GUARDED =
  /^(?:libs\/(?:aglyn|aglyn-node-renderer|aglyn-markdown-editor|besigner|cli|shared|tenant)\/|apps\/(?:console|tenant)\/|cloud\/|tools\/)/

/** The one place a guarded tree may name a plugin package: the generated manifests. */
const MANIFEST = /^apps\/[^/]+\/(?:constants|utils)\/plugins\.[a-z.]*generated\.ts$/

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/
const SPEC = /\.(?:spec|test|e2e)\.(?:[tj]sx?|mjs)$|\/fixtures\//
const GENERATED = /\.generated\.ts$/

/**
 * Rule 1. A domain token opens the file's name, or names a directory on an
 * app's route path. `form` and `contact` are matched because the forms and
 * CRM models are the two widest violations; the handful of generic files that
 * share the word are `stays` rows with their reason.
 */
const DOMAIN_TOKENS =
  'crm|contacts?|marketplace|publisher|campaigns?|datasets?|forms?|bookings?|commerce|outreach|workflows?|wistia|ga4|assist|email-topics?|dynamic-list|list-(?:members|import|assignment)|connect-(?:account|payout)|stripe-account'
const DOMAIN_FILE = new RegExp(`(?:^|/)(${DOMAIN_TOKENS})(?:[-.][^/]*)?\\.(?:tsx?|mjs)$`)
const DOMAIN_DIR = /^apps\/[^/]+\/.*\/(crm|contacts|marketplace|campaigns?|datasets?|forms|bookings|commerce|outreach|workflows)\//

/**
 * Rule 2. `home` is where the literal may live. `everywhere` extends the
 * sweep past the guarded trees, which is the AI rule as AGL-2939 wrote it:
 * no other plugin may grow a model vendor of its own either.
 */
export const VENDOR_LITERALS = [
  { vendor: 'ai', pattern: /api\.anthropic\.com|anthropic-version|\bclaude-[a-z0-9-]+|api\.openai\.com/, home: 'libs/plugins/ai/src/lib/providers/', everywhere: true },
  { vendor: 'ga4', pattern: /googletagmanager\.com|google-analytics\.com|\bgtag\(/ },
  { vendor: 'wistia', pattern: /wistia/i },
  { vendor: 'resend', pattern: /api\.resend\.com|from\s+['"]resend['"]/ },
]

/** Rule 3. First-party ids that are also plain English are left out on purpose. */
const AMBIGUOUS_IDS = new Set(['ai', 'data', 'email', 'forms', 'logic', 'mui'])

const PLUGIN_IMPORT =
  /from\s+['"](@aglyn\/plugins-[a-z-]+)(?:\/[^'"]*)?['"]|import\(\s*['"](@aglyn\/plugins-[a-z-]+)|(?:\.\.\/)+(libs\/plugins\/[a-z-]+)\//
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/

/** A comment that spells a package name is prose, not an import. */
function importsPlugin(text) {
  return text.split('\n').some((line) => !COMMENT_LINE.test(line) && PLUGIN_IMPORT.test(line))
}

export function pluginIdPattern(ids) {
  const distinctive = ids.filter((id) => !AMBIGUOUS_IDS.has(id))
  return distinctive.length ? new RegExp(`['"\`](${distinctive.join('|')})['"\`]`) : null
}

/** The rules a corpus of {path, text} trips: Map<path, string[]>. */
export function findFindings(files, pluginIds) {
  const idPattern = pluginIdPattern(pluginIds)
  const findings = new Map()
  const add = (path, rule) => findings.set(path, [...(findings.get(path) ?? []), rule])
  for (const { path, text } of files) {
    if (!SOURCE.test(path) || SPEC.test(path) || GENERATED.test(path)) continue
    const guarded = GUARDED.test(path)
    // tools/ names hosts and package strings in lint rules and weight budgets;
    // only a domain-named script is evidence there.
    const tools = path.startsWith('tools/')
    if (guarded && (DOMAIN_FILE.test(path) || DOMAIN_DIR.test(path))) add(path, 'domain-name')
    for (const { vendor, pattern, home, everywhere } of VENDOR_LITERALS) {
      if (tools || !(guarded || everywhere)) continue
      if (home && path.startsWith(home)) continue
      if (pattern.test(text)) add(path, `vendor:${vendor}`)
    }
    if (!guarded || tools) continue
    if (idPattern?.test(text)) add(path, 'plugin-id')
    if (!MANIFEST.test(path) && importsPlugin(text)) add(path, 'plugin-import')
  }
  return findings
}

/** What is refused, and what on the list excuses nothing any more. */
export function judge(findings, rows) {
  const allowed = new Map(rows.map((row) => [row.path, new Set(row.rules)]))
  const refused = []
  for (const [path, rules] of findings) {
    for (const rule of rules) if (!allowed.get(path)?.has(rule)) refused.push({ path, rule })
  }
  const stale = []
  for (const row of rows) {
    for (const rule of row.rules) if (!findings.get(row.path)?.includes(rule)) stale.push({ path: row.path, rule })
  }
  const unargued = rows.filter((row) => row.lane === 'stays' && !row.why).map((row) => row.path)
  return { refused, stale, unargued }
}

export function trackedFiles(root = ROOT) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
}

export function loadCorpus(root = ROOT) {
  const out = []
  for (const path of trackedFiles(root)) {
    if (!SOURCE.test(path)) continue
    try {
      out.push({ path, text: readFileSync(join(root, path), 'utf8') })
    } catch {
      // Unreadable — not source that names a domain.
    }
  }
  return out
}

export function firstPartyPluginIds(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'plugins.config.json'), 'utf8')).plugins.map((plugin) => plugin.id)
}

function selfTest() {
  // The forced-red fixture: one file per rule, the homes and exemptions beside
  // them, and a list with a stale rule and an unargued `stays` — each must be
  // reported, and nothing else may be.
  const ids = ['crm', 'commerce', 'data', 'mui']
  const corpus = [
    { path: 'libs/aglyn/src/lib/app-utils/crm-deals.ts', text: 'export const stages = []\n' },
    { path: 'apps/console/app/api/marketplace/listings/route.ts', text: 'export const GET = () => null\n' },
    { path: 'libs/plugins/crm/src/lib/model/crm-deals.ts', text: 'export const stages = []\n' },
    { path: 'libs/aglyn/src/lib/app-utils/thing.ts', text: "const model = 'claude-sonnet-5'\n" },
    { path: 'libs/plugins/crm/src/lib/summary.ts', text: "fetch('https://api.anthropic.com/v1/messages')\n" },
    { path: 'libs/plugins/ai/src/lib/providers/anthropic.ts', text: "fetch('https://api.anthropic.com/v1/messages')\n" },
    { path: 'libs/tenant/runtime/src/lib/video.ts', text: "const host = 'fast.wistia.net'\n" },
    { path: 'libs/plugins/mui/src/lib/video.ts', text: "const host = 'fast.wistia.net'\n" },
    { path: 'libs/aglyn/src/lib/plugin-manager/catalog.ts', text: "const requires = ['commerce']\n" },
    { path: 'libs/aglyn/src/lib/plugin-manager/words.ts', text: "const kind = 'data'\n" },
    { path: 'apps/console/app/(app)/page.tsx', text: "import { x } from '@aglyn/plugins-ai'\n" },
    { path: 'apps/console/constants/plugins.client.generated.ts', text: "import('@aglyn/plugins-ai')\n" },
    { path: 'libs/aglyn/src/lib/app-utils/crm.spec.ts', text: "'claude-haiku-4-5' 'commerce'\n" },
    { path: 'tools/lint-rules/no-remote-image.mjs', text: "const hosts = ['googletagmanager.com']\n" },
    { path: 'tools/scripts/lib/crm-fixtures.mjs', text: 'export const rows = []\n' },
  ]
  const findings = findFindings(corpus, ids)
  const ok = (label, condition) => {
    if (!condition) {
      console.error(`self-test FAILED: ${label}`)
      process.exit(2)
    }
  }
  const has = (path, rule) => findings.get(path)?.includes(rule) === true
  ok('a domain-named core file is reported', has('libs/aglyn/src/lib/app-utils/crm-deals.ts', 'domain-name'))
  ok('a domain-named route directory is reported', has('apps/console/app/api/marketplace/listings/route.ts', 'domain-name'))
  ok('the same name inside its plugin is not', !findings.has('libs/plugins/crm/src/lib/model/crm-deals.ts'))
  ok('a core model literal is reported', has('libs/aglyn/src/lib/app-utils/thing.ts', 'vendor:ai'))
  ok('an AI vendor literal in another plugin is reported', has('libs/plugins/crm/src/lib/summary.ts', 'vendor:ai'))
  ok('the adapter is not reported', !findings.has('libs/plugins/ai/src/lib/providers/anthropic.ts'))
  ok('a video vendor in the runtime is reported', has('libs/tenant/runtime/src/lib/video.ts', 'vendor:wistia'))
  ok('a video vendor inside a plugin is not', !findings.has('libs/plugins/mui/src/lib/video.ts'))
  ok('a plugin id in core is reported', has('libs/aglyn/src/lib/plugin-manager/catalog.ts', 'plugin-id'))
  ok('an id that is a plain word is not', !findings.has('libs/aglyn/src/lib/plugin-manager/words.ts'))
  ok('a page importing a plugin is reported', has('apps/console/app/(app)/page.tsx', 'plugin-import'))
  ok('the generated manifest is not reported', !findings.has('apps/console/constants/plugins.client.generated.ts'))
  ok('a spec is not reported', !findings.has('libs/aglyn/src/lib/app-utils/crm.spec.ts'))
  ok('a lint rule naming a host is not reported', !findings.has('tools/lint-rules/no-remote-image.mjs'))
  ok('a domain-named tools script is reported', has('tools/scripts/lib/crm-fixtures.mjs', 'domain-name'))

  const rows = [
    { path: 'libs/aglyn/src/lib/app-utils/crm-deals.ts', rules: ['domain-name', 'plugin-id'], lane: 'crm' },
    { path: 'libs/aglyn/src/lib/app-utils/gone.ts', rules: ['domain-name'], lane: 'crm' },
    { path: 'libs/tenant/runtime/src/lib/video.ts', rules: ['vendor:wistia'], lane: 'stays' },
  ]
  const { refused, stale, unargued } = judge(findings, rows)
  ok('an allowed finding is not refused', !refused.some((v) => v.path.endsWith('crm-deals.ts')))
  ok('a finding with no row is refused', refused.some((v) => v.path.endsWith('thing.ts') && v.rule === 'vendor:ai'))
  ok('a rule a row no longer trips is stale', stale.some((v) => v.path.endsWith('crm-deals.ts') && v.rule === 'plugin-id'))
  ok('a row whose file is gone is stale', stale.some((v) => v.path.endsWith('gone.ts')))
  ok('a `stays` row with no argument is reported', unargued.length === 1 && unargued[0].endsWith('video.ts'))
  console.log('self-test ok')
}

function prune(list, stale) {
  const gone = new Set(stale.map(({ path, rule }) => `${path}\n${rule}`))
  const files = list.files
    .map((row) => ({ ...row, rules: row.rules.filter((rule) => !gone.has(`${row.path}\n${rule}`)) }))
    .filter((row) => row.rules.length)
  writeFileSync(ALLOWLIST, `${JSON.stringify({ ...list, files }, null, 2)}\n`)
  return list.files.length - files.length
}

function main(argv) {
  if (argv.includes('--fixture')) return selfTest()

  const list = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
  const corpus = loadCorpus(ROOT)
  const findings = findFindings(corpus, firstPartyPluginIds(ROOT))
  const { refused, stale, unargued } = judge(findings, list.files)

  if (argv.includes('--prune')) {
    const rows = prune(list, stale)
    console.log(`check:plugin-domain-in-core: pruned ${stale.length} stale rule(s), ${rows} whole row(s)`)
    return
  }
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ refused, stale, unargued }))
    process.exitCode = refused.length || stale.length || unargued.length ? 1 : 0
    return
  }

  for (const v of refused) console.error(`  REFUSED   ${v.path}: ${v.rule} — a plugin's domain lives in its plugin, behind a generic seam (docs/PACKAGES.md rule 3)`)
  for (const v of stale) console.error(`  STALE ROW ${v.path}: ${v.rule} no longer trips; run with --prune`)
  for (const path of unargued) console.error(`  UNARGUED  ${path}: a "stays" row carries its argument in "why"`)
  if (refused.length || stale.length || unargued.length) {
    console.error(
      `\ncheck:plugin-domain-in-core: ${refused.length} finding(s) outside the allowlist, ` +
        `${stale.length} stale rule(s), ${unargued.length} unargued "stays" row(s).`,
    )
    process.exitCode = 1
    return
  }
  const moving = list.files.filter((row) => row.lane !== 'stays').length
  console.log(
    `check:plugin-domain-in-core: clean (${corpus.length} source files; ${moving} file(s) still to move, ` +
      `${list.files.length - moving} argued to stay)`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
