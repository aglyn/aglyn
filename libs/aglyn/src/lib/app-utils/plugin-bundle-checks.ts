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

export interface BundleCheckProblem {
  level: 'error' | 'warning'
  message: string
}

export interface BundleCheckResult {
  ok: boolean
  problems: BundleCheckProblem[]
  /** Which entry exports the source declares. */
  exports: { register: boolean; registerApi: boolean }
}

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
 */
export const PLUGIN_VERIFIER_VERSION = 2

/** A verdict as stored on a `pluginVersions` doc (AGL-962). */
export interface StoredBundleVerdict {
  ok?: boolean
  problems?: BundleCheckProblem[]
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
function staticString(node: AnyNode | null | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal')
    return typeof node['value'] === 'string' ? (node['value'] as string) : null
  if (node.type === 'TemplateLiteral') {
    const expressions = node['expressions'] as unknown[]
    const quasis = node['quasis'] as Array<{ value: { cooked?: string } }>
    if (expressions.length || quasis.length !== 1) return null
    return quasis[0]?.value?.cooked ?? null
  }
  if (node.type === 'BinaryExpression' && node['operator'] === '+') {
    const left = staticString(node['left'] as AnyNode)
    const right = staticString(node['right'] as AnyNode)
    return left !== null && right !== null ? left + right : null
  }
  return null
}

/** The property name a member expression reads, computed or not. */
function propertyName(node: AnyNode): string | null {
  const property = node['property'] as AnyNode
  if (!node['computed'])
    return property?.type === 'Identifier'
      ? (property['name'] as string)
      : null
  return staticString(property)
}

/** The origin of a URL argument, when it is a knowable absolute URL. */
function literalOrigin(node: AnyNode | undefined): string | null {
  const value = staticString(node)
  if (!value) return null
  try {
    return new URL(value).origin
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

export function checkPluginBundle(
  source: string,
  options?: CheckOptions,
): BundleCheckResult {
  const problems: BundleCheckProblem[] = []
  const seen = new Set<string>()
  const add = (level: BundleCheckProblem['level'], message: string) => {
    if (seen.has(message) || seen.size >= MAX_PROBLEMS) return
    seen.add(message)
    problems.push({ level, message })
  }

  const maxBytes = options?.maxBytes ?? MAX_PLUGIN_BUNDLE_BYTES
  const bytes = new TextEncoder().encode(source).byteLength
  if (bytes === 0) {
    problems.push({ level: 'error', message: 'bundle is empty' })
    return {
      ok: false,
      problems,
      exports: { register: false, registerApi: false },
    }
  }
  if (bytes > maxBytes) {
    add('error', `bundle is ${bytes} bytes (limit ${maxBytes})`)
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
    add(
      'error',
      `bundle does not parse as an ES module: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return {
      ok: false,
      problems,
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
  const noteNetwork = (api: string, urlArg: AnyNode | undefined) => {
    const origin = literalOrigin(urlArg)
    if (!declared) {
      add(
        'warning',
        `bundle makes network calls (${api}) — check them against the ` +
          "manifest's declared network capability",
      )
      return
    }
    if (!allowlist.size) {
      add(
        networkLevel,
        `bundle calls ${api} but the manifest declares no network ` +
          'capability — declare every origin under capabilities.network ' +
          '(the CSP blocks the rest at runtime)',
      )
      return
    }
    if (!origin) {
      add(
        'warning',
        `${api} is called with a URL that is only known at runtime — it ` +
          'cannot be checked against the declared origins',
      )
      return
    }
    if (!allowlist.has(origin)) {
      add(
        networkLevel,
        `${api} calls ${origin}, which the manifest does not declare ` +
          `(declared: ${[...allowlist].join(', ')})`,
      )
    }
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
        const specifier = staticString(node['source'] as AnyNode)
        if (specifier === null) {
          add(
            'error',
            'dynamic import with a specifier computed at runtime is not ' +
              'allowed — the loader cannot know what would be fetched',
          )
        } else if (/^https?:/i.test(specifier)) {
          add('error', 'dynamic import of remote URLs is not allowed')
        }
        break
      }

      // ---- calls ----
      case 'CallExpression':
      case 'NewExpression': {
        const callee = node['callee'] as AnyNode
        const args = (node['arguments'] ?? []) as AnyNode[]
        const name =
          callee?.type === 'Identifier'
            ? (callee['name'] as string)
            : callee?.type === 'MemberExpression'
              ? propertyName(callee)
              : null

        if (name === 'eval') add('error', 'eval() is not allowed')
        if (name === 'Function')
          add('error', 'the Function constructor is not allowed')
        // `(()=>{}).constructor('return 1')()` — the Function constructor
        // reached through any function value, which is why the CALL is the
        // finding rather than the name `Function`.
        if (name === 'constructor' && callee?.type === 'MemberExpression')
          add(
            'error',
            'calling .constructor() is not allowed — it reaches the ' +
              'Function constructor from any function value',
          )
        if (name && NETWORK_CALLS.has(name)) noteNetwork(name, args[0])
        if (name && NETWORK_CONSTRUCTORS.has(name))
          noteNetwork(name, node.type === 'NewExpression' ? args[0] : args[1])
        break
      }

      // ---- member access ----
      case 'MemberExpression': {
        const object = node['object'] as AnyNode
        const name = propertyName(node)
        if (isGlobalRef(object) && name === null) {
          add(
            'error',
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
          add('error', 'document.cookie access is not allowed')
        if (name && STORAGE_NAMES.has(name) && isGlobalRef(object))
          add(
            'error',
            'browser storage access is not allowed (use host-mediated data)',
          )
        if (name === 'eval' && isGlobalRef(object))
          add('error', 'eval() is not allowed')
        break
      }

      // ---- bare references ----
      case 'Identifier': {
        const name = node['name'] as string
        if (STORAGE_NAMES.has(name))
          add(
            'error',
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
      'bundle exports neither register(host) nor registerApi() — ' +
        'nothing for the loader to call',
    )
  }

  if (obfuscatedNames >= MIN_OBFUSCATED_NAMES) {
    add(
      'warning',
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
      `bundle has a single ${longestLine}-character line — nothing on it ` +
        'can be read in review; ask for a readable build or a source map',
    )
  }

  return {
    ok: !problems.some((problem) => problem.level === 'error'),
    problems,
    exports: { register: exportsRegister, registerApi: exportsRegisterApi },
  }
}
