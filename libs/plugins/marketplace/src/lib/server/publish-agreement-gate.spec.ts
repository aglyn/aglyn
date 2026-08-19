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
 * The publisher agreement holds on EVERY publish door (AGL-2252).
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
 * The third layer — a route driven END TO END to a real 412, because a pure
 * function nobody calls is exactly the failure this file exists to catch —
 * lives in `publish-stored-nodes.spec.ts`, which already stands up a real
 * Firestore double for `publishTemplateHandler` and `publishLayoutHandler`.
 * Jest module factories are per FILE, so a second live route here would mean
 * a second, conflicting `@aglyn/tenant-data-admin` double rather than reusing
 * the one that exists.
 */

import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { PUBLISHER_AGREEMENT_VERSION } from '@aglyn/aglyn/app-utils/publisher-agreement'
import { publishPreconditionRefusal } from './publish-preconditions'

const CURRENT = { version: PUBLISHER_AGREEMENT_VERSION }
const PROFILE = {
  orgId: 'org-1',
  handle: 'acme',
  stripeChargesEnabled: true,
  agreement: CURRENT,
}

describe('publishPreconditionRefusal (AGL-2252)', () => {
  it('lets a fully set-up publisher through', () => {
    expect(publishPreconditionRefusal(PROFILE, { priceUsd: 9, sells: 'themes' })).toBeNull()
  })

  it('refuses with no profile at all', () => {
    const refusal = publishPreconditionRefusal(null, {
      priceUsd: 0,
      sells: 'themes',
    })
    expect(refusal?.status).toBe(412)
    expect(String(refusal?.body.error)).toContain('publisher profile')
  })

  it('refuses a PAID listing with no payout binding, naming the artifact', () => {
    const refusal = publishPreconditionRefusal(
      { ...PROFILE, stripeChargesEnabled: false },
      { priceUsd: 9, sells: 'layouts' },
    )
    expect(refusal?.status).toBe(412)
    expect(String(refusal?.body.error)).toContain('to sell layouts')
  })

  it('lets a FREE listing through without a payout binding', () => {
    expect(
      publishPreconditionRefusal(
        { ...PROFILE, stripeChargesEnabled: false },
        { priceUsd: 0, sells: 'layouts' },
      ),
    ).toBeNull()
  })

  it('refuses when the org has never accepted', () => {
    const refusal = publishPreconditionRefusal(
      { ...PROFILE, agreement: undefined },
      { priceUsd: 9, sells: 'components' },
    )
    expect(refusal?.status).toBe(412)
    expect(refusal?.body.agreement).toEqual({
      required: PUBLISHER_AGREEMENT_VERSION,
      accepted: null,
      state: 'none',
    })
  })

  it('refuses a STALE acceptance — the point of versioning it is that it re-asks', () => {
    const refusal = publishPreconditionRefusal(
      { ...PROFILE, agreement: { version: '1999-01-01.1' } },
      { priceUsd: 9, sells: 'components' },
    )
    expect(refusal?.status).toBe(412)
    expect(refusal?.body.agreement).toMatchObject({
      accepted: '1999-01-01.1',
      state: 'outdated',
    })
  })

  it('asks a FREE listing for the agreement too', () => {
    // The negative control for the obvious wrong fix. Sections 2, 3 and 9 —
    // distribution licence, warranties, indemnity — are what make a free
    // listing servable at all; only §8 is about money. A `priceUsd > 0` gate
    // here would put every free listing outside the terms.
    const refusal = publishPreconditionRefusal(
      { ...PROFILE, agreement: undefined },
      { priceUsd: 0, sells: 'themes' },
    )
    expect(refusal?.status).toBe(412)
    expect(refusal?.body.agreement).toMatchObject({ state: 'none' })
  })

  it('reports the profile refusal BEFORE the agreement one', () => {
    // Order matters to the person reading it: an org with no profile has
    // nowhere to record an acceptance, so "accept the agreement" would be
    // advice they cannot follow.
    const refusal = publishPreconditionRefusal(undefined, {
      priceUsd: 9,
      sells: 'themes',
    })
    expect(refusal?.body.agreement).toBeUndefined()
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
describe('every publish door runs the shared gate (AGL-2252)', () => {
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
    // Not vacuous: seven doors exist today. A directory read that returned
    // nothing, or a rename that made the discriminator stop matching, would
    // otherwise let this whole describe pass by finding zero files to check.
    expect(doors.map((file) => file.name).sort()).toEqual([
      'publish-dataset-schema.ts',
      'publish-email-template.ts',
      'publish-layout.ts',
      'publish-plugin.ts',
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
  )('%s calls publishPreconditionRefusal', (name) => {
    const file = doors.find((entry) => entry.name === name)
    expect(file).toBeDefined()
    expect(file!.text).toContain('publishPreconditionRefusal(publisher, {')
  })

  it('no door carries its own copy of the agreement check', () => {
    // The gate is worth having only while it is the single decision. A route
    // that re-derived `publisherAgreementState` beside it would drift the
    // moment the states change.
    const offenders = doors
      .filter((file) => /publisherAgreementState\s*\(/.test(file.text))
      .map((file) => file.name)
    expect(offenders).toEqual([])
  })
})
