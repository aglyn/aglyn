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
 * @jest-environment node
 */

const written: Array<{ path: string; data: Record<string, unknown> }> = []
const hostDocs = new Map<string, Record<string, unknown>>()
const userDocs = new Map<string, Record<string, unknown>>()
const sends: Array<Record<string, unknown>> = []
const suppressed = new Set<string>()
const directory = new Map<string, string>()
const metered: string[] = []
let emailConfigured = true

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => fakeFirestore(),
    }),
  },
  firebaseAdmin: {
    app: () => ({
      firestore: () => fakeFirestore(),
    }),
  },
}))

jest.mock('./auth-pools', () => ({
  listStaffUidsAcrossPools: async () => [],
  findUserByUidAcrossPools: async (uid: string) =>
    directory.has(uid)
      ? { record: { email: directory.get(uid) }, tenantId: null }
      : null,
}))

jest.mock('./organizations', () => ({
  listOrgMembers: async () => [],
}))

/**
 * The REAL resolver and the REAL route table, not stubs (AGL-3224).
 *
 * The barrel itself is mocked only because pulling `@aglyn/aglyn/server` into
 * a node test drags the whole framework in for one pure function; what it
 * resolves to is the actual preference module, so these tests exercise the
 * inheritance and the defaults rather than a second copy of them that could
 * drift from what ships.
 */
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/notifications'),
  // The route table too, for the settings link in the email's footer. Real,
  // not a stub: a stubbed `buildRoute` would let this spec keep passing while
  // the link in the message pointed at a page that does not exist.
  ...jest.requireActual('../../../../../../aglyn/src/lib/app-utils/console-routes'),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => emailConfigured,
  sendEmail: async (options: Record<string, unknown>) => {
    sends.push(options)
    return { sent: true }
  },
}))

jest.mock('./email-suppression', () => ({
  filterSuppressedEmails: async (addresses: readonly string[]) =>
    addresses.filter((address) => !suppressed.has(address)),
}))

jest.mock('./email-metering', () => ({
  meterOrgEmail: async (orgId: string) => {
    metered.push(`org:${orgId}`)
  },
  meterPlatformEmail: async () => {
    metered.push('platform')
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

/**
 * A Firestore stand-in narrow enough to see exactly what the fan-out writes.
 *
 * `set()` REJECTS an explicitly-undefined value, the way the Admin SDK does
 * without `ignoreUndefinedProperties` — which the real project does not set.
 * That is load-bearing here: the org is optional on the host model, and a
 * naive `orgId: host.get('orgId')` would write `undefined` and take down the
 * whole notification for any host that predates AGL-233.
 */
function fakeFirestore(): any {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        get: async () => ({
          id,
          exists: hostDocs.has(`${name}/${id}`),
          get: (field: string) => hostDocs.get(`${name}/${id}`)?.[field],
        }),
        collection: (sub: string) => ({
          doc: () => ({ path: `${name}/${id}/${sub}` }),
        }),
      }),
    }),
    getAll: async (...refs: Array<{ path: string }>) =>
      refs.map((ref) => {
        const id = ref.path.split('/')[1]
        return {
          id,
          get: (field: string) => userDocs.get(id)?.[field],
        }
      }),
    batch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(data)) {
          if (value === undefined) {
            throw new Error(
              `Cannot use "undefined" as a Firestore value (field: ${key})`,
            )
          }
        }
        written.push({ path: ref.path, data })
      },
      commit: async () => undefined,
    }),
  }
}

import { notifyHostManagers, notifyUsers } from './notifications'

/**
 * Host notifications carry their own org (AGL-1773).
 *
 * A notification's `link` is frozen at write time in the legacy
 * `/{hostDocId}/rest` shape and rewritten to `/{orgSlug}/hosts/{subdomain}/…`
 * when it is followed (AGL-644). Without an `orgId` on the doc, the console
 * had to key that `{orgSlug}` off whichever workspace the reader had open —
 * so for a manager who belongs to two, every form submission, booking and
 * order notification about the other workspace pointed at a 404.
 */
describe('notifyHostManagers org stamping (AGL-1773)', () => {
  beforeEach(() => {
    written.length = 0
    hostDocs.clear()
    userDocs.clear()
    sends.length = 0
    metered.length = 0
    suppressed.clear()
    directory.clear()
    emailConfigured = true
  })

  it('stamps the owning org from the host doc', async () => {
    hostDocs.set('hosts/host-1', {
      orgId: 'org-1',
      memberRoles: { 'uid-a': 'admin', 'uid-b': 'editor' },
    })
    await notifyHostManagers('host-1', {
      type: 'content.formSubmission',
      title: 'New form submission',
      link: '/host-1/inbox',
    })
    expect(written).toHaveLength(2)
    for (const entry of written) {
      expect(entry.data['orgId']).toBe('org-1')
      expect(entry.data['hostId']).toBe('host-1')
    }
  })

  it('reaches only admins and editors', async () => {
    // Guards the stamp against quietly widening the audience: `viewer` is a
    // real role on the projection and must stay out of the fan-out.
    hostDocs.set('hosts/host-1', {
      orgId: 'org-1',
      memberRoles: { 'uid-a': 'admin', 'uid-v': 'viewer' },
    })
    await notifyHostManagers('host-1', {
      type: 'content.booking',
      title: 'New booking',
    })
    expect(written).toHaveLength(1)
    expect(written[0].path).toBe('users/uid-a/notifications')
  })

  it('omits the key entirely when the host has no org', async () => {
    // The assertion that would have caught the naive fix: writing
    // `orgId: undefined` throws in the Admin SDK, and `notifyUsers` swallows
    // the error — so the notification would simply never arrive, which is the
    // worst shape a miss on an alerting path can take.
    hostDocs.set('hosts/host-legacy', {
      memberRoles: { 'uid-a': 'admin' },
    })
    await notifyHostManagers('host-legacy', {
      type: 'content.formSubmission',
      title: 'New form submission',
    })
    expect(written).toHaveLength(1)
    expect('orgId' in written[0].data).toBe(false)
    expect(written[0].data['hostId']).toBe('host-legacy')
  })

  it('lets an explicit payload org win over the host doc', async () => {
    hostDocs.set('hosts/host-1', {
      orgId: 'org-stale',
      memberRoles: { 'uid-a': 'admin' },
    })
    await notifyHostManagers('host-1', {
      type: 'content.order',
      title: 'New order',
      orgId: 'org-explicit',
    })
    expect(written[0].data['orgId']).toBe('org-explicit')
  })
})

/**
 * The email beside the console notification (AGL-3224).
 *
 * Every assertion here is about a default: the inbox is not ours to fill, so
 * the interesting cases are the ones where nothing is sent.
 */
describe('the notification email channel (AGL-3224)', () => {
  const FORM = {
    type: 'content.formSubmission' as const,
    title: 'New form submission',
    body: 'Someone filled in Contact us.',
    link: '/org/hosts/site/inbox',
  }

  beforeEach(() => {
    written.length = 0
    hostDocs.clear()
    userDocs.clear()
    sends.length = 0
    metered.length = 0
    suppressed.clear()
    directory.clear()
    emailConfigured = true
    process.env.NEXT_PUBLIC_CONSOLE_URL = 'https://app.example.com'
  })

  it('sends nothing to somebody who never asked', async () => {
    directory.set('uid-a', 'a@example.com')
    await notifyUsers(['uid-a'], FORM)
    expect(written).toHaveLength(1)
    expect(sends).toHaveLength(0)
  })

  it('sends one message to somebody who did, and meters it to the org', async () => {
    userDocs.set('uid-a', {
      notificationSettings: { account: { content: { email: true } } },
    })
    directory.set('uid-a', 'a@example.com')
    await notifyUsers(['uid-a'], { ...FORM, orgId: 'org-1' })
    expect(sends).toHaveLength(1)
    expect(sends[0]['to']).toEqual(['a@example.com'])
    expect(sends[0]['subject']).toBe(FORM.title)
    // The link is absolute and the way out is in the body.
    expect(sends[0]['text']).toContain('https://app.example.com/org/hosts/site/inbox')
    expect(sends[0]['text']).toContain('/manage/notifications/settings')
    expect(sends[0]['headers']).toEqual({
      'List-Unsubscribe': '<https://app.example.com/manage/notifications/settings>',
    })
    expect(metered).toEqual(['org:org-1'])
  })

  it('honours a site override without touching the rest of the workspace', async () => {
    userDocs.set('uid-a', {
      notificationSettings: {
        orgs: { 'org-1': { content: { email: true } } },
        hosts: { 'host-quiet': { content: { email: false } } },
      },
    })
    directory.set('uid-a', 'a@example.com')
    await notifyUsers(['uid-a'], {
      ...FORM,
      orgId: 'org-1',
      hostId: 'host-quiet',
    })
    expect(sends).toHaveLength(0)
    await notifyUsers(['uid-a'], { ...FORM, orgId: 'org-1', hostId: 'host-busy' })
    expect(sends).toHaveLength(1)
  })

  it('writes the console notification even when the channels disagree', async () => {
    // The two are independent: a muted feed and a wanted email is a real
    // answer, and so is its reverse.
    userDocs.set('uid-a', {
      notificationSettings: {
        account: { content: { console: false, email: true } },
      },
    })
    directory.set('uid-a', 'a@example.com')
    await notifyUsers(['uid-a'], FORM)
    expect(written).toHaveLength(0)
    expect(sends).toHaveLength(1)
  })

  it('never mails a suppressed address', async () => {
    userDocs.set('uid-a', {
      notificationSettings: { account: { content: { email: true } } },
    })
    directory.set('uid-a', 'bounced@example.com')
    suppressed.add('bounced@example.com')
    await notifyUsers(['uid-a'], FORM)
    expect(written).toHaveLength(1)
    expect(sends).toHaveLength(0)
  })

  it('never mails a digest that mails itself', async () => {
    userDocs.set('uid-a', {
      notificationSettings: { account: { content: { email: true } } },
    })
    directory.set('uid-a', 'a@example.com')
    await notifyUsers(['uid-a'], {
      type: 'content.crmDailyDigest',
      title: 'Daily CRM digest',
    })
    expect(written).toHaveLength(1)
    expect(sends).toHaveLength(0)
  })

  it('prefers an address the caller already held over a directory lookup', async () => {
    userDocs.set('uid-a', {
      notificationSettings: { account: { content: { email: true } } },
    })
    // Nothing in the directory: a lookup would find no address at all, so a
    // send proves the hint was used rather than merely accepted.
    await notifyUsers(['uid-a'], FORM, { emails: { 'uid-a': 'Roster@Example.com' } })
    expect(sends).toHaveLength(1)
    expect(sends[0]['to']).toEqual(['roster@example.com'])
  })

  it('sends nothing at all when no mail is configured', async () => {
    emailConfigured = false
    userDocs.set('uid-a', {
      notificationSettings: { account: { content: { email: true } } },
    })
    directory.set('uid-a', 'a@example.com')
    await notifyUsers(['uid-a'], FORM)
    expect(written).toHaveLength(1)
    expect(sends).toHaveLength(0)
  })

  it('still honours a mute set on the map nothing has migrated', async () => {
    userDocs.set('uid-a', { notificationPrefs: { content: false } })
    await notifyUsers(['uid-a'], FORM)
    expect(written).toHaveLength(0)
  })
})
