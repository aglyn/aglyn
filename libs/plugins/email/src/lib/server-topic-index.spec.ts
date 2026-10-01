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
 * An org's topic catalog, as another plugin reads it: the declared streams
 * overlaid by what the org stored, archived ones included, each with the
 * facts the index documents and nothing else.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'host-1' ? 'org-1' : null),
}))

import { DECLARED_SUBSCRIPTION_TOPICS } from '@aglyn/aglyn/app-utils/subscription-topics'
import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  createSubscriptionTopicIndex,
  registerSubscriptionTopicIndex,
  SUBSCRIPTION_TOPIC_RECORD_KIND,
} from './server-topic-index'

const FLOOR = DECLARED_SUBSCRIPTION_TOPICS[0]

/** `orgs/org-1/emailTopics`, and nothing else; any other read throws. */
function firestoreOver(stored: Record<string, Record<string, unknown>>): FirebaseFirestore.Firestore {
  return {
    collection: (root: string) => ({
      doc: (orgId: string) => ({
        collection: (name: string) => {
          if (root !== 'orgs' || orgId !== 'org-1' || name !== 'emailTopics') {
            throw new Error(`unexpected read ${root}/${orgId}/${name}`)
          }
          return {
            get: async () => ({
              docs: Object.entries(stored).map(([id, data]) => ({ id, data: () => data })),
            }),
          }
        },
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
}

describe('the subscriptionTopic index', () => {
  it('lists the declared streams, overlaid by the org, plus its own', async () => {
    const index = createSubscriptionTopicIndex(() =>
      firestoreOver({
        [FLOOR.id]: { name: 'Renamed', description: 'Ours now.', doubleOptIn: true },
        webinars: { name: 'Webinars', archived: true },
      }),
    )
    const { records, truncated } = await index.list({ orgId: 'org-1', limit: 50 })
    expect(truncated).toBe(false)
    expect(records.map((record) => record.id)).toEqual([
      ...DECLARED_SUBSCRIPTION_TOPICS.map((topic) => topic.id),
      'webinars',
    ])
    expect(records[0]).toEqual({
      id: FLOOR.id,
      name: 'Renamed',
      facts: { description: 'Ours now.', archived: false, doubleOptIn: true },
    })
    // Retired, and still answered: a message already sent under it must go
    // on resolving to it.
    expect(records[records.length - 1]?.facts).toEqual({ description: '', archived: true })
  })

  it('says nothing about a confirmation the org never decided', async () => {
    const index = createSubscriptionTopicIndex(() => firestoreOver({}))
    const record = await index.get({ orgId: 'org-1', id: FLOOR.id })
    expect(record?.facts).not.toHaveProperty('doubleOptIn')
  })

  it('resolves a site to its org, and answers the declared floor for a site with none', async () => {
    const index = createSubscriptionTopicIndex(() => firestoreOver({ extra: { name: 'Extra' } }))
    expect((await index.get({ hostId: 'host-1', id: 'extra' }))?.name).toBe('Extra')
    const orphan = await index.list({ hostId: 'host-2', limit: 50 })
    expect(orphan.records.map((record) => record.id)).toEqual(
      DECLARED_SUBSCRIPTION_TOPICS.map((topic) => topic.id),
    )
  })

  it('reports the ceiling it cut at', async () => {
    const index = createSubscriptionTopicIndex(() => firestoreOver({}))
    const { records, truncated } = await index.list({ orgId: 'org-1', limit: 1 })
    expect(records).toHaveLength(1)
    expect(truncated).toBe(DECLARED_SUBSCRIPTION_TOPICS.length > 1)
  })
})

describe('registration', () => {
  afterEach(() => resetPluginServicesForTests())

  it('publishes the index as the Email plugin’s', () => {
    registerSubscriptionTopicIndex(() => firestoreOver({}))
    expect(pluginRecordIndex(SUBSCRIPTION_TOPIC_RECORD_KIND)?.pluginId).toBe('email')
  })
})
