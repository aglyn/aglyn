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
 * THE DIVERGENCE GUARD (AGL-1974).
 *
 * An export whose coverage differs from erasure's is a bug in one of them.
 * They answer the same question — *what do we hold about this subject* — and
 * they fail in mirrored ways: an export that misses a collection
 * under-discloses on a statutory access request, and an erasure that misses
 * the same one leaves data standing after a customer was told it was gone.
 *
 * The history is the argument. `erase.ts` learned about `apiKeys` in
 * AGL-1444, about `ssoDomains`/`consoleDomains`/`apiIdempotency`/
 * `stripeCustomers`/`orgSlugs` in AGL-1448, about `profiles`/
 * `publisherProfiles`/`publisherHandles` in AGL-1970 and about
 * `supportTickets` in AGL-1971 — four separate discoveries that a path-scoped
 * cascade is structurally blind to anything keyed by a field. Each was found
 * by a person looking. A second hand-maintained list of the same collections,
 * in the export, would drift the same way and nobody would notice, because the
 * symptom of an incomplete export is a file that looks complete.
 *
 * Ideally both derive from ONE enumeration. `erase.ts` expresses its sweep
 * list as code rather than data and is under concurrent change, so instead:
 * this spec DISCOVERS every collection `erase.ts` names, out of its source,
 * and requires each one to appear in `PERSONAL_DATA_SOURCES` with an explicit
 * disclosure decision. Discovered, not listed — a new sweep arrives in this
 * spec by existing, and fails until somebody decides whether the export
 * discloses it.
 *
 * Reading source text is a blunt instrument and is the honest one here: the
 * thing being guarded IS the text of a sweep list. A rename that this spec
 * cannot parse fails loudly rather than passing quietly, which is the correct
 * direction for a check whose whole job is to notice a change.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EXPORT_COVERED_COLLECTIONS,
  EXPORT_WITHHELD,
  PERSONAL_DATA_SOURCES,
} from './personal-data-export'

const ERASE_SOURCE = readFileSync(join(__dirname, 'erase.ts'), 'utf8')

/**
 * Collections `erase.ts` touches for reasons that are not "this is subject
 * data we hold" — the plumbing of the operation itself.
 *
 * Each needs a reason, and none of them may be a data collection:
 *
 *  - `users` is reached by BOTH functions, but on the org side only to delete
 *    the member's `users/{uid}/orgs/{orgId}` back-reference. The export covers
 *    `users` as a first-class source for the person subject.
 *  - `orgs` and `hosts` likewise: the export covers them, and the erasure also
 *    touches them to strip routing-map keys.
 *  - `adminAudit` is the record OF the erasure, written by it — not a source
 *    it sweeps. The export withholds it for a stated reason of its own.
 */
const PLUMBING = new Set(['users', 'orgs', 'hosts', 'adminAudit'])

/**
 * Subcollections the erasure names directly, and the exported source whose
 * subtree walk reaches each one.
 *
 * Not an exemption list — the assertion below requires the named PARENT to be
 * an exported source, so "it is covered by its parent" is checked rather than
 * asserted. `members` is read by `eraseOrg` to count the roster and clean up
 * back-references, and comes out inside the `orgs` tree; `messages` is the
 * support thread's body, reached inside `supportTickets` for an org and by
 * `authorId` for a person.
 *
 * This entry earned its place: the guard's very first run flagged both,
 * because neither was in the export's source list and neither had a decision.
 */
const REACHED_UNDER: Record<string, string> = {
  members: 'orgs',
  messages: 'supportTickets',
}

/**
 * Every collection name `erase.ts` mentions, from three shapes:
 *   - `deleteDocsByOrgId('x', …)` — the field-keyed sweep helper;
 *   - `.collection('x')` — a direct read or delete;
 *   - `collectionGroup('x')` — the cross-workspace redaction sweep.
 * Plus the one name that arrives as an imported constant.
 */
function collectionsNamedIn(source: string): Set<string> {
  const found = new Set<string>()
  for (const pattern of [
    /deleteDocsByOrgId\(\s*'([^']+)'/g,
    /\.collection\(\s*'([^']+)'\s*\)/g,
    /collectionGroup\(\s*'([^']+)'\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) found.add(match[1])
  }
  // `CONSOLE_DOMAINS_COLLECTION` is imported rather than written as a literal,
  // so the regexes above cannot see it. Resolved from its own module so a
  // rename of the constant's VALUE is caught too.
  if (source.includes('CONSOLE_DOMAINS_COLLECTION')) {
    const consoleDomains = readFileSync(
      join(__dirname, 'console-domains.ts'),
      'utf8',
    )
    const value = consoleDomains.match(
      /CONSOLE_DOMAINS_COLLECTION\s*=\s*'([^']+)'/,
    )
    expect(value).toBeTruthy()
    found.add((value as RegExpMatchArray)[1])
  }
  return found
}

const ERASED = collectionsNamedIn(ERASE_SOURCE)

describe('the export and the erasure see the same collections', () => {
  it('finds the sweeps at all — the guard can fail', () => {
    // A parse that silently matched nothing would make every assertion below
    // vacuously true, which is the shape of green check this repo has been
    // bitten by. These are the four AGL-1448 sweeps; if the regexes stop
    // finding them, the guard is broken and says so here rather than passing.
    expect(ERASED.size).toBeGreaterThan(8)
    for (const known of [
      'apiKeys',
      'ssoDomains',
      'stripeCustomers',
      'apiIdempotency',
      'orgSlugs',
    ]) {
      expect(ERASED.has(known)).toBe(true)
    }
  })

  it('EVERY collection the erasure touches has a disclosure decision', () => {
    // The property. A sweep added to `erase.ts` without a matching entry here
    // means the erasure destroys something the export never mentions — a
    // customer told "this is everything we hold" about a collection nobody
    // listed.
    const undecided = [...ERASED]
      .filter((collection) => !PLUMBING.has(collection))
      .filter((collection) => !(collection in REACHED_UNDER))
      .filter((collection) => !EXPORT_COVERED_COLLECTIONS.includes(collection))
    expect(undecided).toEqual([])
  })

  it('every subcollection is reached through a parent that IS exported', () => {
    // "Covered by its parent" is checked, not asserted. If a parent were ever
    // withheld, its children would be silently withheld with it — an
    // under-disclosure with no entry anywhere saying so.
    for (const [child, parent] of Object.entries(REACHED_UNDER)) {
      const spec = PERSONAL_DATA_SOURCES.find(
        (source) => source.collection === parent,
      )
      expect([child, spec?.collection]).toEqual([child, parent])
      expect([child, spec?.exported]).toEqual([child, true])
    }
  })

  it('the export claims nothing the erasure does not know about', () => {
    // The other direction, and it is not symmetric decoration: a source in the
    // export that the erasure never sweeps is data we disclose and then fail
    // to delete — the AGL-1444 defect discovered from the access side instead
    // of the deletion side.
    //
    // Two documented exceptions, both statutory: tax records survive an
    // erasure on purpose (GDPR Art. 17(3)(b)) and `erase.ts` says in terms
    // that they must NEVER be swept, so they appear in the export's list and
    // not in the erasure's. `hostIndex` is reached through the host sweep.
    const RETAINED_BY_LAW = ['platformRevenue', 'storefrontTaxCollected']
    const unexplained = EXPORT_COVERED_COLLECTIONS.filter(
      (collection) =>
        !ERASED.has(collection) && !RETAINED_BY_LAW.includes(collection),
    )
    expect(unexplained).toEqual([])
  })

  it('the statutory exceptions are the ones erase.ts refuses to sweep', () => {
    // Not asserted from memory: `erase.ts` carries the prohibition in its own
    // words, and this reads it. If a future edit removes the warning, the
    // export's justification for listing them separately has gone with it.
    expect(ERASE_SOURCE).toContain(
      '`platformRevenue` must NEVER be added to this sweep',
    )
    expect(ERASE_SOURCE).toContain(
      '`storefrontTaxCollected` must NEVER be added either',
    )
    for (const collection of ['platformRevenue', 'storefrontTaxCollected']) {
      const spec = PERSONAL_DATA_SOURCES.find(
        (source) => source.collection === collection,
      )
      expect(spec?.exported).toBe(true)
      // Disclosed BECAUSE they survive: the export is the only place a
      // customer can see what an erasure left behind.
      expect(spec?.note).toMatch(/erasure|retention|Art\. 17/i)
    }
  })
})

describe('every withheld source states why', () => {
  it('carries a real reason, not a placeholder', () => {
    expect(EXPORT_WITHHELD.length).toBeGreaterThan(0)
    for (const source of EXPORT_WITHHELD) {
      expect(source.note.trim().length).toBeGreaterThan(40)
      expect(source.note).toMatch(/[A-Z]/)
    }
  })

  it('withholds nothing that is plainly the subject’s own data', () => {
    // The list of things it is legitimate to withhold is short and closed:
    // our own handling records, and identifiers that are hashes of a
    // credential. Anything else withheld is an under-disclosure wearing a
    // reason.
    const allowed = new Set(['adminAudit', 'apiIdempotency'])
    expect(EXPORT_WITHHELD.map((source) => source.collection).sort()).toEqual(
      [...allowed].sort(),
    )
  })
})
