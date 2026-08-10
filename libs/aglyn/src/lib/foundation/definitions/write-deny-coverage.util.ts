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
 * Shared parsing for the write-deny coverage guards (AGL-1355, AGL-1361).
 *
 * Extracted from `org-write-deny-coverage.spec.ts` when the same property was
 * extended to `hosts/{hostId}` and `marketplaceListings/{listingId}`. Three
 * documents, three different rule shapes, one parser — a second copy of this
 * would be a second thing to keep true, which is the disease these guards
 * exist to treat.
 *
 * Deliberately PURE: every function takes source text and returns data, with
 * no file I/O and no imports. That keeps the module free of `node:fs` (this
 * lib is bundled for the browser) and makes each helper testable on a string
 * literal. The specs own the reading.
 *
 * Not exported from the foundation barrel — nothing at runtime should reach
 * for it.
 */

/**
 * Comments are stripped from every source before parsing. Prose in this repo
 * quotes rules fragments and field names constantly — the org block's own
 * comment names all four AGL-1354 keys, and the listing block's names half its
 * deny-list — so parsing with comments in place would read the explanation of
 * a hole as the fix for it.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * Quoted strings, blanked. `org-permissions.ts` declares permission KEYS
 * spelled `'org.settings'` and `'org.auditLog'`, which read exactly like a
 * field access — the first run of the org guard demanded the rules deny two
 * fields that do not exist. Template literals are left alone: a real read can
 * legitimately live inside `${…}`.
 */
export function stripQuotedStrings(source: string): string {
  return source
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
}

/**
 * Firestore path variables (`{orgId}`, `{document=**}`) carry braces that a
 * block-depth walker reads as nesting. Rewriting them to angle brackets makes
 * the rules parseable by brace counting without losing the path text — which
 * matters, because `{document=**}` IS the wildcard these guards have to see.
 */
export function normalizePathVariables(rules: string): string {
  return rules.replace(/\{([A-Za-z_][A-Za-z0-9_]*(?:=\*\*)?)\}/g, '<$1>')
}

/**
 * The text of a `{ … }` block, keeping only what sits at the block's own
 * depth. Nested blocks — sub-`match` rules, inline object types — are dropped,
 * so a nested `allow` or a nested property can never be mistaken for one
 * belonging to the block asked for.
 *
 * `header` must end with the opening brace.
 */
export function topLevelBody(source: string, header: string): string {
  const at = source.indexOf(header)
  if (at < 0) throw new Error(`Guard cannot parse: no \`${header}\` found.`)
  let depth = 1
  let out = ''
  for (let index = at + header.length; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') {
      depth += 1
      continue
    }
    if (character === '}') {
      depth -= 1
      if (depth === 0) return out
      continue
    }
    if (depth === 1) out += character
  }
  throw new Error(`Guard cannot parse: \`${header}\` never closes.`)
}

/**
 * Split an expression on `||` at parenthesis depth 0 only.
 *
 * A naive `split('||')` tears a branch apart at any nested alternation, and
 * both of the documents AGL-1361 added have one. The host rule's client branch
 * is `(… && !hasAny(L1) && (role == 'admin' || !hasAny(L2)))` — its deny-list
 * is TIERED, six keys no site member may touch plus `disabledPlugins` which
 * only a site admin may — and a naive split drops L2 into a branch of its own
 * where nothing looks for it. The listing block's `function listingManager()`
 * produces the mirror problem, matching two branches instead of one.
 */
export function splitTopLevelOr(expression: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (depth === 0 && character === '|' && expression[index + 1] === '|') {
      parts.push(current)
      current = ''
      index += 1
      continue
    }
    current += character
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** The keys of the FIRST `hasAny([...])` literal in a rules branch. */
export function hasAnyKeys(branch: string): string[] {
  const list = branch.match(/hasAny\(\s*\[([^\]]*)\]/)
  if (!list) return []
  return [...list[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

/**
 * The keys of EVERY `hasAny([...])` literal in a branch, flattened.
 *
 * The org rule has one list per branch; the host rule has two in a single
 * branch, because its deny-list is TIERED — six keys no site member may
 * touch, and `disabledPlugins` which only a site admin may. `hasAnyKeys`
 * returns the first list alone, so a host guard built on it would have
 * silently believed `disabledPlugins` was unprotected.
 */
export function allHasAnyKeys(branch: string): string[] {
  return [...branch.matchAll(/hasAny\(\s*\[([^\]]*)\]/g)].flatMap((list) =>
    [...list[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
  )
}

/**
 * Top-level property names declared on an interface.
 *
 * `header` is the full declaration line up to and including the brace, because
 * the three documents do not share a shape: `AglynOrgBilling` and `AglynHost`
 * both `extends AglynDocument`, while `MarketplaceListing` extends nothing.
 */
export function declaredFields(source: string, header: string): string[] {
  const body = topLevelBody(stripComments(source), header)
  return [
    ...body.matchAll(/(?:^|\n)\s*(\$?[A-Za-z_][A-Za-z0-9_$]*)\s*\??\s*:/g),
  ].map((entry) => entry[1])
}

/** A parsed `allow update` rule for one document. */
export interface ParsedUpdateRule {
  /** Every key denied to the client branch, across all its `hasAny` lists. */
  denied: string[]
  /** Every OR'd branch of the single `allow update` statement. */
  branches: string[]
  /** Depth-0 statements of the document's `match` block. */
  statements: string[]
  /** Depth-0 `match` headers under `/databases/{database}/documents`. */
  topLevelMatches: string[]
}

/**
 * Parse the single `allow update` of one top-level document block.
 *
 * `matchHeader` is post-`normalizePathVariables`, e.g.
 * `match /hosts/<hostId> {`. `clientPredicate` names the branch that a CLIENT
 * reaches — `canManageOrg()`, `canWriteHostContent(hostId)`, `listingManager()`
 * — as opposed to the staff branches, which are trusted by design.
 */
export function parseUpdateRule(
  rulesSource: string,
  matchHeader: string,
  clientPredicate: string,
): ParsedUpdateRule {
  const rules = normalizePathVariables(stripComments(rulesSource))
  const root = topLevelBody(rules, 'match /databases/<database>/documents {')
  const topLevelMatches = [...root.matchAll(/match\s+(\/\S*)/g)].map(
    (entry) => entry[1],
  )

  const block = topLevelBody(rules, matchHeader)
  const statements = block
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)

  // ONE `allow` statement may mention `update`. Firestore ORs every allow
  // across sibling statements AND sibling match blocks, and the LOOSER one
  // wins — so a second statement would mean this guard is reasoning about a
  // deny-list that some other statement quietly overrides.
  const updates = statements.filter((statement) =>
    /\ballow\b[^:]*\bupdate\b/.test(statement),
  )
  if (updates.length !== 1) {
    throw new Error(
      `Expected exactly one \`allow … update\` statement under ` +
        `${matchHeader}, found ${updates.length}. Firestore ORs them and the ` +
        `LOOSER wins, so the deny-list this guard reads would no longer be ` +
        `the whole answer. Fold the branches back into one statement, or ` +
        `teach this guard how they combine.`,
    )
  }

  // Start at the `allow` keyword. `topLevelBody` drops a nested block's BODY
  // but leaves its header text at depth 1, so the listing block's
  // `function listingManager()` declaration survives as an orphan with no
  // semicolon of its own — it merges into the following statement and makes
  // `listingManager()` appear in two branches instead of one. Slicing to
  // `allow` removes the remnant without pretending the function is not there.
  const statement = updates[0].slice(updates[0].indexOf('allow'))
  const branches = splitTopLevelOr(statement)
  const found = branches.filter((branch) => branch.includes(clientPredicate))
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one \`allow update\` branch guarded by ` +
        `${clientPredicate} under ${matchHeader}, found ${found.length}. The ` +
        `rule has been restructured; re-read it before trusting this guard.`,
    )
  }

  return {
    denied: allHasAnyKeys(found[0]),
    branches,
    statements,
    topLevelMatches,
  }
}

/**
 * Field names in an object literal a document is seeded with.
 *
 * `anchor` is a regex source locating the write; the literal's own braces are
 * matched by depth rather than `[^}]*`, because a seed can legitimately carry
 * a nested object (the host seed writes `screens: {}`) and a lazy class would
 * truncate the field list at the first inner brace — silently shrinking one of
 * the guard's sources rather than failing.
 */
export function seedFields(source: string, anchor: RegExp): string[] | null {
  const at = stripComments(source).search(anchor)
  if (at < 0) return null
  const text = stripComments(source)
  const open = text.indexOf('{', at)
  if (open < 0) return null
  let depth = 1
  let body = ''
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) break
    }
    if (depth === 1) body += character
  }
  return [
    ...body.matchAll(/(?:^|,|\n)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[,:]/g),
  ].map((entry) => entry[1])
}

/**
 * Top-level fields of `binding` that the modules in `sources` read.
 *
 * Directory-wide on purpose. A per-file list would be one more thing to keep
 * up to date, and a NEW resolver reading a NEW field is covered the moment it
 * is written — the only way this stays true without anyone tending it.
 */
export function readFieldsOf(
  sources: Array<string>,
  binding: string,
): string[] {
  const found = new Set<string>()
  for (const raw of sources) {
    const source = stripQuotedStrings(stripComments(raw))
    // `host?.field` / `host.field` — the ordinary read.
    for (const hit of source.matchAll(
      new RegExp(`\\b${binding}\\s*\\??\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, 'g'),
    )) {
      // A lone `$` is the head of a `${…}` interpolation, not a field: it
      // comes from token-name construction like `` `{{host.${key}}}` ``.
      // Template literals are left unstripped on purpose — a real read can
      // live inside one — so this is the price, and a field named `$` cannot
      // exist. Anything else, including `$id`, is kept and must be classified.
      if (hit[1] !== '$') found.add(hit[1])
    }
    // `(host as { cname?: unknown })?.cname` — the cast a field that is real
    // but was undeclared gets read through.
    for (const hit of source.matchAll(
      new RegExp(
        `\\b${binding}\\s+as\\s*\\{\\s*([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\??\\s*:`,
        'g',
      ),
    )) {
      found.add(hit[1])
    }
  }
  return [...found].sort()
}
