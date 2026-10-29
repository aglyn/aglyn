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
 * The Marketplace Publisher Agreement is agreed to on EVERY publisher save
 * (AGL-4105).
 *
 * Three layers:
 *
 * 1. the decision, `publisherAgreementConsentRefusal`, unit-tested directly;
 * 2. the record, `recordPublisherAgreementAcceptance`, against a Firestore
 *    double: the append-only document under the org, and the profile note
 *    that never makes a profile;
 * 3. an inventory of every route the plugin registers, each classified as a
 *    publisher save or as something else with the reason, so a route added
 *    tomorrow is unclassified — and red — until somebody decides; and every
 *    publisher save's handler is held to both checking the box and recording
 *    it.
 */

const mockTimestampSentinel = Symbol('serverTimestamp')

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    firestore: { FieldValue: { serverTimestamp: () => mockTimestampSentinel } },
  },
}))

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PUBLISHER_AGREEMENT_ACTIONS,
  PUBLISHER_AGREEMENT_BYTES,
  PUBLISHER_AGREEMENT_CONSENT_OUTDATED,
  PUBLISHER_AGREEMENT_CONSENT_REQUIRED,
  PUBLISHER_AGREEMENT_SHA256,
  PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE,
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementConsent,
  publisherAgreementConsentRefusal,
} from '../model/publisher-agreement'
import {
  PUBLISHER_AGREEMENT_ACCEPTANCES,
  recordPublisherAgreementAcceptance,
} from './publisher-agreement-acceptance'

describe('publisherAgreementConsentRefusal (AGL-4105)', () => {
  const published = { published: true }

  it('lets a save through that ticked the box for the version in force', () => {
    expect(publisherAgreementConsentRefusal(publisherAgreementConsent(), published)).toBeNull()
  })

  it('refuses a save that did not tick it, in one plain sentence', () => {
    for (const raw of [undefined, null, 'yes', true, {}, { accepted: true }, { version: PUBLISHER_AGREEMENT_VERSION }, { version: PUBLISHER_AGREEMENT_VERSION, accepted: 'true' }, { version: PUBLISHER_AGREEMENT_VERSION, accepted: false }]) {
      const refusal = publisherAgreementConsentRefusal(raw, published)
      expect([raw, refusal?.status]).toEqual([raw, 428])
      expect(refusal?.body).toEqual({
        error: PUBLISHER_AGREEMENT_CONSENT_REQUIRED,
        agreement: { required: PUBLISHER_AGREEMENT_VERSION, state: 'missing' },
      })
    }
    expect(PUBLISHER_AGREEMENT_CONSENT_REQUIRED).toBe(
      "Tick 'I agree to the Marketplace Publisher Agreement' to save",
    )
  })

  it('refuses a box ticked for another version: a page left open across a change', () => {
    const refusal = publisherAgreementConsentRefusal({ version: '2026-08-18.1', accepted: true }, published)
    expect(refusal?.status).toBe(409)
    expect(refusal?.body).toEqual({
      error: PUBLISHER_AGREEMENT_CONSENT_OUTDATED,
      agreement: { required: PUBLISHER_AGREEMENT_VERSION, state: 'outdated' },
    })
  })

  it('refuses everything while the document has no published page', () => {
    const refusal = publisherAgreementConsentRefusal(publisherAgreementConsent(), { published: false })
    expect(refusal?.status).toBe(409)
    expect(refusal?.body).toEqual({
      error: PUBLISHER_AGREEMENT_UNAVAILABLE_NOTICE,
      agreement: { required: PUBLISHER_AGREEMENT_VERSION, state: 'unavailable' },
    })
  })
})

/** A Firestore double: the created acceptances and the profile writes. */
function firestoreDouble(profile: Record<string, unknown> | null) {
  const created: Array<{ path: string; data: Record<string, unknown> }> = []
  const profileWrites: Array<{ data: Record<string, unknown>; options: unknown }> = []
  let ids = 0
  const firestore = {
    collection: (top: string) => ({
      doc: (id: string) => {
        if (top === 'publisherProfiles') {
          return {
            get: async () => ({
              exists: profile !== null,
              get: (field: string) => (profile ?? {})[field],
            }),
            set: async (data: Record<string, unknown>, options: unknown) => {
              profileWrites.push({ data, options })
            },
          }
        }
        return {
          collection: (sub: string) => ({
            doc: () => {
              const path = `${top}/${id}/${sub}/acceptance-${++ids}`
              return {
                create: async (data: Record<string, unknown>) => {
                  created.push({ path, data })
                },
                set: async () => {
                  throw new Error('an acceptance is created, never set')
                },
              }
            },
          }),
        }
      },
    }),
  }
  return { firestore: firestore as never, created, profileWrites }
}

const request = {
  headers: { 'user-agent': 'Spec Browser/1.0', 'x-forwarded-for': '203.0.113.7' },
  socket: {},
}

describe('recordPublisherAgreementAcceptance (AGL-4105)', () => {
  it('creates one append-only record under the org with the evidence a signature keeps', async () => {
    const double = firestoreDouble({ handle: 'acme' })
    await recordPublisherAgreementAcceptance({
      firestore: double.firestore,
      request,
      orgId: 'org-1',
      uid: 'uid-1',
      action: 'update-listing',
      targetId: 'listing-1',
      now: 1_800_000_000_000,
    })
    expect(double.created).toEqual([
      {
        path: `orgs/org-1/${PUBLISHER_AGREEMENT_ACCEPTANCES}/acceptance-1`,
        data: {
          version: PUBLISHER_AGREEMENT_VERSION,
          sha256: PUBLISHER_AGREEMENT_SHA256,
          bytes: PUBLISHER_AGREEMENT_BYTES,
          orgId: 'org-1',
          uid: 'uid-1',
          staff: false,
          action: 'update-listing',
          targetId: 'listing-1',
          ip: '203.0.113.7',
          userAgent: 'Spec Browser/1.0',
          atMs: 1_800_000_000_000,
          acceptedAt: mockTimestampSentinel,
        },
      },
    ])
  })

  it('notes the last acceptance on the org profile', async () => {
    const double = firestoreDouble({ handle: 'acme' })
    await recordPublisherAgreementAcceptance({
      firestore: double.firestore,
      request,
      orgId: 'org-1',
      uid: 'uid-1',
      staff: true,
      action: 'set-visibility',
      targetId: 'listing-1',
    })
    expect(double.created[0].data).toMatchObject({ staff: true })
    expect(double.profileWrites).toEqual([
      {
        data: {
          publisherAgreement: {
            version: PUBLISHER_AGREEMENT_VERSION,
            sha256: PUBLISHER_AGREEMENT_SHA256,
            bytes: PUBLISHER_AGREEMENT_BYTES,
            acceptedBy: 'uid-1',
            acceptedAt: mockTimestampSentinel,
          },
        },
        options: { merge: true },
      },
    ])
  })

  it('never makes a profile, and never writes onto an erased one', async () => {
    for (const profile of [null, { erased: true, erasedAt: 1 }, { handle: 'acme', erased: true }]) {
      const double = firestoreDouble(profile)
      await recordPublisherAgreementAcceptance({
        firestore: double.firestore,
        request,
        orgId: 'org-1',
        uid: 'uid-1',
        action: 'publish-component',
        targetId: 'listing-1',
      })
      expect(double.created).toHaveLength(1)
      expect(double.profileWrites).toEqual([])
    }
  })

  it('leaves the note to a caller that writes it itself', async () => {
    const double = firestoreDouble({ handle: 'acme' })
    await recordPublisherAgreementAcceptance({
      firestore: double.firestore,
      request,
      orgId: 'org-1',
      uid: 'uid-1',
      action: 'save-profile',
      targetId: 'org-1',
      noteOnProfile: false,
    })
    expect(double.created).toHaveLength(1)
    expect(double.profileWrites).toEqual([])
  })
})

/**
 * EVERY ROUTE THE PLUGIN REGISTERS, CLASSIFIED.
 *
 * A publisher save changes what the marketplace shows for a publisher: its
 * profile, a listing's words, pictures, categories, price, visibility or
 * presence, a version, or the Verified ask. Everything else says why it is
 * not one. Merchant actions — installing, updating an installed copy, buying,
 * rating, reporting — fall under the Terms, not this agreement.
 */
const PUBLISHER_SAVES: Record<string, string> = {
  'marketplace/publisher-profile': 'the public profile (save; the retired accept action answers 410)',
  'marketplace/publish': 'publishing a component, or a new version of one',
  'marketplace/publish-layout': 'publishing a layout',
  'marketplace/publish-template': 'publishing a site template',
  'marketplace/publish-starter': 'publishing a site starter',
  'marketplace/publish-theme': 'publishing a theme',
  'marketplace/publish-dataset-schema': 'publishing a dataset schema',
  'marketplace/publish-email-template': 'publishing an email template',
  'marketplace/publish-email-starter': 'publishing an email starter',
  'marketplace/publish-plugin':
    'a plugin version, and the listing actions: update-listing, set-visibility, set-published',
  'marketplace/preview-image': 'setting or removing a listing’s preview image',
  'marketplace/verification-request': 'asking for the Verified badge, or withdrawing the ask',
}
const NOT_PUBLISHER_SAVES: Record<string, string> = {
  'marketplace/checkout': 'a buyer paying for a listing (merchant)',
  'marketplace/connect': 'payout onboarding, handed to Stripe under its own agreement; writes no listing',
  'marketplace/install': 'installing a component (merchant)',
  'marketplace/install-plugin': 'installing a plugin (merchant)',
  'marketplace/install-layout': 'installing a layout (merchant)',
  'marketplace/install-template': 'installing a template (merchant)',
  'marketplace/install-theme': 'installing, reverting or resetting a theme (merchant)',
  'marketplace/install-dataset-schema': 'installing a dataset schema (merchant)',
  'marketplace/install-email-starter': 'installing an email starter (merchant)',
  'marketplace/install-email-template': 'installing an email template (merchant)',
  'marketplace/update-artifact': 'updating an installed copy (merchant)',
  'marketplace/listing-versions': 'reading a listing’s versions',
  'marketplace/starters': 'searching the site starters Create site offers (a read)',
  'marketplace/report': 'anyone reporting a listing',
  'marketplace/reviews': 'a buyer rating and reviewing a listing (merchant)',
  'marketplace/admin/reports': 'staff moderation',
  'marketplace/admin/reviews': 'staff review',
  'marketplace/admin/trust': 'staff signing',
  'marketplace/admin/overview': 'staff overview',
}

const here = (file: string) => readFileSync(join(__dirname, file), 'utf8')
const serverSource = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8')

/** `route → handler file`, from the registrations and the imports beside them. */
const registered = (() => {
  const imports = new Map<string, string>()
  for (const match of serverSource.matchAll(/import \{ ([A-Za-z]+) \} from '\.\/server\/([a-z-]+)'/g)) {
    imports.set(match[1], `${match[2]}.ts`)
  }
  const routes = new Map<string, string | null>()
  for (const match of serverSource.matchAll(
    /registerPluginApiRoute\(\s*'([^']+)',\s*(?:\{\s*web:\s*)?([A-Za-z]+)/g,
  )) {
    routes.set(match[1], imports.get(match[2]) ?? null)
  }
  return routes
})()

describe('every marketplace route is classified (AGL-4105)', () => {
  it('reads the registrations at all — the guard can fail', () => {
    expect(registered.size).toBeGreaterThan(25)
    expect(registered.get('marketplace/publish-plugin')).toBe('publish-plugin.ts')
    expect(registered.get('marketplace/publisher-profile')).toBe('publisher-profile-save.ts')
  })

  it('names every registered route, and nothing that is not registered', () => {
    const classified = [...Object.keys(PUBLISHER_SAVES), ...Object.keys(NOT_PUBLISHER_SAVES)].sort()
    expect([...registered.keys()].sort()).toEqual(classified)
    for (const route of Object.keys(PUBLISHER_SAVES)) {
      expect([route, route in NOT_PUBLISHER_SAVES]).toEqual([route, false])
    }
  })

  it.each(Object.keys(PUBLISHER_SAVES))('%s checks the box and records it', (route) => {
    const file = registered.get(route)
    expect([route, typeof file]).toEqual([route, 'string'])
    const source = here(file as string)
    // Checked: by the shared publish gate, given the request's agreement, or
    // directly.
    expect(
      /publishPreconditionRefusal\(publisher, \{[^}]*agreement: (req\.body|body)\?\.agreement,/.test(source) ||
        /publisherAgreementConsentRefusal\(req\.body\?\.agreement\)/.test(source),
    ).toBe(true)
    // And recorded, as one of the closed set of actions.
    expect(source).toContain('await recordPublisherAgreementAcceptance({')
    for (const action of source.matchAll(/action: '([a-z-]+)'/g)) {
      if (action[1] === 'accept-agreement') continue
      expect(PUBLISHER_AGREEMENT_ACTIONS).toContain(action[1])
    }
  })

  it('checks and records every one of the plugin route’s listing actions', () => {
    const source = here('publish-plugin.ts')
    // The main publish through the gate, and each of the three listing actions directly.
    expect(source.match(/publisherAgreementConsentRefusal\(req\.body\?\.agreement\)/g)).toHaveLength(3)
    expect(source.match(/await recordPublisherAgreementAcceptance\(\{/g)).toHaveLength(4)
    for (const action of ['publish-plugin', 'update-listing', 'set-visibility', 'set-published']) {
      expect(source).toContain(`action: '${action}'`)
    }
  })
})
