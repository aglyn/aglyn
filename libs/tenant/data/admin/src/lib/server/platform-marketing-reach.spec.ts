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
 * The operator's side of a person's product-email consent (AGL-3292), read
 * the way a campaign from the marketing site reads it: the contact's basis
 * for that site under the org's policy, then the two suppression lists — and
 * (AGL-3305) the product-updates list, which a campaign on it also drops.
 */

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import {
  declineMarketingConsentFields,
  marketingConsentFieldsForGroup,
} from '@aglyn/aglyn/app-utils/marketing-consent'
import { emailSuppressionKey } from './email-suppression'
import {
  platformMarketingHold,
  type PlatformMarketingReach,
  readPlatformMarketingReach,
} from './platform-marketing-consent'

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => undefined }) },
}))
jest.mock('./upsert-contact', () => ({
  __esModule: true,
  upsertHostContact: async () => ({ refused: 'error' }),
}))
const mockGetOrgForHost = jest.fn()
jest.mock('./organizations', () => ({
  __esModule: true,
  getOrgForHost: (hostId: string) => mockGetOrgForHost(hostId),
  orgDataCollectionForHost: async () => ({}),
  // The real group rule: pure once the org is in hand.
  consentGroupForSite: async (hostId: string, org: Record<string, unknown>) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .consentGroupForHost(org, hostId),
}))
const mockFindContactByEmail = jest.fn()
jest.mock('./contact-email-index', () => ({
  __esModule: true,
  findContactByEmail: (_ref: unknown, email: string) =>
    mockFindContactByEmail(email),
}))

const HOST = 'host-platform-marketing'
const ORG = 'org-operator'
const EMAIL = 'person@example.com'
const AT = Date.UTC(2026, 8, 20, 12)
const GROUP = consentGroupForHost({}, HOST)

/** The two suppression lists and the per-topic record, keyed as the sender keys them. */
function fakeFirestore(lists: {
  site?: Record<string, unknown>
  platform?: Record<string, unknown>
  /** `hosts/{hostId}/topicOptOuts/{key}` — what the address left, per topic. */
  optOuts?: Record<string, unknown>
} = {}) {
  const key = emailSuppressionKey(EMAIL) ?? ''
  const snapshot = (data: Record<string, unknown> | undefined) => ({
    exists: data !== undefined,
    get: (field: string) => data?.[field],
  })
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        // `emailSuppressions/{key}` — the platform list.
        get: async () => snapshot(name === 'emailSuppressions' && id === key ? lists.platform : undefined),
        // `hosts/{hostId}/suppressions/{key}` — the site's own list — and
        // `hosts/{hostId}/topicOptOuts/{key}`, the per-topic record.
        collection: (sub: string) => ({
          doc: (entry: string) => ({
            get: async () =>
              snapshot(
                name === 'hosts' && id === HOST && entry === key
                  ? sub === 'suppressions'
                    ? lists.site
                    : sub === 'topicOptOuts'
                      ? lists.optOuts
                      : undefined
                  : undefined,
              ),
          }),
        }),
      }),
    }),
  }
}

const contactWith = (data: Record<string, unknown>) => ({
  id: 'contact-1',
  data: () => ({ email: EMAIL, ...data }),
})

beforeEach(() => {
  mockGetOrgForHost.mockReset()
  mockGetOrgForHost.mockResolvedValue({ orgId: ORG, org: { slug: 'aglyn-org' } })
  mockFindContactByEmail.mockReset()
  mockFindContactByEmail.mockResolvedValue(null)
})

describe('readPlatformMarketingReach (AGL-3292)', () => {
  it('reads nothing on an install with no marketing site', async () => {
    await expect(
      readPlatformMarketingReach({ email: EMAIL, hostId: null, firestore: fakeFirestore() }),
    ).resolves.toEqual({ status: 'unconfigured' })
    expect(mockGetOrgForHost).not.toHaveBeenCalled()
  })

  it('says so when the account has no address to look up', async () => {
    await expect(
      readPlatformMarketingReach({ email: '  ', hostId: HOST, firestore: fakeFirestore() }),
    ).resolves.toEqual({ status: 'no-email' })
  })

  it('reports a console grant as the person’s own consent', async () => {
    mockFindContactByEmail.mockResolvedValue(
      contactWith(
        marketingConsentFieldsForGroup(GROUP, AT, {
          marketingConsentSource: { kind: 'console-signup', by: 'uid-1', atMs: AT, actor: 'person' },
        }),
      ),
    )
    const reach = await readPlatformMarketingReach({
      email: 'Person@Example.com',
      hostId: HOST,
      firestore: fakeFirestore(),
    })
    expect(reach).toEqual({
      status: 'read',
      hostId: HOST,
      orgId: ORG,
      orgSlug: 'aglyn-org',
      contactId: 'contact-1',
      basis: 'granted',
      basisAtMs: AT,
      assertedBy: 'person',
      basisKind: 'console-signup',
      verdict: 'consented',
      reason: 'granted',
      suppression: null,
      // Nobody has left a list they were never taken off.
      topic: { id: 'product-updates', state: 'subscribed', leftAtMs: null },
    })
    // Looked up by the normalized address, as the capture wrote it.
    expect(mockFindContactByEmail).toHaveBeenCalledWith(EMAIL)
  })

  it('keeps the grant AND names the unsubscribe that stops every send anyway', async () => {
    // The drift this exists to show: an unsubscribe link writes the site's
    // list and leaves the contact's basis as it was.
    mockFindContactByEmail.mockResolvedValue(
      contactWith(marketingConsentFieldsForGroup(GROUP, AT)),
    )
    const reach = await readPlatformMarketingReach({
      email: EMAIL,
      hostId: HOST,
      firestore: fakeFirestore({ site: { reason: 'unsubscribe' } }),
    })
    expect(reach).toMatchObject({
      verdict: 'consented',
      suppression: { list: 'site', reason: 'unsubscribe' },
    })
  })

  it('names a platform-wide bounce, and ignores one that was released', async () => {
    mockFindContactByEmail.mockResolvedValue(
      contactWith(marketingConsentFieldsForGroup(GROUP, AT)),
    )
    await expect(
      readPlatformMarketingReach({
        email: EMAIL,
        hostId: HOST,
        firestore: fakeFirestore({ platform: { reason: 'bounce', releasedAt: null } }),
      }),
    ).resolves.toMatchObject({ suppression: { list: 'platform', reason: 'bounce' } })
    await expect(
      readPlatformMarketingReach({
        email: EMAIL,
        hostId: HOST,
        firestore: fakeFirestore({ platform: { reason: 'bounce', releasedAt: AT } }),
      }),
    ).resolves.toMatchObject({ suppression: null })
  })

  it('withholds on a stored refusal', async () => {
    mockFindContactByEmail.mockResolvedValue(
      contactWith(declineMarketingConsentFields(HOST, AT)),
    )
    await expect(
      readPlatformMarketingReach({ email: EMAIL, hostId: HOST, firestore: fakeFirestore() }),
    ).resolves.toMatchObject({ basis: 'declined', verdict: 'withheld', reason: 'declined' })
  })

  it('withholds a person the CRM does not hold, under the strict default', async () => {
    await expect(
      readPlatformMarketingReach({ email: EMAIL, hostId: HOST, firestore: fakeFirestore() }),
    ).resolves.toMatchObject({
      contactId: null,
      basis: 'unrecorded',
      verdict: 'withheld',
      reason: 'no-basis',
    })
  })

  it('answers unreadable, never "no consent", when a read fails', async () => {
    mockGetOrgForHost.mockRejectedValue(new Error('firestore down'))
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      readPlatformMarketingReach({ email: EMAIL, hostId: HOST, firestore: fakeFirestore() }),
    ).resolves.toEqual({ status: 'unreadable', hostId: HOST })
    error.mockRestore()
  })
})

describe('the product-updates list (AGL-3305)', () => {
  beforeEach(() => {
    mockFindContactByEmail.mockResolvedValue(
      contactWith(marketingConsentFieldsForGroup(GROUP, AT)),
    )
  })

  it('reads a left list with the moment it was left, and ignores the other lists', async () => {
    const reach = await readPlatformMarketingReach({
      email: EMAIL,
      hostId: HOST,
      firestore: fakeFirestore({
        optOuts: {
          topics: {
            // A Firestore timestamp, as the preference page stores it.
            'product-updates': { optedOutAt: { toMillis: () => AT }, resubscribedAt: null },
            newsletter: { optedOutAt: { toMillis: () => AT } },
          },
        },
      }),
    })
    expect(reach).toMatchObject({
      verdict: 'consented',
      suppression: null,
      topic: { id: 'product-updates', state: 'opted-out', leftAtMs: AT },
    })
  })

  it('reads a rejoined list as subscribed, and a newsletter-only opt-out as nothing', async () => {
    await expect(
      readPlatformMarketingReach({
        email: EMAIL,
        hostId: HOST,
        firestore: fakeFirestore({
          optOuts: {
            topics: {
              'product-updates': { optedOutAt: { toMillis: () => AT }, resubscribedAt: { toMillis: () => AT + 1 } },
            },
          },
        }),
      }),
    ).resolves.toMatchObject({ topic: { state: 'subscribed', leftAtMs: null } })
    await expect(
      readPlatformMarketingReach({
        email: EMAIL,
        hostId: HOST,
        firestore: fakeFirestore({ optOuts: { topics: { newsletter: { optedOutAt: AT } } } }),
      }),
    ).resolves.toMatchObject({ topic: { state: 'subscribed' } })
  })

  it('reads an unanswered confirmation as pending', async () => {
    await expect(
      readPlatformMarketingReach({
        email: EMAIL,
        hostId: HOST,
        firestore: fakeFirestore({ optOuts: { topics: { 'product-updates': { pendingAt: AT } } } }),
      }),
    ).resolves.toMatchObject({ topic: { state: 'pending', leftAtMs: null } })
  })
})

describe('platformMarketingHold (AGL-3305)', () => {
  const reach = (
    overrides: Partial<Extract<PlatformMarketingReach, { status: 'read' }>> = {},
  ): PlatformMarketingReach => ({
    status: 'read',
    hostId: HOST,
    orgId: ORG,
    orgSlug: 'aglyn-org',
    contactId: 'contact-1',
    basis: 'granted',
    basisAtMs: AT,
    assertedBy: 'person',
    basisKind: 'console-signup',
    verdict: 'consented',
    reason: 'granted',
    suppression: null,
    topic: { id: 'product-updates', state: 'subscribed', leftAtMs: null },
    ...overrides,
  })

  it('answers nothing when nothing stands in the way', () => {
    expect(platformMarketingHold(reach())).toBeNull()
  })

  it('calls the person’s own unsubscribes theirs to undo', () => {
    expect(
      platformMarketingHold(reach({ suppression: { list: 'site', reason: 'unsubscribe' } })),
    ).toEqual({ kind: 'unsubscribed' })
    expect(
      platformMarketingHold(
        reach({ topic: { id: 'product-updates', state: 'opted-out', leftAtMs: AT } }),
      ),
    ).toEqual({ kind: 'unsubscribed' })
  })

  it('calls a bounce, a complaint, an erasure or a staff hold a pause, never a preference', () => {
    expect(
      platformMarketingHold(reach({ suppression: { list: 'platform', reason: 'bounce' } })),
    ).toEqual({ kind: 'paused', reason: 'bounce' })
    expect(
      platformMarketingHold(reach({ suppression: { list: 'site', reason: 'erasure' } })),
    ).toEqual({ kind: 'paused', reason: 'erasure' })
    expect(
      platformMarketingHold(reach({ suppression: { list: 'platform', reason: 'complaint' } })),
    ).toEqual({ kind: 'paused', reason: 'complaint' })
  })

  it('names an unanswered confirmation, and says nothing without a read', () => {
    expect(
      platformMarketingHold(
        reach({ topic: { id: 'product-updates', state: 'pending', leftAtMs: null } }),
      ),
    ).toEqual({ kind: 'unconfirmed' })
    expect(platformMarketingHold({ status: 'unconfigured' })).toBeNull()
    expect(platformMarketingHold({ status: 'unreadable', hostId: HOST })).toBeNull()
  })
})
