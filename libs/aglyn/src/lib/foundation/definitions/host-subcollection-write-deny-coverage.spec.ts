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
 * No host subcollection the metered invoice is computed from is writable by
 * the client (AGL-1367).
 *
 * AGL-1361 built default-deny coverage for the FIELDS of `hosts/{hostId}`.
 * AGL-1367 was the same failure one level out: not an unclassified field but an
 * unclassified COLLECTION. `hosts/{hostId}/counters/*` had no dedicated rules
 * block and appeared in none of the host catch-all's three exclusion lists, so
 * `canWriteHostContent` — admin or EDITOR — granted full create/update/delete
 * on the documents that hold the entire enforcement state of five quotas and
 * three of the four inputs to `estimateMonthlyUsageCost`. Zeroing
 * `counters/media.bytes` bought unbounded Firebase Storage on a Free plan;
 * lowering any of them lowered a live Stripe metered invoice.
 *
 * ## Why this guard is derived rather than declared
 *
 * The field guards partition a declared interface, because a document's fields
 * are enumerable. A host's subcollections are not — ~49 names appear under
 * `hosts/{hostId}` across the repo, most of them plugin content — so a
 * hand-written classification of all of them would be a large list of guesses
 * dressed as decisions, and the first stale entry is where the next hole hides.
 *
 * So this asks the narrower question that AGL-1367 actually answers, and asks
 * it of a DIRECTORY rather than a file list: every host subcollection the
 * billing rollup reads must be denied to client writes, or be named below with
 * a reason it is not billed. A new metered input added under a new collection
 * fails the build until someone decides which it is. That is the AGL-1361
 * property — "a read is an INPUT TO A DECISION" — transposed from fields to
 * collections, with the decision here being money.
 *
 * The behavioural companion is `cloud/rules-tests/firestore-rules.test.mjs`,
 * which drives a real client-SDK write per collection against the emulator and
 * was mutation-tested nine ways: dropping any of `counters`, `analytics` or
 * `members` from any one of the three exclusion lists turns it red naming the
 * key. This file proves the RULES cover what billing reads; that one proves
 * the rules fire. A complete list in a rule that never runs is AGL-1354 again.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

import { parseHostSubcollectionRules } from './write-deny-coverage.util'

const REPO_ROOT = resolve(__dirname, '../../../../../..')
const RULES_FILE = 'cloud/firebase-firestore.rules'
const BILLING_DIR = 'apps/console/app/api/billing'

/**
 * Host subcollections the billing routes read that do NOT price anything.
 *
 * Kept deliberately tiny and reasoned. `report-usage` computes `billedCents`
 * from `estimateMonthlyUsageCost(usage, org)` plus the dataset, API and
 * contact overages; `siteSizeBytes` is summed beside it and written into the
 * audit rollup, but never added to `billedCents` and never sent to the Stripe
 * meter. An editor who rewrites a screen changes what their own site weighs
 * and pays exactly the same, which is what makes this safe and is why the
 * reason has to be written down rather than assumed.
 */
const BILLING_READS_NOT_METERED: Record<string, string> = {
  screens:
    'Site size only. `siteSizeBytes` lands in the usage audit rollup and the ' +
    'staff COGS view; it is not part of `billedCents` and is never sent to ' +
    'the Stripe meter, so a client rewrite moves a number nobody charges for ' +
    '— and screens must stay editor-writable or authoring stops.',
  layouts:
    'The other half of `siteSizeBytes`, on the same footing as `screens`: ' +
    'measured, reported, never billed, and client-writable by necessity ' +
    'because a shared layout is authored in the console.',
}

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')

/**
 * Every host subcollection the billing routes read, swept off the DIRECTORY.
 *
 * Directory-wide on purpose, like the resolver sweep in the field guard: a
 * per-file list would be one more thing to tend, and a NEW billing route
 * reading a NEW collection is covered the moment it is written.
 *
 * The binding is what makes a read host-scoped. `report-usage` also walks
 * `doc.ref.collection('versions')` where `doc` is a screen — matching a bare
 * `.collection('…')` would sweep that in as if it hung off the host and demand
 * the rules deny version history, which is client-written by every save.
 */
const billingHostReads = (() => {
  const dir = resolve(REPO_ROOT, BILLING_DIR)
  const sources = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(dir, entry.name, 'route.ts'))
    .filter((path) => {
      try {
        readFileSync(path)
        return true
      } catch {
        return false
      }
    })
    .map((path) => readFileSync(path, 'utf8'))
  const found = new Set<string>()
  for (const source of sources) {
    for (const hit of source.matchAll(
      /\b(?:hostRef|host\.ref)\s*\.\s*collection\(\s*'([A-Za-z][A-Za-z0-9]*)'/g,
    )) {
      found.add(hit[1])
    }
  }
  return [...found].sort()
})()

describe('the metered invoice is computed from server-owned documents only (AGL-1367)', () => {
  const rules = parseHostSubcollectionRules(read(RULES_FILE))

  describe('the parsers still see what they are supposed to see', () => {
    it('reads the host catch-all exclusion lists out of the rules', () => {
      // One list per operation, and none of them empty — an exclusion list
      // that failed to parse would silently make every collection look
      // client-writable and this whole guard would pass by accident.
      expect(rules.excluded.create).toEqual(
        expect.arrayContaining(['screens', 'datasets', 'webhooks']),
      )
      expect(rules.excluded.update.length).toBeGreaterThanOrEqual(6)
      expect(rules.excluded.delete.length).toBeGreaterThanOrEqual(4)
    })

    it('sees the dedicated blocks that RE-GRANT what the lists exclude', () => {
      // Without this subtraction the guard would call `screens` denied. Rules
      // OR their allows and the looser wins, which is the single most
      // load-bearing fact about this file.
      expect(rules.dedicated).toEqual(
        expect.arrayContaining([
          'screens',
          'layouts',
          'components',
          'templates',
          'webhooks',
          'orders',
          'collections',
        ]),
      )
      expect(rules.serverOnly).not.toContain('screens')
      expect(rules.serverOnly).not.toContain('collections')
    })

    it('finds the host subcollections the billing routes read', () => {
      // The floor. Renaming the `hostRef` binding would otherwise empty this
      // sweep and leave the guard asserting nothing, forever green.
      expect(billingHostReads).toEqual(
        expect.arrayContaining(['counters', 'analytics']),
      )
    })
  })

  it('denies client writes to every host subcollection the invoice reads', () => {
    const exposed = billingHostReads.filter(
      (name) =>
        !rules.serverOnly.includes(name) &&
        !(name in BILLING_READS_NOT_METERED),
    )
    if (exposed.length > 0) {
      throw new Error(
        `These host subcollections are read by the billing rollup in ` +
          `${BILLING_DIR} but a site EDITOR can still write them from the ` +
          `Firebase client SDK:\n\n` +
          `${exposed.map((name) => `  • hosts/{hostId}/${name}`).join('\n')}\n\n` +
          `A document the invoice is computed from is a document the customer ` +
          `must not be able to write. AGL-1367 was exactly this: ` +
          `\`counters/media.bytes\` and \`analytics/{day}.total\` feed ` +
          `\`estimateMonthlyUsageCost\`, and metered pass-through is live for ` +
          `every paid plan (AGL-1280), so lowering them lowered a real bill — ` +
          `while zeroing the same storage counter also removed the ` +
          `\`storagePerHostMb\` wall entirely.\n\n` +
          `Decide, on this commit:\n` +
          `  • priced — add the name to ALL THREE \`subcollection in […]\` ` +
          `exclusion lists of the host catch-all in ${RULES_FILE}. All three: ` +
          `one list is not denial, and a dedicated ` +
          `\`allow write: if false\` block does NOT close it, because sibling ` +
          `match blocks are OR'd and the looser one wins;\n` +
          `  • measured but not billed — add it to ` +
          `BILLING_READS_NOT_METERED with a reason saying why a client ` +
          `rewrite costs nobody anything.\n\n` +
          `When in doubt, deny: every writer of the collections AGL-1367 ` +
          `closed was already an Admin-SDK route, so denying them changed ` +
          `nothing about the product.`,
      )
    }
  })

  it('keeps the not-metered exemptions honest', () => {
    for (const [name, reason] of Object.entries(BILLING_READS_NOT_METERED)) {
      // Still read by billing — a stale exemption is a name nobody is
      // checking any more, which is where the next one hides.
      expect([name, billingHostReads.includes(name)]).toEqual([name, true])
      expect([name, reason.length > 40]).toEqual([name, true])
      // And never both exempt and denied: one of the two would be a lie.
      expect([name, rules.serverOnly.includes(name)]).toEqual([name, false])
    }
  })

  it('holds the three collections AGL-1367 closed', () => {
    // The floor that makes the emulator suite's mutation proof meaningful
    // here too: drop any one of these from any one of the three lists and it
    // leaves `serverOnly`, and this fails naming it — without needing an
    // emulator, so the plain unit build catches it.
    for (const name of ['counters', 'analytics', 'members']) {
      expect([name, rules.serverOnly.includes(name)]).toEqual([name, true])
    }
  })
})
