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
}))

jest.mock('./organizations', () => ({
  listOrgMembers: async () => [],
}))

jest.mock('@aglyn/aglyn/server', () => ({
  notificationMuted: () => false,
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
      refs.map((ref) => ({
        id: ref.path.split('/')[1],
        get: () => undefined,
      })),
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

import { notifyHostManagers } from './notifications'

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
