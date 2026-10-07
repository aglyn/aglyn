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
 * The pure half of `check:mobile-isolation` (AGL-3620, AGL-3651).
 *
 * The native apps and the web apps share one repository and never one byte.
 * Two things are held here:
 *
 *  - THE PURE LIST. `tools/scripts/mobile-pure-modules.json` names the
 *    TypeScript modules the native generators (contracts, theme, catalog) may
 *    read. A listed module is admitted only while its own imports are listed
 *    pure modules or platform-neutral packages, with no DOM, no Node built-in
 *    and nothing web- or server-only (`provePureModules`), so the list grows
 *    only with that proof.
 *  - THE NATIVE TREES, at the file level, both ways (the native walk below).
 *
 * Type-only imports are erased by the compiler and are not edges.
 */

import { builtinModules } from 'node:module'
import { posix } from 'node:path'

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

export function isCodeFile(path) {
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext)) && !path.endsWith('.d.ts')
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

/** Platform-neutral packages a pure module may import. */
const NEUTRAL_PACKAGES = new Set(['react', 'firebase'])

/** Refused from a pure module by name, with the reason a person reads. */
export function bannedForPure(specifier) {
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

/**
 * The allowlist's proof: every listed module's own imports are listed pure
 * modules or neutral packages, with no DOM, no Node built-in and nothing
 * web-only. A module that fails is reported with the edge that broke it.
 */
export function provePureModules({ pure, read, aliases, exists }) {
  const failures = []
  const pureSet = new Set(pure)
  for (const file of pure) {
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
      const banned = bannedForPure(specifier)
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

/* ---------------------------------------------------------------------------
 * The native walk (docs/mobile/native-architecture.md §9)
 *
 * The Swift and Kotlin apps are their own toolchains, so their isolation is
 * held at the file level, both ways:
 *
 *  - WEB → NATIVE. No TS/JS file imports, requires or `new URL()`s a path in
 *    a native tree, no tsconfig `include`/`files`/`paths`/`references` entry
 *    reaches into one, and no `@aglyn/*` alias resolves into one.
 *  - NATIVE → WEB. No Swift, Kotlin, Gradle, Xcode or config file in a
 *    native tree names a relative path that leaves the native trees (a
 *    `sourceSets` dir, a `path:` dependency, an include into `apps/console`
 *    or a plugin's web source), and none names `firebase-admin`, a service
 *    account or a Stripe secret key. A symlink in a native tree points into
 *    the native trees.
 *  - MISPLACED. A `.swift`, `.kt` or `.kts` file lives in a native tree.
 *
 * The only sanctioned crossings are the generated files (§3, §5–§7): their
 * generators READ the pure TypeScript modules and WRITE into the native
 * trees, and nothing in either side imports the other.
 * ------------------------------------------------------------------------- */

/** Trees that hold native code: the apps, the native libs, and each plugin's `src/ios` and `src/android`. */
export const NATIVE_ROOTS = ['apps/ios/', 'apps/android/', 'libs/native/']
export const PLUGIN_NATIVE = /^libs\/plugins\/[^/]+\/src\/(ios|android)(\/|$)/

export function isNativePath(path) {
  const p = path.endsWith('/') ? path : `${path}/`
  return NATIVE_ROOTS.some((root) => p.startsWith(root)) || PLUGIN_NATIVE.test(path)
}

const NATIVE_SOURCE = /\.(swift|kt|kts)$/
/** Text files in a native tree that can name a path or a secret. Binaries (images, fonts) are skipped. */
const NATIVE_TEXT =
  /\.(swift|kt|kts|gradle|properties|toml|xcconfig|plist|pbxproj|xcscheme|xcworkspacedata|entitlements|json|xml|yml|yaml|pro|cfg|sh)$/

/** Web or server trees a native file may never point into. */
export function nativeForbiddenReason(path) {
  if (/^apps\/(console|tenant|docs)(\/|$)/.test(path)) return 'a web app'
  if (/^libs\/(aglyn|tenant|besigner|shared|mobile)(\/|$)/.test(path)) return 'web or server code'
  if (/^libs\/plugins\/[^/]+\/src(\/|$)/.test(path) && !PLUGIN_NATIVE.test(path)) return "a plugin's web or server source"
  return 'a path outside the native trees'
}

const SECRETS = [
  [/firebase-admin/, 'names firebase-admin, which is server-only'],
  [/\bsk_(live|test)_[A-Za-z0-9]{8,}/, 'holds a Stripe secret key'],
  [/"type"\s*:\s*"service_account"|service[-_]?account[^/\s"']*\.json/i, 'names a service account'],
]

const resolveFrom = (from, relative) => posix.normalize(posix.join(posix.dirname(from), relative))

/** The relative paths a native file names: `../x`, `./x`, in quotes or bare after `=`/`(`. */
export function relativePathsIn(source) {
  const found = new Set()
  for (const match of source.matchAll(/(?:^|[\s"'=(:,])((?:\.\.?\/)+[^\s"'(),;]*)/gm)) found.add(match[1])
  return [...found]
}

function stripJsonComments(text) {
  const { code } = scanSource(text)
  return code.replace(/,(\s*[}\]])/g, '$1')
}

/** A tsconfig entry's directory part: the static prefix before its first glob. */
const staticPrefix = (entry) => entry.split(/[*?{[]/)[0].replace(/\/[^/]*$/, (tail) => (tail.includes('.') ? '' : tail))

/**
 * Web → native over TS/JS sources and tsconfigs. `aliases` is the
 * `aliasTable` of tsconfig.base.json.
 */
export function evaluateWebToNative({ files, read, aliases }) {
  const failures = []
  for (const [alias, target] of [...aliases.exact, ...aliases.prefix]) {
    if (isNativePath(target)) {
      failures.push({ direction: 'web→native', file: 'tsconfig.base.json', specifier: alias, why: `maps into ${target}` })
    }
  }
  for (const file of files) {
    if (isNativePath(file) || file.split('/').includes('node_modules')) continue
    if (/(^|\/)tsconfig[^/]*\.json$/.test(file)) {
      let config
      try {
        config = JSON.parse(stripJsonComments(read(file)))
      } catch {
        continue
      }
      const entries = [
        ...(config.include ?? []),
        ...(config.files ?? []),
        ...(config.references ?? []).map((ref) => ref?.path).filter(Boolean),
        ...Object.values(config.compilerOptions?.paths ?? {}).flat(),
      ]
      for (const entry of entries) {
        const target = resolveFrom(file, staticPrefix(String(entry)) || '.')
        if (isNativePath(target)) {
          failures.push({ direction: 'web→native', file, specifier: String(entry), why: `reaches into ${target}` })
        }
      }
      continue
    }
    if (!isCodeFile(file)) continue
    let source
    try {
      source = read(file)
    } catch {
      continue
    }
    const { code, bare } = scanSource(source)
    const specifiers = importSpecifiers(source)
    for (const match of bare.matchAll(/\bnew\s+URL\s*\(\s*(['"`])/g)) {
      const quote = match.index + match[0].length - 1
      const close = code.indexOf(code[quote], quote + 1)
      if (close > quote) specifiers.push(code.slice(quote + 1, close))
    }
    for (const specifier of specifiers) {
      let target = null
      if (specifier.startsWith('.')) target = resolveFrom(file, specifier)
      else if (specifier.startsWith('@aglyn/')) {
        const exact = aliases.exact.get(specifier)
        const prefix = aliases.prefix.find(([from]) => specifier.startsWith(from))
        target = exact ?? (prefix ? prefix[1] + specifier.slice(prefix[0].length) : null)
      } else if (/^(apps|libs)\//.test(specifier)) target = posix.normalize(specifier)
      if (target && isNativePath(target)) {
        failures.push({ direction: 'web→native', file, specifier, why: `reaches native code ${target}` })
      }
    }
  }
  return failures
}

/**
 * Native → web, misplaced native sources and native symlinks. `readLink(path)`
 * returns a symlink's target, or null for a regular file.
 */
export function evaluateNativeToWeb({ files, read, readLink = () => null }) {
  const failures = []
  for (const file of files) {
    if (file.split('/').includes('node_modules')) continue
    const native = isNativePath(file)
    if (!native) {
      if (NATIVE_SOURCE.test(file)) {
        failures.push({
          direction: 'misplaced',
          file,
          specifier: posix.extname(file),
          why: 'native source belongs in apps/ios, apps/android, libs/native or a plugin\'s src/ios|src/android',
        })
      }
      continue
    }
    const link = readLink(file)
    if (link !== null) {
      const target = resolveFrom(file, link)
      if (!isNativePath(target)) {
        failures.push({ direction: 'native→web', file, specifier: link, why: `is a symlink into ${nativeForbiddenReason(target)} (${target})` })
      }
      continue
    }
    if (!NATIVE_TEXT.test(file) && !/(^|\/)(Package\.swift|gradlew|Podfile|Cartfile)$/.test(file)) continue
    let source
    try {
      source = read(file)
    } catch {
      continue
    }
    // A JSON file's `$schema` (Nx's project.json) is editor metadata, never a build input.
    if (file.endsWith('.json')) source = source.replace(/"\$schema"\s*:\s*"[^"]*"/g, '')
    // Xcode writes a project's paths relative to the folder holding the .xcodeproj.
    const bundle = /^(.*?)\/[^/]+\.(xcodeproj|xcworkspace)\//.exec(file)
    const base = bundle ? `${bundle[1]}/project` : file
    for (const relative of relativePathsIn(source)) {
      const target = resolveFrom(base, relative)
      if (target.startsWith('..')) {
        failures.push({ direction: 'native→web', file, specifier: relative, why: 'leaves the repository' })
      } else if (!isNativePath(target)) {
        failures.push({ direction: 'native→web', file, specifier: relative, why: `points into ${nativeForbiddenReason(target)} (${target})` })
      }
    }
    for (const [pattern, why] of SECRETS) {
      const hit = pattern.exec(source)
      if (hit) failures.push({ direction: 'native→web', file, specifier: hit[0].slice(0, 24), why })
    }
  }
  return failures
}
