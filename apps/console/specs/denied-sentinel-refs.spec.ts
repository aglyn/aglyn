/**
 * @jest-environment node
 */

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
 * No client Firestore ref may fall back to a sentinel id on a RULES-DENIED
 * collection (AGL-1440), swept across the whole repo rather than one file at
 * a time — the AGL-1380 lesson, where fixing one sentinel left two siblings
 * thirty lines below, and the AGL-1484 lesson, where per-file specs kept
 * passing while the shape spread.
 *
 * ## Why this class is worth a corpus sweep
 *
 * A `'-pending-'` org id or `'-none-'` host id is not "one wasted read".
 * The rules refuse it — `orgs/{id}` behind `isOrgMember()`, `hosts/{id}`
 * behind `memberRoles` on a missing doc, `users/{uid}/notifications` behind
 * the owner, `marketplacePurchases` behind buyer/seller equality (and a
 * LIST is evaluated against the QUERY, so the sentinel denies the whole
 * query) — and the listener hooks then retry a refusal forever by design.
 * Fourteen of these accounted for most of the 366K denies AGL-1440
 * measured. The retry loop now backs a rules denial off to 60s
 * (`refused-cadence.spec.ts`), but the right count of guaranteed-denied
 * listens is zero: the hooks issue NOTHING for a null ref, so `null` is
 * both cheaper and more honest than a ref that can only error.
 *
 * ## What the patterns deliberately do not cover
 *
 * Sentinels on PUBLIC collections (`marketplaceListings`,
 * `publisherProfiles`) resolve to an empty read and are left alone — wasted
 * during a loading window, never denied, and AGL-1440 triaged them as
 * cosmetic. Sentinels as a LATER path segment under a real gated parent
 * (`hosts/{real}/collections/{'-none-'}/entries`) are allowed-empty because
 * the rule gates on the parent. Each pattern therefore binds the sentinel
 * to the position that the rules actually evaluate: the first id after the
 * gated collection name, or the gated `where` operand.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { code } from './source-text'

const REPO_ROOT = resolve(__dirname, '../../..')

const SENTINEL = "'-(?:none|pending|missing|anonymous)-'"

/**
 * Each entry names the rules gate that makes the position denied. Matched
 * against comment-stripped, whitespace-collapsed source; `[^,)]*?` binds the
 * sentinel to ONE argument, so a sentinel deeper in the path (behind a real
 * gated parent) does not match.
 */
const DENIED_POSITIONS: ReadonlyArray<[string, RegExp]> = [
  // orgs/{orgId} and everything under it → isOrgMember()
  ['org id fallback', new RegExp(`'orgs',\\s*[^,)]*?${SENTINEL}`)],
  // hosts/{hostId} → resource.data.get('memberRoles') on a missing doc
  ['host id fallback', new RegExp(`'hosts',\\s*[^,)]*?${SENTINEL}`)],
  // users/{uid}/... → owner-gated
  ['uid fallback', new RegExp(`'users',\\s*[^,)]*?${SENTINEL}`)],
  // datasets/{id}/records → scoped-sharing rules (AGL-1044)
  ['dataset id fallback', new RegExp(`'datasets',\\s*[^,)]*?${SENTINEL}`)],
  // marketplacePurchases → buyer/seller equality, denied per-QUERY
  [
    'purchases query fallback',
    new RegExp(
      `where\\(\\s*'(?:buyerUid|sellerOrgId)',\\s*'==',\\s*[^)]*?${SENTINEL}`,
    ),
  ],
]

describe('AGL-1440 · no ref falls back to a sentinel the rules must deny', () => {
  const candidates = (): string[] =>
    execSync('git ls-files "*.ts" "*.tsx"', {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString()
      .split('\n')
      .filter(Boolean)
      .filter((file) => !file.endsWith('.spec.ts') && !file.endsWith('.spec.tsx'))
      .filter((file) =>
        /-(?:none|pending|missing|anonymous)-/.test(
          readFileSync(join(REPO_ROOT, file), 'utf8'),
        ),
      )

  it('finds no denied-position sentinel anywhere in tracked source', () => {
    const offenders: string[] = []
    for (const file of candidates()) {
      // Stripped, because the fixes' own comments name the shape they
      // replaced — a raw-text sweep would match the explanation of the bug
      // rather than the bug (the AGL-1484 spec's lesson, same setting).
      const source = code(
        readFileSync(join(REPO_ROOT, file), 'utf8'),
        file,
        0,
      ).replace(/\s+/g, ' ')
      for (const [label, pattern] of DENIED_POSITIONS) {
        if (pattern.test(source)) offenders.push(`${file} (${label})`)
      }
    }
    expect(offenders.sort()).toEqual([])
  })

  /**
   * The planted violations: every expression below SHIPPED (AGL-1440 §2
   * lists the file each came from), and the sweep must recognise each one —
   * a detector that has never gone red is not yet a detector.
   */
  it('still recognises the exact shapes that shipped', () => {
    const shipped: ReadonlyArray<[string, string]> = [
      ['org id fallback', "collection(firestore, 'orgs', orgId ?? '-pending-', 'installs')"],
      ['org id fallback', "doc(firestore, 'orgs', orgId || '-pending-', 'installs', listingId || '-missing-')"],
      ['host id fallback', "collection(firestore, 'hosts', hostId || '-none-', 'components')"],
      ['host id fallback', "collection(firestore, 'hosts', hostId || '-pending-', TENANT_EMAIL_COLLECTION)"],
      ['uid fallback', "collection(firestore, 'users', uid ?? '-none-', 'notifications')"],
      ['dataset id fallback', "'datasets', selected?.$id ?? '-none-', 'records'"],
      ['purchases query fallback', "where('sellerOrgId', '==', orgId || '-none-')"],
      ['purchases query fallback', "where('buyerUid', '==', user?.uid ?? '-anonymous-')"],
    ]
    for (const [label, expression] of shipped) {
      const pattern = DENIED_POSITIONS.find(([name]) => name === label)?.[1]
      expect({ label, expression, matches: pattern?.test(expression) }).toEqual(
        { label, expression, matches: true },
      )
    }
  })

  /**
   * And the allowed shapes stay allowed — the sweep must not creep into the
   * positions the rules do not evaluate, or the next person silences it.
   */
  it('does not flag a sentinel behind a real gated parent or on a public read', () => {
    const allowed = [
      // Later path segment under a real host — the rule gates on the host.
      "collection(firestore, 'hosts', hostId, 'collections', selected?.$id ?? '-none-', 'entries')",
      "collection(firestore, 'hosts', hostId, 'screens', editor?.screenId ?? '-none-', 'versions')",
      // Public collections: wasted round trip during a loading window, not
      // a denial. Triaged cosmetic by AGL-1440 and deliberately out of scope.
      "doc(firestore, 'marketplaceListings', listingId || '-missing-')",
      "doc(firestore, 'publisherProfiles', orgId || '-none-')",
      // Gated where-clause on an ALLOWED collection under a real org.
      "where('source.listingId', '==', listingId || '-missing-')",
    ]
    for (const expression of allowed) {
      for (const [label, pattern] of DENIED_POSITIONS) {
        expect({ label, expression, matches: pattern.test(expression) }).toEqual(
          { label, expression, matches: false },
        )
      }
    }
  })
})
