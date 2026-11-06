/**
 * @jest-environment node
 *
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

import { registerPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { announceConnectionRecordChange, connectionRecordChanged } from './record-announce'

/**
 * A record that changes or goes tells the site's pages (AGL-4195): the page
 * reads records through an hour-long cache, so a disconnected site must not
 * keep showing its reviews until it expires, and an hourly sync that wrote
 * the same values must not regenerate the whole site every hour.
 */

const dropped: string[][] = []

beforeAll(() => {
  registerPluginSiteCache(
    {
      drop: async ({ hostIds }) => {
        dropped.push([...hostIds])
        return { dropped: hostIds.length, skipped: 0, complete: true }
      },
    },
    { pluginId: 'site-cache-fake' },
  )
})

afterAll(() => unregisterPluginServices('site-cache-fake'))

beforeEach(() => {
  dropped.length = 0
})

const RECORD = { kind: 'record', version: '1.0.0', syncedAtMs: 1, fields: { rating: 4.8 }, items: [{ author: 'Sam' }] }

describe('connection record announcements (AGL-4195)', () => {
  it('counts a new, a changed and a deleted record as a change', () => {
    expect(connectionRecordChanged(undefined, RECORD)).toBe(true)
    expect(connectionRecordChanged(RECORD, { ...RECORD, fields: { rating: 4.9 } })).toBe(true)
    expect(connectionRecordChanged(RECORD, { ...RECORD, items: [] })).toBe(true)
    expect(connectionRecordChanged(RECORD, { ...RECORD, version: '1.1.0' })).toBe(true)
    expect(connectionRecordChanged(RECORD, null)).toBe(true)
  })

  it('does not count a re-sync that wrote the same values', () => {
    expect(connectionRecordChanged(RECORD, { ...RECORD, syncedAtMs: 99 })).toBe(false)
  })

  it('drops the site’s cached pages, and never throws', async () => {
    await announceConnectionRecordChange('host-1', 'disconnected')
    expect(dropped).toEqual([['host-1']])
  })
})
