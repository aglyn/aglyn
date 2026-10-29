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
 * The publisher agreement holds on EVERY publish door (AGL-2282), agreed to
 * on each publish since AGL-4105: the request carries the box the publisher
 * ticked, the gate refuses one that did not, and the door records it.
 *
 * `publish-plugin-agreement.spec.ts` proves the gate on the plugin route. It
 * proved nothing about the other six, and the other six did not have it: a
 * paid theme, template, layout, component, email template or dataset schema
 * could be listed — and sold, with Aglyn as merchant of record — by an org
 * that had never accepted the terms that warrant ownership, grant the
 * distribution licence, indemnify us, and consent to the §8.4 refund
 * clawback.
 *
 * Two layers here, because neither is sufficient alone:
 *
 * 1. the DECISION, unit-tested directly, including the free-listing case that
 *    a price-gated reading of "paid listings need terms" would have missed;
 * 2. a coverage guard that DERIVES the door list from the directory rather
 *    than restating it, so the eighth publish route somebody writes next year
 *    is in scope the day it lands.
 *
 * The third layer — a route driven END TO END to a real refusal, because a pure
 * function nobody calls is exactly the failure this file exists to catch —
 * lives in `publish-stored-nodes.spec.ts`, which already stands up a real
 * Firestore double for `publishTemplateHandler` and `publishLayoutHandler`.
 * Jest module factories are per FILE, so a second live route here would mean
 * a second, conflicting `@aglyn/tenant-data-admin` double rather than reusing
 * the one that exists.
 */

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  PUBLISHER_AGREEMENT_CONSENT_REQUIRED,
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementConsent,
} from '../model/publisher-agreement'
import { publishPreconditionRefusal } from './publish-preconditions'

const AGREED = publisherAgreementConsent()
const PROFILE = {
  orgId: 'org-1',
  handle: 'acme',
  // AGL-2471: the payout precondition asks `merchantAccountIsReady`, which
  // wants the payout DESTINATION as well as the flag. `stripeChargesEnabled`
  // with no account id was never a real publisher, only a fixture.
  stripeAccountId: 'acct_spec',
  stripeChargesEnabled: true,
}

describe('publishPreconditionRefusal (AGL-2282, AGL-4105)', () => {
  it('lets a fully set-up publisher through with the box ticked', () => {
    expect(
      publishPreconditionRefusal(PROFILE, { priceUsd: 9, sells: 'themes', agreement: AGREED }),
    ).toBeNull()
  })

  it('refuses with no profile at all', () => {
    const refusal = publishPreconditionRefusal(null, {
      priceUsd: 0,
      sells: 'themes',
      agreement: AGREED,
    })
    expect(refusal?.status).toBe(412)
    expect(String(refusal?.body.error)).toContain('publisher profile')
  })

  it('refuses a PAID listing with no payout binding, naming the artifact', () => {
    const refusal = publishPreconditionRefusal(
      { ...PROFILE, stripeChargesEnabled: false },
      { priceUsd: 9, sells: 'layouts', agreement: AGREED },
    )
    expect(refusal?.status).toBe(412)
    expect(String(refusal?.body.error)).toContain('to sell layouts')
  })

  it('lets a FREE listing through without a payout binding', () => {
    expect(
      publishPreconditionRefusal(
        { ...PROFILE, stripeChargesEnabled: false },
        { priceUsd: 0, sells: 'layouts', agreement: AGREED },
      ),
    ).toBeNull()
  })

  it('refuses a publish that did not tick the box, whatever the org agreed before', () => {
    // The org's last acceptance is a note now, not a gate: a profile carrying
    // a current one still has to agree on this save.
    for (const agreement of [undefined, null, {}, { version: PUBLISHER_AGREEMENT_VERSION }, { ...AGREED, accepted: false }]) {
      const refusal = publishPreconditionRefusal(
        { ...PROFILE, agreement: { version: PUBLISHER_AGREEMENT_VERSION } } as never,
        { priceUsd: 9, sells: 'components', agreement },
      )
      expect(refusal?.status).toBe(428)
      expect(refusal?.body.error).toBe(PUBLISHER_AGREEMENT_CONSENT_REQUIRED)
      expect(refusal?.body.agreement).toEqual({ required: PUBLISHER_AGREEMENT_VERSION, state: 'missing' })
    }
  })

  it('refuses a box ticked for a version no longer in force', () => {
    const refusal = publishPreconditionRefusal(PROFILE, {
      priceUsd: 9,
      sells: 'components',
      agreement: { version: '1999-01-01.1', accepted: true },
    })
    expect(refusal?.status).toBe(409)
    expect(refusal?.body.agreement).toMatchObject({ state: 'outdated' })
  })

  it('asks a FREE listing for the agreement too', () => {
    // The negative control for the obvious wrong fix. Sections 2, 3 and 9 —
    // distribution licence, warranties, indemnity — are what make a free
    // listing servable at all; only §8 is about money. A `priceUsd > 0` gate
    // here would put every free listing outside the terms.
    const refusal = publishPreconditionRefusal(PROFILE, {
      priceUsd: 0,
      sells: 'themes',
      agreement: undefined,
    })
    expect(refusal?.status).toBe(428)
  })

  it('reports the unticked box BEFORE the org-setup refusals', () => {
    // Like the price, the box is a property of the request and is fixed in
    // the form in front of the publisher; they should not go and set up a
    // profile only to be bounced again on a box they could have ticked.
    const refusal = publishPreconditionRefusal(undefined, {
      priceUsd: 9,
      sells: 'themes',
      agreement: undefined,
    })
    expect(refusal?.status).toBe(428)
  })

  it('still reports the price before the box', () => {
    const refusal = publishPreconditionRefusal(PROFILE, {
      priceUsd: 1,
      sells: 'themes',
      agreement: undefined,
    })
    expect(refusal?.status).toBe(400)
  })
})

/**
 * THE GUARD. Derived from the directory, never from a hand list.
 *
 * A publish door is identified by what it does, not by its name: it resolves
 * the publishing org's marketplace profile. Every such file must also run the
 * shared precondition gate. A new route that resolves a profile and forgets
 * the gate fails here on the day it is written — which is the only mechanism
 * that would have caught the six that already had.
 */
describe('every publish door runs the shared gate (AGL-2282)', () => {
  const dir = __dirname
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.includes('.spec.'))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))

  // Everything that reads a publishing org's marketplace profile at all.
  const profileReaders = sources.filter(
    (file) =>
      file.name !== 'publisher-profile.ts' &&
      /resolvePublisherProfile\s*\(/.test(file.text),
  )
  // A publish DOOR is the subset that then attributes a listing to that
  // profile. Structural, not nominal: a route named anything at all is in
  // scope the moment it stamps `profileId` from a resolved publisher.
  const doors = profileReaders.filter((file) =>
    file.text.includes('profileId: publisher.orgId'),
  )
  const nonDoors = profileReaders
    .filter((file) => !doors.includes(file))
    .map((file) => file.name)
    .sort()

  it('finds every publish door the repo has', () => {
    // Not vacuous: nine doors exist today. A directory read that returned
    // nothing, or a rename that made the discriminator stop matching, would
    // otherwise let this whole describe pass by finding zero files to check.
    expect(doors.map((file) => file.name).sort()).toEqual([
      'publish-dataset-schema.ts',
      'publish-email-starter.ts',
      'publish-email-template.ts',
      'publish-layout.ts',
      'publish-plugin.ts',
      'publish-starter.ts',
      'publish-template.ts',
      'publish-theme.ts',
      'publish.ts',
    ])
  })

  it('accounts for every OTHER reader of a publisher profile', () => {
    // The escape hatch the discriminator leaves open, closed. A new publish
    // route that resolves a profile but writes `profileId` some other way
    // would drop out of `doors` and be silently unguarded; it lands here
    // instead, and whoever adds it has to say which it is.
    //
    // `checkout.ts` reads the profile to find the SELLER's Connect account —
    // it is the buyer's door, not a publish door, and the agreement is not
    // its question: an org that stopped accepting must stop publishing, not
    // have its already-listed artifacts stop selling.
    expect(nonDoors).toEqual(['checkout.ts'])
  })

  it.each(
    // Fall back to a placeholder so a broken enumeration is a FAILURE here
    // rather than an empty `it.each` that reports nothing at all.
    doors.length ? doors.map((file) => file.name) : ['<no doors found>'],
  )('%s calls publishPreconditionRefusal with the request\'s agreement, and records it', (name) => {
    const file = doors.find((entry) => entry.name === name)
    expect(file).toBeDefined()
    expect(file!.text).toContain('publishPreconditionRefusal(publisher, {')
    // AGL-4105: the box this publish was sent with goes into the gate…
    expect(file!.text).toMatch(/publishPreconditionRefusal\(publisher, \{[^}]*agreement: (req\.body|body)\?\.agreement,/)
    // …and is recorded before the door writes.
    expect(file!.text).toContain('await recordPublisherAgreementAcceptance({')
  })

  it('no door carries its own copy of the agreement check', () => {
    // The gate is worth having only while it is the single decision. A door
    // that re-derived the org's standing or re-checked the box beside it
    // would drift the moment the rule changes.
    const offenders = doors
      .filter(
        (file) =>
          /publisherAgreementState\s*\(/.test(file.text) ||
          (file.name !== 'publish-plugin.ts' && /publisherAgreementConsentRefusal\s*\(/.test(file.text)),
      )
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })
})
