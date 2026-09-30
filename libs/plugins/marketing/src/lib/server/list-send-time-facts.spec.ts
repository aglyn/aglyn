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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginRecordFactsReader } from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  createListSendTimeFactsReader,
  LIST_SEND_TIME_FACTS_RESOURCE,
  registerListSendTimeFacts,
} from './list-send-time-facts'

/**
 * A list's send time, answered to another plugin from this plugin's sends.
 * The double holds `orgs/{orgId}/campaigns` and answers equality filters,
 * which is every read the reader makes.
 */

type Row = { id: string; data: Record<string, unknown> }

const valueAt = (data: Record<string, unknown>, field: string): unknown =>
  field.split('.').reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], data)

function firestoreOver(rows: Row[]): FirebaseFirestore.Firestore {
  const query = (filters: Array<[string, unknown]>): Record<string, unknown> => ({
    where: (field: string, _op: string, value: unknown) => query([...filters, [field, value]]),
    select: () => query(filters),
    limit: () => query(filters),
    get: async () => ({
      docs: rows
        .filter((row) => filters.every(([field, value]) => valueAt(row.data, field) === value))
        .map((row) => ({ id: row.id, get: (field: string) => valueAt(row.data, field) })),
    }),
  })
  return {
    collection: (name: string) => ({
      doc: (orgId: string) => ({
        collection: (child: string) => {
          if (name !== 'orgs' || orgId !== 'org-1' || child !== 'campaigns') throw new Error('unexpected read')
          return query([])
        },
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
}

/** A Tuesday at 09:00Z, `week` weeks after the first. */
const tuesday = (week: number) => new Date(Date.UTC(2026, 7, 4 + week * 7, 9, 0, 0))

function send(id: string, overrides: Record<string, unknown> = {}): Row {
  return {
    id,
    data: {
      hostId: 'host-1',
      listId: 'list-1',
      status: 'sent',
      sentAt: tuesday(Number(id.replace(/\D/g, '')) || 0),
      stats: { delivered: 400, uniqueOpens: 180 },
      ...overrides,
    },
  }
}

const request = {
  orgId: 'org-1',
  hostId: 'host-1',
  id: 'list-1',
  uid: 'member-1',
  org: null,
  now: new Date(Date.UTC(2026, 8, 30)),
}

describe('a list’s send time, for another plugin', () => {
  it('answers the slot and how many sends it was chosen among', async () => {
    const reader = createListSendTimeFactsReader(() =>
      firestoreOver([send('s0'), send('s1'), send('s2'), send('s3')]),
    )
    expect(await reader.read(request)).toEqual({
      ok: true,
      facts: { label: 'Tuesdays around 9 AM (UTC)', measured: 4 },
    })
  })

  it('reads only the sends made AS the site asked about', async () => {
    const sibling = (id: string) => send(id, { hostId: 'host-2' })
    const reader = createListSendTimeFactsReader(() =>
      firestoreOver([sibling('s0'), sibling('s1'), sibling('s2'), send('s3')]),
    )
    expect(await reader.read(request)).toEqual({ ok: true, facts: { label: null, measured: 0 } })
  })

  it('counts no draft and no other list', async () => {
    const reader = createListSendTimeFactsReader(() =>
      firestoreOver([send('s0', { status: 'draft' }), send('s1', { listId: 'list-2' }), send('s2'), send('s3')]),
    )
    expect(await reader.read(request)).toEqual({ ok: true, facts: { label: null, measured: 0 } })
  })

  it('names no send, subject or recipient', async () => {
    const reader = createListSendTimeFactsReader(() =>
      firestoreOver([0, 1, 2, 3].map((week) => send(`s${week}`, { subject: 'Box launch', recipient: 'ada@example.com' }))),
    )
    const read = await reader.read(request)
    expect(read.ok && Object.keys(read.facts).sort()).toEqual(['label', 'measured'])
    expect(JSON.stringify(read)).not.toMatch(/Box launch|ada@example\.com|s0/)
  })

  it('is read for one site', async () => {
    const reader = createListSendTimeFactsReader(() => firestoreOver([]))
    expect(await reader.read({ ...request, hostId: null })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('registration', () => {
  afterEach(() => resetPluginServicesForTests())

  it('publishes the reader as the marketing plugin’s, from the console surface', () => {
    registerListSendTimeFacts(() => firestoreOver([]))
    expect(pluginRecordFactsReader(LIST_SEND_TIME_FACTS_RESOURCE)?.pluginId).toBe('marketing')
    // The AI jobs that ask it run only on the console (AGL-3026).
    const server = readFileSync(join(__dirname, '..', 'server.ts'), 'utf8')
    const consoleSurface =
      /export function registerMarketingConsoleApi\(\): void \{[\s\S]*?\n\}/.exec(server)?.[0] ?? ''
    expect(consoleSurface).toContain('registerListSendTimeFacts(')
  })
})
