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
// The package map as rules (AGL-2941). `docs/PACKAGES.md` is the map in
// prose; this module is the same map as data, read by three consumers:
//
//  - `eslint.config.mjs` takes `DEP_CONSTRAINTS` for
//    `@nx/enforce-module-boundaries`, and `lintOverridesFor` turns the
//    allowlist into per-project `allow` overrides so a known edge lints
//    green while it is being worked off.
//  - `check-lib-boundaries.mjs` evaluates the SAME constraints over the Nx
//    project graph, so an edge that reaches `main` through a disabled line or
//    a nested config is still a red at the guard tier.
//  - `release-prepare.mjs` writes the one version into every lib.
//
// There is deliberately no second dependency analyzer here: the graph comes
// from `nx graph --file`, and the evaluator is the rule's own semantics — a
// constraint whose `sourceTag` the source carries must be satisfied by the
// target's tags, every matching constraint, no exceptions.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative, sep } from 'node:path'

/**
 * The dependency rules, one entry per source tag. Every project carries a
 * `scope:` tag naming the package it will publish as and a `type:` tag naming
 * its kind; the older `scope:lib`/`scope:aglyn`/`aglyn:*` tags stay because
 * their rules still hold and nothing is served by rewriting them.
 *
 * Read each rule as "a project tagged X may only import projects tagged one
 * of Y". A source with several tags must satisfy every rule that names one.
 */
export const DEP_CONSTRAINTS = Object.freeze([
  {
    // Apps never import feature plugins statically (AGL-417/419): plugins
    // reach the apps ONLY through the generated loader manifests
    // (plugins.*.generated.ts, file-scoped disable) and the core
    // plugin-manager registries (widgets, providers, site runtimes, page
    // hooks, API dispatch).
    sourceTag: 'scope:app',
    notDependOnLibsWithTags: ['aglyn:addons', 'scope:plugin'],
  },
  {
    sourceTag: 'scope:lib',
    onlyDependOnLibsWithTags: ['scope:lib'],
  },
  {
    sourceTag: 'scope:data',
    onlyDependOnLibsWithTags: ['scope:data', 'scope:util'],
  },
  {
    sourceTag: 'scope:feature',
    onlyDependOnLibsWithTags: ['scope:data', 'scope:feature', 'scope:ui', 'scope:util'],
  },
  {
    sourceTag: 'scope:ui',
    onlyDependOnLibsWithTags: ['scope:data', 'scope:ui', 'scope:util'],
  },
  {
    sourceTag: 'scope:util',
    onlyDependOnLibsWithTags: ['scope:util', 'scope:data'],
  },
  {
    // Feature plugins (AGL-409) carry `aglyn:addons` and `scope:plugin` and
    // NOT `scope:lib`, so as a dependency TARGET no core scope's list reaches
    // them: core libs cannot import a plugin, keeping the app runnable with
    // any plugin absent. The `scope:plugin` rule further down is the one
    // that refuses plugin → plugin.
    sourceTag: 'aglyn:addons',
    onlyDependOnLibsWithTags: [
      'aglyn:addons',
      'aglyn:framework',
      'aglyn:renderer',
      'scope:aglyn',
      'scope:shared',
      'scope:ui',
      'scope:util',
      'scope:data',
      'scope:feature',
      'scope:lib',
    ],
  },
  {
    sourceTag: 'scope:aglyn',
    onlyDependOnLibsWithTags: ['scope:aglyn', 'scope:shared'],
  },
  {
    sourceTag: 'aglyn:framework',
    onlyDependOnLibsWithTags: ['aglyn:framework', 'scope:shared'],
  },
  {
    sourceTag: 'aglyn:renderer',
    onlyDependOnLibsWithTags: ['aglyn:framework', 'scope:shared'],
  },
  // ── The package map (AGL-2941). One rule per published scope, bottom-up. ──
  {
    // `libs/shared/**`: generic, framework-free of Aglyn's own model. It is
    // the floor every other package stands on, so it stands on nothing.
    sourceTag: 'scope:shared',
    onlyDependOnLibsWithTags: ['scope:shared'],
  },
  {
    // `@aglyn/aglyn` and its editors: the platform model, no rendering, no
    // designer, no tenancy, no plugin.
    sourceTag: 'scope:core',
    onlyDependOnLibsWithTags: ['scope:core', 'scope:shared'],
  },
  {
    // `@aglyn/aglyn-node-renderer`: a node tree to React, on the core only.
    sourceTag: 'scope:renderer',
    onlyDependOnLibsWithTags: ['scope:renderer', 'scope:core', 'scope:shared'],
  },
  {
    // `@aglyn/besigner`: the designer's LOGIC, publishable without its UI so
    // a consumer can build their own editor on it.
    sourceTag: 'scope:besigner',
    onlyDependOnLibsWithTags: ['scope:besigner', 'scope:core', 'scope:shared'],
  },
  {
    // `@aglyn/besigner-ui`: the designer's React surface, on the logic.
    sourceTag: 'scope:besigner-ui',
    onlyDependOnLibsWithTags: [
      'scope:besigner-ui',
      'scope:besigner',
      'scope:renderer',
      'scope:core',
      'scope:shared',
    ],
  },
  {
    // `@aglyn/tenant-*` and the tenant app: the runtime that serves a
    // published site. It reaches plugins only through the loader manifests.
    sourceTag: 'scope:tenant',
    onlyDependOnLibsWithTags: ['scope:tenant', 'scope:renderer', 'scope:core', 'scope:shared'],
  },
  {
    // The console app: everything below it, plugins only dynamically.
    sourceTag: 'scope:console',
    onlyDependOnLibsWithTags: [
      'scope:console',
      'scope:tenant',
      'scope:besigner-ui',
      'scope:besigner',
      'scope:renderer',
      'scope:core',
      'scope:shared',
    ],
  },
  {
    // A plugin stands on the platform and NEVER on another plugin: what two
    // plugins share goes through a core plugin-manager seam or down into a
    // shared lib. Today's plugin → plugin edges are the allowlist.
    sourceTag: 'scope:plugin',
    onlyDependOnLibsWithTags: ['scope:tenant', 'scope:renderer', 'scope:besigner', 'scope:core', 'scope:shared'],
  },
  {
    // The native apps and libraries (AGL-3651): Swift and Kotlin projects,
    // which import no TypeScript project at all. What they share with the
    // TypeScript side is generated from the pure modules, and
    // `check:mobile-isolation` holds the file level both ways.
    sourceTag: 'scope:mobile',
    onlyDependOnLibsWithTags: ['scope:mobile'],
  },
  {
    sourceTag: 'scope:cli',
    onlyDependOnLibsWithTags: ['scope:cli', 'scope:core', 'scope:shared'],
  },
  // The `type:` axis mirrors the `scope:data|ui|util|feature` rules above so
  // a project's kind is stated once in the vocabulary the map uses.
  {
    sourceTag: 'type:data',
    onlyDependOnLibsWithTags: ['type:data', 'type:util'],
  },
  {
    sourceTag: 'type:util',
    onlyDependOnLibsWithTags: ['type:util', 'type:data'],
  },
  {
    sourceTag: 'type:ui',
    onlyDependOnLibsWithTags: ['type:ui', 'type:data', 'type:util'],
  },
  {
    sourceTag: 'type:feature',
    onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data', 'type:util'],
  },
  {
    sourceTag: '*',
    onlyDependOnLibsWithTags: ['*'],
  },
])

/**
 * Libs whose `version` is NOT the repo's: `@aglyn/cli` was on the registry at
 * its own number before the map existed, and a registry never takes a version
 * back. Everything else carries the root `package.json` version, written by
 * `release:prepare`.
 */
export const INDEPENDENTLY_VERSIONED = Object.freeze(new Set(['cli']))

/**
 * The packages a lib must declare as peers rather than carry: a consumer has
 * exactly one React, one Next, one MUI and one Firebase, and a lib that
 * bundled its own would duplicate them.
 */
const PEER_FAMILY = /^(react-dom|react|next|firebase-admin|firebase|@mui\/[a-z-]+)(?:\/|$)/

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

function parseVersion(version) {
  const match = VERSION.exec(String(version ?? '').trim())
  if (!match) return null
  return { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] }
}

/**
 * Semver precedence of two plain versions: negative when `a` sorts first.
 * Only `X.Y.Z` and `X.Y.Z-pre.release` are read, which is every version this
 * repo publishes or pins.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < 3; i += 1) if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i]
  // A release sorts after every prerelease of the same number.
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length
  const numeric = (part) => /^\d+$/.test(part)
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    if (numeric(x) && numeric(y)) return Number(x) - Number(y)
    if (numeric(x) !== numeric(y)) return numeric(x) ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

/**
 * Does the caret range `range` admit `version`, the way npm reads one?
 *
 * Anything that is not a caret over a plain version is answered `false`; the
 * callers name only caret ranges, and say so when one is not.
 */
export function caretAdmits(range, version) {
  const floorText = /^\^(\S+)$/.exec(String(range ?? '').trim())?.[1]
  const floor = parseVersion(floorText)
  const candidate = parseVersion(version)
  if (!floor || !candidate) return false
  if (compareVersions(version, floorText) < 0) return false
  // npm lets a prerelease through a range only when the range itself names a
  // prerelease of the very same major.minor.patch.
  const sameCore = floor.core.every((part, i) => part === candidate.core[i])
  if (candidate.pre.length && !(floor.pre.length && sameCore)) return false
  const [major, minor, patch] = floor.core
  const [cMajor, cMinor, cPatch] = candidate.core
  if (major > 0) return cMajor === major
  if (minor > 0) return cMajor === 0 && cMinor === minor
  return cMajor === 0 && cMinor === 0 && cPatch === patch
}

/**
 * What is wrong with a lib's peer ranges, as sentences (AGL-3201).
 *
 * A peer is the range the CONSUMER's copy of a framework must fall in, so it
 * fails in their install, never in this repo, where the root's single copy
 * satisfies everything. Two shapes break it:
 *
 * - An EXACT version. Every lib that named `next` pinned `16.3.3`, the day
 *   npm's `next` became 16.3.8 a plain `npm install @aglyn/besigner-ui next`
 *   could not resolve: npm searched for eighteen minutes and failed.
 * - A range that does not admit the version the workspace runs, which is a
 *   promise about a release nobody here has built against.
 *
 * Our own packages are skipped: they are pinned at the repo version as
 * dependencies, and a peer between them is a different rule's business.
 */
export function peerRangeFindings(peerDependencies, { rootRanges = {}, workspacePackages = new Set() } = {}) {
  const findings = []
  for (const [name, range] of Object.entries(peerDependencies ?? {})) {
    if (workspacePackages.has(name)) continue
    if (VERSION.test(String(range).trim())) {
      findings.push(`peerDependencies["${name}"] is pinned to "${range}", so a consumer on any other release of ${name} cannot install this package. Name a range: "^${range}"`)
      continue
    }
    const running = String(rootRanges[name] ?? '').replace(/^[\^~=]/, '')
    const readable = range.startsWith('^') && parseVersion(range.slice(1)) && parseVersion(running)
    if (readable && !caretAdmits(range, running)) {
      findings.push(`peerDependencies["${name}"] is "${range}", which does not admit ${running}, the version the workspace runs`)
    }
  }
  return findings
}

const SOURCE_FILE = /\.(?:ts|tsx|mts|js|jsx|mjs)$/
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/
const IMPORT_SOURCE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

/**
 * Every workspace project with the facts the map states about it, read from
 * `tsconfig.base.json` (the alias is the intended npm name) and each
 * `project.json` (name, root, tags).
 *
 * @param {string} repoRoot
 * @returns {Array<{name: string, root: string, alias: string | null, deepAlias: boolean, tags: string[], projectType: string}>}
 */
/**
 * True for a library that ships as an npm package. The native libraries
 * (`libs/native/*`) are Gradle and SwiftPM modules: Nx runs their builds, but
 * they have no package.json and no `@aglyn` alias (docs/PACKAGES.md, "Native").
 */
export function isNpmLibrary(project) {
  return project.projectType === 'library' && !project.root.startsWith('libs/native/')
}

export function readPackageMap(repoRoot) {
  const paths = JSON.parse(readFileSync(join(repoRoot, 'tsconfig.base.json'), 'utf8')).compilerOptions.paths ?? {}
  const aliasByRoot = new Map()
  const deepByRoot = new Set()
  for (const [alias, [target]] of Object.entries(paths)) {
    if (!target || !alias.startsWith('@aglyn/')) continue
    const root = target.replace(/^\.\//, '').replace(/\/src\/.*$/, '')
    if (alias.endsWith('/*')) deepByRoot.add(root)
    else if (alias.split('/').length === 2) aliasByRoot.set(root, alias)
  }
  const projects = []
  for (const file of walk(join(repoRoot, 'libs'), (name) => name === 'project.json')) {
    projects.push(projectRow(repoRoot, file, aliasByRoot, deepByRoot))
  }
  for (const file of walk(join(repoRoot, 'apps'), (name) => name === 'project.json', 2)) {
    projects.push(projectRow(repoRoot, file, aliasByRoot, deepByRoot))
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name))
}

function projectRow(repoRoot, file, aliasByRoot, deepByRoot) {
  const project = JSON.parse(readFileSync(file, 'utf8'))
  const root = relative(repoRoot, join(file, '..')).split(sep).join('/')
  return {
    name: project.name,
    root,
    alias: aliasByRoot.get(root) ?? null,
    deepAlias: deepByRoot.has(root),
    tags: project.tags ?? [],
    projectType: project.projectType ?? 'library',
  }
}

/** Files under `dir` whose basename `keep` accepts, `node_modules` skipped. */
function walk(dir, keep, maxDepth = Infinity, depth = 0) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth < maxDepth) out.push(...walk(path, keep, maxDepth, depth + 1))
    } else if (keep(entry.name)) out.push(path)
  }
  return out
}

/**
 * The static workspace edges of an `nx graph --file` document that break a
 * constraint. Dynamic edges are the sanctioned seam (the loader manifests)
 * and implicit ones are e2e wiring, so neither is judged here; the lint rule
 * still sees both at the file.
 *
 * @param {{graph: {nodes: Record<string, {data: {tags?: string[]}}>, dependencies: Record<string, Array<{target: string, type: string}>>}}} document
 * @param {ReadonlyArray<{sourceTag: string, onlyDependOnLibsWithTags?: string[], notDependOnLibsWithTags?: string[]}>} constraints
 * @returns {Array<{from: string, to: string, rule: string}>}
 */
export function evaluateEdges(document, constraints = DEP_CONSTRAINTS) {
  const { nodes, dependencies } = document.graph
  const violations = []
  for (const [from, edges] of Object.entries(dependencies)) {
    const source = nodes[from]
    if (!source) continue
    const sourceTags = source.data?.tags ?? []
    for (const edge of edges) {
      if (edge.type !== 'static' || edge.target.startsWith('npm:')) continue
      const target = nodes[edge.target]
      if (!target) continue
      const targetTags = target.data?.tags ?? []
      for (const constraint of constraints) {
        if (constraint.sourceTag !== '*' && !sourceTags.includes(constraint.sourceTag)) continue
        const only = constraint.onlyDependOnLibsWithTags
        const not = constraint.notDependOnLibsWithTags
        if (only && !only.includes('*') && !targetTags.some((tag) => only.includes(tag))) {
          violations.push({ from, to: edge.target, rule: `${constraint.sourceTag} may only depend on ${only.join(', ')}` })
        }
        if (not && targetTags.some((tag) => not.includes(tag))) {
          violations.push({ from, to: edge.target, rule: `${constraint.sourceTag} may not depend on ${not.join(', ')}` })
        }
      }
    }
  }
  return violations
}

/**
 * The allowlist compared with what the graph shows, the ratchet way: an edge
 * the list does not carry is a regression, and a listed edge the graph no
 * longer has — or that no rule refuses any more — is stale and equally red,
 * because an exemption nobody has re-read is the shape that outlives its
 * reason.
 *
 * @param {Array<{from: string, to: string, rule: string}>} violations
 * @param {Array<{from: string, to: string}>} allowlist
 */
export function compareToAllowlist(violations, allowlist) {
  const key = (edge) => `${edge.from} -> ${edge.to}`
  const seen = new Map()
  for (const violation of violations) {
    if (!seen.has(key(violation))) seen.set(key(violation), violation)
  }
  const allowed = new Set(allowlist.map(key))
  const regressions = [...seen.values()].filter((edge) => !allowed.has(key(edge)))
  const stale = allowlist.filter((edge) => !seen.has(key(edge)))
  const by = (a, b) => key(a).localeCompare(key(b))
  return {
    clean: regressions.length === 0 && stale.length === 0,
    regressions: regressions.sort(by),
    stale: stale.sort(by),
  }
}

/**
 * The projects that import a library statically AND reach it through lazy
 * `import()` edges, which `@nx/enforce-module-boundaries` answers with
 * "Static imports of lazy-loaded libraries are forbidden" on every static
 * import of it — in the lazy importer, and in every project that lazily loads
 * the lazy importer. The console and the tenant reach every plugin through the
 * generated manifests' `load()`, so one `import('@aglyn/…')` of a library in a
 * plugin reds both apps' lint at every import of that library (AGL-3557:
 * 1,021 errors across five projects, from three plugin files).
 *
 * The rule spares an import that resolves to one of the library's package
 * entry points, which is why the rows of `LAZY_AND_STATIC_ALLOWED` lint green;
 * a new pair is red here because whether it is spared depends on every
 * import's resolution, which only the full lint sees — and no pre-push step
 * runs that.
 *
 * Read from the project graph alone: `dependencies[source]` carries a project
 * edge per type, so a project with both a `static` and a `dynamic` edge to a
 * target has both. The lazy reach follows dynamic edges only, as the rule's
 * own walk does.
 *
 * @returns {Array<{from: string, to: string, via: string[]}>} each pair once,
 *   `via` the lazy chain from `from` to `to`
 */
export function lazyAndStaticPairs(document) {
  const dependencies = document.graph.dependencies
  const pairs = []
  for (const from of Object.keys(document.graph.nodes)) {
    const statics = new Set((dependencies[from] ?? []).filter((edge) => edge.type === 'static').map((edge) => edge.target))
    // Breadth first over dynamic edges, keeping the first chain to each target.
    const chains = new Map([[from, [from]]])
    const queue = [from]
    while (queue.length) {
      const at = queue.shift()
      for (const edge of dependencies[at] ?? []) {
        if (edge.type !== 'dynamic' || chains.has(edge.target)) continue
        chains.set(edge.target, [...chains.get(at), edge.target])
        queue.push(edge.target)
      }
    }
    for (const [to, via] of chains) {
      if (to !== from && statics.has(to)) pairs.push({ from, to, via })
    }
  }
  return pairs.sort((a, b) => `${a.from} -> ${a.to}`.localeCompare(`${b.from} -> ${b.to}`))
}

/**
 * The lazy-and-static pairs that lint green, each with why. Compared the
 * ratchet way (`compareToAllowlist`): a row the graph no longer has is red
 * too. A new row is only for a pair whose `nx run <from>:lint` is clean.
 */
export const LAZY_AND_STATIC_ALLOWED = Object.freeze([
  {
    from: 'console',
    to: 'besigner-feature-designer',
    why: 'The designer pages load the canvas with next/dynamic; every static import is the package barrel or a ./* entry.',
  },
  {
    from: 'console',
    to: 'shared-ui-json-editor',
    why: 'The designer pages load the JSON editor with next/dynamic; every static import is the package barrel.',
  },
])

/** The text a source project's `eslint.config.mjs` spreads to take its overrides. */
export const OVERRIDES_CALL = 'boundaryOverridesFor(import.meta.url)'

/**
 * The lint-side half of the allowlist for ONE source project: a flat-config
 * block that re-states the boundary rule with the project's listed targets
 * in `allow`, or nothing when the project has no row.
 *
 * Every project has its own `eslint.config.mjs` that spreads the root one,
 * and ESLint resolves `files` patterns against the directory of the config
 * it loaded, so a root-level block naming `libs/plugins/forms/**` never
 * matches a forms file. The block is therefore built FOR the config that
 * asks — `boundaryOverridesFor(import.meta.url)` in the root config — and
 * matches every file under it, which is exactly that one project. The
 * alias stays refused in every other project.
 *
 * An entry marked `enforcedInline` gets no block: the one importer carries
 * its own `eslint-disable-next-line`, and a project-wide allow would loosen
 * the very files the boundary is there to keep clean.
 *
 * @param {object} args
 * @param {Array<{from: string, to: string, enforcedInline?: boolean}>} args.allowlist
 * @param {ReturnType<typeof readPackageMap>} args.packageMap
 * @param {string} args.projectRoot repo-relative root of the project asking
 * @param {string} args.ruleName
 * @param {Record<string, unknown>} args.baseOptions the rule's options as configured
 * @param {(alias: string) => string[]} [args.contractAliasesOf] the npm names of the plugins whose contracts the asking plugin declares (AGL-3980)
 */
export function lintOverridesFor({ allowlist, packageMap, projectRoot, ruleName, baseOptions, contractAliasesOf = () => [] }) {
  const byName = new Map(packageMap.map((project) => [project.name, project]))
  const source = packageMap.find((project) => project.root === projectRoot)
  if (!source) return []
  const aliases = new Set()
  for (const entry of allowlist) {
    if (entry.enforcedInline || entry.from !== source.name) continue
    const target = byName.get(entry.to)
    if (target?.alias) aliases.add(target.alias)
  }
  const escape = (alias) => alias.replace(/[/@.-]/g, '\\$&')
  // A plugin's declared providers, by their contracts subpath ONLY (AGL-3980):
  // their entry and every other module stay refused.
  const contracts = [...new Set(source.alias ? contractAliasesOf(source.alias) : [])].sort()
  if (!aliases.size && !contracts.length) return []
  const allow = [
    ...[...aliases].sort().map((alias) => `^${escape(alias)}(/|$)`),
    ...contracts.map((alias) => `^${escape(alias)}/${CONTRACTS_SUBPATH}$`),
  ]
  return [
    {
      // Exactly the extensions the root config runs the rule on. Naming
      // `.mjs` here would switch the rule ON for the project's own
      // `eslint.config.mjs`, whose relative import of the root config the
      // rule then reads as an external resource.
      files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
      rules: {
        [ruleName]: ['error', { ...baseOptions, allow: [...(baseOptions.allow ?? []), ...allow] }],
      },
    },
  ]
}

/**
 * The source projects whose own `eslint.config.mjs` must spread the
 * overrides, and whether each does: the file exists and contains
 * `OVERRIDES_CALL`. A project on the list without the call lints red on an
 * edge the map has agreed to carry, which is the wrong red.
 *
 * @param {Array<{from: string, enforcedInline?: boolean}>} allowlist
 * @param {ReturnType<typeof readPackageMap>} packageMap
 * @param {(path: string) => string | null} readConfig repo-relative path → text, or null when absent
 * @returns {Array<{name: string, config: string, wired: boolean}>}
 */
export function overrideWiring(allowlist, packageMap, readConfig) {
  const byName = new Map(packageMap.map((project) => [project.name, project]))
  const sources = [...new Set(allowlist.filter((entry) => !entry.enforcedInline).map((entry) => entry.from))].sort()
  return sources.map((name) => {
    const config = `${byName.get(name)?.root ?? name}/eslint.config.mjs`
    const text = readConfig(config)
    return { name, config, wired: typeof text === 'string' && text.includes(OVERRIDES_CALL) }
  })
}

/**
 * The project names `docs/PACKAGES.md` has no row for. A row names the
 * project in backticks in a table cell, which is how the doc is written and
 * the only spelling this reads.
 */
export function missingMapRows(docText, projectNames) {
  const rows = new Set()
  for (const line of String(docText).split('\n')) {
    if (!line.startsWith('|')) continue
    for (const match of line.matchAll(/`([^`]+)`/g)) rows.add(match[1])
  }
  return projectNames.filter((name) => !rows.has(name)).sort()
}

/**
 * The peer families a lib's shipped source imports: what its `package.json`
 * must list under `peerDependencies`.
 *
 * @param {string} libRoot absolute path of the lib
 * @returns {string[]} sorted package names, e.g. `react`, `@mui/material`
 */
export function peerFamiliesImported(libRoot) {
  const families = new Set()
  for (const file of walk(join(libRoot, 'src'), (name) => SOURCE_FILE.test(name) && !SPEC_FILE.test(name))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(IMPORT_SOURCE)) {
      const family = PEER_FAMILY.exec(match[1])
      if (family) families.add(family[1])
    }
  }
  return [...families].sort()
}

/**
 * A module specifier in a statement that is really an import: `import … from`,
 * a bare `import '…'`, `export … from`, and a closing `} from '…'` of a
 * multi-line one; then `import('…')` and `require('…')` anywhere on a line
 * that is not a comment. `IMPORT_SOURCE` above is looser on purpose — it only
 * feeds a filter for six peer families — and would read a quoted word in a
 * doc comment as a package, which here would demand a dependency on prose.
 */
const STATEMENT_IMPORT = /^\s*(?:import\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?|export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s+)?from\s+|\}\s*from\s+)['"]([^'"]+)['"]/
const CALL_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*)/
/** A Storybook story documents a component; it is not what the package ships. */
const STORY_FILE = /\.stories\.[cm]?[jt]sx?$/
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*/i

/** `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`; else `null`. */
export function packageOfSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null
  const match = PACKAGE_NAME.exec(specifier)
  return match ? match[0] : null
}

/**
 * Every package a lib's SHIPPED source imports, by package name.
 *
 * A type-only import counts: the published `.d.ts` names the package too, so a
 * consumer's compiler has to find it. Specs do not count, a lib's import of
 * itself does not, and neither does a Node builtin.
 *
 * @param {string} libRoot absolute path of the lib
 * @param {string | null} ownName the lib's own npm name
 * @param {ReadonlySet<string>} [builtins] Node builtin module names
 * @returns {string[]} sorted package names
 */
export function packagesImported(libRoot, ownName, builtins = NODE_BUILTINS) {
  const found = new Set()
  for (const file of walk(join(libRoot, 'src'), (name) => SOURCE_FILE.test(name) && !SPEC_FILE.test(name) && !STORY_FILE.test(name))) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (COMMENT_LINE.test(line)) continue
      const specifiers = []
      const statement = STATEMENT_IMPORT.exec(line)
      if (statement) specifiers.push(statement[1])
      for (const call of line.matchAll(CALL_IMPORT)) specifiers.push(call[1])
      for (const specifier of specifiers) {
        const name = packageOfSpecifier(specifier)
        if (!name || name === ownName || builtins.has(name)) continue
        found.add(name)
      }
    }
  }
  return [...found].sort()
}

/**
 * The workspace subpaths a lib's SHIPPED source imports: `[{ specifier, name,
 * subpath }]` for every `@scope/name/sub/path` naming one of `workspaceNames`.
 */
export function workspaceSubpathsImported(libRoot, workspaceNames) {
  const found = new Map()
  for (const file of walk(join(libRoot, 'src'), (name) => SOURCE_FILE.test(name) && !SPEC_FILE.test(name) && !STORY_FILE.test(name))) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (COMMENT_LINE.test(line)) continue
      const specifiers = []
      const statement = STATEMENT_IMPORT.exec(line)
      if (statement) specifiers.push(statement[1])
      for (const call of line.matchAll(CALL_IMPORT)) specifiers.push(call[1])
      for (const specifier of specifiers) {
        const name = packageOfSpecifier(specifier)
        if (!name || !workspaceNames.has(name) || specifier === name) continue
        found.set(specifier, { specifier, name, subpath: specifier.slice(name.length + 1) })
      }
    }
  }
  return [...found.values()]
}

/**
 * Subpaths a consumer of the published package could not resolve (AGL-3201).
 *
 * Inside this repo `@aglyn/x/model` resolves through a tsconfig alias to a
 * FOLDER and its index. A published package is resolved by its `exports` map,
 * where `./*` means `./src/lib/*.js` — a file — so the same import finds
 * `model.js`, which does not exist, and the package fails at load in somebody
 * else's build while every test here passes. A subpath is fine when the target
 * package names it in `exports` or it is a module file under `src/lib`.
 *
 * `target(name)` answers `{ exports, hasModule(subpath) }` for a workspace
 * package, or null.
 */
export function unresolvableSubpaths(imports, target) {
  return imports
    .filter(({ name, subpath }) => {
      const found = target(name)
      if (!found) return false
      if (found.exports?.[`./${subpath}`]) return false
      return !found.hasModule(subpath)
    })
    .map(({ specifier }) => specifier)
    .sort()
}

/** `unist` → `@types/unist`; `@scope/name` → `@types/scope__name`. */
export function typesPackageOf(name) {
  return `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`
}

/** Node's own modules, which a package never declares. */
const NODE_BUILTINS = new Set(builtinModules)

/**
 * What a lib must declare, split the way its `package.json` splits it: the
 * framework families are peers (a consumer has one of each), and everything
 * else the shipped source imports is a dependency.
 *
 * @param {string[]} imported from {@link packagesImported}
 */
export function declarationsOwed(imported) {
  const peers = []
  const dependencies = []
  for (const name of imported) (PEER_FAMILY.test(name) ? peers : dependencies).push(name)
  return { peers, dependencies }
}

/**
 * What a lib's `package.json` is missing for the map, as one line each.
 *
 * @param {object} args
 * @param {{name: string, root: string, alias: string | null, deepAlias: boolean}} args.project
 * @param {Record<string, any>} args.pkg the lib's package.json
 * @param {string} args.rootVersion the repo version
 * @param {string[]} args.peers the families the lib imports
 * @param {boolean} args.hasServerEntry whether `src/server.ts` exists
 * @param {string[]} [args.dependencies] the non-peer packages the shipped source imports
 * @param {ReadonlySet<string>} [args.workspacePackages] npm names that are this repo's own libs
 * @param {Record<string, string>} [args.rootRanges] the root package.json's ranges, by package
 */
/**
 * What is wrong with a `sideEffects` list (AGL-3201).
 *
 * A lib is read two ways: as SOURCE by this repo's apps, where the module is
 * `server.ts`, and as the built package by everyone else, where it is
 * `server.js`. An entry naming one extension is silently wrong for the other
 * reader — that bundler finds no match, takes the module for side-effect free
 * and drops the registration it exists to make, with nothing failing. So an
 * entry names the module and leaves the extension open (`./src/lib/server.*`),
 * and it has to be a module that exists: a list that outlived a rename
 * protects nothing.
 *
 * `moduleExists(stem)` answers for `./src/lib/server`; omit it to check shape
 * alone.
 */
export function sideEffectsFindings(sideEffects, moduleExists) {
  if (!Array.isArray(sideEffects)) return []
  const findings = []
  for (const entry of sideEffects) {
    if (typeof entry !== 'string' || !entry.endsWith('.*') || !entry.startsWith('./')) {
      findings.push(`sideEffects entry "${entry}" must name the module with the extension left open ("./src/lib/x.*"): this repo reads the .ts and a consumer reads the emitted .js`)
      continue
    }
    if (moduleExists && !moduleExists(entry.slice(0, -2))) {
      findings.push(`sideEffects entry "${entry}" matches no module in the lib`)
    }
  }
  return findings
}

export function packageFindings({ project, pkg, rootVersion, peers, hasServerEntry, dependencies = [], workspacePackages = new Set(), rootRanges = {}, moduleExists }) {
  const findings = []
  if (project.alias && pkg.name !== project.alias) {
    findings.push(`name is "${pkg.name}" but the alias, which is the npm name, is "${project.alias}"`)
  }
  if (!INDEPENDENTLY_VERSIONED.has(project.name) && pkg.version !== rootVersion) {
    findings.push(`version is "${pkg.version}" but the repo version is "${rootVersion}" (release:prepare writes it)`)
  }
  const exportsMap = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : {}
  if (!exportsMap['.']) findings.push('exports has no "." entry')
  if (hasServerEntry && !exportsMap['./server']) findings.push('exports has no "./server" entry but src/server.ts exists')
  if (project.deepAlias && !exportsMap['./*']) {
    findings.push('exports has no "./*" entry but tsconfig.base.json publishes a deep alias')
  }
  if (!('sideEffects' in pkg)) findings.push('sideEffects is not declared')
  findings.push(...sideEffectsFindings(pkg.sideEffects, moduleExists))
  // WHAT THE REGISTRY PAGE AND THE PUBLISH STEP READ (AGL-3201). Every package
  // is Apache-2.0; a scoped package publishes restricted unless it says
  // `public`, and the first anyone learns of that is a 402 from the registry;
  // and `repository.directory` is what links a package page to its source in a
  // monorepo, and what provenance is checked against.
  if (pkg.license !== 'Apache-2.0') findings.push(`license is ${JSON.stringify(pkg.license)}; every package is "Apache-2.0"`)
  if (pkg.publishConfig?.access !== 'public') findings.push('publishConfig.access is not "public", so a scoped package would publish restricted')
  const directory = typeof pkg.repository === 'object' ? pkg.repository?.directory : undefined
  if (project.root && !INDEPENDENTLY_VERSIONED.has(project.name) && directory !== project.root) {
    findings.push(`repository.directory is ${JSON.stringify(directory)} but the package lives at "${project.root}"`)
  }
  const declared = pkg.peerDependencies ?? {}
  for (const family of peers) {
    if (!(family in declared)) findings.push(`peerDependencies lacks ${family}, which the shipped source imports`)
  }
  findings.push(...peerRangeFindings(declared, { rootRanges, workspacePackages }))
  const bundled = pkg.dependencies ?? {}
  for (const family of Object.keys(bundled)) {
    if (PEER_FAMILY.test(family)) findings.push(`dependencies carries ${family}; it must be a peer`)
  }
  // A PACKAGE SAYS WHAT IT NEEDS (AGL-3201). Inside this repo every import
  // resolves through a tsconfig alias or the root node_modules, so a lib that
  // declares nothing builds and tests green — and installs from the registry
  // unable to find its own imports. Each one is declared, and one of this
  // repo's own libs is declared at the repo version, which is the only number
  // it is ever published beside.
  for (const name of dependencies) {
    // A package that ships only types is declared by its `@types/` name.
    if (!(name in bundled) && !(name in declared) && !(typesPackageOf(name) in bundled)) {
      findings.push(`dependencies lacks ${name}, which the shipped source imports (sync:lib-dependencies writes it)`)
    }
  }
  for (const [name, range] of Object.entries(bundled)) {
    if (workspacePackages.has(name) && range !== rootVersion) {
      findings.push(`dependencies["${name}"] is "${range}" but the repo version is "${rootVersion}" (release:prepare writes it)`)
    }
    // A third-party range is the one the workspace runs, or the package is
    // published promising a version nobody here has ever built against.
    if (!INDEPENDENTLY_VERSIONED.has(project.name) && !workspacePackages.has(name) && name in rootRanges && range !== rootRanges[name]) {
      findings.push(`dependencies["${name}"] is "${range}" but the workspace runs "${rootRanges[name]}" (sync:lib-dependencies writes it)`)
    }
  }
  return findings
}

/**
 * Every lib `package.json` that carries the repo version, with its path, for
 * `release:prepare` to write and the guard to read.
 *
 * @param {string} repoRoot
 * @returns {Array<{name: string, path: string}>}
 */
export function versionedLibPackages(repoRoot) {
  return readPackageMap(repoRoot)
    .filter((project) => project.projectType === 'library' && !INDEPENDENTLY_VERSIONED.has(project.name))
    .map((project) => ({ name: project.name, path: join(project.root, 'package.json') }))
    .filter((entry) => statSync(join(repoRoot, entry.path), { throwIfNoEntry: false })?.isFile())
}

// ── Plugin contracts (AGL-3980) ──────────────────────────────────────────────
//
// A plugin never imports another plugin, with ONE exception: the other
// plugin's contracts module, `libs/plugins/<id>/src/lib/contracts.ts`,
// imported as `@aglyn/plugins-<id>/contracts`. It carries what a consumer
// would otherwise restate by hand — a service contract's id and interface, an
// event's name and payload — and nothing that runs the plugin, so importing it
// never loads the plugin, and the consumer stays runnable with the provider
// absent. The consumer says so in `plugins.config.json`: the provider is in its
// `uses` (an optional code dependency) or its `catalog.requires` (it cannot be
// switched on without it), and its package.json carries the provider as an
// OPTIONAL peer.

/** The subpath every plugin publishes its contracts at. */
export const CONTRACTS_SUBPATH = 'contracts'

/** Where a plugin's contracts module lives, relative to the plugin's root. */
export const CONTRACTS_MODULE = 'src/lib/contracts.ts'

/**
 * Each plugin's declared code dependencies, read from `plugins.config.json`:
 * `uses` and `catalog.requires` (a capability's `requires` names a switchboard
 * id, which resolves to the plugin that serves it). What is malformed comes
 * back as sentences, for the generator to throw and the guard to print.
 *
 * @param {{plugins: Array<Record<string, any>>}} config
 * @returns {{plugins: Map<string, {id: string, alias: string, may: Set<string>}>, findings: string[]}}
 */
export function pluginCodeDependencies(config) {
  const findings = []
  const owner = new Map()
  for (const plugin of config.plugins ?? []) {
    owner.set(plugin.id, plugin.id)
    for (const capability of plugin.capabilities ?? []) owner.set(capability.id, plugin.id)
  }
  const plugins = new Map()
  for (const plugin of config.plugins ?? []) {
    const where = `plugins.config.json: "${plugin.id}"`
    const may = new Set()
    if (plugin.uses !== undefined) {
      if (!Array.isArray(plugin.uses) || plugin.uses.some((id) => typeof id !== 'string' || !id)) {
        findings.push(`${where} "uses" must be a list of plugin ids`)
      } else {
        if (new Set(plugin.uses).size !== plugin.uses.length) findings.push(`${where} "uses" names a plugin twice`)
        for (const id of plugin.uses) {
          if (id === plugin.id) findings.push(`${where} "uses" names the plugin itself`)
          else if (!owner.has(id)) findings.push(`${where} uses "${id}", which is no plugin in plugins.config.json`)
          else if (owner.get(id) !== id) findings.push(`${where} uses "${id}", a capability of "${owner.get(id)}": name the plugin`)
          else may.add(id)
        }
      }
    }
    for (const source of [plugin, ...(plugin.capabilities ?? [])]) {
      for (const required of source.catalog?.requires ?? []) {
        const id = owner.get(required)
        if (id && id !== plugin.id) may.add(id)
      }
    }
    plugins.set(plugin.id, { id: plugin.id, alias: plugin.package, may })
  }
  return { plugins, findings }
}

const STATEMENT = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** The text with every comment removed, so a quoted word in prose is never read as an import. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/**
 * Every module specifier one source file imports or re-exports, with whether
 * the statement is erased at compile time: `import type`, `export type`, or a
 * braced list whose every name says `type`.
 *
 * @param {string} text
 * @returns {Array<{specifier: string, typeOnly: boolean}>}
 */
export function importStatements(text) {
  const out = []
  for (const match of withoutComments(text).matchAll(STATEMENT)) {
    if (match[4]) {
      const clause = match[3].trim()
      const braced = /^\{([\s\S]*)\}$/.exec(clause)
      const names = braced ? braced[1].split(',').map((name) => name.trim()).filter(Boolean) : []
      const typeOnly = Boolean(match[2]) || (names.length > 0 && names.every((name) => name.startsWith('type ')))
      out.push({ specifier: match[4], typeOnly })
    } else {
      out.push({ specifier: match[5] ?? match[6], typeOnly: false })
    }
  }
  return out
}

/**
 * What one plugin's source — specs included, because the graph edge is drawn
 * from any file — imports from other plugins: `[{ file, specifier, to,
 * contract }]`, `to` the providing plugin's id and `contract` true for exactly
 * `<alias>/contracts`.
 *
 * @param {string} pluginRoot absolute path of the importing plugin
 * @param {string} ownId
 * @param {ReadonlyMap<string, string>} idByAlias every plugin's npm name → id
 */
export function crossPluginImports(pluginRoot, ownId, idByAlias) {
  const found = []
  for (const file of walk(join(pluginRoot, 'src'), (name) => SOURCE_FILE.test(name))) {
    for (const { specifier } of importStatements(readFileSync(file, 'utf8'))) {
      const alias = packageOfSpecifier(specifier)
      const to = alias ? idByAlias.get(alias) : undefined
      if (!to || to === ownId) continue
      found.push({ file, specifier, to, contract: specifier === `${alias}/${CONTRACTS_SUBPATH}` })
    }
  }
  return found
}

/**
 * The plugin → plugin edges that are contracts and nothing else, which the
 * map allows, and what is wrong with the rest of the contract imports.
 *
 * An edge is a contract edge when EVERY import across it is the provider's
 * `/contracts`, the provider has a contracts module, and the consumer names
 * the provider in `uses` or `requires`. One other import across the same edge
 * — the entry, a model file, a component — and the edge is an ordinary
 * plugin → plugin edge, which `evaluateEdges` refuses as before.
 *
 * @param {object} args
 * @param {Map<string, {id: string, alias: string, may: Set<string>}>} args.plugins from {@link pluginCodeDependencies}
 * @param {Map<string, ReturnType<typeof crossPluginImports>>} args.imports by importing plugin id
 * @param {(id: string) => boolean} args.hasContracts whether a plugin has its contracts module
 * @returns {{allowed: Array<{from: string, to: string}>, findings: string[]}} edges by plugin id
 */
export function contractEdges({ plugins, imports, hasContracts }) {
  const allowed = []
  const findings = []
  for (const [from, list] of imports) {
    const byTarget = new Map()
    for (const entry of list) byTarget.set(entry.to, [...(byTarget.get(entry.to) ?? []), entry])
    for (const [to, entries] of byTarget) {
      if (!entries.every((entry) => entry.contract)) continue
      const alias = plugins.get(to)?.alias ?? to
      if (!hasContracts(to)) {
        findings.push(`${from} imports ${alias}/${CONTRACTS_SUBPATH}, but ${to} has no ${CONTRACTS_MODULE}`)
        continue
      }
      if (!plugins.get(from)?.may.has(to)) {
        findings.push(
          `${from} imports ${alias}/${CONTRACTS_SUBPATH} without declaring it: add "${to}" to "uses" on "${from}" in plugins.config.json ` +
            `(or to its catalog "requires", when ${from} cannot be switched on without ${to})`,
        )
        continue
      }
      allowed.push({ from, to })
    }
  }
  return { allowed, findings }
}

/**
 * What a contracts module may not do, as sentences. It is the one module of a
 * plugin another plugin loads, so it must load nothing of the plugin: a
 * runtime import is `@aglyn/aglyn` or one of its subpaths (the contract
 * helpers), and anything else it names — its own model files included — is
 * `import type`, which the compiler erases.
 *
 * @param {string} text the module's source
 * @param {string} file for the message
 */
export function contractsModuleFindings(text, file) {
  const findings = []
  for (const { specifier, typeOnly } of importStatements(text)) {
    if (typeOnly && (specifier.startsWith('.') || specifier.startsWith('@aglyn/aglyn'))) continue
    if (!typeOnly && (specifier === '@aglyn/aglyn' || specifier.startsWith('@aglyn/aglyn/'))) continue
    findings.push(
      typeOnly
        ? `${file} imports types from "${specifier}": a contract names its own model files or @aglyn/aglyn, nothing another package would have to install`
        : `${file} loads "${specifier}" at runtime: a contracts module imports only @aglyn/aglyn at runtime, and everything else as \`import type\`, so loading it never loads the plugin`,
    )
  }
  return findings
}

/**
 * What a consumer's package.json owes for the contracts it imports from
 * shipped source: the provider as a peer at the repo version, marked
 * optional, and NOT as a dependency — installing the consumer must never
 * install the provider.
 *
 * @param {Record<string, any>} pkg
 * @param {string[]} providers npm names of the plugins whose contracts the shipped source imports
 * @param {string} rootVersion
 */
export function contractPeerFindings(pkg, providers, rootVersion) {
  const findings = []
  for (const name of providers) {
    if (pkg.dependencies?.[name]) findings.push(`dependencies carries ${name}; a plugin whose contracts it imports is an optional peer, never a dependency`)
    if (pkg.peerDependencies?.[name] !== rootVersion) {
      findings.push(`peerDependencies["${name}"] must be "${rootVersion}", the repo version (sync:lib-dependencies writes it)`)
    }
    if (pkg.peerDependenciesMeta?.[name]?.optional !== true) {
      findings.push(`peerDependenciesMeta["${name}"] must say { "optional": true }: the plugin runs with ${name} absent (sync:lib-dependencies writes it)`)
    }
  }
  return findings
}
