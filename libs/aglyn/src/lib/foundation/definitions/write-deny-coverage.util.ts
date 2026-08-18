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
 *
 * A single left-to-right scan, NOT two regex passes, and that distinction is
 * load-bearing (AGL-2004). The previous version removed block comments first
 * and line comments second, so a line comment that merely QUOTED a path opened
 * a block comment that was never meant to exist:
 *
 *     // the name, so `hosts/<hostId>/datasets/*` stayed a client-writable
 *
 * The `/` before `*` reads as an opening delimiter, and the strip then ran to
 * the next closing delimiter 571 lines away, swallowing real rule text — and
 * with it two closing braces, which left the block walker unable to find the
 * end of the root `match` and threw `never closes`. Every deny-coverage guard
 * in this directory failed to RUN, which is the worst way for a guard to fail:
 * the suite is red, so nobody reads it as coverage, but the thing it protects
 * (the AGL-1775 `registers` deny-list) is unwatched until someone does.
 *
 * Scanning once fixes it in both directions: whichever delimiter appears first
 * wins, so `/*` inside a line comment is just text, and `//` inside a block
 * comment cannot eat the block's own terminator.
 */
export function stripComments(source: string): string {
  let out = ''
  let index = 0
  while (index < source.length) {
    const pair = source.slice(index, index + 2)
    if (pair === '/*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    if (pair === '//') {
      const end = source.indexOf('\n', index + 2)
      if (end < 0) break
      // Keep the newline: line numbers and statement separation survive.
      out += '\n'
      index = end + 1
      continue
    }
    out += source[index]
    index += 1
  }
  return out
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
 * The FULL text of a `{ … }` block, nested blocks INCLUDED.
 *
 * The opposite of `topLevelBody`, and needed for the opposite question. That
 * one answers "what does THIS block say", so it drops nested bodies — which is
 * exactly right for a deny-list on one document, and exactly wrong for
 * `hosts/{hostId}`, whose subcollection rules all live in nested `match`
 * blocks. AGL-1367 lived in one of them.
 *
 * `header` must end with the opening brace.
 */
export function rawBlockBody(source: string, header: string): string {
  const at = source.indexOf(header)
  if (at < 0) throw new Error(`Guard cannot parse: no \`${header}\` found.`)
  let depth = 1
  let out = ''
  for (let index = at + header.length; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return out
    }
    out += character
  }
  throw new Error(`Guard cannot parse: \`${header}\` never closes.`)
}

/** The subcollection write rules of `hosts/{hostId}`, as the rules state them. */
export interface ParsedSubcollectionRules {
  /** The `subcollection in […]` exclusion list of each catch-all allow. */
  excluded: { create: string[]; update: string[]; delete: string[] }
  /** Collections with a dedicated `match` block, which can RE-GRANT. */
  dedicated: string[]
  /** Excluded from all three AND re-granted by nothing: denied outright. */
  serverOnly: string[]
}

/**
 * Parse the host catch-all's three exclusion lists (AGL-1367).
 *
 * Membership in ONE list is not denial and never was — `variables` is
 * create-excluded and freely updatable, `webhooks` is create-excluded and
 * freely updatable on purpose (the soft delete is how a capped site frees a
 * slot). And a dedicated `match` block RE-GRANTS, because Firestore ORs its
 * allows and the LOOSER one wins: `screens`, `layouts` and `collections` all
 * sit in three lists and stay editor-writable through the blocks above.
 *
 * So "denied outright" is the intersection of the three lists MINUS everything
 * with a block of its own. That subtraction is the reason a dedicated
 * `allow write: if false` block would not have closed AGL-1367 — a deny can
 * never win an OR.
 */
export function parseHostSubcollectionRules(
  rulesSource: string,
): ParsedSubcollectionRules {
  const rules = normalizePathVariables(stripComments(rulesSource))
  const host = rawBlockBody(rules, 'match /hosts/<hostId> {')

  const catchAllHeader = 'match /<subcollection>/<document=**> {'
  const occurrences = host.split(catchAllHeader).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one \`${catchAllHeader}\` under match /hosts/{hostId}, ` +
        `found ${occurrences}. A second one would OR another set of allows ` +
        `onto every subcollection, so these lists would be half the answer.`,
    )
  }
  const catchAll = rawBlockBody(host, catchAllHeader)

  const listFor = (operation: 'create' | 'update' | 'delete'): string[] => {
    const statement = catchAll
      .split(';')
      .find((entry) =>
        new RegExp(`\\ballow\\b[^:]*\\b${operation}\\b`).test(entry),
      )
    if (!statement) {
      throw new Error(
        `No \`allow … ${operation}\` in the host catch-all. The block has been ` +
          `restructured; re-read it before trusting this guard.`,
      )
    }
    const list = statement.match(/subcollection\s+in\s+\[([^\]]*)\]/)
    if (!list) {
      throw new Error(
        `The host catch-all's \`allow ${operation}\` has no ` +
          `\`subcollection in […]\` exclusion list. Every server-owned host ` +
          `subcollection is denied by NAME in that list and nowhere else, so ` +
          `this guard cannot see what is protected any more.`,
      )
    }
    return [...list[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
  }

  const excluded = {
    create: listFor('create'),
    update: listFor('update'),
    delete: listFor('delete'),
  }
  // Named `match` blocks only. After `normalizePathVariables` a wildcard
  // segment starts with `<`, so a leading letter is what distinguishes a
  // collection block from `match /<subcollection>/…` or the nested
  // `match /<sub>/…` inside the screens/layouts/components blocks.
  const dedicated = [
    ...new Set(
      [...host.matchAll(/match\s+\/([A-Za-z][A-Za-z0-9]*)\//g)].map(
        (entry) => entry[1],
      ),
    ),
  ]
  const serverOnly = excluded.create.filter(
    (name) =>
      excluded.update.includes(name) &&
      excluded.delete.includes(name) &&
      !dedicated.includes(name),
  )
  return { excluded, dedicated, serverOnly }
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
 * Whether the property access ending at `index` is being CALLED (AGL-1719).
 *
 * The guard reads `hosts/{hostId}` fields by scanning for `host.<name>` across
 * a whole directory, which means it matches on the identifier NAME and cannot
 * see the type. `media-ref.ts` has `isFirstPartyHost(host: string)` whose body
 * is `host.toLowerCase()` — a hostname string, not the host document — so
 * `toLowerCase` entered the field universe and the guard demanded that a
 * `String.prototype` method be classified as server-owned or client-writable.
 *
 * Dropping method calls removes that whole class rather than that one name,
 * and it is sound in the only direction that matters. Firestore document data
 * is JSON: string, number, boolean, null, array, map, timestamp, geopoint,
 * reference. **No field of a document can be callable**, so `binding.X(` is
 * provably never a field read and this can never introduce a false negative —
 * which is the single failure mode a coverage guard has (AGL-1420).
 *
 * A chained read is untouched: in `host.disabledPlugins.includes(x)` the
 * character after the captured name is `.`, so `disabledPlugins` is still
 * collected and only `includes` is dropped. Optional calls (`host.foo?.()`)
 * and generic ones (`host.foo<T>()`) are calls too.
 *
 * An exclusion list of known method names was rejected: it would silence the
 * symptom, need tending forever, and still say nothing about the next method
 * on the next same-named local.
 */
function isMethodCallAt(source: string, index: number): boolean {
  const rest = source.slice(index)
  return /^\s*(?:\?\.)?\s*(?:<[^<>()]*>\s*)?\(/.test(rest)
}

/**
 * Top-level fields of `binding` that the modules in `sources` read.
 *
 * Directory-wide on purpose. A per-file list would be one more thing to keep
 * up to date, and a NEW resolver reading a NEW field is covered the moment it
 * is written — the only way this stays true without anyone tending it.
 *
 * The document is identified by IDENTIFIER NAME, not by type — this is a text
 * scan, and it has no way to know what a local called `host` actually holds.
 * So an unrelated binding of the same name contributes its property reads too.
 * That direction is safe (a spurious field fails loudly and gets classified by
 * a human, and can never HIDE a real one), and it is deliberately left alone,
 * because the filter that would suppress it is the filter that could suppress
 * a real read. See {@link isMethodCallAt} for the one case that is not safe to
 * leave — it produced a name no human could classify.
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
      // `host.toLowerCase()` is a method INVOCATION, not a field (AGL-1719).
      if (isMethodCallAt(source, hit.index + hit[0].length)) continue
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
