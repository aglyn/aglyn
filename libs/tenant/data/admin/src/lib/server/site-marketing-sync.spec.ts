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
 * A site's consent as an outside list mirrors it (AGL-3639): the status the
 * list should hold, the walk of who left, and the unsubscribe a list hands
 * back — marked with where it came from, and liftable only from there.
 */

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { Timestamp } from 'firebase-admin/firestore'
import {
  listSiteSuppressionChanges,
  readSiteMarketingStatuses,
  recordSiteUnsubscribe,
  recordSiteUnsubscribes,
  releaseSiteUnsubscribe,
  releaseSiteUnsubscribes,
} from './site-marketing-sync'
import { queryFakeFirestore } from './test-firestore-queries'

const stamped: Array<{ hostId: string; email: string; status: string; detail: string | null }> = []
jest.mock('@aglyn/aglyn/plugin-manager/plugin-record-email-state', () => ({
  stampRecordEmailState: async (request: any) => {
    stamped.push({
      hostId: request.hostId,
      email: request.email,
      status: request.state.status,
      detail: request.state.detail,
    })
  },
}))
const mirrored: string[] = []
const resubscribed: string[] = []
jest.mock('./platform-marketing-consent', () => ({
  mirrorPlatformUnsubscribe: async (input: any) => {
    mirrored.push(`${input.hostId}:${input.email}:${input.left}`)
    return { status: 'not-platform' }
  },
  mirrorPlatformResubscribe: async (input: any) => {
    resubscribed.push(`${input.hostId}:${input.email}:${input.via}`)
    return { status: 'not-platform' }
  },
}))
jest.mock('./firebase-admin', () => ({ __esModule: true, default: { app: () => ({ firestore: () => null }) } }))

const HOST = 'host-1'
const keyOf = (email: string) => personKey(email) as string
const granted = { marketingConsentByHost: { [HOST]: { marketingConsent: true } } }
const declined = { marketingConsentByHost: { [HOST]: { marketingConsent: false } } }

beforeEach(() => {
  stamped.length = 0
  mirrored.length = 0
})

describe('what an outside list should hold for each person', () => {
  it('subscribes a granted basis, unsubscribes a refusal or a suppression, and leaves out no basis', async () => {
    const firestore = queryFakeFirestore({
      [`emailSuppressions/${keyOf('bounced@example.com')}`]: { email: 'bounced@example.com', reason: 'bounce', releasedAt: null },
      [`emailSuppressions/${keyOf('released@example.com')}`]: { email: 'released@example.com', reason: 'bounce', releasedAt: 5 },
      [`hosts/${HOST}/suppressions/${keyOf('left@example.com')}`]: { email: 'left@example.com', reason: 'unsubscribe' },
    })
    const statuses = await readSiteMarketingStatuses({
      hostId: HOST,
      org: null,
      firestore,
      people: [
        { email: 'pat@example.com', data: granted },
        { email: 'no@example.com', data: declined },
        { email: 'bounced@example.com', data: granted },
        { email: 'released@example.com', data: granted },
        { email: 'left@example.com', data: granted },
        { email: 'stranger@example.com', data: {} },
        { email: 'not an address', data: granted },
      ],
    })
    expect(statuses).toEqual(['subscribed', 'unsubscribed', 'unsubscribed', 'subscribed', 'unsubscribed', 'withheld', 'withheld'])
  })

  it('honors a refusal filed on a sibling site of the consent group', async () => {
    const org = { consentGroups: { g1: { name: 'Brand', hostIds: [HOST, 'host-2'] } } }
    const firestore = queryFakeFirestore({
      [`hosts/host-2/suppressions/${keyOf('pat@example.com')}`]: { email: 'pat@example.com', reason: 'unsubscribe' },
    })
    const [status] = await readSiteMarketingStatuses({
      hostId: HOST,
      org,
      firestore,
      people: [{ email: 'pat@example.com', data: granted }],
    })
    expect(status).toBe('unsubscribed')
  })

  it('throws when a list cannot be read, rather than answering an unmeasured "unsubscribed"', async () => {
    const firestore = queryFakeFirestore()
    firestore.getAll = async () => Promise.reject(new Error('unavailable'))
    await expect(
      readSiteMarketingStatuses({ hostId: HOST, org: null, firestore, people: [{ email: 'pat@example.com', data: granted }] }),
    ).rejects.toThrow('unavailable')
  })
})

describe('the walk of who left a site', () => {
  it('answers rows in the order written, and a cursor that resumes after the last', async () => {
    const at = (ms: number) => Timestamp.fromMillis(ms)
    const firestore = queryFakeFirestore({
      [`hosts/${HOST}/suppressions/b`]: { email: 'b@example.com', reason: 'bounce', suppressedAt: at(2_000) },
      [`hosts/${HOST}/suppressions/a`]: { email: 'a@example.com', reason: 'unsubscribe', via: 'marketing-platforms:mailchimp', suppressedAt: at(1_000) },
      [`hosts/${HOST}/suppressions/c`]: { email: 'c@example.com', suppressedAt: at(2_000) },
      [`hosts/${HOST}/suppressions/old`]: { email: 'old@example.com', reason: 'unsubscribe' },
    })
    const first = await listSiteSuppressionChanges({ hostId: HOST, after: null, limit: 2, firestore })
    expect(first.rows).toEqual([
      { email: 'a@example.com', reason: 'unsubscribe', via: 'marketing-platforms:mailchimp' },
      { email: 'b@example.com', reason: 'bounce', via: null },
    ])
    const second = await listSiteSuppressionChanges({ hostId: HOST, after: first.next, limit: 2, firestore })
    expect(second.rows).toEqual([{ email: 'c@example.com', reason: 'unsubscribe', via: null }])
    const third = await listSiteSuppressionChanges({ hostId: HOST, after: second.next, limit: 2, firestore })
    expect(third).toEqual({ rows: [], next: null })
  })
})

describe('an unsubscribe handed back by an outside list', () => {
  const VIA = 'marketing-platforms:mailchimp'

  it('is filed as the site’s own, marked with where it came from, once', async () => {
    const firestore = queryFakeFirestore()
    const input = { hostId: HOST, email: 'Pat@Example.com', via: VIA, detail: 'Unsubscribed in Mailchimp.', firestore }
    expect(await recordSiteUnsubscribe(input)).toEqual({ created: true })
    expect(await recordSiteUnsubscribe(input)).toEqual({ created: false })
    const row = firestore.read(`hosts/${HOST}/suppressions/${keyOf('pat@example.com')}`)
    expect(row).toEqual(expect.objectContaining({ email: 'pat@example.com', reason: 'unsubscribe', via: VIA }))
    expect(stamped).toEqual([{ hostId: HOST, email: 'pat@example.com', status: 'unsubscribed', detail: 'Unsubscribed in Mailchimp.' }])
    expect(mirrored).toEqual([`${HOST}:pat@example.com:everything`])
  })

  it('never rewrites a row of another kind', async () => {
    const path = `hosts/${HOST}/suppressions/${keyOf('pat@example.com')}`
    const firestore = queryFakeFirestore({ [path]: { email: 'pat@example.com', reason: 'erasure' } })
    expect(await recordSiteUnsubscribe({ hostId: HOST, email: 'pat@example.com', via: VIA, detail: 'x', firestore })).toEqual({ created: false })
    expect(firestore.read(path)).toEqual({ email: 'pat@example.com', reason: 'erasure' })
    expect(stamped).toEqual([])
  })

  it('refuses a via that names no plugin and list', async () => {
    const firestore = queryFakeFirestore()
    expect(await recordSiteUnsubscribe({ hostId: HOST, email: 'pat@example.com', via: 'mailchimp', detail: 'x', firestore })).toEqual({ created: false })
    expect(firestore.docs(`hosts/${HOST}/suppressions`)).toEqual({})
  })

  it('is lifted only by the same list, and nothing else ever is', async () => {
    const own = `hosts/${HOST}/suppressions/${keyOf('own@example.com')}`
    const theirs = `hosts/${HOST}/suppressions/${keyOf('pat@example.com')}`
    const bounce = `hosts/${HOST}/suppressions/${keyOf('dead@example.com')}`
    const firestore = queryFakeFirestore({
      [own]: { email: 'own@example.com', reason: 'unsubscribe' },
      [theirs]: { email: 'pat@example.com', reason: 'unsubscribe', via: VIA },
      [bounce]: { email: 'dead@example.com', reason: 'bounce', via: VIA },
    })
    const release = (email: string, via = VIA) => releaseSiteUnsubscribe({ hostId: HOST, email, via, firestore })
    expect(await release('own@example.com')).toBe(false)
    expect(await release('dead@example.com')).toBe(false)
    expect(await release('pat@example.com', 'marketing-platforms:klaviyo')).toBe(false)
    expect(resubscribed).toEqual([])
    expect(await release('pat@example.com')).toBe(true)
    // The account's answer follows the list back, as the site's own resubscribe link does.
    expect(resubscribed).toEqual([`${HOST}:pat@example.com:email-resubscribe`])
    expect(firestore.read(theirs)).toBeUndefined()
    expect(firestore.read(own)).toBeDefined()
    expect(firestore.read(bounce)).toBeDefined()
  })
})

describe('a page of changes handed back by an outside list', () => {
  const VIA = 'marketing-platforms:klaviyo'

  it('files only the addresses with no row yet, once each', async () => {
    const firestore = queryFakeFirestore({
      [`hosts/${HOST}/suppressions/${keyOf('dead@example.com')}`]: { email: 'dead@example.com', reason: 'bounce' },
    })
    const created = await recordSiteUnsubscribes({
      hostId: HOST,
      emails: ['A@example.com', 'a@example.com', 'dead@example.com', 'nope', 'b@example.com'],
      via: VIA,
      detail: 'Unsubscribed in Klaviyo.',
      firestore,
    })
    expect(created).toBe(2)
    expect(Object.keys(firestore.docs(`hosts/${HOST}/suppressions`)).sort()).toEqual(
      [keyOf('a@example.com'), keyOf('b@example.com'), keyOf('dead@example.com')].sort(),
    )
    expect(firestore.read(`hosts/${HOST}/suppressions/${keyOf('dead@example.com')}`)?.reason).toBe('bounce')
  })

  it('lifts only the rows that list filed', async () => {
    const firestore = queryFakeFirestore({
      [`hosts/${HOST}/suppressions/${keyOf('a@example.com')}`]: { email: 'a@example.com', reason: 'unsubscribe', via: VIA },
      [`hosts/${HOST}/suppressions/${keyOf('b@example.com')}`]: { email: 'b@example.com', reason: 'unsubscribe' },
    })
    const released = await releaseSiteUnsubscribes({
      hostId: HOST,
      emails: ['a@example.com', 'b@example.com', 'c@example.com'],
      via: VIA,
      firestore,
    })
    expect(released).toBe(1)
    expect(firestore.read(`hosts/${HOST}/suppressions/${keyOf('a@example.com')}`)).toBeUndefined()
    expect(firestore.read(`hosts/${HOST}/suppressions/${keyOf('b@example.com')}`)).toBeDefined()
  })
})
