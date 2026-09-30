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
 *
 * @jest-environment node
 */

/**
 * Every server-owned field of `marketplaceListings/{listingId}` is denied to
 * client writes (AGL-1361).
 *
 * Written with the host's guard in core (`host-write-deny-coverage.spec.ts`),
 * because the two documents carry the same hand-maintained-list shape, and
 * moved here with the list it partitions: `LISTING_CLIENT_WRITABLE_FIELDS` is
 * the marketplace's, and core may not import a plugin. The parsing is core's
 * (`write-deny-coverage.util`), so both guards read the rules one way.
 *
 * The listing has no single seed writer to sweep: ~6 sibling publish routes
 * each write their own literal, so its universe leans on the type and the
 * deny-list. That is why `MarketplaceListing`'s honesty matters, and why the
 * declared-field anchor below has a floor.
 *
 * The listing block declares `function listingManager()` INSIDE itself. Its
 * body is dropped by the depth walker but its header survives as an orphan
 * statement, which made the predicate match two branches instead of one in
 * the first pass.
 *
 * The companion behavioural assertions are in
 * `cloud/rules-tests/firestore-rules.test.mjs`, which drives a REAL emulator
 * write per key. This file proves the LISTS are complete; that one proves they
 * are enforced.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

import {
  declaredFields,
  deniedAndDeclaredWritable,
  parseUpdateRule,
  readFieldsOf,
  recursiveMatchesReaching,
  unclassifiedFields,
} from '@aglyn/aglyn/foundation/definitions/write-deny-coverage.util'
import {
  LISTING_CLIENT_WRITABLE_FIELDS,
  LISTING_UNPERSISTED_FIELDS,
} from './listing-visibility'

const REPO_ROOT = resolve(__dirname, '../../../../../..')

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')

const RULES_FILE = 'cloud/firebase-firestore.rules'
const LISTING_TYPES_FILE = 'libs/plugins/marketplace/src/lib/model/marketplace.ts'
const LISTING_POLICY_FILE =
  'libs/plugins/marketplace/src/lib/model/listing-visibility.ts'
/**
 * Where a policy reading a `listing` lives: the plugin's model, and core's
 * app-utils for the modules that still read a listing from there. Both are
 * swept whole, so a NEW policy reading a NEW field is covered the moment it is
 * written.
 */
const RESOLVER_DIRS = [
  'libs/plugins/marketplace/src/lib/model',
  'libs/aglyn/src/lib/app-utils',
]

const resolverSources = RESOLVER_DIRS.flatMap((dir) =>
  readdirSync(resolve(REPO_ROOT, dir))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => readFileSync(resolve(REPO_ROOT, dir, file), 'utf8')),
)

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
          // AGL-1420. The sibling counter, and the reason the pair is worth
          // naming rather than leaning on the count below: `installCount` was
          // denied here from the first pass while `activeInstalls` was
          // declared NOWHERE — not in this list, not on `MarketplaceListing`
          // — so it was not classified wrongly, it was outside the universe
          // this guard partitions. A field a coverage guard cannot see is the
          // one failure mode a coverage guard has.
          'activeInstalls',
          // AGL-1419's derived cache for it. `verifiedLivePins` short-circuits
          // on `pinnedActiveInstalls === activeInstalls` inside the TTL, so a
          // client that could write the triple could hold the cache open and
          // stop the derivation that is the only thing able to lower a count.
          'pinnedActiveInstalls',
          'pinsVerifiedAtMs',
          'pinnedVersionInstalls',
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
      expect(rule.denied.length).toBeGreaterThanOrEqual(32)
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
          // AGL-1420 — declared so the guard can see them at all.
          'activeInstalls',
          'pinnedActiveInstalls',
        ]),
      )
      expect(declared.length).toBeGreaterThanOrEqual(34)
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
        `These listing fields are read by the policies in ${RESOLVER_DIRS.join(' and ')} ` +
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
    const unclassified = unclassifiedFields(
      universe,
      denied,
      clientWritable,
      unpersisted,
    )
    if (unclassified.length > 0) {
      throw new Error(
        `These fields of \`marketplaceListings/{listingId}\` are not classified:\n\n` +
          `${unclassified.map((field) => `  • ${field}`).join('\n')}\n\n` +
          `Unclassified means CLIENT-WRITABLE in production right now — the ` +
          `rules deny only what is named, so a field nobody listed is a field ` +
          `any publisher can set from the client SDK (AGL-1354, AGL-1364).\n\n` +
          `Decide, on this commit:\n` +
          `  • server-owned — does a client rewrite change what the platform ` +
          `DECIDES (a price, whether something passed review, who may read)? ` +
          `Then add it to the client branch's hasAny([…]) list in ${RULES_FILE};\n` +
          `  • genuinely the publisher's own — add it to ` +
          `LISTING_CLIENT_WRITABLE_FIELDS in ${LISTING_POLICY_FILE} with a ` +
          `reason saying why a rewrite is harmless.\n\n` +
          `When in doubt, deny.`,
      )
    }
  })

  it('never lets a listing field be both denied and declared client-writable', () => {
    expect(
      deniedAndDeclaredWritable(
        denied,
        LISTING_CLIENT_WRITABLE_FIELDS,
        LISTING_UNPERSISTED_FIELDS,
      ),
    ).toEqual([])
  })

  it('keeps the declared listing client-writable list honest', () => {
    // A stale entry is how the next hole hides, and a reason nobody wrote is
    // a decision nobody made.
    for (const [field, reason] of Object.entries({
      ...LISTING_CLIENT_WRITABLE_FIELDS,
      ...LISTING_UNPERSISTED_FIELDS,
    })) {
      expect([field, universe.has(field)]).toEqual([field, true])
      expect([field, reason.length > 40]).toEqual([field, true])
    }
  })

  it('has no second rule that could OR a looser write onto the listing doc', () => {
    expect(
      recursiveMatchesReaching(rule.topLevelMatches, 'marketplaceListings'),
    ).toEqual([])
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
