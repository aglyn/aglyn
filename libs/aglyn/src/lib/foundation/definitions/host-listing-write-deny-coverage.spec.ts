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
 * Every server-owned field of `hosts/{hostId}` and
 * `marketplaceListings/{listingId}` is denied to client writes (AGL-1361).
 *
 * AGL-1355 built this property for `orgs/{orgId}` and said plainly that the
 * two documents carrying the same hand-maintained-list shape were NOT covered.
 * There was never a reason to expect them to have drifted less, and they had
 * not: writing this guard found AGL-1364 — a site-takedown primitive available
 * to any editor, and a marketplace review bypass available to any publisher.
 *
 * ## Why this is not a copy of the org guard
 *
 * The org guard's agent declined to extend it, for a good reason. `AglynHost`
 * has ~22 declared fields and MOST are legitimately client-writable: `seo`,
 * `theme`, `announcementBar`, the screen and layout directories. Copying the
 * org rules verbatim would either deny fields the editor needs — breaking
 * authoring outright — or classify everything permissively and prove nothing.
 *
 * So the classifications are per-field product judgement, recorded beside each
 * type in `HOST_CLIENT_WRITABLE_FIELDS` and `LISTING_CLIENT_WRITABLE_FIELDS`
 * with a reason. What carries over is the PROPERTY, not the list:
 * **default-deny**. An unclassified field fails the build naming itself, so
 * forgetting is not a reachable state.
 *
 * Two rule shapes had to be taught, and both were real bugs in the first pass:
 *
 *  - The host deny-list is **tiered** — six keys no site member may touch,
 *    plus `disabledPlugins` which only a site ADMIN may. That is a second
 *    `hasAny([…])` nested behind an inner `||`, which a naive branch split
 *    tore off into a branch nothing looked at. `splitTopLevelOr` and
 *    `allHasAnyKeys` exist for it.
 *  - The listing block declares `function listingManager()` INSIDE itself.
 *    Its body is dropped by the depth walker but its header survives as an
 *    orphan statement, which made the predicate match two branches instead of
 *    one.
 *
 * ## What this does not cover, stated plainly
 *
 * The same hole the org guard names: a field written by server code and
 * declared nowhere — not on the interface, not in the rules, not read by a
 * resolver — is outside every source below. The seed sweep is the mitigation
 * for the host (the fields a site is BORN with are always classified). The
 * listing has no single seed writer to sweep: ~6 sibling publish routes each
 * write their own literal, so its universe leans on the type and the
 * deny-list. That is why `MarketplaceListing`'s honesty matters, and why the
 * declared-field anchor below has a floor.
 *
 * The companion behavioural assertions are in
 * `cloud/rules-tests/firestore-rules.test.mjs`, which drives a REAL emulator
 * write per key. This file proves the LISTS are complete; that one proves they
 * are enforced. Neither is worth much alone: a complete list in a rule that
 * never fires is the AGL-1354 shape one level up.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

import {
  LISTING_CLIENT_WRITABLE_FIELDS,
  LISTING_UNPERSISTED_FIELDS,
} from '../../app-utils/marketplace-listing-visibility'
import {
  HOST_CLIENT_WRITABLE_FIELDS,
  HOST_UNPERSISTED_FIELDS,
} from './platform.types'
import {
  declaredFields,
  parseUpdateRule,
  readFieldsOf,
  seedFields,
} from './write-deny-coverage.util'

const REPO_ROOT = resolve(__dirname, '../../../../../..')

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')

const RULES_FILE = 'cloud/firebase-firestore.rules'
const HOST_TYPES_FILE =
  'libs/aglyn/src/lib/foundation/definitions/platform.types.ts'
const LISTING_TYPES_FILE =
  'libs/plugins/marketplace/src/lib/model/marketplace.ts'
const RESOLVER_DIR = 'libs/aglyn/src/lib/app-utils'
const HOST_SEED_FILE = 'apps/console/app/api/hosts/create/route.ts'

/**
 * The resolver modules, read once.
 *
 * `LISTING_TYPES_FILE` is read as TEXT, never imported: this lib is core and
 * the marketplace model is a plugin lib, so an import would be a dependency
 * edge pointing the wrong way. Parsing keeps the guard honest without
 * inverting the graph.
 */
const resolverSources = readdirSync(resolve(REPO_ROOT, RESOLVER_DIR))
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .map((file) => readFileSync(resolve(REPO_ROOT, RESOLVER_DIR, file), 'utf8'))

/**
 * Assert the partition, or throw naming every field that has no home.
 *
 * Shared by both documents because the failure is identical and the remedy is
 * identical: unclassified means CLIENT-WRITABLE in production right now — the
 * rules deny only what is named — so a field nobody listed is a field the
 * client can set today.
 */
function expectFullyClassified(options: {
  document: string
  universe: Set<string>
  denied: Set<string>
  clientWritable: Set<string>
  unpersisted: Set<string>
  writableList: string
}): void {
  const unclassified = [...options.universe].filter(
    (field) =>
      !options.denied.has(field) &&
      !options.clientWritable.has(field) &&
      !options.unpersisted.has(field),
  )
  if (unclassified.length > 0) {
    throw new Error(
      `These fields of \`${options.document}\` are not classified:\n\n` +
        `${unclassified.map((field) => `  • ${field}`).join('\n')}\n\n` +
        `Unclassified means CLIENT-WRITABLE in production right now — the ` +
        `rules deny only what is named, so a field nobody listed is a field ` +
        `any holder of the client SDK can set. That is AGL-1354, and ` +
        `AGL-1364 found two more of them on this pair of documents.\n\n` +
        `Decide, on this commit:\n` +
        `  • server-owned — does a client rewrite change what the platform ` +
        `DECIDES (an entitlement, a price, where a request routes, who may ` +
        `read, whether something passed review)? Then add it to the client ` +
        `branch's hasAny([…]) list in ${RULES_FILE};\n` +
        `  • genuinely the user's own — add it to ${options.writableList} ` +
        `with a reason saying why a rewrite is harmless.\n\n` +
        `When in doubt, deny: every key AGL-1354 and AGL-1364 closed was ` +
        `already written exclusively by an Admin-SDK route, so denying it ` +
        `changed nothing about the product.`,
    )
  }
}

/** The two partitions disagreeing means one of them is a lie. */
function expectDisjoint(
  denied: Set<string>,
  writable: Record<string, string>,
  unpersisted: Record<string, string>,
): void {
  const both = [...Object.keys(writable), ...Object.keys(unpersisted)].filter(
    (field) => denied.has(field),
  )
  expect(both).toEqual([])
}

/**
 * A stale allow-list entry is how the next hole hides, and a reason nobody
 * wrote is a decision nobody made.
 */
function expectListHonest(
  universe: Set<string>,
  entries: Record<string, string>,
): void {
  for (const [field, reason] of Object.entries(entries)) {
    expect([field, universe.has(field)]).toEqual([field, true])
    expect([field, reason.length > 40]).toEqual([field, true])
  }
}

describe('every server-owned host field is denied to client writes (AGL-1361)', () => {
  const rule = parseUpdateRule(
    read(RULES_FILE),
    'match /hosts/<hostId> {',
    'canWriteHostContent(hostId)',
  )
  const declared = declaredFields(
    read(HOST_TYPES_FILE),
    'export interface AglynHost extends AglynDocument {',
  )
  const inputs = readFieldsOf(resolverSources, 'host')
  const seeded = seedFields(
    read(HOST_SEED_FILE),
    /collection\('hosts'\)\s*\.doc\([^)]*\)\s*\.\s*(?:set|create)\s*\(/,
  )
  if (!seeded) {
    throw new Error(
      `Guard cannot parse the host seed write in ${HOST_SEED_FILE}. It is ` +
        `one of the four sources of the host document's field set — fix the ` +
        `parse rather than dropping the source.`,
    )
  }

  const denied = new Set(rule.denied)
  const clientWritable = new Set(Object.keys(HOST_CLIENT_WRITABLE_FIELDS))
  const unpersisted = new Set(Object.keys(HOST_UNPERSISTED_FIELDS))
  const universe = new Set([...declared, ...rule.denied, ...inputs, ...seeded])

  describe('the parsers still see what they are supposed to see', () => {
    it('reads the host deny-list out of the rules, including the admin tier', () => {
      expect(rule.denied).toEqual(
        expect.arrayContaining([
          'memberRoles',
          'orgId',
          'subdomain',
          'cname',
          // AGL-1364. `cname` was denied and these were not, so the takedown
          // it exists to prevent was reachable one key over.
          'cnameAttachmentPending',
          'cnameDetachmentPending',
          // The second, ADMIN-ONLY hasAny list. A naive branch split loses
          // this, and the guard would have believed it unprotected.
          'disabledPlugins',
        ]),
      )
      expect(rule.denied.length).toBeGreaterThanOrEqual(12)
      // isStaff / the client branch.
      expect(rule.branches).toHaveLength(2)
    })

    it('reads the document field set off AglynHost', () => {
      expect(declared).toEqual(
        expect.arrayContaining(['$id', 'subdomain', 'cname', 'seo', 'theme']),
      )
      expect(declared.length).toBeGreaterThanOrEqual(20)
    })

    it('finds the host fields the resolvers actually read', () => {
      expect(inputs).toEqual(
        expect.arrayContaining([
          'cname',
          'subdomain',
          // The AGL-1364 pair, found by this sweep rather than by review.
          'cnameAttachmentPending',
          'cnameDetachmentPending',
        ]),
      )
      expect(inputs.length).toBeGreaterThanOrEqual(10)
    })

    it('finds the fields a site is created with', () => {
      expect(seeded).toEqual(
        expect.arrayContaining(['displayName', 'subdomain', 'orgId']),
      )
    })
  })

  it('denies every host field the routing/entitlement resolvers read', () => {
    // The derived half: no list, no memory, no review checklist. A resolver
    // reading a field is what MAKES it server-owned — but only where the read
    // is a DECISION the platform makes about the site, which for a host is
    // routing, provenance and access. Fields the resolvers merely render
    // (`displayName`, `seo`, `logoUrl`) are authoring and are classified.
    const exposed = inputs.filter(
      (field) =>
        !denied.has(field) &&
        !clientWritable.has(field) &&
        !unpersisted.has(field),
    )
    if (exposed.length > 0) {
      throw new Error(
        `These host fields are read by resolvers in ${RESOLVER_DIR} but an ` +
          `editor can still write them from the Firebase client SDK:\n\n` +
          `${exposed.map((field) => `  • ${field}`).join('\n')}\n\n` +
          `A field a resolver reads is an INPUT TO A DECISION. AGL-1364 was ` +
          `exactly this: \`liveCustomDomain\` refuses to redirect on three ` +
          `conditions and only one of them was denied, so an editor could ` +
          `clear the other two and point the site's last working origin at a ` +
          `domain that serves nothing.`,
      )
    }
  })

  it('classifies every field of the host document, defaulting to denied', () => {
    expectFullyClassified({
      document: 'hosts/{hostId}',
      universe,
      denied,
      clientWritable,
      unpersisted,
      writableList: `HOST_CLIENT_WRITABLE_FIELDS in ${HOST_TYPES_FILE}`,
    })
  })

  it('never lets a host field be both denied and declared client-writable', () => {
    expectDisjoint(denied, HOST_CLIENT_WRITABLE_FIELDS, HOST_UNPERSISTED_FIELDS)
  })

  it('keeps the declared host client-writable list honest', () => {
    expectListHonest(universe, {
      ...HOST_CLIENT_WRITABLE_FIELDS,
      ...HOST_UNPERSISTED_FIELDS,
    })
  })

  it('has no second rule that could OR a looser write onto the host doc', () => {
    // Sibling `match` blocks are OR'd and the LOOSER one wins, so a deny-list
    // in one block proves nothing if a wildcard block elsewhere allows the
    // same write. `parseUpdateRule` already refuses more than one
    // `allow … update` inside the block; this covers the outside of it.
    expect(rule.topLevelMatches.filter((path) => path.includes('**'))).toEqual(
      [],
    )
    expect(
      rule.topLevelMatches.filter((path) => path.startsWith('/hosts')),
    ).toEqual(['/hosts/<hostId>'])
    // And no depth-0 `allow write` in the host block, which would swallow
    // updates whole regardless of the key diff. The subcollection blocks have
    // their own `allow write`, but those sit deeper and cannot reach the host
    // document — the extra `{subcollection}` segment in the catch-all is
    // precisely what keeps a bare `{document=**}` from matching it (AGL-235).
    expect(
      rule.statements.filter((statement) => /\ballow\s+write\b/.test(statement)),
    ).toEqual([])
  })
})

describe('every server-owned listing field is denied to client writes (AGL-1361)', () => {
  const rule = parseUpdateRule(
    read(RULES_FILE),
    'match /marketplaceListings/<listingId> {',
    'listingManager()',
  )
  const declared = declaredFields(
    read(LISTING_TYPES_FILE),
    'export interface MarketplaceListing {',
  )
  // `listing` is the binding the visibility/update-state policies read.
  const inputs = readFieldsOf(resolverSources, 'listing')

  const denied = new Set(rule.denied)
  const clientWritable = new Set(Object.keys(LISTING_CLIENT_WRITABLE_FIELDS))
  const unpersisted = new Set(Object.keys(LISTING_UNPERSISTED_FIELDS))
  const universe = new Set([...declared, ...rule.denied, ...inputs])

  describe('the parsers still see what they are supposed to see', () => {
    it('reads the listing deny-list out of the rules', () => {
      expect(rule.denied).toEqual(
        expect.arrayContaining([
          'installCount',
          'priceUsd',
          'profileId',
          'reviewStatus',
          'latestApprovedVersion',
          'hiddenAt',
          // AGL-1364. `reviewStatus` was denied, but the gate that reads it
          // only applies to plugins — so relabelling the artifact skipped
          // review without touching the verdict.
          'artifactType',
          'type',
          'kind',
        ]),
      )
      expect(rule.denied.length).toBeGreaterThanOrEqual(28)
      // isStaff / listingManager.
      expect(rule.branches).toHaveLength(2)
    })

    it('reads the document field set off MarketplaceListing', () => {
      expect(declared).toEqual(
        expect.arrayContaining([
          'profileId',
          'reviewStatus',
          'artifactType',
          'deletedAt',
        ]),
      )
      expect(declared.length).toBeGreaterThanOrEqual(30)
    })

    it('finds the listing fields the visibility policies read', () => {
      expect(inputs).toEqual(
        expect.arrayContaining(['artifactType', 'reviewStatus', 'hiddenAt']),
      )
    })
  })

  it('denies every listing field the visibility/update policies read', () => {
    const exposed = inputs.filter(
      (field) =>
        !denied.has(field) &&
        !clientWritable.has(field) &&
        !unpersisted.has(field),
    )
    if (exposed.length > 0) {
      throw new Error(
        `These listing fields are read by the policies in ${RESOLVER_DIR} ` +
          `but a publisher can still write them from the client SDK:\n\n` +
          `${exposed.map((field) => `  • ${field}`).join('\n')}\n\n` +
          `AGL-1364 was exactly this: \`isListingBrowsable\` consults ` +
          `\`reviewStatus\` only for PLUGINS, and \`listingArtifactType\` ` +
          `resolves three fields none of which were denied — so a publisher ` +
          `sitting at 'rejected' could relabel the artifact and become ` +
          `publicly browsable without touching the verdict.`,
      )
    }
  })

  it('classifies every field of the listing document, defaulting to denied', () => {
    expectFullyClassified({
      document: 'marketplaceListings/{listingId}',
      universe,
      denied,
      clientWritable,
      unpersisted,
      writableList:
        'LISTING_CLIENT_WRITABLE_FIELDS in ' +
        'libs/aglyn/src/lib/app-utils/marketplace-listing-visibility.ts',
    })
  })

  it('never lets a listing field be both denied and declared client-writable', () => {
    expectDisjoint(
      denied,
      LISTING_CLIENT_WRITABLE_FIELDS,
      LISTING_UNPERSISTED_FIELDS,
    )
  })

  it('keeps the declared listing client-writable list honest', () => {
    expectListHonest(universe, {
      ...LISTING_CLIENT_WRITABLE_FIELDS,
      ...LISTING_UNPERSISTED_FIELDS,
    })
  })

  it('has no second rule that could OR a looser write onto the listing doc', () => {
    expect(rule.topLevelMatches.filter((path) => path.includes('**'))).toEqual(
      [],
    )
    // `/revocations/{listingId}` is keyed by the same id but is a DIFFERENT
    // collection, so the filter is on the collection name, not the variable.
    expect(
      rule.topLevelMatches.filter((path) =>
        path.startsWith('/marketplaceListings'),
      ),
    ).toEqual(['/marketplaceListings/<listingId>'])
    expect(
      rule.statements.filter((statement) => /\ballow\s+write\b/.test(statement)),
    ).toEqual([])
  })
})
