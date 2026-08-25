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
 * domain's sign-ins to an org's IdP. One line carries the whole invariant —
 * as of AGL-1887 it admits on TWO positive markers and no third:
 *
 *   const claim = await claimRef(orgId, domain).get()
 *   if (!claim.exists) continue
 *   const proven =
 *     claim.get('verified') === true ||
 *     isStaffAttestedClaim(claim.get('attestedBy'))
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
 * ## The attested half (AGL-1887)
 *
 * AGL-1887 added a SECOND way to be proven — a staff attestation, for the orgs
 * onboarded before self-serve domain verification existed — and for a while
 * this suite could not see it. Measured, not assumed: deleting the whole
 * `|| isStaffAttestedClaim(...)` clause left all six original cases green,
 * because every fixture here was either verified or unverified and none was
 * attested. The unit suite `sso-attested-restore.spec.ts` covered the branch
 * against doubles; nothing covered it against Firestore.
 *
 * That distinction is the entire reason this file exists. `attestedBy` is read
 * with `claim.get('attestedBy')`, and on a real snapshot an absent field comes
 * back `undefined` while a double may hand back `null`, `''`, or a getter that
 * throws — and `strictNullChecks` is OFF repo-wide, so an absent attestation
 * folds to falsy with no type error to catch a mistake either way. The cases
 * below pin both directions against the real thing: an attested claim
 * publishes, and an attestation that is not a non-empty string does not.
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

/** Never DNS-proven, but a named staff member vouched for it (AGL-1887). */
const ATTESTED_DOMAIN = 'attested.sso-publish-gate-fixture.com'
/** An `attestedBy` of whitespace — present, and worth nothing. */
const BLANK_ATTESTATION_DOMAIN = 'blank-attestation.sso-publish-gate-fixture.com'
/** An `attestedBy` that is truthy but names nobody. */
const NONSTRING_ATTESTATION_DOMAIN =
  'nonstring-attestation.sso-publish-gate-fixture.com'
/**
 * Attested, and on its way to being DNS-verified — the upgrade path.
 *
 * Kept apart from {@link ATTESTED_DOMAIN} because this case WRITES to the
 * claim, and the attested control asserts the claim is left alone.
 */
const UPGRADE_DOMAIN = 'upgrade.sso-publish-gate-fixture.com'

const ALL_DOMAINS = [
  VERIFIED_DOMAIN,
  MISSING_CLAIM_DOMAIN,
  UNVERIFIED_DOMAIN,
  TRUTHY_DOMAIN,
  OTHER_ORGS_DOMAIN,
  ATTESTED_DOMAIN,
  BLANK_ATTESTATION_DOMAIN,
  NONSTRING_ATTESTATION_DOMAIN,
  UPGRADE_DOMAIN,
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
    // AGL-1887, the shape the pre-self-serve orgs are in: no token and no DNS
    // proof, because domain verification did not exist when they were
    // onboarded — just a staff member on record saying they checked. Seeded
    // with `verified: false` EXPLICITLY rather than omitted, so this fixture
    // cannot publish by accident through the `verified` clause; the only route
    // to a green here is the attestation clause.
    await claim(ORG, ATTESTED_DOMAIN).set({
      domain: ATTESTED_DOMAIN,
      verified: false,
      attestedBy: 'staff-uid-fixture',
      attestationNote: 'ownership confirmed out of band',
    })
    // Present but empty. `isStaffAttestedClaim` trims before measuring, and
    // this is what proves the trim is load-bearing rather than decorative.
    await claim(ORG, BLANK_ATTESTATION_DOMAIN).set({
      domain: BLANK_ATTESTATION_DOMAIN,
      verified: false,
      attestedBy: '   ',
    })
    // Truthy, and names nobody. The attestation's whole value is that it is
    // ATTRIBUTABLE, so a check relaxed to `!!attestedBy` — which reads as
    // equivalent — would accept this and publish a domain no person vouched
    // for. The mirror of the `verified: 'true'` case above.
    await claim(ORG, NONSTRING_ATTESTATION_DOMAIN).set({
      domain: NONSTRING_ATTESTATION_DOMAIN,
      verified: false,
      attestedBy: true,
    })
    // Attested and TOKENLESS — the exact document `attestSsoDomain` writes for
    // an org that had no claim before. `token` is absent rather than empty,
    // because that is what the real write leaves behind and the bug this
    // fixture catches turns on `snapshot.get('token')` being `undefined`.
    await claim(ORG, UPGRADE_DOMAIN).set({
      domain: UPGRADE_DOMAIN,
      attestedBy: 'staff-uid-fixture',
      attestationNote: 'ownership confirmed out of band',
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

  it('THE ATTESTED CONTROL: a staff-attested claim publishes without DNS (AGL-1887)', async () => {
    // The admit half of AGL-1887, against real Firestore. Deleting the
    // `|| isStaffAttestedClaim(...)` clause reddens exactly this case and
    // nothing else in the file — which is the coverage that was missing.
    expect(await publish(ORG, ATTESTED_DOMAIN)).toEqual([ATTESTED_DOMAIN])
    const doc = await db.collection('ssoDomains').doc(ATTESTED_DOMAIN).get()
    expect(doc.exists).toBe(true)
    expect(doc.get('orgId')).toBe(ORG)
    expect(doc.get('active')).toBe(true)

    // The attestation is a MARKER, not a voucher that gets spent: the claim
    // still says `verified: false` afterwards, and publishing did not quietly
    // promote it. An implementation that collapsed the two facts would make an
    // attested domain indistinguishable from a DNS-proven one in the data.
    const claim = await db
      .collection('orgs')
      .doc(ORG)
      .collection('ssoDomains')
      .doc(ATTESTED_DOMAIN)
      .get()
    expect(claim.get('verified')).toBe(false)
    expect(claim.get('attestedBy')).toBe('staff-uid-fixture')
  }, 60_000)

  it('refuses an attestation that is blank, and writes nothing', async () => {
    expect(await publish(ORG, BLANK_ATTESTATION_DOMAIN)).toEqual([])
    const doc = await db
      .collection('ssoDomains')
      .doc(BLANK_ATTESTATION_DOMAIN)
      .get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('refuses an attestation that is truthy but names nobody', async () => {
    // The widening this issue forbids, in its most plausible form: relaxing
    // the marker to `!!attestedBy` reddens this case.
    expect(await publish(ORG, NONSTRING_ATTESTATION_DOMAIN)).toEqual([])
    const doc = await db
      .collection('ssoDomains')
      .doc(NONSTRING_ATTESTATION_DOMAIN)
      .get()
    expect(doc.exists).toBe(false)
  }, 60_000)

  it('THE UPGRADE PATH: claiming an attested domain PERSISTS the token it shows', async () => {
    // AGL-1887 part 2. `attestSsoDomain` creates a claim document with no
    // token, a shape that did not exist before it — every claim used to be
    // created by `issueDomainClaim`, so "the document exists" and "it has a
    // token" were the same fact. `issueDomainClaim` still branched on
    // `!snapshot.exists` alone, so for an attested domain it minted a token,
    // returned a TXT record built from it, and wrote NOTHING.
    //
    // The admin publishes that record, clicks Verify, and `verifyDomainClaim`
    // compares it against `snapshot.get('token')` — `undefined`. It can never
    // match, and the next click shows a different record. The DNS upgrade the
    // card nudges every attested org towards was unreachable for exactly the
    // orgs AGL-1887 exists to serve.
    //
    // Firestore-shaped on purpose: the whole bug is that an ABSENT field reads
    // back `undefined` and folds to falsy, with `strictNullChecks` off and no
    // type error either way. A double that returned `''` or `null` would catch
    // it; one that returned a stub token would not.
    const first = await sso.issueDomainClaim(ORG, UPGRADE_DOMAIN)
    expect(first.error).toBe(null)
    expect(first.claim?.token).toBeTruthy()

    const stored = await db
      .collection('orgs')
      .doc(ORG)
      .collection('ssoDomains')
      .doc(UPGRADE_DOMAIN)
      .get()
    // The record the admin was told to publish has to be the one we will
    // check. This is the assertion the bug fails: `token` was undefined here.
    expect(stored.get('token')).toBe(first.claim?.token)
    expect(first.claim?.recordValue).toContain(first.claim?.token as string)

    // STABLE across calls. A token that changes every click is the same defect
    // wearing a different face — the admin publishes one value and we check
    // another — and it would survive a fix that persisted without reusing.
    const second = await sso.issueDomainClaim(ORG, UPGRADE_DOMAIN)
    expect(second.claim?.token).toBe(first.claim?.token)

    // And the attestation SURVIVES being upgraded. Issuing a claim must not
    // clear the marker: doing so would strand the org again the moment they
    // clicked "Set up DNS proof", and the failure would look like the original
    // AGL-1375 bug rather than like this one.
    expect(stored.get('attestedBy')).toBe('staff-uid-fixture')
    expect(await publish(ORG, UPGRADE_DOMAIN)).toEqual([UPGRADE_DOMAIN])
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
