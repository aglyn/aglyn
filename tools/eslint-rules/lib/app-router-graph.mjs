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
 * App Router module-graph analysis, shared by the `no-cross-graph-import`
 * ESLint rule and the `app-router-graph-boundary` guard spec (AGL-1350).
 *
 * ## Why this exists
 *
 * App Router splits every app into two module graphs. A file reached from a
 * route handler or an unmarked `page`/`layout` is a **server** module and may
 * not touch `createContext`; a file reached from a `'use client'` file is a
 * **client** module and may not touch `node:*`. Both entry barrels of
 * `@aglyn/aglyn` sit on the wrong side of exactly one of those lines —
 * `@aglyn/aglyn` re-exports `app-utils/contexts`, `@aglyn/aglyn/server`
 * re-exports the `node:stream` API adapter (AGL-405).
 *
 * The violation is **transitive**, which is the whole difficulty. AGL-1349
 * broke `main` through a module that is in neither `app/` nor a client
 * component: `apps/console/utils/usage-metering.ts` imported `@aglyn/aglyn`,
 * and three App Routes import `usage-metering`. Nothing about that file looks
 * server-side, it typechecks clean, and no unit test observes a module graph —
 * so it surfaced only at `nx build`, i.e. at promotion time.
 *
 * ## The model
 *
 * Two closures, computed the way Next computes them:
 *
 * - **server closure** — BFS from every App Router server entry (a Next
 *   special file under `apps/<app>/app/**` with no `'use client'`, plus
 *   `middleware`/`instrumentation`), pruned at any `'use client'` file,
 *   because that directive *is* the graph boundary.
 * - **client closure** — BFS from every `'use client'` file, never pruned:
 *   everything a client module imports is bundled for the browser.
 *
 * A module can be in **both** (`usage-metering.ts` is), and that is the case
 * the fix has to respect: such a module may import neither entry barrel.
 *
 * Leaf classification is derived, not hardcoded, so "what else re-exports the
 * contexts" never has to be maintained by hand:
 *
 * - `clientOnly` — reaches a module-scope `createContext(` without crossing a
 *   `'use client'` boundary. `@aglyn/aglyn` and `@aglyn/aglyn/app-utils` fall
 *   out of this; `@aglyn/aglyn/foundation` does not.
 * - `serverOnly` — reaches an import of a Node builtin or `server-only`.
 *   `@aglyn/aglyn/server` falls out of this via `app-utils/api-adapter`.
 *
 * ## Honest limits
 *
 * Resolution follows relative specifiers and `tsconfig.base.json` paths only;
 * anything in `node_modules` is opaque, so a client-only package pulled in
 * through a third-party barrel is invisible here (Turbopack still catches it).
 * Imports are found by scanning comment-stripped source rather than by
 * parsing — the same trade the repo's other source guards make — and
 * `import type` / `export type` are skipped because they are erased and
 * create no runtime edge.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path'

/** Extensions probed when a specifier carries none. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
/** Index files probed when a specifier resolves to a directory. */
const INDEX_FILES = EXTENSIONS.map((extension) => `index${extension}`)

/**
 * Node builtins whose presence makes a module server-only.
 *
 * Unprefixed only — the `node:` prefix is caught separately and always
 * counts. Deliberately excludes the names bundlers still shim for the browser
 * (`buffer`, `events`, `process`, `url`, `util`, `assert`, `querystring`,
 * `string_decoder`, `punycode`, `timers`): flagging those would report code
 * that ships fine today, and a rule that fires on working code gets silenced
 * mechanically, which is worse than no rule.
 */
const NODE_BUILTINS = new Set([
  'async_hooks', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'fs',
  'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path',
  'perf_hooks', 'readline', 'repl', 'stream', 'tls', 'tty', 'v8', 'vm',
  'worker_threads', 'zlib',
])

/** Bare specifiers that are server-only regardless of what they resolve to. */
const SERVER_ONLY_PACKAGES = [
  'server-only',
  'firebase-admin',
  '@google-cloud/',
  'stripe',
  'nodemailer',
]

/** Next's App Router special files — the server graph's entry points. */
const ROUTER_ENTRY_BASENAMES = new Set([
  'route', 'page', 'layout', 'template', 'default', 'not-found', 'loading',
  'sitemap', 'robots', 'manifest', 'icon', 'apple-icon', 'opengraph-image',
  'twitter-image',
])

/** Directories never worth descending into. */
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.next', '.git', 'dist', 'coverage', '.docusaurus',
  '.nx', 'tmp', '.turbo',
])

const isSourceFile = (path) =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path) &&
  !/\.(spec|test|e2e|stories)\.[^.]+$/.test(path) &&
  !path.endsWith('.d.ts')

/**
 * Strips comments while leaving string and template literals intact, so a
 * `createContext` named in prose (`app-utils/server.ts` does exactly that)
 * cannot be mistaken for a call. Newlines inside block comments survive so
 * reported line numbers stay truthful.
 *
 * Written as a slice-copying scanner rather than a character loop: it runs
 * over every source file in the workspace on every ESLint process start.
 */
export function stripComments(source) {
  if (!source.includes('//') && !source.includes('/*')) return source
  const parts = []
  const length = source.length
  let index = 0
  let copiedFrom = 0
  while (index < length) {
    const character = source[index]
    if (character === "'" || character === '"' || character === '`') {
      index += 1
      while (index < length) {
        const inner = source[index]
        if (inner === '\\') {
          index += 2
          continue
        }
        index += 1
        if (inner === character) break
      }
      continue
    }
    if (character !== '/') {
      index += 1
      continue
    }
    const next = source[index + 1]
    if (next === '/') {
      parts.push(source.slice(copiedFrom, index))
      while (index < length && source[index] !== '\n') index += 1
      copiedFrom = index
      continue
    }
    if (next === '*') {
      parts.push(source.slice(copiedFrom, index))
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? length : end + 2
      const body = source.slice(index, stop)
      for (let i = body.indexOf('\n'); i !== -1; i = body.indexOf('\n', i + 1)) {
        parts.push('\n')
      }
      index = stop
      copiedFrom = index
      continue
    }
    index += 1
  }
  parts.push(source.slice(copiedFrom))
  return parts.join('')
}

/**
 * One statement head plus its specifier. The clause is restricted to
 * quote/paren-free characters so the match cannot run away across a file.
 */
const STATEMENT = /\b(import|export)\b([^'"();]*?)\bfrom\s*(['"])([^'"\n]+)\3/g
const SIDE_EFFECT = /(?:^|[\s;{}])import\s*(['"])([^'"\n]+)\1/g
const DYNAMIC = /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g
const REQUIRE = /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g

/** True when every named binding carries an inline `type` marker. */
function isAllInlineTypes(clause) {
  const braced = /^\s*\{([^}]*)\}\s*$/.exec(clause)
  if (!braced) return false
  const members = braced[1].split(',').map((member) => member.trim()).filter(Boolean)
  return members.length > 0 && members.every((member) => /^type\s/.test(member))
}

/**
 * Every module specifier this file references at runtime, with the 1-based
 * line it sits on. Type-only imports are omitted: they are erased, so they
 * are not graph edges — which is why the AGL-1349 fix could keep
 * `import type { AglynOrgBilling }` and still be correct.
 */
export function readImports(source) {
  const stripped = stripComments(source)
  const found = []
  const push = (specifier, index) => {
    if (!specifier || specifier.startsWith('data:')) return
    found.push({ specifier, index })
  }

  let match
  STATEMENT.lastIndex = 0
  while ((match = STATEMENT.exec(stripped)) !== null) {
    const clause = match[2]
    // `import type { … } from` / `export type { … } from` — erased.
    if (/^\s*type\b/.test(clause)) continue
    if (isAllInlineTypes(clause)) continue
    push(match[4], match.index)
  }
  for (const pattern of [SIDE_EFFECT, DYNAMIC, REQUIRE]) {
    pattern.lastIndex = 0
    while ((match = pattern.exec(stripped)) !== null) push(match[2], match.index)
  }

  found.sort((a, b) => a.index - b.index)
  // One forward pass for line numbers instead of a slice per specifier.
  let line = 1
  let cursor = 0
  for (const entry of found) {
    while (cursor < entry.index) {
      if (stripped.charCodeAt(cursor) === 10) line += 1
      cursor += 1
    }
    entry.line = line
  }
  return found
}

/** True when the file opens with the `'use client'` directive. */
export function hasUseClient(source) {
  return /^\s*(['"])use client\1/.test(stripComments(source))
}

/** True when the file calls `createContext` (React's client-only API). */
function callsCreateContext(source) {
  return /\bcreateContext\s*[<(]/.test(stripComments(source))
}

/** True when the file imports something only Node can provide. */
function importsServerRuntime(imports) {
  return imports.some(({ specifier }) => {
    if (specifier.startsWith('node:')) return true
    if (NODE_BUILTINS.has(specifier)) return true
    return SERVER_ONLY_PACKAGES.some(
      (name) => specifier === name || specifier.startsWith(name),
    )
  })
}

/** Reads `tsconfig.base.json` without a JSON5 dependency. */
function readTsconfigPaths(root) {
  const raw = readFileSync(join(root, 'tsconfig.base.json'), 'utf8')
  const config = JSON.parse(stripComments(raw).replace(/,(\s*[}\]])/g, '$1'))
  const paths = config.compilerOptions?.paths ?? {}
  const baseUrl = resolvePath(root, config.compilerOptions?.baseUrl ?? '.')
  // Longest (most specific) alias first so `@aglyn/aglyn/server` beats
  // `@aglyn/aglyn/*`.
  return Object.entries(paths)
    .map(([alias, targets]) => ({ alias, targets, baseUrl }))
    .sort((a, b) => b.alias.length - a.alias.length)
}


/**
 * Resolves a specifier to an absolute source path, or null when it lives in
 * `node_modules` (opaque to this analysis) or cannot be found.
 */
export function createResolver(root, known) {
  const aliases = readTsconfigPaths(root)
  const cache = new Map()
  const exists = known
    ? (path) => known.has(path)
    : (path) => existsSync(path) && statSync(path).isFile()

  const probe = (candidate) => {
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(candidate) && exists(candidate)) {
      return candidate
    }
    for (const extension of EXTENSIONS) {
      if (exists(candidate + extension)) return candidate + extension
    }
    // A specifier written with `.js` against a `.ts` source (ESM style).
    const swapped = candidate.replace(/\.js$/, '')
    if (swapped !== candidate) {
      for (const extension of EXTENSIONS) {
        if (exists(swapped + extension)) return swapped + extension
      }
    }
    for (const index of INDEX_FILES) {
      const indexPath = join(candidate, index)
      if (exists(indexPath)) return indexPath
    }
    return null
  }

  return (specifier, fromFile) => {
    const isRelative = specifier.startsWith('.')
    // Alias specifiers resolve identically everywhere, so they cache
    // globally; relative ones only need the importing directory.
    const key = isRelative ? `${dirname(fromFile)}::${specifier}` : specifier
    if (cache.has(key)) return cache.get(key)
    let resolved = null
    if (isRelative) {
      resolved = probe(resolvePath(dirname(fromFile), specifier))
    } else {
      for (const { alias, targets, baseUrl } of aliases) {
        let tail = null
        if (alias.endsWith('/*')) {
          const prefix = alias.slice(0, -1)
          if (specifier.startsWith(prefix)) tail = specifier.slice(prefix.length)
        } else if (specifier === alias) {
          tail = ''
        }
        if (tail === null) continue
        for (const target of targets) {
          const candidate = resolvePath(
            baseUrl,
            target.replace('*', tail).replace(/^\.\//, ''),
          )
          resolved = probe(candidate)
          if (resolved) break
        }
        if (resolved) break
      }
    }
    cache.set(key, resolved)
    return resolved
  }
}

/**
 * Collects every module in the workspace once: `modules` is the analysable
 * set (specs and declaration files excluded), `known` is every file the
 * resolver may land on, so resolution never touches the filesystem again.
 */
function walkFiles(directory, modules, known) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      walkFiles(full, modules, known)
      continue
    }
    known.add(full)
    if (isSourceFile(full)) modules.push(full)
  }
}

/**
 * True when `file` is an App Router server entry: a Next special file under
 * `apps/<app>/app/` with no `'use client'`, or an app's middleware /
 * instrumentation module.
 */
function isServerEntryPath(root, file) {
  const relativePath = relative(root, file).split(sep).join('/')
  if (!relativePath.startsWith('apps/')) return false
  const basename = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const stem = basename.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')
  if (/^apps\/[^/]+\/(middleware|instrumentation)\./.test(relativePath)) return true
  if (!/^apps\/[^/]+\/app\//.test(relativePath)) return false
  return ROUTER_ENTRY_BASENAMES.has(stem)
}

/**
 * Builds the two closures and returns every cross-graph import edge found.
 *
 * @param root - workspace root (the directory holding `tsconfig.base.json`)
 * @returns the two closures, the leaf predicates, `classifyImport` (the one
 *   definition of the policy, shared with the ESLint rule) and `violations`.
 *   Each violation names the importing FILE, so the blame lands on the module
 *   that crossed the line rather than on the route that reached it.
 */
export function analyzeAppRouterGraph(root) {
  const files = []
  const known = new Set()
  for (const top of ['apps', 'libs']) {
    const directory = join(root, top)
    if (existsSync(directory)) walkFiles(directory, files, known)
  }
  const resolve = createResolver(root, known)

  const sources = new Map()
  const read = (file) => {
    if (sources.has(file)) return sources.get(file)
    let source = ''
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      source = ''
    }
    const record = {
      useClient: hasUseClient(source),
      createsContext: callsCreateContext(source),
      imports: readImports(source),
    }
    record.edges = record.imports
      .map((entry) => ({ ...entry, target: resolve(entry.specifier, file) }))
      .filter((entry) => entry.target !== null)
    record.serverRuntime = importsServerRuntime(record.imports)
    sources.set(file, record)
    return record
  }

  // --- leaf classification -------------------------------------------------
  // `clientOnly(m)`: m reaches a module-scope `createContext` without crossing
  // a `'use client'` boundary. `serverOnly(m)`: m reaches a Node builtin.
  //
  // Both are computed by propagating BACKWARDS along the import edges from the
  // seed modules — linear, and immune to the import cycles this graph is full
  // of. (Forward recursion has to choose between memoising a `false` that only
  // held because of a cycle and re-walking, which goes exponential here.)
  const reverse = new Map()
  for (const file of files) {
    for (const edge of read(file).edges) {
      const callers = reverse.get(edge.target)
      if (callers) callers.push(file)
      else reverse.set(edge.target, [file])
    }
  }

  const propagate = (seeds, blocked) => {
    const marked = new Set(seeds)
    const queue = [...seeds]
    while (queue.length > 0) {
      const file = queue.pop()
      for (const caller of reverse.get(file) ?? []) {
        if (marked.has(caller) || blocked(caller)) continue
        marked.add(caller)
        queue.push(caller)
      }
    }
    return marked
  }

  const clientOnly = propagate(
    files.filter((file) => {
      const record = read(file)
      return record.createsContext && !record.useClient
    }),
    // A `'use client'` module is the boundary: it may hold every context in
    // the repo and still be legal in a server graph, because Next renders it
    // on the client.
    (file) => read(file).useClient,
  )
  const serverOnly = propagate(
    files.filter((file) => read(file).serverRuntime),
    () => false,
  )

  const isClientOnly = (file) => clientOnly.has(file)
  const isServerOnly = (file) => serverOnly.has(file)

  // --- closures ------------------------------------------------------------
  const violations = []
  const rel = (file) => relative(root, file).split(sep).join('/')

  /**
   * Why `target` is poisoned, as a path down to the offending leaf — the
   * shape Turbopack prints, and the reason the message is actionable at all.
   */
  const explain = (target, poisoned, isLeaf) => {
    const path = []
    const visited = new Set()
    let cursor = target
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      path.push(rel(cursor))
      if (isLeaf(cursor)) break
      cursor = read(cursor).edges.find(
        (edge) => poisoned(edge.target) && !visited.has(edge.target),
      )?.target
    }
    return path
  }

  /**
   * BFS one graph and report every edge that crosses into the other.
   *
   * Two shapes count, and the walk stops at both so one mistake produces one
   * error rather than a cascade through the library it reached:
   *
   * - a **package** specifier (an alias, not a relative path) that resolves
   *   into poisoned territory — the entry-barrel case, `@aglyn/aglyn` and
   *   `@aglyn/aglyn/server`;
   * - a relative import of a module that IS the offending leaf.
   *
   * Everything else is traversed, which is what puts the blame on
   * `usage-metering.ts` instead of on the three routes that merely reach it.
   */
  const closure = (entries, { prune, poisoned, isLeaf, direction, parent }) => {
    const seen = new Set(entries)
    const queue = [...seen]
    while (queue.length > 0) {
      const file = queue.shift()
      for (const edge of read(file).edges) {
        const target = edge.target
        const crosses =
          poisoned(target) &&
          (!edge.specifier.startsWith('.') || isLeaf(target))
        if (crosses) {
          const trace = [rel(file)]
          let cursor = file
          while (parent.has(cursor)) {
            cursor = parent.get(cursor)
            trace.push(rel(cursor))
          }
          violations.push({
            direction,
            // The module that wrote the import — where the fix belongs.
            file: rel(file),
            absolute: file,
            specifier: edge.specifier,
            line: edge.line,
            target: rel(target),
            // Entry FIRST, so it reads route → … → offender.
            reachedFrom: trace.reverse(),
            through: explain(target, poisoned, isLeaf),
          })
          continue
        }
        if (seen.has(target) || prune(target)) continue
        seen.add(target)
        parent.set(target, file)
        queue.push(target)
      }
    }
    return seen
  }

  const createsContext = (file) => read(file).createsContext
  const usesServerRuntime = (file) => read(file).serverRuntime

  const serverParents = new Map()
  const serverEntries = files.filter(
    (file) => isServerEntryPath(root, file) && !read(file).useClient,
  )
  const serverModules = closure(serverEntries, {
    prune: (file) => read(file).useClient,
    poisoned: isClientOnly,
    isLeaf: createsContext,
    direction: 'client-into-server',
    parent: serverParents,
  })

  const clientParents = new Map()
  const clientEntries = files.filter((file) => read(file).useClient)
  const clientModules = closure(clientEntries, {
    prune: () => false,
    poisoned: isServerOnly,
    isLeaf: usesServerRuntime,
    direction: 'server-into-client',
    parent: clientParents,
  })

  const serverEntrySet = new Set(serverEntries)

  const traceFrom = (parents, file) => {
    const trace = [rel(file)]
    const visited = new Set([file])
    let cursor = file
    while (parents.has(cursor) && !visited.has(parents.get(cursor))) {
      cursor = parents.get(cursor)
      visited.add(cursor)
      trace.push(rel(cursor))
    }
    return trace.reverse()
  }

  /**
   * The single place the policy lives, so the ESLint rule and the guard spec
   * cannot drift. Returns null for a legal import.
   *
   * `file` is the importing module (absolute), `target` the resolved absolute
   * path of `specifier`. The rule passes both from the AST so the report has
   * the editor's current line, not the snapshot's.
   */
  const classifyImport = (file, specifier, target) => {
    if (!target) return null
    const isPackage = !specifier.startsWith('.')
    const inServer = serverModules.has(file) || serverEntrySet.has(file)
    const inClient = clientModules.has(file) || read(file).useClient
    const dualGraph = inServer && inClient

    if (inServer && isClientOnly(target) && (isPackage || createsContext(target))) {
      return {
        direction: 'client-into-server',
        dualGraph,
        reachedFrom: traceFrom(serverParents, file),
        through: explain(target, isClientOnly, createsContext),
      }
    }
    if (inClient && isServerOnly(target) && (isPackage || usesServerRuntime(target))) {
      return {
        direction: 'server-into-client',
        dualGraph,
        reachedFrom: traceFrom(clientParents, file),
        through: explain(target, isServerOnly, usesServerRuntime),
      }
    }
    return null
  }

  return {
    root,
    files,
    serverEntries: serverEntrySet,
    serverModules,
    clientModules,
    isClientOnly,
    isServerOnly,
    isServerEntry: (file) => isServerEntryPath(root, file),
    readImportsOf: (file) => read(file).imports,
    resolve,
    classifyImport,
    violations,
  }
}

/**
 * Nearest ancestor holding both `nx.json` and `tsconfig.base.json`. ESLint's
 * cwd is the workspace root under `nx lint`, but not when a run is launched
 * from a project directory or an editor.
 */
export function findWorkspaceRoot(from) {
  let directory = from
  for (let depth = 0; depth < 12; depth += 1) {
    if (
      existsSync(join(directory, 'nx.json')) &&
      existsSync(join(directory, 'tsconfig.base.json'))
    ) {
      return directory
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

const graphCache = new Map()

/**
 * One analysis per ESLint process, refreshed after `maxAgeMs` so a long-lived
 * editor server does not answer from a snapshot taken hours ago. The walk is
 * ~1s over ~14.5k modules; the rule reads the *current* file from the AST, so
 * only reachability — which changes slowly — is ever served from the cache.
 */
export function getAppRouterGraph(root, maxAgeMs = 30_000) {
  const cached = graphCache.get(root)
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.graph
  const graph = analyzeAppRouterGraph(root)
  graphCache.set(root, { graph, at: Date.now() })
  return graph
}
