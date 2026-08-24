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
 * Every server-written field of a MEDIA document is denied to client writes
 * (AGL-1881).
 *
 * ## The gap this fills, stated as the gap
 *
 * The pre-launch security review found `storagePath` client-writable and
 * handed verbatim to `bucket.file(...)` on the Admin SDK, which the Storage
 * rules do not govern — cross-tenant read, overwrite and destroy of a shared
 * bucket that also holds `adminAudit-archive/` and `erasures/` at fixed,
 * guessable prefixes. The same review found three server-owned fields on
 * `orgs/{orgId}` (`usageBudget`, `usageAlerts`, `usageAlertsSeeded`) that
 * `org-write-deny-coverage.spec.ts` could not see, because its universe is
 * built from an interface, a deny-list, the entitlement resolvers and the seed
 * writer — and a field written only by an API ROUTE appears in none of them.
 *
 * A media document is the same shape one level worse. Its fields are written
 * ONLY by API routes, so the org guard's blind spot is this document's entire
 * surface — and no guard in this directory looked at media at all.
 * `host-subcollection-write-deny-coverage.spec.ts` asks about COLLECTIONS the
 * billing rollup reads, `host-listing-write-deny-coverage.spec.ts` about a
 * marketplace listing's fields, and neither has a reason to notice `media`.
 * So `storagePath` and `private` shipped client-writable with three green
 * coverage guards standing beside them.
 *
 * ## Why the universe here IS the routes
 *
 * That is the point. The org guard's four sources all describe the document
 * from the outside; this one reads the only writers there are. Two derived
 * sets, no hand-maintained list on either side:
 *
 *  1. **Server-written — DERIVED from the creators.** The routes that MINT a
 *     media document are discovered, not listed, exactly as
 *     `media-create-shape.spec.ts` discovers them: a file that reaches
 *     `collection('media')` and allocates an id with `createResourceUid`. The
 *     keys of the object they write are the document's server-owned surface. A
 *     fifth creator, or a new field on an existing one, arrives here by being
 *     written rather than by being remembered.
 *
 *  2. **Client-written — DERIVED from the console.** Every client-SDK write to
 *     a `media` document anywhere in `apps/` and `libs/`, with its payload keys
 *     read out. This is the half that stops the guard from being a ratchet
 *     that eventually denies the product: a field the DAM genuinely edits is
 *     classified by the sweep, not by an argument.
 *
 * The partition is then forced: server-written MINUS client-written must be
 * frozen in the rules, or named in `MEDIA_SERVER_WRITTEN_NOT_FROZEN` with a
 * reason. That map is EMPTY, and deliberately so — see its own note.
 *
 * ## What this file does not cover, stated plainly
 *
 * A field written onto a media document by a route that is not a CREATOR —
 * `media/replace`, `media/folders`, the quarantine writer — and never written
 * by a creator, is outside source 1. `storagePath`, `private`, `url` and
 * `cdnPath` are all written by both, so the fields this issue is about are
 * covered; a future patch-only field would not be. The mitigation is that the
 * creators write the document's full shape by construction, which
 * `media-create-shape.spec.ts` independently enforces.
 *
 * Fields that reach the document only through a SPREAD of a computed object
 * (`...(dimensions ?? {})` — `width`/`height`) are invisible to the parse, and
 * that is asserted below rather than left implicit, so the number this guard
 * covers cannot quietly shrink.
 *
 * The behavioural companion is the `media object fields are server-owned`
 * suite in `cloud/rules-tests/firestore-rules.test.mjs`, which drives real
 * client-SDK writes against the compiled rules in the emulator — deny on
 * `storagePath`, deny on `private`, and a positive control that the rename,
 * tag, folder move and sharing edit still land. This file proves the LIST is
 * complete; that one proves the list is ENFORCED. A complete list in a rule
 * that never fires is the AGL-1354 shape, and a rule that fires over an
 * incomplete list is this one.
 */

import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'

import {
  normalizePathVariables,
  parseHostSubcollectionRules,
  rawBlockBody,
  stripComments,
  stripTypeScriptComments,
} from './write-deny-coverage.util'

const REPO_ROOT = resolve(__dirname, '../../../../../..')
const RULES_FILE = 'cloud/firebase-firestore.rules'
const CONSOLE_API = 'apps/console/app/api'
/** The v1 REST creator, which is not a `route.ts` and would be missed by name. */
const V1_RESOURCES = 'apps/console/utils/api-v1-resources.ts'
const CLIENT_SWEEP_ROOTS = ['apps', 'libs']

/**
 * Server-written media fields deliberately left client-writable, each with the
 * reason it is safe.
 *
 * EMPTY, and that is the finding rather than an omission. Classifying the
 * eleven fields beyond `storagePath`/`private` one by one is what turned two
 * of them up as security inputs in their own right —
 *
 *  - `contentSha256` is the key `mediaCdnServeBlock` asks the quarantine
 *    deny-list with, so a client that could rewrite it walked its own asset
 *    out of a takedown;
 *  - `contentType` is the served `Content-Type` and the input to
 *    `mediaCdnContentSecurityPolicy`.
 *
 * — at which point writing "safe because it is only metadata" beside the
 * other nine stopped being an argument anyone should trust. Every writer of
 * every one of them is an Admin-SDK route, so denial costs the product
 * nothing; that is the AGL-1367 test, and it passes for all of them. An entry
 * here is therefore an explicit decision that a field is BOTH server-written
 * and safely client-editable, which nothing on this document is today.
 */
const MEDIA_SERVER_WRITTEN_NOT_FROZEN: Record<string, string> = {}

/**
 * Fields that reach a media document only through a spread of a computed
 * object, so the parse below cannot see them.
 *
 * Named rather than ignored: this is the guard's own blind spot, and a blind
 * spot nobody wrote down is the AGL-1354 shape. Both are best-effort image
 * metadata read from the file header — never a gate, never billed, and
 * absent entirely when the header was unreadable.
 */
const INVISIBLE_TO_THE_PARSE = ['width', 'height']

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.nx',
  '.turbo',
])

function walk(absoluteDir: string, keep: (name: string) => boolean): string[] {
  const found: string[] = []
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(join(absoluteDir, entry.name), keep))
    } else if (keep(entry.name)) {
      found.push(join(absoluteDir, entry.name))
    }
  }
  return found
}

/** The `{ … }` starting at `open`, braces included. */
function balancedObject(source: string, open: number): string {
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  throw new Error('Guard cannot parse: an object literal never closes.')
}

/** The comma-separated entries of an object literal, at its own depth only. */
function topLevelEntries(literal: string): string[] {
  const body = literal.slice(1, -1)
  const entries: string[] = []
  let depth = 0
  let current = ''
  let quote: string | null = null
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (quote) {
      current += character
      if (character === '\\') {
        current += body[index + 1] ?? ''
        index += 1
      } else if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      current += character
      continue
    }
    if ('{(['.includes(character)) depth += 1
    if ('})]'.includes(character)) depth -= 1
    if (character === ',' && depth === 0) {
      entries.push(current)
      current = ''
      continue
    }
    current += character
  }
  entries.push(current)
  return entries.map((entry) => entry.trim()).filter(Boolean)
}

/**
 * The FIELD names an object literal writes.
 *
 * Shorthand (`fileName,`) counts, because that is how most of these are
 * written. A spread is followed only through the one idiom the creators use —
 * `...(condition ? { field: value } : {})` — and only into that literal's own
 * depth. Following a spread everywhere would collect the argument names of
 * `mediaCdnPathUpdate({ billing, cdnScope, mediaId, isPrivate })` and demand
 * the rules freeze four fields that do not exist; not following it at all
 * would miss `private`, which is half of what this file is here for.
 */
function fieldsOf(literal: string): string[] {
  const fields: string[] = []
  for (const entry of topLevelEntries(literal)) {
    if (entry.startsWith('...')) {
      const branch = entry.indexOf('?')
      if (branch < 0) continue
      const open = entry.indexOf('{', branch)
      if (open < 0) continue
      for (const inner of topLevelEntries(balancedObject(entry, open))) {
        const named = inner.match(/^([A-Za-z_$][\w$]*)\s*(:|$)/)
        if (named) fields.push(named[1])
      }
      continue
    }
    const named = entry.match(/^([A-Za-z_$][\w$]*)\s*(:|$)/)
    if (named) fields.push(named[1])
  }
  return fields
}

/*===========================================================================
 * SOURCE 1 — the creators, discovered.
 *==========================================================================*/

const MEDIA_COLLECTION = "collection('media')"
const MINTS_AN_ID = 'createResourceUid'

const CREATORS = [
  ...walk(resolve(REPO_ROOT, CONSOLE_API), (name) => name === 'route.ts'),
  resolve(REPO_ROOT, V1_RESOURCES),
]
  .filter((file) => {
    const source = readFileSync(file, 'utf8')
    return source.includes(MEDIA_COLLECTION) && source.includes(MINTS_AN_ID)
  })
  .map((file) => relative(REPO_ROOT, file))
  .sort()

/** `field -> the creators that write it`, so a failure can name the file. */
const SERVER_WRITTEN = (() => {
  const byField = new Map<string, string[]>()
  for (const file of CREATORS) {
    const source = stripTypeScriptComments(read(file))
    let at = source.indexOf(MEDIA_COLLECTION)
    while (at >= 0) {
      // `.set({` / `.create({` on the SAME chain — `collection('media')
      // .doc(mediaId).set({`. The window is what keeps a later, unrelated
      // `.set(` in the file from being read as this collection's payload.
      const chain = source.slice(at, at + 160)
      const write = chain.match(/\.(set|create)\(\s*\{/)
      if (write) {
        const open = source.indexOf('{', at + (write.index ?? 0))
        for (const field of fieldsOf(balancedObject(source, open))) {
          byField.set(field, [...(byField.get(field) ?? []), file])
        }
      }
      at = source.indexOf(MEDIA_COLLECTION, at + 1)
    }
  }
  return byField
})()

/*===========================================================================
 * SOURCE 2 — the client writers, swept.
 *==========================================================================*/

/**
 * A client-SDK write to a media document: `updateDoc`/`setDoc`/`batch.update`
 * against a `doc(firestore, …, 'media', …)` path, with its payload.
 *
 * Server files are excluded by path rather than by content: a route holds an
 * ADMIN-SDK write that these rules never see, and reading one as a client
 * surface would classify every server-owned field as client-editable — the
 * guard passing by disabling itself.
 */
const CLIENT_WRITE =
  /(?:batch\.(?:update|set)|updateDoc|setDoc)\(\s*doc\([^)]*['"]media['"][^)]*\)\s*,\s*\{/g

const CLIENT_WRITTEN = (() => {
  const byField = new Map<string, string[]>()
  const files = CLIENT_SWEEP_ROOTS.flatMap((root) =>
    walk(
      resolve(REPO_ROOT, root),
      (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
    ),
  )
    .map((file) => relative(REPO_ROOT, file))
    .filter(
      (file) =>
        !file.includes('/api/') &&
        !file.includes('/server/') &&
        !/\.(spec|test)\.tsx?$/.test(file),
    )
  for (const file of files) {
    const source = stripTypeScriptComments(read(file))
    if (!source.includes("'media'") && !source.includes('"media"')) continue
    for (const match of source.matchAll(CLIENT_WRITE)) {
      const open = source.indexOf('{', (match.index ?? 0) + match[0].length - 1)
      for (const field of fieldsOf(balancedObject(source, open))) {
        byField.set(field, [...(byField.get(field) ?? []), file])
      }
    }
  }
  return byField
})()

/*===========================================================================
 * THE RULES — what they actually freeze.
 *==========================================================================*/

const RULES = normalizePathVariables(stripComments(read(RULES_FILE)))

/** The `hasAny([...])` list of one of the two media freeze helpers. */
function frozenBy(helper: 'mediaObjectFieldsUnset' | 'mediaObjectFieldsUnchanged'): string[] {
  const at = RULES.indexOf(`function ${helper}()`)
  if (at < 0) {
    throw new Error(
      `Guard cannot parse: \`${helper}\` is gone from ${RULES_FILE}. It is ` +
        `the only thing freezing a media document's server-owned fields, so ` +
        `its removal is the regression this file exists for.`,
    )
  }
  const body = RULES.slice(at, RULES.indexOf('}', at))
  const list = body.match(/hasAny\(\s*\[([^\]]*)\]/)
  if (!list) {
    throw new Error(
      `Guard cannot parse: \`${helper}\` no longer freezes fields with a ` +
        `\`hasAny([…])\` list. It has been restructured, so re-read it ` +
        `before trusting this guard.`,
    )
  }
  return [...list[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort()
}

/** The body of a media `match` block, for asserting the helpers are wired. */
function mediaBlock(scope: 'orgs' | 'hosts'): string {
  const outer = rawBlockBody(
    RULES,
    scope === 'orgs' ? 'match /orgs/<orgId> {' : 'match /hosts/<hostId> {',
  )
  return rawBlockBody(outer, 'match /media/<mediaId> {')
}

/** The `allow <operation>` statement of a media block. */
function mediaAllow(scope: 'orgs' | 'hosts', operation: 'create' | 'update'): string {
  const statement = mediaBlock(scope)
    .split(';')
    .find((entry) => new RegExp(`\\ballow\\b[^:]*\\b${operation}\\b`).test(entry))
  if (!statement) {
    throw new Error(
      `Guard cannot parse: no \`allow … ${operation}\` in the ` +
        `${scope}/…/media block. A media document with no client ${operation} ` +
        `rule at all is a bigger change than this guard is written for.`,
    )
  }
  return statement
}

/*===========================================================================
 * THE ASSERTIONS.
 *==========================================================================*/

describe('media documents: server-owned fields are denied to clients (AGL-1881)', () => {
  /**
   * The negative control, first.
   *
   * Every assertion below is of the form "for each field in a swept set". A
   * sweep that matched nothing would satisfy all of them in silence, which is
   * how a coverage guard fails without going red. The three-file creator set
   * is asserted by NAME because it is small, stable and independently pinned
   * by `media-create-shape.spec.ts` — if a fourth creator arrives, this line
   * is where somebody is told to look at it.
   */
  it('the sweeps found something to sweep', () => {
    expect(CREATORS).toEqual([
      'apps/console/app/api/media/upload-url/route.ts',
      'apps/console/app/api/media/upload/route.ts',
      'apps/console/utils/api-v1-resources.ts',
    ])
    expect(SERVER_WRITTEN.size).toBeGreaterThanOrEqual(16)
    expect([...CLIENT_WRITTEN.keys()].sort()).toContain('fileName')
    expect([...CLIENT_WRITTEN.keys()].sort()).toContain('visibleTo')
    // The parse is known not to see these; if it starts to, the note above
    // is stale and the field needs classifying like any other.
    for (const field of INVISIBLE_TO_THE_PARSE) {
      expect([...SERVER_WRITTEN.keys()]).not.toContain(field)
    }
  })

  it('no server-written media field is unclassified', () => {
    const frozen = new Set(frozenBy('mediaObjectFieldsUnchanged'))
    const unclassified = [...SERVER_WRITTEN.entries()]
      .filter(
        ([field]) =>
          !frozen.has(field) &&
          !CLIENT_WRITTEN.has(field) &&
          !(field in MEDIA_SERVER_WRITTEN_NOT_FROZEN),
      )
      .map(([field, files]) => `${field} (written by ${files.join(', ')})`)
    expect(unclassified).toEqual([])
  })

  it('the two fields the review named CRITICAL are frozen', () => {
    // Spelled out rather than left to the derived set. The derivation is what
    // makes the guard survive the next field; naming these two is what makes
    // a green run mean the finding is closed.
    for (const helper of ['mediaObjectFieldsUnset', 'mediaObjectFieldsUnchanged'] as const) {
      expect(frozenBy(helper)).toContain('storagePath')
      expect(frozenBy(helper)).toContain('private')
    }
  })

  it('the create and update freeze lists say the same thing', () => {
    // Rules have no constants, so the list is written twice. Two lists that
    // disagree is a document frozen on update and mintable on create, which
    // is the `webhooks` shape AGL-1360 shipped for months.
    expect(frozenBy('mediaObjectFieldsUnset')).toEqual(
      frozenBy('mediaObjectFieldsUnchanged'),
    )
  })

  it('freezing nothing the DAM writes', () => {
    // The other direction, and the one that keeps this guard from becoming a
    // ratchet: a freeze that catches `fileName` or `tags` breaks the media
    // library for every customer, and a deny that breaks the product is worse
    // than the hole it closes.
    const frozen = new Set(frozenBy('mediaObjectFieldsUnchanged'))
    const collisions = [...CLIENT_WRITTEN.entries()]
      .filter(([field]) => frozen.has(field))
      .map(([field, files]) => `${field} (written by ${files.join(', ')})`)
    expect(collisions).toEqual([])
  })

  it('both scopes wire the freeze on create AND on update', () => {
    for (const scope of ['orgs', 'hosts'] as const) {
      expect(mediaAllow(scope, 'create')).toContain('mediaObjectFieldsUnset()')
      expect(mediaAllow(scope, 'update')).toContain(
        'mediaObjectFieldsUnchanged()',
      )
    }
  })

  /**
   * The structural half, and the reason the host freeze fires at all.
   *
   * Firestore ORs its allows and the LOOSER branch wins, so a dedicated block
   * that narrows an operation the catch-all still grants narrows nothing. That
   * is not hypothetical: it is why an `author` could still delete a component
   * after that block's delete had been tightened and its comment said so
   * (AGL-2334). A guard that read only the `match /media/{mediaId}` block
   * would have called this closed on the day it was open.
   */
  it('`media` is excluded from the host catch-all create and update', () => {
    const { excluded, dedicated } = parseHostSubcollectionRules(read(RULES_FILE))
    expect(dedicated).toContain('media')
    expect(excluded.create).toContain('media')
    expect(excluded.update).toContain('media')
    // Delete is deliberately left to the catch-all: removing the document sets
    // no field, and the dedicated block re-grants no delete, so excluding the
    // name would take the DAM's delete away to close nothing.
    expect(excluded.delete).not.toContain('media')
  })
})
