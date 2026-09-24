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
 * The console consent writer (AGL-3185): the person's document always, the
 * operator's contact only when a marketing host is configured, and the
 * contact carrying the decision with the person's own provenance.
 */

import {
  PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
  USER_MARKETING_PROMPT_DISMISSED_AT_FIELD,
} from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import {
  platformMarketingHostId,
  readPlatformMarketingConsentForUser,
  recordPlatformMarketingConsent,
  snoozePlatformMarketingPrompt,
} from './platform-marketing-consent'

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => undefined }) },
}))
// The real door is not under test here; what reaches it is.
jest.mock('./upsert-contact', () => ({
  __esModule: true,
  upsertHostContact: async () => ({ refused: 'error' }),
}))

/** A users collection and nothing else, merge-set like the Admin SDK. */
function fakeFirestore(existing: Record<string, Record<string, unknown>> = {}) {
  const docs: Record<string, Record<string, unknown>> = { ...existing }
  return {
    docs,
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`
        return {
          get: async () => ({
            exists: docs[path] !== undefined,
            get: (field: string) => docs[path]?.[field],
            data: () => docs[path],
          }),
          set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
            if (!options?.merge) throw new Error('expected a merge set')
            docs[path] = { ...(docs[path] ?? {}), ...data }
          },
        }
      },
    }),
  }
}

const UID = 'uid-console-person'
const EMAIL = 'person@example.com'
const NOW = Date.UTC(2026, 8, 20, 12)
const HOST = 'host-platform-marketing'

const upsertCalls: Array<Record<string, unknown>> = []
const upsert = jest.fn(async (options: Record<string, unknown>) => {
  upsertCalls.push(options)
  return { contactId: 'contact-1', created: true }
}) as never

beforeEach(() => {
  upsertCalls.length = 0
  delete process.env.PLATFORM_MARKETING_HOST_ID
})

describe('recordPlatformMarketingConsent', () => {
  it('writes the decision, its timestamp and its provenance onto the person’s document', async () => {
    const db = fakeFirestore()
    const result = await recordPlatformMarketingConsent({
      uid: UID,
      email: EMAIL,
      decision: 'granted',
      source: 'console-signup',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      hostId: HOST,
      upsert,
    })
    expect(result.atMs).toBe(NOW)
    expect(db.docs[`users/${UID}`]).toEqual({
      marketingConsent: true,
      marketingConsentAtMs: NOW,
      marketingConsentSource: expect.objectContaining({
        kind: 'console-signup',
        by: UID,
        atMs: NOW,
        actor: 'person',
        textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      }),
    })
  })

  it('captures the contact on the marketing host with the grant and the same provenance', async () => {
    const db = fakeFirestore({
      [`users/${UID}`]: { firstName: 'Ada', lastName: 'Example' },
    })
    const result = await recordPlatformMarketingConsent({
      uid: UID,
      email: EMAIL,
      name: 'Token Name',
      decision: 'granted',
      source: 'console-prompt',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      hostId: HOST,
      upsert,
    })
    expect(result.contact).toEqual({
      status: 'recorded',
      contactId: 'contact-1',
      created: true,
    })
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]).toEqual(
      expect.objectContaining({
        hostId: HOST,
        email: EMAIL,
        // The document's name outranks the token's.
        name: 'Ada Example',
        source: 'account',
        marketingConsent: true,
        initialLifecycleStage: 'lead',
        marketingConsentSource: expect.objectContaining({
          kind: 'console-prompt',
          by: UID,
          actor: 'person',
        }),
      }),
    )
    expect(upsertCalls[0]).not.toHaveProperty('declineMarketingConsent')
    expect((upsertCalls[0].interaction as { atMs: number }).atMs).toBe(NOW)
  })

  it('records a refusal as a refusal on both documents, never as a grant or as nothing', async () => {
    const db = fakeFirestore()
    await recordPlatformMarketingConsent({
      uid: UID,
      email: EMAIL,
      decision: 'declined',
      source: 'console-preferences',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      hostId: HOST,
      upsert,
    })
    expect(db.docs[`users/${UID}`]).toEqual(
      expect.objectContaining({ marketingConsent: false, marketingConsentAtMs: NOW }),
    )
    expect(upsertCalls[0]).toEqual(
      expect.objectContaining({ declineMarketingConsent: true }),
    )
    expect(upsertCalls[0]).not.toHaveProperty('marketingConsent')
  })

  it('records the preference alone when no marketing host is configured', async () => {
    const db = fakeFirestore()
    const result = await recordPlatformMarketingConsent({
      uid: UID,
      email: EMAIL,
      decision: 'granted',
      source: 'console-signup',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      upsert,
    })
    expect(result.contact).toEqual({ status: 'unconfigured' })
    expect(upsertCalls).toHaveLength(0)
    expect(db.docs[`users/${UID}`]?.marketingConsent).toBe(true)
  })

  it('reads the host from the environment when none is injected', async () => {
    process.env.PLATFORM_MARKETING_HOST_ID = ` ${HOST} `
    expect(platformMarketingHostId()).toBe(HOST)
    const db = fakeFirestore()
    await recordPlatformMarketingConsent({
      uid: UID,
      email: EMAIL,
      decision: 'granted',
      source: 'console-signup',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      upsert,
    })
    expect(upsertCalls[0]?.hostId).toBe(HOST)
  })

  it('skips the contact for an account with no address, and says so', async () => {
    const db = fakeFirestore()
    const result = await recordPlatformMarketingConsent({
      uid: UID,
      email: '',
      decision: 'granted',
      source: 'console-signup',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      hostId: HOST,
      upsert,
    })
    expect(result.contact).toEqual({ status: 'no-email' })
    expect(upsertCalls).toHaveLength(0)
  })

  it('returns a refused contact rather than failing the preference', async () => {
    const db = fakeFirestore()
    const result = await recordPlatformMarketingConsent({
      uid: UID,
      email: EMAIL,
      decision: 'granted',
      source: 'console-signup',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      hostId: HOST,
      upsert: (async () => ({ refused: 'erased' })) as never,
    })
    expect(result.contact).toEqual({ status: 'refused', reason: 'erased' })
    expect(db.docs[`users/${UID}`]?.marketingConsent).toBe(true)
  })

  it('refuses to record a decision it cannot attribute', async () => {
    const db = fakeFirestore()
    const base = {
      uid: UID,
      email: EMAIL,
      decision: 'granted' as const,
      source: 'console-signup' as const,
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      firestore: db,
      hostId: HOST,
      upsert,
    }
    await expect(
      recordPlatformMarketingConsent({ ...base, uid: ' ' }),
    ).rejects.toThrow('uid')
    await expect(
      recordPlatformMarketingConsent({ ...base, decision: 'maybe' as never }),
    ).rejects.toThrow('decision')
    await expect(
      recordPlatformMarketingConsent({ ...base, source: 'website' as never }),
    ).rejects.toThrow('source')
    await expect(
      recordPlatformMarketingConsent({ ...base, textVersion: '' }),
    ).rejects.toThrow('textVersion')
    expect(Object.keys(db.docs)).toEqual([])
  })
})

describe('the prompt dismissal and the read-back', () => {
  it('stamps the dismissal without touching the decision', async () => {
    const db = fakeFirestore({
      [`users/${UID}`]: { marketingConsent: true, marketingConsentAtMs: NOW - 5 },
    })
    await snoozePlatformMarketingPrompt(UID, { now: NOW, firestore: db })
    expect(db.docs[`users/${UID}`]).toEqual({
      marketingConsent: true,
      marketingConsentAtMs: NOW - 5,
      [USER_MARKETING_PROMPT_DISMISSED_AT_FIELD]: NOW,
    })
  })

  it('reads the state back off the document, and nothing off a missing one', async () => {
    const db = fakeFirestore()
    expect(await readPlatformMarketingConsentForUser(UID, { firestore: db })).toEqual({
      decision: null,
      atMs: null,
      textVersion: null,
      sourceKind: null,
      promptDismissedAtMs: null,
    })
    await recordPlatformMarketingConsent({
      uid: UID,
      email: EMAIL,
      decision: 'declined',
      source: 'console-prompt',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      now: NOW,
      firestore: db,
      hostId: null,
      upsert,
    })
    expect(await readPlatformMarketingConsentForUser(UID, { firestore: db })).toEqual({
      decision: 'declined',
      atMs: NOW,
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      sourceKind: 'console-prompt',
      promptDismissedAtMs: null,
    })
  })
})

describe('a Yes reopens the list it stands for (AGL-3305)', () => {
  const rejoin = jest.fn(async () => ({
    status: 'rejoined' as const,
    releasedSuppression: true,
    keptLeft: 3,
  }))
  beforeEach(() => rejoin.mockClear())
  const base = {
    uid: UID,
    email: EMAIL,
    textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    now: NOW,
    hostId: HOST,
    upsert,
    rejoin: rejoin as never,
  }

  it('asks for the product-updates list on the marketing site, for a verified mailbox', async () => {
    const result = await recordPlatformMarketingConsent({
      ...base,
      firestore: fakeFirestore(),
      decision: 'granted',
      source: 'console-preferences',
      mailboxVerified: true,
    })
    expect(rejoin).toHaveBeenCalledWith({
      hostId: HOST,
      email: EMAIL,
      topicId: 'product-updates',
    })
    expect(result.stream).toEqual({ status: 'rejoined', releasedSuppression: true, keptLeft: 3 })
  })

  it('records an unverified Yes and reopens nothing — the address might be somebody else’s', async () => {
    const db = fakeFirestore()
    const result = await recordPlatformMarketingConsent({
      ...base,
      firestore: db,
      decision: 'granted',
      source: 'console-signup',
    })
    expect(result.stream).toEqual({ status: 'unverified' })
    expect(rejoin).not.toHaveBeenCalled()
    expect(db.docs[`users/${UID}`]).toMatchObject({ marketingConsent: true })
  })

  it('reopens nothing for a No, and nothing where there is no marketing site', async () => {
    const declined = await recordPlatformMarketingConsent({
      ...base,
      firestore: fakeFirestore(),
      decision: 'declined',
      source: 'console-preferences',
      mailboxVerified: true,
    })
    expect(declined.stream).toBeUndefined()
    const unconfigured = await recordPlatformMarketingConsent({
      ...base,
      hostId: null,
      firestore: fakeFirestore(),
      decision: 'granted',
      source: 'console-preferences',
      mailboxVerified: true,
    })
    expect(unconfigured.stream).toBeUndefined()
    expect(rejoin).not.toHaveBeenCalled()
  })

  it('keeps the answer when the list could not reopen, and says so', async () => {
    const db = fakeFirestore()
    const result = await recordPlatformMarketingConsent({
      ...base,
      rejoin: (async () => ({ status: 'failed' })) as never,
      firestore: db,
      decision: 'granted',
      source: 'console-preferences',
      mailboxVerified: true,
    })
    expect(result.stream).toEqual({ status: 'failed' })
    expect(db.docs[`users/${UID}`]).toMatchObject({ marketingConsent: true })
  })

  it('refuses an email door — those are the marketing site’s to record', async () => {
    await expect(
      recordPlatformMarketingConsent({
        ...base,
        firestore: fakeFirestore(),
        decision: 'declined',
        source: 'email-unsubscribe' as never,
      }),
    ).rejects.toThrow('console source')
  })
})
