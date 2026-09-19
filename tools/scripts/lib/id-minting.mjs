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
// Where tracked source names a new Firestore document with an id the platform
// did not mint (AGL-3079), and the allowlist every such site is classified in.
//
// Everything the console makes is named by `createResourceUid()`, a
// 10-character nanoid, and that id is what a member sees in a URL, what the
// public API routes by and what other documents reference. A document named
// any other way is one of three things, and the allowlist says which:
//
//   RESOURCE    its id is shown, routed or referenced as an address, so it
//               should be a resource id. Each is a debt, listed under the area
//               issue that fixes it ("to fix").
//   RECORD      an internal row nobody addresses by its id: an audit entry, a
//               ledger line, a message inside a thread.
//   DELIBERATE  a key with a meaning — a day, a hash, a slug, a pair of ids —
//               and the reason the meaning is the point.
//
// ## What counts as a site
//
// Three forms, each found in the syntax tree so a call split over many lines
// is one site like any other:
//
//   auto-id     `.doc()` with no argument, `.add(data)` on a collection,
//               `addDoc(collectionRef, data)`, and `doc(collectionRef)`.
//   uid-helper  a document id from an id helper that is not the platform's:
//               `randomUUID()`, `nanoid()`, `createUid()`, a `customAlphabet`
//               product, `randomBytes(n).toString(...)`.
//   derived     a document id written inline as a template literal or a `+`
//               concatenation of other values, such as `${jobId}-c0`. A path's
//               last segment is its id: `orgSlugs/${slug}` addresses `slug`
//               and derives nothing.
//
// An id passed through a `const` in the same scope is read through it, so
// `const id = \`${a}-${b}\`` followed by `.doc(id)` is the derived site it looks
// like. A key built by a NAMED function (`suppressionId(email)`,
// `assistUsageMonth(now)`) is not a site: the function is the one place the
// scheme is written and reviewed, and every read of the key calls it too.
//
// A site is keyed by its file and its call, printed without comments and with
// the whitespace collapsed, and for `.add` without the data it writes, so a
// reformat or a new field moves nothing. The same call written twice in one
// file is one row with a `count`.

import { createRequire } from 'node:module'

/**
 * `typescript` ships CommonJS; a `createRequire` bound to this module resolves
 * it from the repo's own `node_modules` however the script is invoked, as
 * `hardcoded-colours.mjs` does.
 */
const ts = createRequire(import.meta.url)('typescript')

/**
 * The allowlist's size when it was written, in sites, and how many of those
 * sites are RESOURCE debts. Both may only fall. The guard is red when the list
 * holds more than this (a site was added) and when it holds fewer (rows were
 * removed without lowering these), so a removed row never leaves room for a
 * new one. Lower them in the commit that removes the rows.
 */
export const ID_MINTING_CEILING = { sites: 173, toFix: 39 }

/** The id the platform names a document by. A document named by it is never a site. */
const PLATFORM_ID_HELPERS = new Set(['createResourceUid'])

/** Id helpers that are not the platform's, called directly: `randomUUID()`, `crypto.randomUUID()`. */
const UID_HELPERS = new Set([
  'nanoid',
  'createUid',
  'createIdUrlSafe',
  'randomUUID',
  'uuid',
  'uuidv4',
  'v4',
  'ulid',
  'cuid',
])

/** Factories whose product mints ids: `customAlphabet(alphabet, size)()`. */
const UID_FACTORIES = new Set(['customAlphabet', 'customRandom', 'createUidWithAlphabet'])

/** The classes a row may carry. */
export const ID_MINTING_CLASSES = ['RESOURCE', 'RECORD', 'DELIBERATE']

/** Tracked files the guard reads. */
export const ID_MINTING_SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

/**
 * What names no customer's document: specs and their fixtures, mocks, the e2e
 * apps and harness scripts, the rules tests and type declarations.
 */
export const ID_MINTING_NOT_SOURCE =
  /\.(?:spec|test|e2e)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|__mocks__|fixtures|rules-tests|e2e)\/|(?:^|\/)[^/]+-e2e\/|\.d\.ts$/

/** Whether the guard reads a tracked path. */
export function isIdMintingSource(path) {
  return ID_MINTING_SOURCE.test(path) && !ID_MINTING_NOT_SOURCE.test(path)
}

/** A cheap text test: a file with none of these cannot hold a site. */
const MAYBE = /\.doc\(|\.add\(|addDoc|\bdoc\(/

/**
 * Every site in one file.
 *
 * @param {string} path the repo-relative path, which also picks the parser
 * @param {string} text the file's source
 * @returns {Array<{ path: string, line: number, kind: 'auto-id' | 'uid-helper' | 'derived', site: string, via?: string }>}
 */
export function findIdMintingSites(path, text) {
  if (!MAYBE.test(text)) return []
  const scriptKind = path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : path.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : /\.[cm]?js$/.test(path)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind)
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  const print = (node) =>
    printer
      .printNode(ts.EmitHint.Unspecified, node, sourceFile)
      .replace(/\n\s*\./g, '.')
      .replace(/\s+/g, ' ')
      .trim()

  const unwrap = (node) => {
    let current = node
    while (
      current &&
      (ts.isParenthesizedExpression(current) ||
        ts.isAwaitExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)))
    ) {
      current = current.expression
    }
    return current
  }

  /** The name a call is made by: `f()` → f, `a.b.f()` → f. */
  const calleeName = (call) => {
    const callee = unwrap(call.expression)
    if (ts.isIdentifier(callee)) return callee.text
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text
    return null
  }

  /**
   * The declaration an identifier names, looked up through its enclosing
   * scopes in this file: a `const`/`let`/`var` with its initializer and type,
   * or a parameter with its type.
   */
  const bindingOf = (identifier) => {
    const name = identifier.text
    for (let scope = identifier.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope)) {
        for (const parameter of scope.parameters ?? []) {
          if (ts.isIdentifier(parameter.name) && parameter.name.text === name) {
            return {
              initializer: parameter.initializer ?? null,
              type: parameter.type ? parameter.type.getText(sourceFile) : '',
            }
          }
        }
      }
      // A block, a source file, a module body or a `case` clause.
      const statements = scope.statements
      if (!statements) continue
      for (const statement of statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
            return {
              initializer: declaration.initializer ?? null,
              type: declaration.type ? declaration.type.getText(sourceFile) : '',
            }
          }
        }
      }
    }
    return null
  }

  /**
   * Whether an expression is a Firestore collection reference, as far as this
   * file shows: a `collection(...)` call, a helper named for the collection it
   * returns (`jobsCollection(...)`, `orgDataCollectionForHost(...)`), or a
   * name bound to either or typed `CollectionReference`.
   */
  const isCollection = (node, depth = 0) => {
    const expression = unwrap(node)
    if (!expression || depth > 3) return false
    if (ts.isCallExpression(expression)) {
      const name = calleeName(expression)
      return name === 'collection' || name === 'collectionGroup' || (name !== null && /Collection/.test(name))
    }
    if (ts.isIdentifier(expression)) {
      const binding = bindingOf(expression)
      if (!binding) return false
      if (/\bCollectionReference\b/.test(binding.type)) return true
      return binding.initializer ? isCollection(binding.initializer, depth + 1) : false
    }
    return false
  }

  /** Whether a call mints an id with a helper that is not the platform's. */
  const isUidHelperCall = (node, depth = 0) => {
    const call = unwrap(node)
    if (!call || !ts.isCallExpression(call) || depth > 3) return false
    const callee = unwrap(call.expression)
    const name = calleeName(call)
    if (name !== null && PLATFORM_ID_HELPERS.has(name)) return false
    if (name !== null && UID_HELPERS.has(name)) return true
    // `randomBytes(16).toString('hex')`
    if (name === 'toString' && ts.isPropertyAccessExpression(callee)) {
      const inner = unwrap(callee.expression)
      if (ts.isCallExpression(inner) && calleeName(inner) === 'randomBytes') return true
    }
    // `customAlphabet(alphabet, 12)()`
    if (ts.isCallExpression(callee) && UID_FACTORIES.has(calleeName(callee) ?? '')) return true
    // `const makeId = customAlphabet(alphabet, 12)` … `makeId()`
    if (ts.isIdentifier(callee)) {
      const binding = bindingOf(callee)
      const factory = binding?.initializer ? unwrap(binding.initializer) : null
      if (factory && ts.isCallExpression(factory) && UID_FACTORIES.has(calleeName(factory) ?? '')) return true
    }
    return false
  }

  /** The parts of a `+` chain, left to right. */
  const concatParts = (node) => {
    const expression = unwrap(node)
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return [...concatParts(expression.left), ...concatParts(expression.right)]
    }
    return [expression]
  }

  const isText = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

  /**
   * Whether an id's text derives it from other values. A path's last segment
   * is the id, so `hosts/${hostId}` and `hosts/` + hostId address `hostId`.
   * One value alone (`${x}`, '' + x) is that value, not a derivation, and a
   * `+` chain with no text in it is arithmetic.
   */
  const derivesInline = (node) => {
    const expression = unwrap(node)
    if (ts.isTemplateExpression(expression)) {
      // The segments after the last '/' anywhere in the literal text.
      let values = 0
      let text = expression.head.text
      if (text.includes('/')) text = text.slice(text.lastIndexOf('/') + 1)
      for (const span of expression.templateSpans) {
        values += 1
        const literal = span.literal.text
        if (literal.includes('/')) {
          values = 0
          text = literal.slice(literal.lastIndexOf('/') + 1)
        } else {
          text += literal
        }
      }
      return values > 1 || (values === 1 && text.length > 0)
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const parts = concatParts(expression)
      if (!parts.some(isText)) return false
      let values = 0
      let text = ''
      for (const part of parts) {
        if (isText(part)) {
          if (part.text.includes('/')) {
            values = 0
            text = part.text.slice(part.text.lastIndexOf('/') + 1)
          } else {
            text += part.text
          }
        } else {
          values += 1
        }
      }
      return values > 1 || (values === 1 && text.length > 0)
    }
    return false
  }

  /**
   * How an id argument mints, if it does: through a uid helper, or derived
   * inline. Read through fallbacks (`a ?? b`, `c ? a : b`), text conversions
   * (`String(x)`, `x.trim()`) and a `const` in scope.
   *
   * @returns {{ kind: 'uid-helper' | 'derived', via?: string } | null}
   */
  const mintingOf = (node, depth = 0) => {
    const expression = unwrap(node)
    if (!expression || depth > 3) return null
    if (isUidHelperCall(expression)) return { kind: 'uid-helper' }
    if (derivesInline(expression)) return { kind: 'derived' }
    if (ts.isTemplateExpression(expression)) {
      for (const span of expression.templateSpans) {
        if (isUidHelperCall(span.expression)) return { kind: 'uid-helper' }
      }
      return null
    }
    if (ts.isConditionalExpression(expression)) {
      return mintingOf(expression.whenTrue, depth + 1) ?? mintingOf(expression.whenFalse, depth + 1)
    }
    if (
      ts.isBinaryExpression(expression) &&
      (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return mintingOf(expression.left, depth + 1) ?? mintingOf(expression.right, depth + 1)
    }
    if (ts.isCallExpression(expression)) {
      const name = calleeName(expression)
      if (name === 'String' && expression.arguments.length === 1) return mintingOf(expression.arguments[0], depth + 1)
      const callee = unwrap(expression.expression)
      if (
        ts.isPropertyAccessExpression(callee) &&
        ['trim', 'toLowerCase', 'toUpperCase', 'toString'].includes(callee.name.text) &&
        expression.arguments.length === 0
      ) {
        return mintingOf(callee.expression, depth + 1)
      }
      return null
    }
    if (ts.isIdentifier(expression)) {
      const binding = bindingOf(expression)
      if (!binding?.initializer) return null
      const through = mintingOf(binding.initializer, depth + 1)
      return through ? { ...through, via: `${expression.text} = ${print(binding.initializer)}` } : null
    }
    return null
  }

  const sites = []
  const report = (node, kind, site, via) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    sites.push({ path, line, kind, site, ...(via ? { via } : {}) })
  }

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      const args = node.arguments
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'doc') {
        // `collectionRef.doc()` mints; `collectionRef.doc(id)` and `firestore.doc(path)` may.
        if (args.length === 0) report(node, 'auto-id', `${print(callee.expression)}.doc()`)
        else if (args.length === 1) {
          const minting = mintingOf(args[0])
          if (minting) report(node, minting.kind, print(node), minting.via)
        }
      } else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'add') {
        if (args.length === 1 && isCollection(callee.expression)) {
          report(node, 'auto-id', `${print(callee.expression)}.add(…)`)
        }
      } else if (calleeName(node) === 'addDoc' && args.length >= 1) {
        report(node, 'auto-id', `addDoc(${print(args[0])}, …)`)
      } else if (ts.isIdentifier(callee) && callee.text === 'doc') {
        // The modular SDK: `doc(collectionRef)` mints; `doc(db, ...segments)` names its last segment.
        if (args.length === 1) {
          if (isCollection(args[0])) report(node, 'auto-id', print(node))
        } else if (args.length >= 2 && !args.some((arg) => ts.isSpreadElement(arg))) {
          const minting = mintingOf(args[args.length - 1])
          if (minting) report(node, minting.kind, print(node), minting.via)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return sites
}

/** A row's key: the file and the call. */
export function siteKey(site) {
  return `${site.path}: ${site.site}`
}

/**
 * The found sites set against the allowlist: sites no row covers, rows that
 * cover no site, and rows that are malformed. A row covers as many
 * occurrences of its call in its file as its `count` (default 1).
 *
 * @param {Array<{ path: string, site: string, line: number, kind: string }>} found
 * @param {{ sites?: Array<{ site: string, class: string, reason: string, issue?: string, count?: number }> }} allowlist
 */
export function compareToAllowlist(found, allowlist) {
  const occurrences = new Map()
  for (const site of found) {
    const key = siteKey(site)
    const list = occurrences.get(key) ?? []
    list.push(site)
    occurrences.set(key, list)
  }
  const rows = allowlist.sites ?? []
  const invalid = []
  const listed = new Map()
  for (const row of rows) {
    const problems = rowProblems(row)
    if (listed.has(row.site)) problems.push('listed twice; give the one row a count')
    if (problems.length) invalid.push({ site: row.site ?? '(no site)', problems })
    listed.set(row.site, row)
  }
  const unlisted = []
  const stale = []
  for (const [key, list] of occurrences) {
    const row = listed.get(key)
    const allowed = row ? (row.count ?? 1) : 0
    if (list.length > allowed) unlisted.push({ key, found: list, allowed })
  }
  for (const row of rows) {
    const have = occurrences.get(row.site)?.length ?? 0
    if (have < (row.count ?? 1)) stale.push({ key: row.site, have, allowed: row.count ?? 1 })
  }
  return { unlisted, stale, invalid }
}

/** What is wrong with one row, if anything. */
export function rowProblems(row) {
  const problems = []
  if (typeof row?.site !== 'string' || !/^[^:\s]+: \S/.test(row.site)) problems.push('site must be "<file>: <call>"')
  if (!ID_MINTING_CLASSES.includes(row?.class)) problems.push(`class must be one of ${ID_MINTING_CLASSES.join(', ')}`)
  if (typeof row?.reason !== 'string' || row.reason.trim().length < 12) problems.push('reason must say why')
  if (row?.class === 'RESOURCE' && !/^AGL-\d+$/.test(row?.issue ?? '')) {
    problems.push('a RESOURCE row is a debt: name the area issue that fixes it')
  }
  if (row?.count !== undefined && !(Number.isInteger(row.count) && row.count > 1)) {
    problems.push('count, where given, is a whole number above 1')
  }
  return problems
}

/**
 * What the allowlist's size says against the ceiling: a list above it grew,
 * and a list below it shrank without the ceiling following it down.
 */
export function ceilingProblems(size, ceiling = ID_MINTING_CEILING) {
  const problems = []
  for (const [name, label] of [
    ['sites', 'sites'],
    ['toFix', 'RESOURCE sites to fix'],
  ]) {
    if (size[name] > ceiling[name]) {
      problems.push(
        `the allowlist holds ${size[name]} ${label}, above its ceiling of ${ceiling[name]}: the list may only shrink`,
      )
    } else if (size[name] < ceiling[name]) {
      problems.push(
        `the allowlist holds ${size[name]} ${label}, below its ceiling of ${ceiling[name]}: lower ` +
          `ID_MINTING_CEILING.${name} to ${size[name]} in tools/scripts/lib/id-minting.mjs, in this commit`,
      )
    }
  }
  return problems
}

/** The allowlist's size, in sites, and how many of them are RESOURCE debts. */
export function allowlistSize(allowlist) {
  let sites = 0
  let toFix = 0
  for (const row of allowlist.sites ?? []) {
    const count = row.count ?? 1
    sites += count
    if (row.class === 'RESOURCE') toFix += count
  }
  return { sites, toFix }
}
