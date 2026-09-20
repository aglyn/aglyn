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
 */
export function lintOverridesFor({ allowlist, packageMap, projectRoot, ruleName, baseOptions }) {
  const byName = new Map(packageMap.map((project) => [project.name, project]))
  const source = packageMap.find((project) => project.root === projectRoot)
  if (!source) return []
  const aliases = new Set()
  for (const entry of allowlist) {
    if (entry.enforcedInline || entry.from !== source.name) continue
    const target = byName.get(entry.to)
    if (target?.alias) aliases.add(target.alias)
  }
  if (!aliases.size) return []
  const allow = [...aliases].sort().map((alias) => `^${alias.replace(/[/@.-]/g, '\\$&')}(/|$)`)
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
 */
export function packageFindings({ project, pkg, rootVersion, peers, hasServerEntry, dependencies = [], workspacePackages = new Set() }) {
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
  const declared = pkg.peerDependencies ?? {}
  for (const family of peers) {
    if (!(family in declared)) findings.push(`peerDependencies lacks ${family}, which the shipped source imports`)
  }
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
