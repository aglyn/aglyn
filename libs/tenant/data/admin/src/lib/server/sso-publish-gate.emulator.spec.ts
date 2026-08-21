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
 * The SSO publish gate has a refusal branch, and this is what exercises it
 * (AGL-1912).
 *
 * `publishSsoDomains` is the ONLY writer of the top-level `ssoDomains`
 * collection, and a live `ssoDomains/{domain}` doc is what routes that
 * domain's sign-ins to an org's IdP. One line carries the whole invariant:
 *
 *   const claim = await claimRef(orgId, domain).get()
 *   if (!claim.exists || claim.get('verified') !== true) continue
 *
 * Delete that line before AGL-1912 and every suite in the repo still passed.
 * The token side of domain verification is well covered by
 * `sso-provisioning.spec.ts`, and `erase-org-routing.emulator.spec.ts` calls
 * this function — but only POSITIVELY, seeding `{ verified: true }` to guard
 * the premise of an erasure assertion. Nothing took the refusal branch, so a
 * regression here would have shipped silently into the one place it must not:
 * an org publishing routing for a domain it does not own intercepts another
 * company's sign-ins, which is the account-takeover vector AGL-1210 was
 * written to close.
 *
 * ## Why the emulator and not a double
 *
 * Deliberate, and the reason is the issue itself. These assertions rest on
 * `.doc().get()`, `.exists`, `.get(field)` and `batch()` behaving exactly as
 * Firestore does. A hand-rolled fake that got any of them subtly wrong would
 * fabricate a green here just as convincingly as a real pass — the same class
 * of false signal AGL-1912 exists to remove. `sso-provisioning.spec.ts` stays
 * a pure-function suite; the Firestore-shaped half lives here.
 *
 * ## Every case owns its own domain
 *
 * No case depends on another's cleanup, and no case can pass because a
 * previous one left the collection in a convenient state. Each also asserts
 * on the DOCUMENT as well as the return value: `published` is a report, and a
 * regression that wrote the doc and forgot to push the name would be invisible
 * to the return value alone. The routing doc is the thing sign-in reads.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set. Start the emulator
 * (`npm run firebase:emulate`), then:
 *
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/data/admin/jest.config.ts \
 *       --testPathPatterns sso-publish-gate.emulator
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-sso-publish-gate-org'
/** A second org, for the case where the claim belongs to somebody else. */
const OTHER_ORG = 'e2e-sso-publish-gate-other'

const VERIFIED_DOMAIN = 'verified.sso-publish-gate-fixture.com'
const MISSING_CLAIM_DOMAIN = 'no-claim.sso-publish-gate-fixture.com'
const UNVERIFIED_DOMAIN = 'unverified.sso-publish-gate-fixture.com'
const TRUTHY_DOMAIN = 'truthy.sso-publish-gate-fixture.com'
const OTHER_ORGS_DOMAIN = 'other-org.sso-publish-gate-fixture.com'

const ALL_DOMAINS = [
  VERIFIED_DOMAIN,
  MISSING_CLAIM_DOMAIN,
  UNVERIFIED_DOMAIN,
  TRUTHY_DOMAIN,
  OTHER_ORGS_DOMAIN,
]

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

describeEmulated('the SSO publish gate refuses an unproven domain (AGL-1912)', () => {
  let db: Firestore
  let sso: typeof import('./sso-provisioning')

  /** Publish exactly one domain for one org, through the real function. */
  const publish = (orgId: string, domain: string) =>
    sso.publishSsoDomains({
      orgId,
      tenantId: `tenant-${orgId}`,
      providerId: 'saml.fixture',
      protocol: 'saml',
      displayName: 'Fixture IdP',
      domains: [domain],
    })

  async function purge(): Promise<void> {
    await Promise.all(
      ALL_DOMAINS.map((domain) => db.collection('ssoDomains').doc(domain).delete()),
    )
    for (const orgId of [ORG, OTHER_ORG]) {
      await db.recursiveDelete(db.collection('orgs').doc(orgId))
    }
  }

  beforeAll(async () => {
    db = getFirestore()
    sso = await import('./sso-provisioning')
    // A stale row from an earlier run would answer these assertions instead of
    // this run's fixtures — and for the negative cases it would answer them
    // WRONG, by leaving behind exactly the document they assert is absent.
    await purge()

    const claim = (orgId: string, domain: string) =>
      db.collection('orgs').doc(orgId).collection('ssoDomains').doc(domain)

    await claim(ORG, VERIFIED_DOMAIN).set({
      domain: VERIFIED_DOMAIN,
      token: 'fixture-token',
      verified: true,
    })
    await claim(ORG, UNVERIFIED_DOMAIN).set({
      domain: UNVERIFIED_DOMAIN,
      token: 'fixture-token',
      verified: false,
    })
    // Truthy but not `true`. `verified !== true` is a STRICT comparison and
    // the strictness is the control: a refactor to `!claim.get('verified')`
    // reads as equivalent and would accept every value on this line.
    await claim(ORG, TRUTHY_DOMAIN).set({
      domain: TRUTHY_DOMAIN,
      token: 'fixture-token',
      verified: 'true',
    })
    // The attack shape, in the data: the claim is real and verified, it just
    // belongs to a DIFFERENT org. Nothing is seeded under ORG for it.
    await claim(OTHER_ORG, OTHER_ORGS_DOMAIN).set({
      domain: OTHER_ORGS_DOMAIN,
      token: 'fixture-token',
      verified: true,
    })
    // MISSING_CLAIM_DOMAIN gets no claim document at all, on purpose.
  }, 60_000)

  afterAll(async () => {
    if (!EMULATED) return
    await purge()
  }, 60_000)

  it('THE CONTROL: a verified claim does publish', async () => {
    // Without this the four refusals below are vacuous — a fixture that could
    // not publish anything would satisfy every one of them while proving
    // nothing about the gate.
    expect(await publish(ORG, VERIFIED_DOMAIN)).toEqual([VERIFIED_DOMAIN])
    const doc = await db.collection('ssoDomains').doc(VERIFIED_DOMAIN).get()
    expect(doc.exists).toBe(true)
    expect(doc.get('orgId')).toBe(ORG)
    expect(doc.get('active')).toBe(true)
  }, 60_000)

  it('refuses a domain with NO claim document, and writes nothing', async () => {
    // MEASURED, because the obvious reading of the gate is wrong. AGL-1912
    // describes `!claim.exists` and the `verified` check as two distinct
    // branches that a refactor could preserve one of and drop the other.
    // Against a real Firestore snapshot they are not independent: `get()` on
    // a missing document returns `undefined`, so `!== true` already refuses
    // it, and deleting the `!claim.exists` clause on its own changes no
    // observable behaviour — this suite stays green through that mutation,
    // deliberately, because nothing broke.
    //
    // The case still earns its place, and one mutation proves it: flipping
    // the `||` to `&&` (refuse only an EXISTING unverified claim) lets a
    // domain with no claim at all go live, and reddens this case and the
    // cross-org one below. What is pinned here is the BEHAVIOUR — no claim,
    // no routing — not whichever clause happens to implement it.
    expect(await publish(ORG, MISSING_CLAIM_DOMAIN)).toEqual([])
    const doc = await db.collection('ssoDomains').doc(MISSING_CLAIM_DOMAIN).get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('refuses a claim that exists with verified: false, and writes nothing', async () => {
    // The second failure mode: the org ASKED for this domain and proved
    // nothing. `issueDomainClaim` creates exactly this document, so it is the
    // state every unverified domain in the product is actually in.
    expect(await publish(ORG, UNVERIFIED_DOMAIN)).toEqual([])
    const doc = await db.collection('ssoDomains').doc(UNVERIFIED_DOMAIN).get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('refuses a claim whose verified is truthy but not true', async () => {
    expect(await publish(ORG, TRUTHY_DOMAIN)).toEqual([])
    const doc = await db.collection('ssoDomains').doc(TRUTHY_DOMAIN).get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('refuses a domain another org verified — the takeover shape', async () => {
    // The claim is read at `orgs/{orgId}/ssoDomains/{domain}`, so ORG asking
    // for a domain OTHER_ORG proved finds nothing. This is the case that
    // matters in production: the domain is genuinely verified, just not by
    // the org asking, and a gate keyed on the domain rather than on the
    // (org, domain) pair would hand it over.
    expect(await publish(ORG, OTHER_ORGS_DOMAIN)).toEqual([])
    const doc = await db.collection('ssoDomains').doc(OTHER_ORGS_DOMAIN).get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('deactivates rather than deletes on unpublish, and can be re-published', async () => {
    // `unpublishSsoDomains` sets `active: false` and leaves the doc. That is
    // deliberate — `revokeDomain` is the destructive act — but it means the
    // disabled doc is only as safe as its consumer, so the shape is pinned
    // here and `/api/auth/sso-lookup` is pinned against it in
    // `apps/console/app/api/auth/sso-lookup/route.emulator.spec.ts`.
    await sso.unpublishSsoDomains(ORG)
    const off = await db.collection('ssoDomains').doc(VERIFIED_DOMAIN).get()
    expect(off.exists).toBe(true)
    expect(off.get('active')).toBe(false)

    // And the round trip still works for an org whose claim is intact — the
    // control for AGL-1887, which is about the orgs whose claim is not.
    expect(await publish(ORG, VERIFIED_DOMAIN)).toEqual([VERIFIED_DOMAIN])
    const on = await db.collection('ssoDomains').doc(VERIFIED_DOMAIN).get()
    expect(on.get('active')).toBe(true)
  }, 60_000)
})
