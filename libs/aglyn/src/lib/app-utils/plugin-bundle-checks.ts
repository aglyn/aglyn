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
 * Static plugin-bundle checks (AGL-426) — Strapi `strapi-plugin verify`
 * parity, but ALSO enforced server-side: the publish API runs the same
 * checks, so a bundle that fails locally fails there identically.
 *
 * The bundle is PARSED and the tree analysed (AGL-964). The checks used to
 * match source text with regexes, which meant they could not see computed
 * member access, could not follow a value into a call, and could not tell
 * code from a comment — `g['ev'+'al'](…)` passed while the words `eval(`
 * inside a comment failed. On a minified bundle, which every published
 * artifact is, that is close to no signal at all.
 *
 * These are still cheap heuristics, NOT a sandbox: they catch honest build
 * mistakes (leftover imports, missing entry exports, oversized bundles),
 * flag the APIs the platform never wants in marketplace code, and surface
 * the questions a reviewer should ask. A determined author can still hide
 * intent from any static pass. The real security boundary stays the trust
 * chain (sandbox iframe + per-manifest CSP / staff review + realm signing /
 * sha pinning / the kill switch).
 */

import { parse, type Node, type Options } from 'acorn'

/** The areas the verifier reports on, in the order a reviewer reads them. */
export type BundleCheckId =
  | 'parse'
  | 'entry'
  | 'self-contained'
  | 'size'
  | 'code-execution'
  | 'globals'
  | 'storage'
  | 'dynamic-import'
  | 'network'
  | 'obfuscation'

export interface BundleCheckProblem {
  level: 'error' | 'warning'
  message: string
  /**
   * Which check produced this. Optional so a verdict stored by an older
   * checker still reads — those findings render on their own rather than
   * under a check row.
   */
  check?: BundleCheckId
}

/**
 * `unknown` is the one that earns its keep (AGL-1087). A check that could
 * not run — the network diff with no manifest supplied, everything at all
 * when the parse failed — must not render as green, or the page tells a
 * reviewer something was verified when nothing looked at it.
 */
export type BundleCheckStatus = 'pass' | 'fail' | 'question' | 'unknown'

export interface BundleCheckSummary {
  id: BundleCheckId
  /** Reviewer-facing name of the area. */
  label: string
  status: BundleCheckStatus
  /** What the check actually saw, when that is worth stating on its own. */
  detail?: string
}

export interface BundleCheckResult {
  ok: boolean
  problems: BundleCheckProblem[]
  /** Every area, including the ones that found nothing (AGL-1087). */
  checks: BundleCheckSummary[]
  /** Which entry exports the source declares. */
  exports: { register: boolean; registerApi: boolean }
}

const CHECK_LABELS: Record<BundleCheckId, string> = {
  parse: 'Parses as an ES module',
  entry: 'Exports an entry point',
  'self-contained': 'Self-contained (no static imports)',
  size: 'Within the size limit',
  'code-execution': 'No eval / Function constructor',
  globals: 'No computed access on a global',
  storage: 'No direct storage or cookie access',
  'dynamic-import': 'No dynamic import of unknown code',
  network: 'Network calls match the manifest',
  obfuscation: 'No obfuscation shapes',
}

/** Check order as displayed — findings first would reorder on every bundle. */
const CHECK_ORDER: BundleCheckId[] = [
  'parse',
  'entry',
  'self-contained',
  'size',
  'code-execution',
  'globals',
  'storage',
  'dynamic-import',
  'network',
  'obfuscation',
]

export const MAX_PLUGIN_BUNDLE_BYTES = 1_000_000

/**
 * Stamped onto a cached verdict (AGL-962) so a stored result outlives only
 * the checker that produced it.
 *
 * `checkPluginBundle` is pure over immutable, content-addressed bytes, so a
 * verdict for a given sha256 never changes — but the CHECKS do. **Bump this
 * whenever a rule is added, removed or loosened**, and every stored verdict
 * from the old checker is ignored and recomputed on next read. Forgetting to
 * bump means a reviewer sees a verdict from a checker that no longer exists,
 * which is the failure mode re-running the verifier was meant to prevent.
 *
 * 2 — AST analysis replaces the regex scan (AGL-964).
 * 3 — per-check summary added to the verdict (AGL-1087).
 * 4 — calls through an alias are resolved (AGL-1090).
 * 5 — URLs held in a constant are resolved (AGL-1093).
 */
export const PLUGIN_VERIFIER_VERSION = 5

/** A verdict as stored on a `pluginVersions` doc (AGL-962). */
export interface StoredBundleVerdict {
  ok?: boolean
  problems?: BundleCheckProblem[]
  /** Present from verifier 3 on (AGL-1087). */
  checks?: BundleCheckSummary[]
  sha256?: string
  verifierVersion?: number
}

/**
 * Whether a stored verdict may be served instead of re-running the checks.
 *
 * Fails closed on every mismatch: no verdict, a verdict for different bytes
 * (a republished version keeps its version string but changes sha), or a
 * verdict from a checker that has since changed. Any of those means
 * download-and-recompute, which costs one page view rather than showing a
 * reviewer a verdict that was never true of the bundle in front of them.
 */
export function isStoredVerdictCurrent(
  stored: StoredBundleVerdict | null | undefined,
  sha256: string,
): boolean {
  if (!stored || !sha256) return false
  return (
    stored.sha256 === sha256 &&
    Number(stored.verifierVersion) === PLUGIN_VERIFIER_VERSION
  )
}

/**
 * Globals whose properties are the platform's business. Computed access on
 * one of these is flagged as computed access rather than by trying to
 * enumerate the property names an author might reach — `g[k]` hides its
 * property from any static pass, so the ACCESS is the finding.
 */
const GLOBAL_ROOTS = new Set([
  'globalThis',
  'window',
  'self',
  'top',
  'parent',
  'frames',
  'document',
])

/** Storage the platform never wants reached directly (use host-mediated data). */
const STORAGE_NAMES = new Set(['localStorage', 'sessionStorage', 'indexedDB'])

/** Network entry points, by the name they are called/constructed under. */
const NETWORK_CALLS = new Set(['fetch', 'sendBeacon'])
const NETWORK_CONSTRUCTORS = new Set([
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
])

/**
 * Names worth following through an alias (AGL-1090).
 *
 * `const f = fetch; f(url)` used to pass every check, and the network row
 * rendered a green "no network calls" rather than going quiet — a two-line
 * indirection defeating the signal this whole verifier exists to produce.
 * Aliasing a VALUE was the exact gap the project was created to close, and
 * resolving global objects (`const g = globalThis`) never covered it.
 *
 * Reassignment, `arr[0]`, an object property and passing the function as an
 * argument all stay out of reach. The bar is that the cheap form is not free.
 */
const ALIASABLE_CALLABLES = new Set([
  'eval',
  'Function',
  'fetch',
  'sendBeacon',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
])

/**
 * Callees that legitimately take an absolute URL and reach nothing — so a URL
 * literal passed to them is not a call the network check failed to follow.
 * `createElementNS` matters most: an SVG namespace argument appears in a large
 * share of real bundles.
 */
const URL_TAKING_NON_CALLS = new Set([
  'URL',
  'URLSearchParams',
  'createElementNS',
  'createDocument',
])

/** Beyond this, a single line is not source a reviewer can read. */
const MAX_READABLE_LINE = 100_000
/** A base64 blob at least this long is worth decoding before approving. */
const MIN_SUSPICIOUS_BASE64 = 1024
/** How many `_0x…` names before the bundle counts as machine-obfuscated. */
const MIN_OBFUSCATED_NAMES = 5
/** Verdicts are stored on a version doc; keep them bounded. */
const MAX_PROBLEMS = 40

const OBFUSCATED_NAME = /^_0x[0-9a-f]{4,}$/i
const BASE64_BLOB = /^[A-Za-z0-9+/\r\n]+={0,2}$/

type AnyNode = Node & Record<string, unknown>

/**
 * Child keys that are NOT expressions in the surrounding scope — a
 * non-computed `.property`, an object literal key, a label. Walking into
 * them would read `x.localStorage` on an unrelated object as a global
 * storage access.
 */
const skippedChild = (node: AnyNode, key: string): boolean => {
  switch (node.type) {
    case 'MemberExpression':
      return key === 'property' && !node['computed']
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      return key === 'key' && !node['computed']
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return key === 'label'
    case 'ImportSpecifier':
    case 'ExportSpecifier':
      return true
    default:
      return false
  }
}

/** Depth-first walk over every expression-position node in the tree. */
function walk(root: AnyNode, visit: (node: AnyNode) => void): void {
  const stack: AnyNode[] = [root]
  while (stack.length) {
    const node = stack.pop()
    if (!node) continue
    visit(node)
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      if (skippedChild(node, key)) continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && typeof item.type === 'string')
            stack.push(item as AnyNode)
        }
      } else if (
        value &&
        typeof value === 'object' &&
        typeof (value as AnyNode).type === 'string'
      ) {
        stack.push(value as AnyNode)
      }
    }
  }
}

/**
 * The string a node evaluates to, when that is knowable without running it.
 * Covers the shapes used to hide a property name from a text scan: a
 * string literal, a template with no interpolation, and literals added
 * together (`'ev' + 'al'`).
 */
function staticString(
  node: AnyNode | null | undefined,
  constants?: ReadonlyMap<string, string>,
): string | null {
  if (!node) return null
  if (node.type === 'Literal')
    return typeof node['value'] === 'string' ? (node['value'] as string) : null
  // A name bound once to a constant string (AGL-1093). `const ENDPOINT =
  // 'https://…'; fetch(ENDPOINT)` is the idiomatic way to write a request,
  // and refusing to read it meant the network diff quietly did not run for
  // the bundles most likely to be honest.
  if (node.type === 'Identifier' && constants)
    return constants.get(node['name'] as string) ?? null
  if (node.type === 'TemplateLiteral') {
    const expressions = (node['expressions'] ?? []) as AnyNode[]
    const quasis = (node['quasis'] ?? []) as Array<{
      value: { cooked?: string }
    }>
    if (!expressions.length) {
      return quasis.length === 1 ? quasis[0]?.value?.cooked ?? null : null
    }
    // `${BASE}/zen` — resolvable exactly when every hole is.
    let out = ''
    for (let index = 0; index < quasis.length; index += 1) {
      out += quasis[index]?.value?.cooked ?? ''
      if (index < expressions.length) {
        const filled = staticString(expressions[index], constants)
        if (filled === null) return null
        out += filled
      }
    }
    return out
  }
  if (node.type === 'BinaryExpression' && node['operator'] === '+') {
    const left = staticString(node['left'] as AnyNode, constants)
    const right = staticString(node['right'] as AnyNode, constants)
    return left !== null && right !== null ? left + right : null
  }
  return null
}

/** The property name a member expression reads, computed or not. */
function propertyName(
  node: AnyNode,
  constants?: ReadonlyMap<string, string>,
): string | null {
  const property = node['property'] as AnyNode
  if (!node['computed'])
    return property?.type === 'Identifier'
      ? (property['name'] as string)
      : null
  return staticString(property, constants)
}

/**
 * The origin of a URL argument, when it is a knowable http(s) URL.
 *
 * Scheme-checked HERE, once (AGL-1094). An opaque origin — every `data:`,
 * `blob:` and `javascript:` URL — makes `new URL(x).origin` the STRING
 * `"null"`, and a caller that then re-parsed that string threw `Invalid URL`
 * and took the whole checker down with it. Nothing downstream should have to
 * know that, so nothing downstream gets the chance.
 */
function literalOrigin(
  node: AnyNode | undefined,
  constants?: ReadonlyMap<string, string>,
): string | null {
  const value = staticString(node, constants)
  if (!value) return null
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.origin : null
  } catch {
    return null
  }
}

interface CheckOptions {
  maxBytes?: number
  /**
   * The origins the manifest declares under `capabilities.network`. A
   * network call the manifest does not account for is the single most
   * useful signal the tree makes available — and the per-manifest CSP
   * would block it at runtime anyway, so the bundle and its manifest
   * disagreeing is a bug the publisher wants to hear about at publish
   * time, not a mystery in production. Undefined = "not supplied", which
   * downgrades those findings to warnings, because a checker that was
   * never told what was declared cannot claim anything was undeclared.
   */
  declaredNetwork?: string[]
}

function analyseBundle(
  source: string,
  options?: CheckOptions,
): BundleCheckResult {
  const problems: BundleCheckProblem[] = []
  const seen = new Set<string>()
  // Every area starts as "ran, found nothing" and is downgraded by its own
  // findings, so the summary cannot drift from the problem list (AGL-1087).
  const status = new Map<BundleCheckId, BundleCheckStatus>(
    CHECK_ORDER.map((id) => [id, 'pass']),
  )
  const details = new Map<BundleCheckId, string>()
  const add = (
    level: BundleCheckProblem['level'],
    check: BundleCheckId,
    message: string,
  ) => {
    if (level === 'error') status.set(check, 'fail')
    else if (status.get(check) === 'pass') status.set(check, 'question')
    if (seen.has(message) || seen.size >= MAX_PROBLEMS) return
    seen.add(message)
    problems.push({ level, message, check })
  }
  /** Mark the areas that never ran, so they cannot read as clean. */
  const unknownFrom = (...ids: BundleCheckId[]) => {
    for (const id of ids) status.set(id, 'unknown')
  }
  const summarise = (): BundleCheckSummary[] =>
    CHECK_ORDER.map((id) => ({
      id,
      label: CHECK_LABELS[id],
      status: status.get(id) ?? 'unknown',
      ...(details.has(id) ? { detail: details.get(id) } : {}),
    }))

  const maxBytes = options?.maxBytes ?? MAX_PLUGIN_BUNDLE_BYTES
  const bytes = new TextEncoder().encode(source).byteLength
  details.set('size', `${bytes.toLocaleString('en-US')} bytes of ${maxBytes.toLocaleString('en-US')}`)
  if (bytes === 0) {
    add('error', 'size', 'bundle is empty')
    unknownFrom(
      'parse',
      'entry',
      'self-contained',
      'code-execution',
      'globals',
      'storage',
      'dynamic-import',
      'network',
      'obfuscation',
    )
    return {
      ok: false,
      problems,
      checks: summarise(),
      exports: { register: false, registerApi: false },
    }
  }
  if (bytes > maxBytes) {
    add('error', 'size', `bundle is ${bytes} bytes (limit ${maxBytes})`)
  }

  const parseOptions: Options = {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
  }
  let program: AnyNode
  try {
    program = parse(source, parseOptions) as unknown as AnyNode
  } catch (error) {
    // Unparseable means unanalysable, and the loader would fail on it too.
    // Nothing else ran, and saying so is the whole point of `unknown`: a
    // bundle nobody could read must not show nine green rows.
    add(
      'error',
      'parse',
      `bundle does not parse as an ES module: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    unknownFrom(
      'entry',
      'self-contained',
      'code-execution',
      'globals',
      'storage',
      'dynamic-import',
      'network',
      'obfuscation',
    )
    return {
      ok: false,
      problems,
      checks: summarise(),
      exports: { register: false, registerApi: false },
    }
  }

  // Names bound to a global, so `const g = globalThis; g['ev'+'al']` reads
  // as access on a global rather than on some object we know nothing about.
  const aliases = new Set<string>()
  const noteAlias = (name: unknown, init: AnyNode | null | undefined) => {
    if (typeof name !== 'string' || !init) return
    const roots: AnyNode[] =
      init.type === 'LogicalExpression'
        ? [init['left'] as AnyNode, init['right'] as AnyNode]
        : [init]
    for (const root of roots) {
      if (
        root?.type === 'Identifier' &&
        GLOBAL_ROOTS.has(root['name'] as string)
      ) {
        aliases.add(name)
      }
    }
  }
  // Local name -> the constant string it holds (AGL-1093).
  //
  // A binding is only usable when the whole tree agrees on it: declared once,
  // never assigned again, and never a parameter or another binder anywhere.
  // Any of those means the value at a given call site is a GUESS, and a guess
  // is how a checker starts making claims about code it did not read.
  const constants = new Map<string, string>()
  {
    const bound = new Map<string, AnyNode>()
    const poisoned = new Set<string>()
    const declared = new Set<string>()
    const poison = (name: unknown) => {
      if (typeof name === 'string') poisoned.add(name)
    }
    /** Every name a pattern binds — a parameter shadowing a constant is a
     * different variable, and resolving it to the outer value would be a
     * fabrication. */
    const poisonPattern = (node: AnyNode | null | undefined) => {
      if (!node) return
      if (node.type === 'Identifier') return poison(node['name'])
      for (const key of [
        'left',
        'argument',
        'properties',
        'elements',
        'value',
      ]) {
        const value = node[key]
        if (Array.isArray(value))
          value.forEach((item) => poisonPattern(item as AnyNode))
        else if (value) poisonPattern(value as AnyNode)
      }
    }
    walk(program, (node) => {
      if (node.type === 'VariableDeclarator') {
        const id = node['id'] as AnyNode
        if (id?.type === 'Identifier') {
          const name = id['name'] as string
          if (declared.has(name)) poison(name)
          declared.add(name)
          bound.set(name, node['init'] as AnyNode)
        } else {
          poisonPattern(id)
        }
      } else if (node.type === 'AssignmentExpression') {
        poisonPattern(node['left'] as AnyNode)
      } else if (node.type === 'UpdateExpression') {
        poisonPattern(node['argument'] as AnyNode)
      } else if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        ;((node['params'] ?? []) as AnyNode[]).forEach(poisonPattern)
        if ((node['id'] as AnyNode)?.type === 'Identifier')
          poison((node['id'] as AnyNode)['name'])
      } else if (node.type === 'CatchClause') {
        poisonPattern(node['param'] as AnyNode)
      } else if (
        node.type === 'ClassDeclaration' ||
        node.type === 'ClassExpression'
      ) {
        if ((node['id'] as AnyNode)?.type === 'Identifier')
          poison((node['id'] as AnyNode)['name'])
      }
    })
    // Two passes, so `const BASE = 'https://x'` then `BASE + '/y'` resolves.
    // A third buys almost nothing and each is a full re-read of the bindings.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const [name, init] of bound) {
        if (poisoned.has(name) || constants.has(name)) continue
        const value = staticString(init, constants)
        if (value !== null) constants.set(name, value)
      }
    }
  }

  // Local name -> the callable it stands for (AGL-1090). `const f = fetch`,
  // `const d = globalThis.fetch`, `const {fetch: h} = globalThis`.
  const callableAliases = new Map<string, string>()
  /** The aliasable callable an initializer denotes, if any. */
  const callableFrom = (init: AnyNode | null | undefined): string | null => {
    if (!init) return null
    if (
      init.type === 'Identifier' &&
      ALIASABLE_CALLABLES.has(init['name'] as string)
    ) {
      return init['name'] as string
    }
    // `globalThis.fetch` / `window['fe' + 'tch']` — the property is what the
    // name will stand for, and only when the object is a global (an unknown
    // object's `.fetch` is somebody else's method).
    if (init.type === 'MemberExpression') {
      const property = propertyName(init)
      const object = init['object'] as AnyNode
      if (
        property &&
        ALIASABLE_CALLABLES.has(property) &&
        object?.type === 'Identifier' &&
        (GLOBAL_ROOTS.has(object['name'] as string) ||
          aliases.has(object['name'] as string))
      ) {
        return property
      }
    }
    return null
  }
  const noteCallableAlias = (
    id: AnyNode | null | undefined,
    init: AnyNode | null | undefined,
  ) => {
    if (!id) return
    if (id.type === 'Identifier') {
      const callable = callableFrom(init)
      if (callable) callableAliases.set(id['name'] as string, callable)
      return
    }
    // `const { fetch } = globalThis` and `const { fetch: h } = globalThis`.
    if (id.type === 'ObjectPattern' && init) {
      const fromGlobal =
        init.type === 'Identifier' &&
        (GLOBAL_ROOTS.has(init['name'] as string) ||
          aliases.has(init['name'] as string))
      if (!fromGlobal) return
      for (const property of (id['properties'] ?? []) as AnyNode[]) {
        const key = property['key'] as AnyNode
        const value = property['value'] as AnyNode
        const name =
          key?.type === 'Identifier' ? (key['name'] as string) : staticString(key)
        if (
          name &&
          ALIASABLE_CALLABLES.has(name) &&
          value?.type === 'Identifier'
        ) {
          callableAliases.set(value['name'] as string, name)
        }
      }
    }
  }

  // Global-object aliases first, as a complete pass: the callable pass below
  // resolves `g.fetch` against them, and walk order is not source order.
  walk(program, (node) => {
    if (node.type === 'VariableDeclarator') {
      const id = node['id'] as AnyNode
      if (id?.type === 'Identifier')
        noteAlias(id['name'], node['init'] as AnyNode)
    } else if (
      node.type === 'AssignmentExpression' &&
      node['operator'] === '='
    ) {
      const left = node['left'] as AnyNode
      if (left?.type === 'Identifier')
        noteAlias(left['name'], node['right'] as AnyNode)
    }
  })
  walk(program, (node) => {
    if (node.type === 'VariableDeclarator') {
      noteCallableAlias(node['id'] as AnyNode, node['init'] as AnyNode)
    } else if (
      node.type === 'AssignmentExpression' &&
      node['operator'] === '='
    ) {
      noteCallableAlias(node['left'] as AnyNode, node['right'] as AnyNode)
    }
  })

  const isGlobalRef = (node: AnyNode | null | undefined): boolean =>
    !!node &&
    node.type === 'Identifier' &&
    (GLOBAL_ROOTS.has(node['name'] as string) ||
      aliases.has(node['name'] as string))

  const declared = options?.declaredNetwork
  const allowlist = new Set(
    (declared ?? []).map((origin) => {
      try {
        return new URL(origin).origin
      } catch {
        return origin
      }
    }),
  )
  /** Level for a network finding: a claim only when we know what was declared. */
  const networkLevel: BundleCheckProblem['level'] = declared
    ? 'error'
    : 'warning'
  // What the bundle reaches for, so the summary row can SAY it (AGL-1087) —
  // "calls https://api.stripe.com, declared" is the line a reviewer would
  // otherwise open the bundle to get.
  const networkApis = new Set<string>()
  const networkOrigins = new Set<string>()
  let runtimeUrls = 0
  /** Origins handed to a callee the checker could not resolve (AGL-1090). */
  const unresolvedOrigins = new Set<string>()
  const noteNetwork = (api: string, urlArg: AnyNode | undefined) => {
    const origin = literalOrigin(urlArg, constants)
    networkApis.add(api)
    if (origin) networkOrigins.add(origin)
    else runtimeUrls += 1
    if (!declared) {
      add(
        'warning',
        'network',
        `bundle makes network calls (${api}) — check them against the ` +
          "manifest's declared network capability",
      )
      return
    }
    if (!allowlist.size) {
      add(
        networkLevel,
        'network',
        `bundle calls ${api} but the manifest declares no network ` +
          'capability — declare every origin under capabilities.network ' +
          '(the CSP blocks the rest at runtime)',
      )
      return
    }
    if (!origin) {
      add(
        'warning',
        'network',
        `${api} is called with a URL that is only known at runtime — it ` +
          'cannot be checked against the declared origins',
      )
      return
    }
    if (!allowlist.has(origin)) {
      add(
        networkLevel,
        'network',
        `${api} calls ${origin}, which the manifest does not declare ` +
          `(declared: ${[...allowlist].join(', ')})`,
      )
    }
  }

  /**
   * A call the checker could not resolve, given an absolute URL.
   *
   * Reported as a QUESTION, never a refusal: most of these are helpers, and
   * refusing every unrecognised call that mentions a URL would make the
   * verifier useless. But leaving them silent is what let the network row
   * claim "no network calls" over a bundle whose calls it simply could not
   * follow — and a URL to an origin the manifest never declared is exactly
   * what a reviewer should be pointed at.
   */
  const noteUnresolvedUrl = (
    name: string | null,
    urlArg: AnyNode | undefined,
  ) => {
    if (name && URL_TAKING_NON_CALLS.has(name)) return
    const origin = literalOrigin(urlArg, constants)
    if (!origin) return
    // A declared origin is consistent with the manifest and permitted by the
    // CSP, so there is no question to raise about it.
    if (allowlist.has(origin)) return
    unresolvedOrigins.add(origin)
    add(
      'warning',
      'network',
      `${name ? `${name}()` : 'a call'} is passed ${origin}, which the ` +
        'manifest does not declare — the checker could not tell whether it ' +
        'reaches the network, so read this call',
    )
  }

  let exportsRegister = false
  let exportsRegisterApi = false
  const noteExport = (name: unknown) => {
    if (name === 'register') exportsRegister = true
    else if (name === 'registerApi') exportsRegisterApi = true
  }

  let obfuscatedNames = 0

  walk(program, (node) => {
    switch (node.type) {
      // ---- entry exports + self-containment ----
      case 'ImportDeclaration':
        add(
          'error',
          'self-contained',
          'bundle has static imports — realm bundles must be self-contained ' +
            '(react/@aglyn/aglyn come from the host ABI; see the realm rollup ' +
            'template)',
        )
        break
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration': {
        if (node['source']) {
          add(
            'error',
            'self-contained',
            'bundle re-exports from another module — realm bundles must be ' +
              'self-contained (see the realm rollup template)',
          )
        }
        const declaration = node['declaration'] as AnyNode | null
        if (declaration) {
          if (declaration['id'])
            noteExport((declaration['id'] as AnyNode)['name'])
          for (const declarator of (declaration['declarations'] ??
            []) as AnyNode[]) {
            const id = declarator['id'] as AnyNode
            if (id?.type === 'Identifier') noteExport(id['name'])
          }
        }
        for (const specifier of (node['specifiers'] ?? []) as AnyNode[]) {
          const exported = specifier['exported'] as AnyNode
          noteExport(
            exported?.type === 'Identifier'
              ? exported['name']
              : staticString(exported),
          )
        }
        break
      }

      // ---- dynamic import ----
      case 'ImportExpression': {
        const specifier = staticString(node['source'] as AnyNode, constants)
        if (specifier === null) {
          add(
            'error',
            'dynamic-import',
            'dynamic import with a specifier computed at runtime is not ' +
              'allowed — the loader cannot know what would be fetched',
          )
        } else if (/^https?:/i.test(specifier)) {
          add(
            'error',
            'dynamic-import',
            'dynamic import of remote URLs is not allowed',
          )
        }
        break
      }

      // ---- calls ----
      case 'CallExpression':
      case 'NewExpression': {
        const callee = node['callee'] as AnyNode
        const args = (node['arguments'] ?? []) as AnyNode[]
        const written =
          callee?.type === 'Identifier'
            ? (callee['name'] as string)
            : callee?.type === 'MemberExpression'
              ? propertyName(callee, constants)
              : null
        // An alias resolves to what it stands for (AGL-1090), so `f(url)`
        // after `const f = fetch` is a fetch call.
        const name =
          (written && callableAliases.get(written)) ?? written ?? null

        if (name === 'eval')
          add('error', 'code-execution', 'eval() is not allowed')
        if (name === 'Function')
          add(
            'error',
            'code-execution',
            'the Function constructor is not allowed',
          )
        // `(()=>{}).constructor('return 1')()` — the Function constructor
        // reached through any function value, which is why the CALL is the
        // finding rather than the name `Function`.
        if (name === 'constructor' && callee?.type === 'MemberExpression')
          add(
            'error',
            'code-execution',
            'calling .constructor() is not allowed — it reaches the ' +
              'Function constructor from any function value',
          )
        if (name && NETWORK_CALLS.has(name)) noteNetwork(name, args[0])
        else if (name && NETWORK_CONSTRUCTORS.has(name))
          noteNetwork(name, node.type === 'NewExpression' ? args[0] : args[1])
        // Something we could not follow, handed an absolute URL (AGL-1090).
        // Not a refusal — it may be a helper, a logger, or a link — but the
        // network row must stop rendering "no network calls" over it.
        else noteUnresolvedUrl(name, args[0])
        break
      }

      // ---- member access ----
      case 'MemberExpression': {
        const object = node['object'] as AnyNode
        const name = propertyName(node, constants)
        if (isGlobalRef(object) && name === null) {
          add(
            'error',
            'globals',
            `computed property access on ${
              (object['name'] as string) || 'a global'
            } is not allowed — a property chosen at runtime cannot be ` +
              'reviewed',
          )
          break
        }
        // Property names only mean anything on a global: `response.cookie`
        // and `state.localStorage` are somebody else's object.
        if (name === 'cookie' && isGlobalRef(object))
          add('error', 'storage', 'document.cookie access is not allowed')
        if (name && STORAGE_NAMES.has(name) && isGlobalRef(object))
          add(
            'error',
            'storage',
            'browser storage access is not allowed (use host-mediated data)',
          )
        if (name === 'eval' && isGlobalRef(object))
          add('error', 'code-execution', 'eval() is not allowed')
        break
      }

      // ---- bare references ----
      case 'Identifier': {
        const name = node['name'] as string
        if (STORAGE_NAMES.has(name))
          add(
            'error',
            'storage',
            'browser storage access is not allowed (use host-mediated data)',
          )
        if (OBFUSCATED_NAME.test(name)) obfuscatedNames += 1
        break
      }

      // ---- obfuscation ----
      case 'Literal': {
        const value = node['value']
        if (
          typeof value === 'string' &&
          value.length >= MIN_SUSPICIOUS_BASE64 &&
          BASE64_BLOB.test(value)
        ) {
          add(
            'warning',
            'obfuscation',
            `bundle embeds a ${value.length}-character base64 literal — ` +
              'decode it before approving',
          )
        }
        break
      }
      default:
        break
    }
  })

  if (!exportsRegister && !exportsRegisterApi) {
    add(
      'error',
      'entry',
      'bundle exports neither register(host) nor registerApi() — ' +
        'nothing for the loader to call',
    )
  }

  if (obfuscatedNames >= MIN_OBFUSCATED_NAMES) {
    add(
      'warning',
      'obfuscation',
      `bundle uses ${obfuscatedNames} machine-obfuscated identifiers ` +
        '(_0x… naming) — minifiers do not produce these',
    )
  }
  const longestLine = source
    .split('\n')
    .reduce((longest, line) => Math.max(longest, line.length), 0)
  if (longestLine > MAX_READABLE_LINE) {
    add(
      'warning',
      'obfuscation',
      `bundle has a single ${longestLine}-character line — nothing on it ` +
        'can be read in review; ask for a readable build or a source map',
    )
  }

  details.set(
    'entry',
    [
      exportsRegister ? 'register(host)' : null,
      exportsRegisterApi ? 'registerApi()' : null,
    ]
      .filter(Boolean)
      .join(', ') || 'none',
  )

  // What the network check actually saw. Without the manifest it saw the
  // calls but could not judge them, and that is `unknown`, not a pass — the
  // row a reviewer must not read as "checked and fine".
  if (!declared) {
    if (networkApis.size) {
      status.set('network', 'unknown')
      details.set(
        'network',
        `calls ${[...networkApis].join(', ')} — no declared origins were ` +
          'supplied, so nothing was compared',
      )
    } else {
      details.set('network', 'no network calls')
    }
  } else if (!networkApis.size) {
    details.set(
      'network',
      unresolvedOrigins.size
        ? `no resolved network calls, but ${[...unresolvedOrigins].join(', ')} ` +
            'is passed to a call the checker could not follow'
        : 'no network calls',
    )
  } else {
    const origins = networkOrigins.size
      ? [...networkOrigins]
          .map((origin) =>
            allowlist.has(origin) ? `${origin} (declared)` : `${origin} (NOT declared)`,
          )
          .join(', ')
      : ''
    details.set(
      'network',
      [
        `calls ${[...networkApis].join(', ')}`,
        origins,
        runtimeUrls
          ? `${runtimeUrls} call(s) with a URL only known at runtime`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    )
  }

  return {
    ok: !problems.some((problem) => problem.level === 'error'),
    problems,
    checks: summarise(),
    exports: { register: exportsRegister, registerApi: exportsRegisterApi },
  }
}

/**
 * Run the checks over a bundle. NEVER throws (AGL-1094).
 *
 * The publish route calls this directly, so an unexpected failure in here
 * used to mean a 500 and no explanation for the publisher — and in the review
 * sweep it looked exactly like a missing artifact, which sent the
 * investigation to the storage bucket instead of to this file. A checker that
 * cannot analyse a bundle has an answer: say so, in the verdict, as an error.
 */
export function checkPluginBundle(
  source: string,
  options?: CheckOptions,
): BundleCheckResult {
  try {
    return analyseBundle(source, options)
  } catch (error) {
    return {
      ok: false,
      problems: [
        {
          level: 'error',
          check: 'parse',
          message:
            'the verifier failed on this bundle — treat it as unchecked and ' +
            `report it: ${
              error instanceof Error ? error.message : String(error)
            }`,
        },
      ],
      checks: CHECK_ORDER.map((id) => ({
        id,
        label: CHECK_LABELS[id],
        status: id === 'parse' ? 'fail' : 'unknown',
      })),
      exports: { register: false, registerApi: false },
    }
  }
}
