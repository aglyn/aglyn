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
 * An unsubscribe reaches the account, for its own list only (AGL-3305).
 *
 * What a plausible implementation gets wrong silently: it mirrors a
 * newsletter unsubscribe onto an answer about product updates; it mirrors a
 * TENANT's unsubscribe onto a platform account; it lets a link in an email
 * overturn a No given in the console; it restores a Yes while the list is
 * still left; and it lets a failure here fail the unsubscribe that stopped
 * the mail.
 */

import {
  platformMarketingEmailSource,
  platformMarketingUserFields,
} from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import { emailSuppressionKey } from './email-suppression'
import {
  mirrorPlatformResubscribe,
  mirrorPlatformUnsubscribe,
} from './platform-marketing-consent'

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => undefined }) },
}))
jest.mock('./upsert-contact', () => ({
  __esModule: true,
  upsertHostContact: async () => ({ refused: 'error' }),
}))

const HOST = 'host-platform-marketing'
const TENANT = 'host-a-customer'
const UID = 'uid-person'
const EMAIL = 'person@example.com'
const KEY = emailSuppressionKey(EMAIL) ?? ''
const NOW = Date.UTC(2026, 8, 23, 20)
const BEFORE = Date.UTC(2026, 8, 20, 12)

/** Documents by path, merge-set like the Admin SDK, at any depth. */
function fakeFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const docs: Record<string, Record<string, unknown>> = { ...seed }
  const ref = (path: string): any => ({
    get: async () => ({
      exists: docs[path] !== undefined,
      get: (field: string) => docs[path]?.[field],
      data: () => docs[path],
    }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      if (!options?.merge) throw new Error('expected a merge set')
      docs[path] = { ...(docs[path] ?? {}), ...data }
    },
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  })
  return { docs, collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }
}

const USER = `users/${UID}`
const SITE_LIST = `hosts/${HOST}/suppressions/${KEY}`
const TOPICS = `hosts/${HOST}/topicOptOuts/${KEY}`
const PLATFORM_LIST = `emailSuppressions/${KEY}`

/** An account's answer, as a console door or an email door wrote it. */
function answered(
  decision: 'granted' | 'declined',
  kind: string,
): Record<string, unknown> {
  const source = kind.startsWith('email-')
    ? platformMarketingEmailSource({ kind, decision, uid: UID, atMs: BEFORE } as never)
    : { kind, by: UID, atMs: BEFORE, reason: 'console', textVersion: '2026-09-20', actor: 'person' as const }
  return platformMarketingUserFields({ decision, atMs: BEFORE, source })
}

const findAccount = jest.fn(async (email: string) => (email === EMAIL ? UID : null))

beforeEach(() => {
  findAccount.mockClear()
  delete process.env.PLATFORM_MARKETING_HOST_ID
})

const mirror = (left: 'everything' | string[], db = fakeFirestore(), hostId = HOST) =>
  mirrorPlatformUnsubscribe({
    hostId,
    email: EMAIL,
    left,
    now: NOW,
    firestore: db,
    platformHostId: HOST,
    findAccount,
  })

describe('mirrorPlatformUnsubscribe', () => {
  it('never touches an account from another site’s list', async () => {
    const db = fakeFirestore({ [USER]: answered('granted', 'console-signup') })
    await expect(mirror('everything', db, TENANT)).resolves.toEqual({ status: 'not-platform' })
    expect(findAccount).not.toHaveBeenCalled()
    expect(db.docs[USER]).toMatchObject({ marketingConsent: true })
  })

  it('leaves the answer alone for a list it is not about', async () => {
    const db = fakeFirestore({ [USER]: answered('granted', 'console-signup') })
    await expect(mirror(['newsletter', 'marketing'], db)).resolves.toEqual({
      status: 'other-list',
    })
    expect(findAccount).not.toHaveBeenCalled()
    expect(db.docs[USER]).toMatchObject({ marketingConsent: true })
  })

  it('turns a Yes to No when they leave everything, through the unsubscribe door', async () => {
    const db = fakeFirestore({ [USER]: answered('granted', 'console-signup') })
    await expect(mirror('everything', db)).resolves.toEqual({
      status: 'recorded',
      uid: UID,
      decision: 'declined',
    })
    expect(db.docs[USER]).toEqual({
      marketingConsent: false,
      marketingConsentAtMs: NOW,
      marketingConsentSource: {
        kind: 'email-unsubscribe',
        by: UID,
        atMs: NOW,
        reason: expect.stringMatching(/every email/),
        actor: 'person',
      },
    })
  })

  it('turns a Yes to No when product updates is among the lists they left', async () => {
    const db = fakeFirestore({ [USER]: answered('granted', 'console-prompt') })
    await mirror(['newsletter', 'product-updates'], db)
    expect(db.docs[USER]).toMatchObject({
      marketingConsent: false,
      marketingConsentSource: { kind: 'email-preferences' },
    })
  })

  it('records a No for somebody the console never got an answer from', async () => {
    // Which also stops the console prompt asking somebody who has said no.
    const db = fakeFirestore()
    await mirror('everything', db)
    expect(db.docs[USER]).toMatchObject({ marketingConsent: false, marketingConsentAtMs: NOW })
  })

  it('keeps the first No’s date and door — a second unsubscribe is not a later decision', async () => {
    const earlier = answered('declined', 'console-preferences')
    const db = fakeFirestore({ [USER]: earlier })
    await expect(mirror('everything', db)).resolves.toEqual({ status: 'unchanged' })
    expect(db.docs[USER]).toEqual(earlier)
  })

  it('changes nobody’s answer for an address no single account holds', async () => {
    const db = fakeFirestore()
    await expect(
      mirrorPlatformUnsubscribe({
        hostId: HOST,
        email: 'stranger@example.com',
        left: 'everything',
        firestore: db,
        platformHostId: HOST,
        findAccount,
      }),
    ).resolves.toEqual({ status: 'no-account' })
    expect(db.docs).toEqual({})
  })

  it('never throws — the list already stopped the mail', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      mirrorPlatformUnsubscribe({
        hostId: HOST,
        email: EMAIL,
        left: 'everything',
        firestore: fakeFirestore(),
        platformHostId: HOST,
        findAccount: async () => {
          throw new Error('auth unavailable')
        },
      }),
    ).resolves.toEqual({ status: 'failed' })
    error.mockRestore()
  })

  it('follows a self-hosted install’s own marketing site, and only it', async () => {
    process.env.PLATFORM_MARKETING_HOST_ID = 'studio-marketing'
    const db = fakeFirestore({ [USER]: answered('granted', 'console-signup') })
    const run = (hostId: string) =>
      mirrorPlatformUnsubscribe({ hostId, email: EMAIL, left: 'everything', firestore: db, findAccount })
    await expect(run(HOST)).resolves.toEqual({ status: 'not-platform' })
    await expect(run('studio-marketing')).resolves.toMatchObject({ status: 'recorded' })
    delete process.env.PLATFORM_MARKETING_HOST_ID
    // With no marketing site at all, no unsubscribe is ever about the account.
    await expect(run('studio-marketing')).resolves.toEqual({ status: 'not-platform' })
  })
})

const resubscribe = (db: ReturnType<typeof fakeFirestore>, via: 'email-resubscribe' | 'email-preferences' = 'email-resubscribe') =>
  mirrorPlatformResubscribe({
    hostId: HOST,
    email: EMAIL,
    via,
    now: NOW,
    firestore: db,
    platformHostId: HOST,
    findAccount,
  })

describe('mirrorPlatformResubscribe', () => {
  it('restores a Yes an email door took, once product updates reach them again', async () => {
    const db = fakeFirestore({ [USER]: answered('declined', 'email-unsubscribe') })
    await expect(resubscribe(db)).resolves.toEqual({
      status: 'recorded',
      uid: UID,
      decision: 'granted',
    })
    expect(db.docs[USER]).toMatchObject({
      marketingConsent: true,
      marketingConsentAtMs: NOW,
      marketingConsentSource: { kind: 'email-resubscribe', actor: 'person' },
    })
  })

  it('never overturns a No given in the console', async () => {
    const refusal = answered('declined', 'console-preferences')
    const db = fakeFirestore({ [USER]: refusal })
    await expect(resubscribe(db)).resolves.toEqual({ status: 'unchanged' })
    expect(db.docs[USER]).toEqual(refusal)
  })

  it('restores nothing while product updates itself is still left', async () => {
    const db = fakeFirestore({
      [USER]: answered('declined', 'email-preferences'),
      [TOPICS]: { topics: { 'product-updates': { optedOutAt: BEFORE, resubscribedAt: null } } },
    })
    await expect(resubscribe(db)).resolves.toEqual({ status: 'unchanged' })
    expect(db.docs[USER]).toMatchObject({ marketingConsent: false })
  })

  it('restores once the list is ticked again on the preference page', async () => {
    const db = fakeFirestore({
      [USER]: answered('declined', 'email-preferences'),
      [TOPICS]: { topics: { 'product-updates': { optedOutAt: BEFORE, resubscribedAt: NOW } } },
    })
    await resubscribe(db, 'email-preferences')
    expect(db.docs[USER]).toMatchObject({
      marketingConsent: true,
      marketingConsentSource: { kind: 'email-preferences' },
    })
  })

  it('restores nothing while either suppression list still stands', async () => {
    for (const [path, entry] of [
      [SITE_LIST, { reason: 'unsubscribe' }],
      [PLATFORM_LIST, { reason: 'bounce', releasedAt: null }],
    ] as const) {
      const db = fakeFirestore({ [USER]: answered('declined', 'email-unsubscribe'), [path]: entry })
      await expect(resubscribe(db)).resolves.toEqual({ status: 'unchanged' })
    }
  })

  it('leaves a Yes, and a never-answered account, exactly as they were', async () => {
    const yes = answered('granted', 'console-signup')
    const withYes = fakeFirestore({ [USER]: yes })
    await expect(resubscribe(withYes)).resolves.toEqual({ status: 'unchanged' })
    expect(withYes.docs[USER]).toEqual(yes)
    const never = fakeFirestore()
    await expect(resubscribe(never)).resolves.toEqual({ status: 'unchanged' })
    expect(never.docs[USER]).toBeUndefined()
  })
})
