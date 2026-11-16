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
 * Every id a native plugin registers is one its `mobile.contributes` declares
 * (AGL-3671).
 *
 * The rule is the native plugin hosts' own, read from them rather than
 * restated: `NativePluginRegistrar.admit` (Swift, AglynPluginHost/Registry.swift)
 * and `NativePluginRegistrar.add` (Kotlin, pluginhost/NativePluginRegistry.kt)
 * refuse a registration whose id the plugin's `mobile.contributes.<kind>`
 * in plugins.config.json does not name, or that is not `<pluginId>.<name>`,
 * and the loader then UNREGISTERS THE WHOLE PLUGIN: one undeclared widget takes
 * every screen, tab and card of that plugin out of the app. The loader also
 * fails a plugin that declares an id it never registers.
 *
 * Nothing caught that before the apps ran. `generate:plugin-manifests:check`
 * proves the generated manifests match plugins.config.json; it never reads the
 * registrar, so a registrar naming a new id passes it. This reads the
 * registrar's calls in each plugin's Swift and Kotlin sources and holds them
 * to the declaration, per platform, because each app loads independently.
 *
 * What a registration is, statically:
 *  - a call on a `NativePluginRegistrar` parameter (`r.widget(…)`,
 *    `registrar.screen(…)`), by method: screen / upcomingScreen → screens,
 *    widget / staffWidget → widgets, tab → tabs, quickAction → quickActions,
 *    deepLink → deepLinks. Its first argument is a string literal, a
 *    constant (`let x = "…"`, `const val X = "…"`) in the plugin's sources, or
 *    an interpolated string (`"crm.\(section.rawValue)-page"`), which becomes
 *    a pattern;
 *  - `SpecScreens.register(…)`: every `*.screens.json` the platform bundles
 *    registers each spec as a screen, each link as `<id>.link`, `<id>.link2`…
 *    and each `cardSlot` as the widget `<id>.card` (ScreenCatalog's own
 *    `declaration`).
 *
 * An argument that is none of those (an enum case's property, say) is
 * DYNAMIC: it is counted and printed with `--verbose`, never guessed at.
 *
 * Verdicts:
 *  - error: a literal or constant id that is undeclared, or not the plugin's
 *    own; or a pattern that no declared id of its kind matches. Each is a
 *    plugin the apps would unload.
 *  - warning: a declared id the platform never registers, when every
 *    registration of that kind on that platform was read statically (a
 *    dynamic one could be the registration, so that kind is left unproven).
 */

import { MOBILE_CONTRIBUTION_KINDS } from './mobile-manifest.mjs'
import { androidModuleDir, iosPackageDir } from './native-manifest.mjs'

/** Registrar method → the `mobile.contributes` kind it registers. */
export const REGISTRAR_METHODS = Object.freeze({
  screen: 'screens',
  upcomingScreen: 'screens',
  widget: 'widgets',
  staffWidget: 'widgets',
  tab: 'tabs',
  quickAction: 'quickActions',
  deepLink: 'deepLinks',
})

const PLATFORM_LABEL = { ios: 'Apple', android: 'Android' }

/** Each file is read by three passes; blank its comments once. */
const blanked = new Map()

/**
 * `text` with every `//` and `/* *\/` comment blanked to spaces (newlines
 * kept), so offsets and line numbers still match the file and a commented-out
 * call is not read as a registration. Strings are left whole, so a `//` inside
 * one is not a comment. Block comments nest, as they do in Swift and Kotlin.
 */
export function blankComments(text) {
  const cached = blanked.get(text)
  if (cached !== undefined) return cached
  const pieces = []
  let kept = 0
  const blank = (from, to) => {
    pieces.push(text.slice(kept, from), text.slice(from, to).replace(/[^\n]/g, ' '))
    kept = to
  }
  const next = /"|\/[/*]/g
  let i = 0
  while (i < text.length) {
    next.lastIndex = i
    const hit = next.exec(text)
    if (!hit) break
    i = hit.index
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3)
      i = end < 0 ? text.length : end + 3
    } else if (text[i] === '"' && text[i - 1] === "'" && text[i + 1] === "'") {
      // Kotlin's character literal '"'.
      i++
    } else if (text[i] === '"') {
      i = stringEnd(text, i)
    } else if (text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      const stop = end < 0 ? text.length : end
      blank(i, stop)
      i = stop
    } else {
      let depth = 1
      let k = i + 2
      const marker = /\/\*|\*\//g
      while (depth > 0) {
        marker.lastIndex = k
        const m = marker.exec(text)
        if (!m) {
          k = text.length
          break
        }
        depth += m[0] === '/*' ? 1 : -1
        k = m.index + 2
      }
      blank(i, k)
      i = k
    }
  }
  pieces.push(text.slice(kept))
  const out = pieces.join('')
  blanked.set(text, out)
  return out
}

/** The offset just past the single-line string literal that opens at `start`. */
function stringEnd(text, start) {
  return readString(text, start)?.end ?? start + 1
}

/**
 * The single-line string literal opening at `start` (a `"`), as its static
 * text plus whether it interpolates: Swift `\(…)`, Kotlin `${…}` and `$name`.
 * Interpolated parts become `null` in `parts`. Returns null when the literal
 * does not close on its line.
 */
export function readString(text, start) {
  const parts = ['']
  let i = start + 1
  const push = (s) => {
    if (typeof parts[parts.length - 1] === 'string') parts[parts.length - 1] += s
    else parts.push(s)
  }
  const skipBalanced = (from, open, close) => {
    let depth = 1
    let k = from
    while (k < text.length && depth > 0) {
      if (text[k] === '\n') return -1
      if (text[k] === '"') {
        const inner = readString(text, k)
        if (!inner) return -1
        k = inner.end
        continue
      }
      if (text[k] === open) depth++
      else if (text[k] === close) depth--
      k++
    }
    return depth === 0 ? k : -1
  }
  while (i < text.length) {
    const c = text[i]
    if (c === '\n') return null
    if (c === '"') return { parts: parts.filter((p) => p !== ''), end: i + 1 }
    if (c === '\\') {
      if (text[i + 1] === '(') {
        const end = skipBalanced(i + 2, '(', ')')
        if (end < 0) return null
        parts.push(null)
        i = end
        continue
      }
      push(text[i + 1] ?? '')
      i += 2
      continue
    }
    if (c === '$' && text[i + 1] === '{') {
      const end = skipBalanced(i + 2, '{', '}')
      if (end < 0) return null
      parts.push(null)
      i = end
      continue
    }
    if (c === '$' && /[A-Za-z_]/.test(text[i + 1] ?? '')) {
      let k = i + 1
      while (k < text.length && /\w/.test(text[k])) k++
      parts.push(null)
      i = k
      continue
    }
    push(c)
    i++
  }
  return null
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A literal's parts as a value (no interpolation) or a pattern (each interpolation any non-empty run). */
function literalValue(parts) {
  if (parts.every((p) => typeof p === 'string')) return { type: 'literal', value: parts.join('') }
  const source = parts.map((p) => (p === null ? '.+' : escapeRegExp(p))).join('')
  const shown = parts.map((p) => (p === null ? '…' : p)).join('')
  return { type: 'pattern', regex: new RegExp(`^${source}$`), shown }
}

const lineAt = (text, offset) => text.slice(0, offset).split('\n').length

/**
 * The string constants and computed string properties a source file defines,
 * by simple name: `let x = "…"`, `static let x = "…"`, `const val X = "…"`,
 * `val x: String = "…"`, Swift `var x: String { "…" }` and Kotlin
 * `val x: String get() = "…"`. Values are `{ type: 'literal' | 'pattern' }`.
 */
export function constantsIn(source) {
  const text = blankComments(source)
  const found = []
  const forms = [
    /\b(?:let|val|var)\s+([A-Za-z_]\w*)\s*(?::\s*String\s*)?=\s*(?=")/g,
    /\bvar\s+([A-Za-z_]\w*)\s*:\s*String\s*\{\s*(?:return\s+)?(?=")/g,
    /\bval\s+([A-Za-z_]\w*)\s*(?::\s*String\s*)?get\s*\(\s*\)\s*=\s*(?=")/g,
  ]
  for (const form of forms) {
    for (const match of text.matchAll(form)) {
      const literal = readString(text, match.index + match[0].length)
      if (literal) found.push({ name: match[1], value: literalValue(literal.parts) })
    }
  }
  return found
}

/** The names a file gives its `NativePluginRegistrar` parameters (`r`, `registrar`). */
export function registrarNames(source) {
  return [...new Set([...blankComments(source).matchAll(/\b([A-Za-z_]\w*)\s*:\s*NativePluginRegistrar\b/g)].map((m) => m[1]))]
}

/**
 * Every registrar call in one source file: `{ kind, method, line, arg }`, where
 * `arg` is `{ type: 'literal', value }`, `{ type: 'pattern', regex, shown }`
 * or `{ type: 'symbol', name }` (resolved later against the plugin's
 * constants). `kind` is null for Kotlin's generic `add(…)`, which is read as
 * dynamic. Also says whether the file hands its registrar to `SpecScreens.register`.
 */
export function registrationsIn(source) {
  const text = blankComments(source)
  const names = registrarNames(source)
  const calls = []
  if (names.length) {
    const receivers = names.map(escapeRegExp).join('|')
    const methods = [...Object.keys(REGISTRAR_METHODS), 'add'].join('|')
    const call = new RegExp(`(?<![\\w.])(${receivers})\\s*\\??\\.\\s*(${methods})\\s*\\(\\s*(?:id\\s*=\\s*)?`, 'g')
    for (const match of text.matchAll(call)) {
      const method = match[2]
      const at = match.index + match[0].length
      const line = lineAt(text, match.index)
      const kind = method === 'add' ? null : REGISTRAR_METHODS[method]
      let arg
      if (text[at] === '"' && !text.startsWith('"""', at)) {
        const literal = readString(text, at)
        arg = literal ? literalValue(literal.parts) : { type: 'symbol', name: '(unterminated string)' }
      } else {
        const symbol = /^[A-Za-z_][\w.]*/.exec(text.slice(at))
        const name = symbol ? symbol[0] : text.slice(at, at + 40).split(/[\n,)]/)[0].trim()
        arg = { type: 'symbol', name }
      }
      calls.push({ kind, method, line, arg })
    }
  }
  const specs = /\bSpecScreens\s*\.\s*register\s*\(/.test(text)
  return { calls, specs }
}

/**
 * What one `*.screens.json` registers, as ScreenCatalog's `declaration` derives
 * it: each spec with an `id` and a `title` is a screen, its links are deep
 * links `<id>.link`, `<id>.link2`…, and a `cardSlot` makes the widget `<id>.card`.
 */
export function specContributions(json) {
  const out = []
  const screens = Array.isArray(json?.screens) ? json.screens : []
  for (const spec of screens) {
    if (typeof spec?.id !== 'string' || typeof spec?.title !== 'string') continue
    out.push({ kind: 'screens', id: spec.id, spec: spec.id })
    const links = Array.isArray(spec.links) ? spec.links.filter((l) => typeof l === 'string') : []
    links.forEach((_, index) => out.push({ kind: 'deepLinks', id: index === 0 ? `${spec.id}.link` : `${spec.id}.link${index + 1}`, spec: spec.id }))
    if (typeof spec.cardSlot === 'string') out.push({ kind: 'widgets', id: `${spec.id}.card`, spec: spec.id })
  }
  return out
}

/** Where a platform's sources and spec files live, for one native manifest row. */
export function platformTrees(row, platform) {
  if (platform === 'ios') {
    const dir = `${iosPackageDir(row.id)}/Sources/${row.ios.module}/`
    return {
      isSource: (path) => path.startsWith(dir) && path.endsWith('.swift'),
      isSpec: (path) => path.startsWith(dir) && path.endsWith('.screens.json'),
    }
  }
  const dir = `${androidModuleDir(row.id)}/`
  return {
    // Main source sets only (commonMain, androidMain, desktopMain…): tests register through spec registrars of their own.
    isSource: (path) => path.startsWith(`${dir}src/`) && /^[^/]+Main\//.test(path.slice(`${dir}src/`.length)) && path.endsWith('.kt'),
    isSpec: (path) => path.startsWith(`${dir}screens/`) && path.endsWith('.screens.json'),
  }
}

/**
 * Resolves a symbol argument against the plugin's constants: an unqualified
 * name, or `Type.name`, by its simple name when exactly one value is defined
 * for it; an instance property (`kind.widgetID`) only through a computed
 * string property of that name. Anything else stays dynamic (null).
 */
function resolveSymbol(name, constants) {
  const segments = name.split('.')
  const simple = segments[segments.length - 1]
  const qualifiedByInstance = segments.length > 1 && /^[a-z]/.test(segments[segments.length - 2])
  const candidates = constants.filter((c) => c.name === simple)
  if (!candidates.length) return null
  const distinct = new Map(candidates.map((c) => [c.value.type === 'literal' ? `l:${c.value.value}` : `p:${c.value.regex.source}`, c.value]))
  if (distinct.size !== 1) return null
  const [value] = distinct.values()
  if (qualifiedByInstance && value.type === 'literal') return null
  return value
}

/**
 * Holds one plugin's registrations on one platform to its declaration.
 *
 * @param {{ id: string, contributes: Record<string, string[]> }} row
 * @param {'ios' | 'android'} platform
 * @param {{ path: string, text: string }[]} sources
 * @param {{ path: string, text: string }[]} specs
 */
export function evaluatePlatform(row, platform, sources, specs) {
  const where = `${row.id} (${PLATFORM_LABEL[platform]})`
  const declared = (kind) => row.contributes[kind] ?? []
  const errors = []
  const dynamic = []
  const registered = Object.fromEntries(MOBILE_CONTRIBUTION_KINDS.map((kind) => [kind, new Set()]))
  const patterns = Object.fromEntries(MOBILE_CONTRIBUTION_KINDS.map((kind) => [kind, []]))
  const opaque = new Set()
  const constants = sources.flatMap((source) => constantsIn(source.text))
  let readsSpecs = false
  let count = 0

  const admit = (kind, id, at, how) => {
    count++
    registered[kind].add(id)
    if (!id.startsWith(`${row.id}.`) || id.length <= row.id.length + 1) {
      errors.push({
        plugin: row.id,
        platform,
        at,
        kind,
        id,
        message: `${where} ${at}: registers ${kind} "${id}"${how}, which is not "${row.id}.<name>": a plugin registers only its own ids, and the apps unload the whole plugin when it tries another's`,
      })
    } else if (!declared(kind).includes(id)) {
      errors.push({
        plugin: row.id,
        platform,
        at,
        kind,
        id,
        message: `${where} ${at}: registers ${kind} "${id}"${how}, which plugins.config.json's "${row.id}" mobile.contributes.${kind} does not declare. The apps unload the whole plugin over it: add "${id}" to mobile.contributes.${kind} and run node tools/scripts/generate-plugin-manifests.mjs`,
      })
    }
  }

  for (const source of sources) {
    const { calls, specs: handsToSpecs } = registrationsIn(source.text)
    readsSpecs ||= handsToSpecs
    for (const call of calls) {
      const at = `${source.path}:${call.line}`
      let arg = call.arg
      let how = ''
      if (arg.type === 'symbol') {
        const resolved = call.kind ? resolveSymbol(arg.name, constants) : null
        if (!resolved) {
          dynamic.push({ plugin: row.id, platform, at, kind: call.kind, method: call.method, name: arg.name })
          if (call.kind) opaque.add(call.kind)
          else MOBILE_CONTRIBUTION_KINDS.forEach((kind) => opaque.add(kind))
          continue
        }
        how = ` (through ${arg.name})`
        arg = resolved
      }
      if (arg.type === 'literal') {
        admit(call.kind, arg.value, at, how)
        continue
      }
      count++
      patterns[call.kind].push(arg.regex)
      if (!declared(call.kind).some((id) => arg.regex.test(id))) {
        errors.push({
          plugin: row.id,
          platform,
          at,
          kind: call.kind,
          id: arg.shown,
          message: `${where} ${at}: registers ${call.kind} "${arg.shown}"${how}, and no id in plugins.config.json's "${row.id}" mobile.contributes.${call.kind} matches it, so every id it makes is undeclared and the apps unload the whole plugin`,
        })
      }
    }
  }

  if (readsSpecs) {
    for (const spec of specs) {
      let json
      try {
        json = JSON.parse(spec.text)
      } catch (error) {
        errors.push({ plugin: row.id, platform, at: spec.path, kind: null, id: null, message: `${where} ${spec.path}: not JSON (${error.message})` })
        continue
      }
      for (const entry of specContributions(json)) {
        const offset = spec.text.indexOf(`"${entry.spec}"`)
        admit(entry.kind, entry.id, `${spec.path}:${offset < 0 ? 1 : lineAt(spec.text, offset)}`, ` (spec "${entry.spec}")`)
      }
    }
  }

  const warnings = []
  const unproven = []
  for (const kind of MOBILE_CONTRIBUTION_KINDS) {
    for (const id of declared(kind)) {
      if (registered[kind].has(id) || patterns[kind].some((regex) => regex.test(id))) continue
      if (opaque.has(kind)) {
        unproven.push({ plugin: row.id, platform, kind, id })
        continue
      }
      warnings.push({
        plugin: row.id,
        platform,
        kind,
        id,
        message: `${where}: declares ${kind} "${id}" in mobile.contributes, and no ${PLATFORM_LABEL[platform]} registration names it. The loader fails a plugin that declares an id it never registers: register it, or drop it from the declaration`,
      })
    }
  }
  return { errors, warnings, dynamic, unproven, count }
}

/**
 * Every native plugin, on every platform it names.
 *
 * @param {object[]} rows `nativeManifestRows(plugins.config.json plugins)`
 * @param {string[]} files repo-relative tracked paths
 * @param {(path: string) => string} read
 */
export function evaluateNativeDeclarations(rows, files, read) {
  const result = { errors: [], warnings: [], dynamic: [], unproven: [], count: 0, platforms: 0 }
  for (const row of rows) {
    for (const platform of ['ios', 'android']) {
      if (!row[platform]) continue
      const trees = platformTrees(row, platform)
      const sources = files.filter(trees.isSource).map((path) => ({ path, text: read(path) }))
      const specs = files.filter(trees.isSpec).map((path) => ({ path, text: read(path) }))
      const one = evaluatePlatform(row, platform, sources, specs)
      result.platforms++
      result.count += one.count
      if (!sources.length) {
        result.errors.push({
          plugin: row.id,
          platform,
          at: null,
          kind: null,
          id: null,
          message: `${row.id} (${PLATFORM_LABEL[platform]}): plugins.config.json names its registrar, and no source under its ${platform === 'ios' ? `Sources/${row.ios.module}` : 'src/*Main'} was found to read`,
        })
      }
      for (const key of ['errors', 'warnings', 'dynamic', 'unproven']) result[key].push(...one[key])
    }
  }
  return result
}
