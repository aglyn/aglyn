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

import { SERVER_TIMESTAMP, settingsFirestoreDouble } from '../testing/settings-firestore-double'
import { pageView } from './api-v1-site-settings'
import { readPageSeoPatch, settlePageSeoCache, writePageSeo } from './page-seo-write'

const NOW = new Date('2026-11-19T12:00:00Z')
const PAGE = 'hosts/host-1/screens/about'

describe('readPageSeoPatch (AGL-4235)', () => {
  it('holds title and description HARD to the search listing limits, and the breadcrumb to its own', () => {
    for (const [member, limit] of [['title', 60], ['description', 155], ['breadcrumb', 40]] as const) {
      expect(readPageSeoPatch({ [member]: 'a'.repeat(limit) })).toEqual({ edits: { [member]: 'a'.repeat(limit) } })
      expect(readPageSeoPatch({ [member]: 'a'.repeat(limit + 1) })).toEqual({ errors: { [member]: `Must be ${limit} characters or fewer` } })
    }
  })

  it('reads null and an empty string as emptying, and names what it does not write', () => {
    expect(readPageSeoPatch({ title: null, description: '' })).toEqual({ edits: { title: '', description: '' } })
    expect(readPageSeoPatch({ image: 'x' })).toEqual({ errors: { image: 'Not writable on a page’s search listing' } })
  })
})

describe('writePageSeo (AGL-4235)', () => {
  it('carries untouched keys forward, invents no image keys, and announces a published page by its address', async () => {
    const double = settingsFirestoreDouble({
      'hosts/host-1': { screens: { about: 'company/about' } },
      [PAGE]: { displayName: 'About', kind: 'page', seo: { breadcrumb: 'About', imageWidth: 1200 } },
    })
    const written = await writePageSeo(double.firestore, { hostId: 'host-1', pageId: 'about', edits: { title: 'About us' }, now: NOW })
    expect(written).toEqual(expect.objectContaining({ ok: true, changed: true, routePath: 'company/about', outboxId: expect.any(String) }))
    expect(double.read(PAGE)?.['seo']).toEqual({ breadcrumb: 'About', imageWidth: 1200, title: 'About us' })
    expect(double.read(PAGE)?.['seo']).not.toHaveProperty('image')
    expect(double.outbox().map(([, entry]) => entry)).toEqual([
      { hostId: 'host-1', paths: ['/company/about'], createdAt: SERVER_TIMESTAMP, attempts: 0 },
    ])
  })

  it('deletes the field when nothing is left, and owes no announce for a page with no address', async () => {
    const double = settingsFirestoreDouble({ 'hosts/host-1': {}, [PAGE]: { kind: 'page', seo: { title: 'Old' } } })
    const written = await writePageSeo(double.firestore, { hostId: 'host-1', pageId: 'about', edits: { title: '' }, now: NOW })
    expect(written).toEqual(expect.objectContaining({ ok: true, changed: true, routePath: null, outboxId: null }))
    expect(double.read(PAGE)).toEqual({ kind: 'page', updatedAt: NOW })
    expect(double.outbox()).toEqual([])
  })

  it('answers with the date it wrote as an ISO string, not an empty object (AGL-4235)', async () => {
    const double = settingsFirestoreDouble({ 'hosts/host-1': {}, [PAGE]: { displayName: 'About', kind: 'page' } })
    const written = await writePageSeo(double.firestore, { hostId: 'host-1', pageId: 'about', edits: { title: 'About us' }, now: NOW })
    if (!written.ok) throw new Error('expected the write to land')
    const view = pageView('about', written.page, {})
    expect(view.updated).toBe(NOW.toISOString())
    expect(JSON.parse(JSON.stringify(view)).updated).toBe('2026-11-19T12:00:00.000Z')
  })

  it('writes nothing when nothing differs', async () => {
    const double = settingsFirestoreDouble({ 'hosts/host-1': {}, [PAGE]: { seo: { title: 'Same' } } })
    expect(await writePageSeo(double.firestore, { hostId: 'host-1', pageId: 'about', edits: { title: 'Same' }, now: NOW })).toEqual(
      expect.objectContaining({ ok: true, changed: false, outboxId: null }),
    )
    expect(double.writes).toEqual([])
  })

  it('refuses a page that is missing, deleted, or not a page of the site', async () => {
    for (const page of [undefined, { deletedAt: NOW }, { kind: 'email' }, { kind: 'template' }, { kind: 'error' }, { kind: 'group' }]) {
      const double = settingsFirestoreDouble({ 'hosts/host-1': {}, ...(page ? { [PAGE]: page } : {}) })
      expect(await writePageSeo(double.firestore, { hostId: 'host-1', pageId: 'about', edits: { title: 'X' }, now: NOW })).toEqual({ ok: false, missing: true })
      expect(double.writes).toEqual([])
    }
  })
})

describe('settlePageSeoCache (AGL-4235)', () => {
  it('drops only that page, by its address, and releases the entry when the drop landed', async () => {
    const double = settingsFirestoreDouble({ 'publishOutbox/e1': { hostId: 'host-1' } })
    const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
    expect(await settlePageSeoCache(double.firestore, { hostId: 'host-1', routePath: '/', outboxId: 'e1' }, { dropCache })).toBe(true)
    expect(dropCache).toHaveBeenCalledWith(expect.objectContaining({ hostIds: ['host-1'], paths: { 'host-1': ['/'] } }))
    expect(double.read('publishOutbox/e1')).toBeUndefined()
  })
})
