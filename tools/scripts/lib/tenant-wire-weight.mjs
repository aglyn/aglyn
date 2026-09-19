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
 * The measurement and the verdict behind `check-tenant-wire-weight.mjs`
 * (AGL-3082): the JavaScript a published page downloads before it settles,
 * read out of a tenant PRODUCTION BUILD.
 *
 * ## Why a build, when `check:tenant-page-weight` needs none
 *
 * That gate weighs the SOURCE the page's client root statically reaches. It is
 * the right proxy for "did an import start dragging something in", and it is
 * blind to three things that decide what a visitor downloads:
 *
 * - tree shaking. A module the walk counts can be absent from every chunk, and
 *   a module it never sees can be most of one;
 * - `import()`. The page loads its site plugins, the consent banner and
 *   real-user vitals through dynamic imports before the network goes quiet,
 *   and a static walk stops at every one of them. On aglyn.com (beta.129)
 *   that was 480 of the 747 KB of script;
 * - the chunker. Turbopack decides which modules share a file, and a module
 *   can be emitted in several.
 *
 * So this reads what the chunker emitted, in the units the wire bills.
 *
 * ## What counts as "before settle"
 *
 * The page's eager chunks: `build-manifest.json`'s `rootMainFiles` plus every
 * chunk the route's client-reference manifest names. Those are exactly the
 * scripts the document names (checked against a real cold load: 23 of 23).
 *
 * Then the dynamic imports that fire on their own before the page settles,
 * DECLARED in the budget file as `{ from, import }` — the importing source
 * file and the specifier it imports. Each is found in the build by its call
 * site: a Turbopack dynamic import compiles to `<ctx>.A(<loader id>)`, the
 * loader is `<id>, s => { s.v(t => Promise.all([<chunk files>]…)) }`, and the
 * chunk's source map places the call site on the original line that holds the
 * `import('…')`. Keying on the call site rather than on the module a loader
 * resolves to is deliberate: Turbopack hoists a package's entry into what it
 * re-exports, so "the module `@aglyn/plugins-mui` resolves to" names
 * `lib/plugin.ts` in one build and something else in the next, while the
 * line that says `import('@aglyn/plugins-mui')` does not move.
 *
 * A declared import that cannot be found is RED, never an empty group: a
 * renamed file or a moved import would otherwise make the gate weigh less and
 * pass.
 *
 * ## The units
 *
 * Brotli at quality 3 with a 2^18 window: across beta.129's 52 chunks it
 * reproduced production's served script bytes to 0.1% (763,848 against
 * 764,497), which is what "on the wire" means here. The raw size is reported
 * beside it.
 */

import { brotliCompressSync, constants as zlib } from 'node:zlib'

/** The published page's route: every customer site is served by it. */
export const PUBLISHED_ROUTE = '[host]/[scheme]/[[...slug]]'

/**
 * Headroom over the recorded baseline before a group goes red.
 *
 * Tighter than the source gate's 25% because these are the bytes themselves,
 * not a proxy for them: 5% of the every-page group is ~25 KB, the size of the
 * regressions this was written after (a search library on every page, a
 * 14 KB dialog nobody opened). Chunker reshuffles from ordinary changes move
 * it by 1–2%.
 */
export const WIRE_HEADROOM = 1.05

/** Bytes a chunk costs on the wire, in the production basis described above. */
export function wireBytes(buffer) {
  return brotliCompressSync(buffer, {
    params: {
      [zlib.BROTLI_PARAM_QUALITY]: 3,
      [zlib.BROTLI_PARAM_LGWIN]: 18,
    },
  }).length
}

/**
 * The eager chunk set: the framework's root files and every chunk the route's
 * client-reference manifest names, as `static/chunks/<file>.js` paths.
 *
 * The manifest is a JS file that assigns a global, so it is scraped rather than
 * evaluated — the same reading `analyze-chunk-attribution.mjs` does.
 */
export function eagerChunks({ buildManifest, clientReferenceManifest }) {
  const files = new Set(buildManifest?.rootMainFiles ?? [])
  for (const match of String(clientReferenceManifest ?? '').matchAll(
    /static\/chunks\/[A-Za-z0-9_\-.]+\.js/g,
  )) {
    files.add(match[0])
  }
  return [...files].sort()
}

/**
 * Every async loader a chunk defines: its module id and the chunk files it
 * fetches before resolving.
 */
export function asyncLoaders(code) {
  const loaders = []
  const shape =
    /(\d+),(\w+)=>\{\2\.v\((\w+)=>Promise\.all\(\[([^\]]*)\]\.map\(\w+=>\2\.l\(\w+\)\)\)\.then\(\(\)=>\3\(\d+\)\)\)\}/g
  for (const match of code.matchAll(shape)) {
    loaders.push({
      id: match[1],
      chunks: [...match[4].matchAll(/"(static\/chunks\/[^"]+\.js)"/g)].map(
        (chunk) => chunk[1],
      ),
    })
  }
  return loaders
}

/** Every `<ident>.A(<id>)` in a chunk: a dynamic import's call site. */
export function loaderCallSites(code) {
  return [...code.matchAll(/\b[\w$]+\.A\((\d+)\)/g)].map((match) => ({
    id: match[1],
    offset: match.index,
  }))
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DIGIT = new Map([...BASE64].map((char, index) => [char, index]))

/**
 * A source map's mappings as `[generatedLine, generatedColumn, sourceIndex,
 * originalLine]` segments, zero-based, in generated order.
 */
export function decodeMappings(mappings) {
  const segments = []
  let source = 0
  let originalLine = 0
  const lines = String(mappings ?? '').split(';')
  for (let line = 0; line < lines.length; line++) {
    let column = 0
    for (const run of lines[line].split(',')) {
      if (!run) continue
      const fields = []
      let shift = 0
      let value = 0
      for (const char of run) {
        const digit = DIGIT.get(char)
        if (digit === undefined) continue
        value += (digit & 31) << shift
        shift += 5
        if (digit & 32) continue
        fields.push(value & 1 ? -(value >> 1) : value >> 1)
        value = 0
        shift = 0
      }
      if (!fields.length) continue
      column += fields[0]
      if (fields.length >= 4) {
        source += fields[1]
        originalLine += fields[2]
        segments.push([line, column, source, originalLine])
      }
    }
  }
  return segments
}

/** A mapped source path without Turbopack's `turbopack:///[project]/` prefix. */
export function projectPath(source) {
  return String(source)
    .replace(/^.*?:\/\/\/\[project\]\//, '')
    .replace(/^\[project\]\//, '')
}

/**
 * Where a generated offset came from: the source file and the original line's
 * text, from the map's own `sourcesContent`. Null when no segment covers it.
 */
export function originalLineAt(code, map, segments, offset) {
  const before = code.slice(0, offset)
  const line = before.split('\n').length - 1
  const column = offset - (before.lastIndexOf('\n') + 1)
  let best = null
  for (const segment of segments) {
    if (segment[0] < line) continue
    if (segment[0] > line) break
    if (segment[1] <= column) best = segment
    else break
  }
  if (!best) return null
  const source = map.sources?.[best[2]]
  const content = map.sourcesContent?.[best[2]]
  if (source === undefined || typeof content !== 'string') return null
  const lines = content.split('\n')
  return {
    file: projectPath(source),
    line: best[3] + 1,
    text: lines[best[3]] ?? '',
    // The two lines after it, for a call whose arguments wrap. Consulted only
    // when the mapped line names nothing itself — see `callSpecifiers`.
    after: lines.slice(best[3] + 1, best[3] + 3).join('\n'),
  }
}

/** The specifiers `import('…')` names in a piece of source text. */
export function importSpecifiers(text) {
  return [...String(text).matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => match[1],
  )
}

/**
 * What a mapped call site imports: the specifiers on its own line, or — only
 * when that line names none — the FIRST one on the lines after it. Two
 * adjacent `import()` lines (a plugin manifest is a column of them) must not
 * each claim both.
 */
export function callSpecifiers(site) {
  const own = importSpecifiers(site.text)
  return own.length ? own : importSpecifiers(site.after).slice(0, 1)
}

/**
 * Weigh the published page's before-settle JavaScript in a production build.
 *
 * `io` is injected so the tests can hand in a synthetic build:
 *   `readJson(path)`, `readText(path)`, `readBuffer(path)` and
 *   `exists(path)`, every path relative to `.next`.
 *
 * `groups` is the budget file's list. Each group's bytes are the chunks its
 * declared imports load that no EARLIER group already loads, so the first
 * group — every published page, with the document's own chunks — is the floor
 * every visitor pays, and each later one is what its condition adds on top.
 *
 * ## Only chunks the page has loaded are read
 *
 * One loader id is defined in several chunk groups at once — the page's, the
 * error boundary's, the not-found page's — and Turbopack lists in each only
 * the chunks THAT group has not already loaded. The copy that matters is the
 * one in a chunk this page loads. So call sites and loader definitions are
 * looked up in the eager set, and then in whatever each import adds, never in
 * the build at large: read from the wrong group, the always-on plugin's loader
 * listed 12 chunks where the page fetches 16.
 *
 * @returns {{ groups: Array<{ name: string, chunks: string[], bytes: number,
 *   raw: number, missing: Array<{ from: string, import: string }> }>,
 *   eager: string[] }}
 */
export function measureWireWeight({ route = PUBLISHED_ROUTE, groups, io }) {
  const eager = eagerChunks({
    buildManifest: io.readJson('build-manifest.json'),
    clientReferenceManifest: io.readText(
      `server/app/${route}/page_client-reference-manifest.js`,
    ),
  })

  /** One chunk's loaders and mapped call sites, read once. */
  const indexed = new Map()
  const indexOf = (chunk) => {
    if (indexed.has(chunk)) return indexed.get(chunk)
    const entry = { loaders: new Map(), sites: [] }
    indexed.set(chunk, entry)
    if (!io.exists(chunk)) return entry
    const code = io.readText(chunk)
    for (const loader of asyncLoaders(code)) entry.loaders.set(loader.id, loader.chunks)
    const calls = loaderCallSites(code)
    const marker = calls.length ? code.match(/\/\/# sourceMappingURL=(\S+)/) : null
    const mapPath = marker ? `${chunk.replace(/[^/]+$/, '')}${marker[1]}` : null
    if (!mapPath || !io.exists(mapPath)) return entry
    const map = io.readJson(mapPath)
    const segments = decodeMappings(map.mappings)
    for (const call of calls) {
      const origin = originalLineAt(code, map, segments, call.offset)
      if (origin) entry.sites.push({ id: call.id, ...origin })
    }
    return entry
  }

  const size = new Map()
  const measure = (chunk) => {
    if (!size.has(chunk)) {
      const buffer = io.readBuffer(chunk)
      size.set(chunk, { bytes: wireBytes(buffer), raw: buffer.length })
    }
    return size.get(chunk)
  }

  const counted = new Set()
  const out = []
  groups.forEach((group, index) => {
    const chunks = new Set(index === 0 ? eager : [])
    const missing = []
    for (const load of group.loads ?? []) {
      const scope = [...new Set([...counted, ...chunks])]
      const ids = new Set()
      for (const chunk of scope) {
        for (const site of indexOf(chunk).sites) {
          if (site.file === load.from && callSpecifiers(site).includes(load.import)) {
            ids.add(site.id)
          }
        }
      }
      let found = false
      for (const id of ids) {
        for (const chunk of scope) {
          const list = indexOf(chunk).loaders.get(id)
          if (!list) continue
          found = true
          for (const listed of list) chunks.add(listed)
        }
      }
      if (!found) missing.push({ from: load.from, import: load.import })
    }
    const own = [...chunks].filter((chunk) => !counted.has(chunk)).sort()
    for (const chunk of own) counted.add(chunk)
    let bytes = 0
    let raw = 0
    for (const chunk of own) {
      if (!io.exists(chunk)) {
        missing.push({ from: '(build output)', import: chunk })
        continue
      }
      const one = measure(chunk)
      bytes += one.bytes
      raw += one.raw
    }
    out.push({ name: group.name, chunks: own, bytes, raw, missing })
  })
  return { eager, groups: out }
}

/** The budget a measurement should be pinned at. */
export function budgetFor(measured, previous) {
  const byName = new Map((previous?.groups ?? []).map((group) => [group.name, group]))
  return {
    ...previous,
    groups: measured.groups.map((group) => ({
      ...byName.get(group.name),
      name: group.name,
      baselineBytes: group.bytes,
      budgetBytes: Math.ceil((group.bytes * WIRE_HEADROOM) / 1024) * 1024,
    })),
  }
}

/**
 * Compare a measurement with the checked-in budget.
 *
 * Red when a group grew past its budget, when a declared import is not in the
 * build, or when a group in the budget was not measured at all. A group that
 * got LIGHTER is not red: this pins a ceiling, and a win that has to be re-cut
 * to pass is a win the gate punishes. `--write` records it.
 */
export function evaluateWireWeight(measured, budget) {
  const byName = new Map(measured.groups.map((group) => [group.name, group]))
  const reasons = []
  for (const planned of budget.groups ?? []) {
    const group = byName.get(planned.name)
    if (!group) {
      reasons.push({ kind: 'unmeasured', group: planned.name })
      continue
    }
    for (const missing of group.missing) {
      reasons.push({ kind: 'missing', group: planned.name, ...missing })
    }
    if (group.bytes > planned.budgetBytes) {
      reasons.push({
        kind: 'over',
        group: planned.name,
        bytes: group.bytes,
        budgetBytes: planned.budgetBytes,
        baselineBytes: planned.baselineBytes,
      })
    }
  }
  return { ok: reasons.length === 0, reasons }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

/** Every reason a verdict is red, as the text the gate prints. */
export function explainWireVerdict(verdict) {
  return verdict.reasons.map((reason) => {
    if (reason.kind === 'unmeasured') {
      return (
        `the budget names a group "${reason.group}" that this measurement did ` +
        'not produce. A group the gate stops weighing is a group it stops ' +
        'guarding; rename it in the budget in the same commit that renames it.'
      )
    }
    if (reason.kind === 'missing') {
      return (
        `"${reason.group}": import('${reason.import}') from ${reason.from} is ` +
        'not in this build. If the import moved, point the budget at its new ' +
        'home in the same commit; a group that cannot find its chunks weighs ' +
        'nothing and would pass.'
      )
    }
    return (
      `"${reason.group}" grew past its budget.\n\n` +
      `  measured  ${kb(reason.bytes)} on the wire\n` +
      `  baseline  ${kb(reason.baselineBytes)}\n` +
      `  budget    ${kb(reason.budgetBytes)}\n\n` +
      WHY_WIRE_WEIGHT
    )
  })
}

/** What a failure costs and where it usually comes from. */
export const WHY_WIRE_WEIGHT =
  'These are the bytes a visitor downloads before a published page settles, ' +
  'and the page-view rate is priced on them: every KB here is paid on every ' +
  'view of every customer site. Run `npm run check:tenant-wire-weight -- ' +
  '--list` to see the chunks, and `npm run analyze:chunks` to see the modules ' +
  'in them. The usual causes are a component registered by an always-on ' +
  'plugin, a module that reaches a barrel, and a click-only surface loaded ' +
  'with the page. If the growth is deliberate, re-baseline with --write in ' +
  'the same commit, so a reviewer reads the new number beside its cause.'
