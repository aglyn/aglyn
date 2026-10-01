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
 * The `emailSend` record index (AGL-3080): a campaign's sends, named for
 * another plugin — the CRM naming the mail on a person's timeline — without
 * it reading `orgs/{orgId}/campaigns` itself.
 */

const sends: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'site-1' ? 'org-1' : null),
}))

const docRef = (path: string) => ({
  get: async () => ({
    id: path.split('/').pop(),
    exists: sends[path] !== undefined,
    data: () => sends[path],
  }),
})

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({
      firestore: () => ({
        collection: (root: string) => ({
          doc: (id: string) => ({
            collection: (sub: string) => ({ doc: (sendId: string) => docRef(`${root}/${id}/${sub}/${sendId}`) }),
          }),
        }),
      }),
    }),
  },
}))

import { emailSendIndexedRecord, emailSendRecordIndex } from './email-send-record-index'

beforeEach(() => {
  for (const key of Object.keys(sends)) delete sends[key]
  sends['orgs/org-1/campaigns/s1'] = { displayName: 'Spring sale', subject: 'Ends Sunday', hostId: 'site-1', status: 'sent' }
  sends['orgs/org-1/campaigns/s2'] = { subject: 'Summer preview', hostId: 'site-2' }
  sends['orgs/org-1/campaigns/s3'] = { hostId: 'site-1' }
})

it('names a send by the name the team gave it, else its subject', async () => {
  expect(await emailSendRecordIndex.get({ orgId: 'org-1', id: 's1' })).toEqual({
    id: 's1',
    name: 'Spring sale',
    facts: { hostId: 'site-1', subject: 'Ends Sunday', status: 'sent' },
  })
  expect((await emailSendRecordIndex.get({ orgId: 'org-1', id: 's2' }))?.name).toBe('Summer preview')
})

it('leaves out an unnamed send, a missing one, and another site’s when asked for a site', async () => {
  expect(await emailSendRecordIndex.get({ orgId: 'org-1', id: 's3' })).toBeNull()
  expect(await emailSendRecordIndex.get({ orgId: 'org-1', id: 'gone' })).toBeNull()
  expect(await emailSendRecordIndex.get({ hostId: 'site-1', id: 's2' })).toBeNull()
  expect((await emailSendRecordIndex.get({ hostId: 'site-1', id: 's1' }))?.name).toBe('Spring sale')
  expect(await emailSendRecordIndex.get({ orgId: 'org-1', id: 'a/b' })).toBeNull()
})

it('reads nothing for a scope with no organization', async () => {
  expect(await emailSendRecordIndex.get({ hostId: 'site-9', id: 's1' })).toBeNull()
  expect(emailSendIndexedRecord('s1', undefined)).toBeNull()
})
