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
 * The pure half of `check:mobile-isolation` (AGL-3620).
 *
 * The native apps and the web apps share one repository and never one byte.
 * Two directions, both enforced over the import graph:
 *
 *  - WEB → MOBILE. No file a web app can reach (console, tenant, docs, core,
 *    shared, and every plugin file outside `src/mobile`) imports React
 *    Native, Expo, React Navigation, `libs/mobile`, `@aglyn/mobile-*` or a
 *    plugin's `/mobile` entry. Because EVERY non-mobile file is held to this,
 *    no web entry (`src/index.ts`, `server.ts`, `declarations*.ts`) can reach
 *    `src/mobile` transitively either: the path would need one edge from a
 *    non-mobile file into mobile code, and that edge is the red.
 *  - MOBILE → WEB. From every file of `apps/mobile`, `apps/pos-mobile`,
 *    `libs/mobile/*` and each plugin's `src/mobile`, imports are followed
 *    transitively. A bare package must be a mobile package; MUI, Emotion,
 *    Next, React DOM, firebase-admin, the Stripe Node SDK and Node built-ins
 *    are refused by name. A workspace module outside the mobile trees must be
 *    on the PURE allowlist, and an allowlisted module is admitted only while
 *    its own closure is pure (`provePureModules`), so the list can grow only
 *    with that proof. The DOM (`document`) is refused outside string
 *    literals: a WebView's injected script is a string, and runs in the page.
 *
 * Type-only imports are erased by the compiler and are not edges.
 */

import { builtinModules } from 'node:module'
import { posix } from 'node:path'

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** Trees a web app bundles or serves from. */
export const WEB_ROOTS = [
  'apps/console/',
  'apps/tenant/',
  'apps/docs/',
  'libs/aglyn/',
  'libs/tenant/',
  'libs/besigner/',
  'libs/shared/',
  'libs/plugins/',
]

/** Trees that are mobile code. */
export const MOBILE_ROOTS = ['apps/mobile/', 'apps/pos-mobile/', 'libs/mobile/']

/** A plugin's mobile entry: `libs/plugins/<id>/src/mobile/…`. */
export const PLUGIN_MOBILE = /^libs\/plugins\/[^/]+\/src\/mobile\//

/**
 * Build-time configs at a mobile app's root run in Node under Expo's CLI,
 * Metro or jest, and are never bundled into the app.
 */
const MOBILE_BUILD_CONFIG = /^apps\/(mobile|pos-mobile)\/[^/]+\.config\.(js|ts|cjs|mjs)$/

export function isMobileFile(path) {
  return MOBILE_ROOTS.some((root) => path.startsWith(root)) || PLUGIN_MOBILE.test(path)
}

export function isCodeFile(path) {
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext)) && !path.endsWith('.d.ts')
}

const isSpec = (path) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(path)

/** Mobile files the graph starts from: everything the apps can bundle. */
export function mobileRoots(files) {
  return files.filter(
    (path) =>
      isMobileFile(path) &&
      isCodeFile(path) &&
      !isSpec(path) &&
      !MOBILE_BUILD_CONFIG.test(path) &&
      !path.split('/').includes('node_modules'),
  )
}

/** Web files whose imports are held to the web → mobile rule. */
export function webFiles(files) {
  return files.filter(
    (path) =>
      WEB_ROOTS.some((root) => path.startsWith(root)) &&
      !isMobileFile(path) &&
      isCodeFile(path) &&
      !path.split('/').includes('node_modules'),
  )
}

/* ---------------------------------------------------------------------------
 * Source scanning
 * ------------------------------------------------------------------------- */

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', ''])

/**
 * The source twice over: once with comments removed (strings intact, for
 * import specifiers) and once with every string, template and regex literal
 * blanked as well (for code-only patterns such as DOM access). Lengths and
 * line breaks are preserved so a match keeps its position.
 */
export function scanSource(source) {
  let code = ''
  let bare = ''
  let i = 0
  let last = ''
  const n = source.length
  const keep = (text, blankText = text) => {
    code += text
    bare += blankText
  }
  const blank = (text) => text.replace(/[^\n]/g, ' ')
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end < 0 ? n : end
      keep(blank(source.slice(i, stop)))
      i = stop
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      keep(blank(source.slice(i, stop)))
      i = stop
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < n && source[j] !== ch) {
        if (source[j] === '\\') j += 1
        else if (ch !== '`' && source[j] === '\n') break
        j += 1
      }
      const text = source.slice(i, j + 1)
      keep(text, ch + blank(text.slice(1, -1)) + (text.length > 1 ? ch : ''))
      i = j + 1
      last = ch
      continue
    }
    if (ch === '/' && REGEX_PRECEDERS.has(last)) {
      let j = i + 1
      let inClass = false
      while (j < n && source[j] !== '\n') {
        if (source[j] === '\\') j += 1
        else if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break
        j += 1
      }
      if (source[j] === '/') {
        const text = source.slice(i, j + 1)
        keep(text, `/${blank(text.slice(1, -1))}/`)
        i = j + 1
        last = '/re'
        continue
      }
    }
    keep(ch)
    if (!/\s/.test(ch)) last = /[A-Za-z0-9_$)\]]/.test(ch) ? 'id' : ch
    i += 1
  }
  return { code, bare }
}

/**
 * Every runtime module specifier a source imports: static imports and
 * re-exports, side-effect imports, dynamic `import()` and `require()`.
 * `import type …`, `export type …` and a brace list that is all `type`
 * names are erased by the compiler and are not returned.
 */
export function importSpecifiers(source) {
  // Patterns run over the literal-blanked text, so an import written inside
  // a string or a comment is never an edge; the specifier itself is then read
  // from the same offsets of the text with its strings intact.
  const { code, bare } = scanSource(source)
  const specifierAt = (quoteIndex) => {
    const quote = code[quoteIndex]
    const close = code.indexOf(quote, quoteIndex + 1)
    return close < 0 ? null : code.slice(quoteIndex + 1, close)
  }
  const found = new Set()
  // The clause between the keyword and `from` is names, braces, commas and
  // `*` only, so a match can never start at one statement and end at another.
  const statement = /\b(import|export)\s+(type\s+)?([\w$\s{},*]*?)\s*from\s*(['"])/g
  for (const match of bare.matchAll(statement)) {
    const [whole, , typeOnly, clause] = match
    if (typeOnly) continue
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim())
    if (braces) {
      const names = braces[1].split(',').map((name) => name.trim()).filter(Boolean)
      if (names.length && names.every((name) => name.startsWith('type '))) continue
    }
    const specifier = specifierAt(match.index + whole.length - 1)
    if (specifier) found.add(specifier)
  }
  for (const match of bare.matchAll(/(?:^|[^\w$.])import\s*(['"])/g)) {
    const specifier = specifierAt(match.index + match[0].length - 1)
    if (specifier) found.add(specifier)
  }
  for (const match of bare.matchAll(/(?:^|[^\w$.])(?:import|require)\s*\(\s*(['"])/g)) {
    const specifier = specifierAt(match.index + match[0].length - 1)
    if (specifier) found.add(specifier)
  }
  return [...found]
}

/** DOM access in code (not in a string): `document.…`, `window.document`. */
export function domAccess(source) {
  const { bare } = scanSource(source)
  const hits = []
  const pattern = /(?<![\w$.])document\s*[.[]|\bwindow\s*\.\s*document\b|\bglobalThis\s*\.\s*document\b/g
  for (const match of bare.matchAll(pattern)) {
    hits.push(bare.slice(0, match.index).split('\n').length)
  }
  return hits
}

/* ---------------------------------------------------------------------------
 * Resolution
 * ------------------------------------------------------------------------- */

/** `tsconfig.base.json` paths as [alias, target] pairs, exact first, then longest prefix. */
export function aliasTable(paths) {
  const exact = new Map()
  const prefix = []
  for (const [alias, targets] of Object.entries(paths ?? {})) {
    const target = String(targets?.[0] ?? '').replace(/^\.\//, '')
    if (!target) continue
    if (alias.endsWith('/*')) prefix.push([alias.slice(0, -1), target.replace(/\*$/, '')])
    else exact.set(alias, target)
  }
  prefix.sort((a, b) => b[0].length - a[0].length)
  return { exact, prefix }
}

/** The npm package a bare specifier names: `@scope/name` or `name`. */
export function packageOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

export function isNodeBuiltin(specifier) {
  return specifier.startsWith('node:') || BUILTINS.has(specifier) || BUILTINS.has(packageOf(specifier))
}

/**
 * Resolves a specifier from `from` to a workspace file, a package, or null.
 * `exists(path)` answers for repo-relative paths.
 */
export function resolveSpecifier(specifier, from, { aliases, exists }) {
  const candidates = (base) => [
    base,
    ...CODE_EXTENSIONS.map((ext) => base + ext),
    ...CODE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ]
  const firstExisting = (base) => candidates(posix.normalize(base)).find((path) => exists(path)) ?? null
  if (specifier.startsWith('.')) {
    const target = firstExisting(posix.join(posix.dirname(from), specifier))
    return target ? { kind: 'file', path: target } : { kind: 'unresolved', specifier }
  }
  if (specifier.startsWith('@aglyn/')) {
    const exact = aliases.exact.get(specifier)
    let base = exact ?? null
    if (!base) {
      for (const [from_, to] of aliases.prefix) {
        if (specifier.startsWith(from_)) {
          base = to + specifier.slice(from_.length)
          break
        }
      }
    }
    if (base) {
      const target = firstExisting(base)
      return target ? { kind: 'file', path: target } : { kind: 'unresolved', specifier }
    }
  }
  return { kind: 'package', name: packageOf(specifier), specifier }
}

/* ---------------------------------------------------------------------------
 * Rules
 * ------------------------------------------------------------------------- */

/** Packages that exist only for the native apps. */
export function isMobilePackage(name) {
  return (
    name === 'react-native' ||
    name.startsWith('react-native-') ||
    name.startsWith('@react-native/') ||
    name.startsWith('@react-native-') ||
    name === 'expo' ||
    name.startsWith('expo-') ||
    name.startsWith('@expo/') ||
    name.startsWith('@react-navigation/') ||
    name === '@stripe/stripe-terminal-react-native'
  )
}

/** Platform-neutral packages mobile code may also import. */
const NEUTRAL_PACKAGES = new Set(['react', 'firebase', '@tanstack/react-query', '@tanstack/query-async-storage-persister', '@tanstack/react-query-persist-client'])

export function isAllowedMobilePackage(name) {
  return isMobilePackage(name) || NEUTRAL_PACKAGES.has(name) || name.startsWith('@firebase/')
}

/** Refused from mobile code by name, with the reason a person reads. */
export function bannedForMobile(specifier) {
  const name = packageOf(specifier)
  if (isNodeBuiltin(specifier)) return 'a Node built-in'
  if (name.startsWith('@mui/')) return 'MUI (web UI)'
  if (name.startsWith('@emotion/')) return 'Emotion (web styling)'
  if (name === 'next') return 'Next.js'
  if (name === 'react-dom') return 'React DOM'
  if (name === 'firebase-admin' || name.startsWith('@google-cloud/')) return 'server-only (admin SDK)'
  if (name === 'stripe') return 'the Stripe Node SDK (server-only)'
  if (/\.(css|scss|sass|less)$/.test(specifier)) return 'a stylesheet'
  return null
}

/** A web-only or server-only workspace path, named for the message. */
export function webOnlyReason(path) {
  if (path.startsWith('libs/besigner/')) return 'the Besigner (web UI)'
  if (path.startsWith('libs/tenant/feature/')) return 'a web UI lib'
  if (/(^|\/)server(\/|\.ts$|\.tsx$)/.test(path)) return 'server-only code'
  if (/secret-box/.test(path)) return 'server-only secrets'
  if (/-admin(\/|$)/.test(path) || /\/admin\/src\//.test(path)) return 'server-only (admin)'
  if (/^libs\/plugins\/[^/]+\/src\/(index|server)\.tsx?$/.test(path)) return "a plugin's web entry"
  if (/\/components\//.test(path)) return 'web components'
  if (/\.(css|scss|sass|less)$/.test(path)) return 'a stylesheet'
  return null
}

/** Is a web file's import of `specifier` (resolved to `target`) a mobile edge? */
export function mobileEdge(specifier, target) {
  if (target.kind === 'package' && isMobilePackage(target.name)) return `imports ${target.name}`
  if (/^@aglyn\/mobile-/.test(specifier)) return `imports ${specifier}`
  if (/^@aglyn\/plugins-[^/]+\/mobile(\/|$)/.test(specifier)) return `imports ${specifier}`
  if (target.kind === 'file' && isMobileFile(target.path)) return `imports mobile code ${target.path}`
  return null
}

/**
 * Web → mobile. Returns one failure per offending import.
 * `read(path)` returns source text.
 */
export function evaluateWebToMobile({ files, read, aliases, exists }) {
  const failures = []
  for (const file of webFiles(files)) {
    let source
    try {
      source = read(file)
    } catch {
      continue
    }
    for (const specifier of importSpecifiers(source)) {
      const target = resolveSpecifier(specifier, file, { aliases, exists })
      const why = mobileEdge(specifier, target)
      if (why) failures.push({ direction: 'web→mobile', file, specifier, why })
    }
  }
  return failures
}

/**
 * Mobile → web. Walks from every mobile root; returns one failure per
 * offending edge, and the set of pure modules mobile code reached.
 */
export function evaluateMobileToWeb({ files, read, aliases, exists, pure }) {
  const failures = []
  const reachedPure = new Set()
  const seen = new Set()
  const queue = mobileRoots(files)
  const pureSet = new Set(pure)
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    let source
    try {
      source = read(file)
    } catch {
      continue
    }
    for (const line of domAccess(source)) {
      failures.push({ direction: 'mobile→web', file, specifier: `line ${line}`, why: 'touches the DOM outside a string' })
    }
    for (const specifier of importSpecifiers(source)) {
      const banned = bannedForMobile(specifier)
      if (banned) {
        failures.push({ direction: 'mobile→web', file, specifier, why: banned })
        continue
      }
      const target = resolveSpecifier(specifier, file, { aliases, exists })
      if (target.kind === 'unresolved') {
        failures.push({ direction: 'mobile→web', file, specifier, why: 'does not resolve to a file' })
        continue
      }
      if (target.kind === 'package') {
        if (!isAllowedMobilePackage(target.name)) {
          failures.push({ direction: 'mobile→web', file, specifier, why: `${target.name} is not a mobile package` })
        }
        continue
      }
      if (isMobileFile(target.path)) {
        queue.push(target.path)
        continue
      }
      if (pureSet.has(target.path)) {
        reachedPure.add(target.path)
        continue
      }
      const reason = webOnlyReason(target.path)
      failures.push({
        direction: 'mobile→web',
        file,
        specifier,
        why: reason
          ? `reaches ${reason}: ${target.path}`
          : `reaches ${target.path}, which is not on the proven-pure allowlist`,
      })
    }
  }
  // What the reached pure modules reach in turn (their proof is separate).
  const pending = [...reachedPure]
  while (pending.length) {
    const file = pending.pop()
    let source
    try {
      source = read(file)
    } catch {
      continue
    }
    for (const specifier of importSpecifiers(source)) {
      const target = resolveSpecifier(specifier, file, { aliases, exists })
      if (target.kind === 'file' && pureSet.has(target.path) && !reachedPure.has(target.path)) {
        reachedPure.add(target.path)
        pending.push(target.path)
      }
    }
  }
  return { failures, reachedPure: [...reachedPure].sort() }
}

/**
 * The allowlist's proof: every listed module's own imports are listed pure
 * modules or neutral packages, with no DOM, no Node built-in and nothing
 * web-only. A module that fails is reported with the edge that broke it.
 */
export function provePureModules({ pure, read, aliases, exists }) {
  const failures = []
  const pureSet = new Set(pure)
  for (const file of pure) {
    if (isMobileFile(file)) {
      failures.push({ direction: 'pure', file, specifier: '', why: 'is mobile code, which needs no allowlisting' })
      continue
    }
    let source
    try {
      source = read(file)
    } catch {
      failures.push({ direction: 'pure', file, specifier: '', why: 'does not exist' })
      continue
    }
    for (const line of domAccess(source)) {
      failures.push({ direction: 'pure', file, specifier: `line ${line}`, why: 'touches the DOM' })
    }
    for (const specifier of importSpecifiers(source)) {
      const banned = bannedForMobile(specifier)
      if (banned) {
        failures.push({ direction: 'pure', file, specifier, why: banned })
        continue
      }
      const target = resolveSpecifier(specifier, file, { aliases, exists })
      if (target.kind === 'package') {
        if (!NEUTRAL_PACKAGES.has(target.name) && !target.name.startsWith('@firebase/')) {
          failures.push({ direction: 'pure', file, specifier, why: `${target.name} is not a platform-neutral package` })
        }
        continue
      }
      if (target.kind === 'unresolved') {
        failures.push({ direction: 'pure', file, specifier, why: 'does not resolve to a file' })
        continue
      }
      if (!pureSet.has(target.path)) {
        failures.push({
          direction: 'pure',
          file,
          specifier,
          why: `imports ${target.path}, which is not on the allowlist (list it, with its own proof, or split the pure part out)`,
        })
      }
    }
  }
  return failures
}

export function formatFailures(failures) {
  return failures.map((failure) => `  [${failure.direction}] ${failure.file}: ${failure.specifier} — ${failure.why}`).join('\n')
}
