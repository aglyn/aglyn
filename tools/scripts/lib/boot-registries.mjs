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
 * Finds a registry that the boot fills and that lives at module scope
 * (AGL-3947).
 *
 * Both apps run their registrations from `instrumentation.ts`, and Next
 * compiles that file apart from the routes, so the boot and a route each hold
 * their own copy of every module the boot reaches. A registry kept in a
 * module-scoped `Map`, `Set`, array or `let` is filled in the boot's copy and
 * read empty in the route's. It bit three times: the trust signer and the site
 * cache (AGL-3412), the native push senders (AGL-3868), and eleven registries
 * the plugins' server declarations fill (AGL-3947). The fix that holds keeps
 * the registry on `globalThis` under a `Symbol.for` key.
 *
 * What the boot reaches is walked by NAME, through `register…` functions:
 *
 * 1. The boot sources: each app's `instrumentation.ts`, the app-local files it
 *    imports by relative path, and every plugin's `declarations*.ts` (the
 *    modules `registerPluginServerDeclarations()` loads). Every `register…`
 *    call in them is reached.
 * 2. A reached name is looked up where it is exported as a function, and every
 *    `register…` call in THAT function's body is reached too.
 * 3. A file that defines a reached function is checked: a top-level
 *    collection the file mutates, or a top-level `let` a reached function
 *    assigns, is a finding, unless its initializer is on `globalThis`.
 *
 * A latch in a boot source itself (`let declared = false`) is not a finding:
 * each copy running its own registrations once is the point of it.
 *
 * A registry that is per copy ON PURPOSE says so on the line above its
 * declaration with `// boot-registry: per copy — <reason>`.
 */

const REGISTER_CALL = /\b(register[A-Z][A-Za-z0-9_]*)\s*(?:<[^>()]*>)?\s*\(/g
const EXPORTED_REGISTER = /^export\s+(?:async\s+)?function\s+(register[A-Z][A-Za-z0-9_]*)\b/gm
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
const TOP_LEVEL_COLLECTION =
  /^(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+)?=\s*(new\s+(?:Map|Set|WeakMap|WeakSet)\b|\[\s*\])/gm
const TOP_LEVEL_LET = /^(?:export\s+)?let\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm
const WAIVER = /\/\/\s*boot-registry:\s*per copy\b/

const isSource = (path) =>
  /\.(ts|tsx)$/.test(path) &&
  !/\.(spec|test)\.tsx?$/.test(path) &&
  !/(^|\/)(specs|__tests__|e2e)\//.test(path)

/** Whether a path is a boot source by its name alone. */
export function isNamedBootSource(path) {
  return (
    /^apps\/[^/]+\/instrumentation\.ts$/.test(path) ||
    (/^libs\/plugins\/.+\/declarations[^/]*\.ts$/.test(path) && isSource(path))
  )
}

/** Strips comments and string contents so braces and names in them do not count. */
export function stripNoise(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const n = source[i + 1]
    if (c === '/' && n === '/') {
      while (i < source.length && source[i] !== '\n') i++
    } else if (c === '/' && n === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? source.length : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else if (c === "'" || c === '"' || c === '`') {
      out += c
      i++
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') {
          out += '  '
          i += 2
          continue
        }
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/** The body of `export function name(…) {…}` in stripped source, or ''. */
export function functionBody(stripped, name) {
  const at = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${name}\\b`, 'm').exec(stripped)
  if (!at) return ''
  // The body opens at the first `{` after the parameter list closes.
  let i = stripped.indexOf('(', at.index)
  let depth = 0
  for (; i < stripped.length; i++) {
    if (stripped[i] === '(') depth++
    else if (stripped[i] === ')' && --depth === 0) break
  }
  const open = stripped.indexOf('{', i)
  if (open < 0) return ''
  depth = 0
  for (let j = open; j < stripped.length; j++) {
    if (stripped[j] === '{') depth++
    else if (stripped[j] === '}' && --depth === 0) return stripped.slice(open, j + 1)
  }
  return stripped.slice(open)
}

const namesCalled = (text) => new Set([...text.matchAll(REGISTER_CALL)].map((m) => m[1]))

function resolveRelative(from, spec, files) {
  const dir = from.split('/').slice(0, -1)
  for (const part of spec.split('/')) {
    if (part === '..') dir.pop()
    else if (part !== '.') dir.push(part)
  }
  const base = dir.join('/')
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (files.has(candidate)) return candidate
  }
  return null
}

/**
 * The boot sources: the named ones, plus the app-local files each app's
 * `instrumentation.ts` reaches by relative import.
 */
export function bootSources(files) {
  const sources = new Set([...files.keys()].filter(isNamedBootSource))
  const queue = [...sources].filter((path) => path.startsWith('apps/'))
  while (queue.length) {
    const path = queue.pop()
    const app = path.split('/').slice(0, 2).join('/')
    for (const m of stripImports(files.get(path)).matchAll(RELATIVE_IMPORT)) {
      const target = resolveRelative(path, m[1], files)
      if (target && target.startsWith(`${app}/`) && isSource(target) && !sources.has(target)) {
        sources.add(target)
        queue.push(target)
      }
    }
  }
  return sources
}

// Comments only: the specifiers are strings, which `stripNoise` would blank.
const stripImports = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/**
 * Every module-scoped registry the boot reaches.
 *
 * @param {Map<string, string>} files tracked path → source
 * @returns {Array<{ file: string, line: number, name: string, via: string }>}
 */
export function findBootRegistries(files) {
  const stripped = new Map()
  const strip = (path) => {
    if (!stripped.has(path)) stripped.set(path, stripNoise(files.get(path)))
    return stripped.get(path)
  }

  const definedIn = new Map()
  for (const [path, source] of files) {
    if (!isSource(path) || !source.includes('export')) continue
    for (const m of source.matchAll(EXPORTED_REGISTER)) {
      if (!definedIn.has(m[1])) definedIn.set(m[1], [])
      definedIn.get(m[1]).push(path)
    }
  }

  const boot = bootSources(files)
  const reached = new Map() // name → the name or boot file that reached it
  const queue = []
  for (const path of [...boot].sort()) {
    for (const name of namesCalled(strip(path))) {
      if (!reached.has(name)) {
        reached.set(name, path)
        queue.push(name)
      }
    }
  }
  const reachedIn = new Map() // file → reached names it defines
  while (queue.length) {
    const name = queue.shift()
    for (const path of definedIn.get(name) ?? []) {
      if (!reachedIn.has(path)) reachedIn.set(path, new Set())
      reachedIn.get(path).add(name)
      for (const callee of namesCalled(functionBody(strip(path), name))) {
        if (!reached.has(callee)) {
          reached.set(callee, name)
          queue.push(callee)
        }
      }
    }
  }

  const findings = []
  for (const [path, names] of [...reachedIn].sort(([a], [b]) => a.localeCompare(b))) {
    if (boot.has(path)) continue
    const source = files.get(path)
    const text = strip(path)
    const lines = source.split('\n')
    const lineOf = (index) => source.slice(0, index).split('\n').length
    const waived = (line) => WAIVER.test(lines[line - 2] ?? '') || WAIVER.test(lines[line - 1] ?? '')
    const via = [...names].sort().join(', ')

    for (const m of text.matchAll(TOP_LEVEL_COLLECTION)) {
      const name = m[1]
      const mutated = new RegExp(
        `\\b${name}\\s*(?:\\.\\s*(?:set|push|add|unshift|splice)\\s*\\(|\\[[^\\]]*\\]\\s*=(?!=))`,
      ).test(text)
      const line = lineOf(m.index)
      if (mutated && !waived(line)) findings.push({ file: path, line, name, via })
    }
    const bodies = [...names].map((name) => functionBody(text, name)).join('\n')
    for (const m of text.matchAll(TOP_LEVEL_LET)) {
      const name = m[1]
      const assigned = new RegExp(`(^|[^.\\w$])${name}\\s*(?:\\?\\?=|\\|\\|=|=(?![=>]))`, 'm').test(bodies)
      const line = lineOf(m.index)
      if (assigned && !waived(line)) findings.push({ file: path, line, name, via })
    }
  }
  return findings
}
