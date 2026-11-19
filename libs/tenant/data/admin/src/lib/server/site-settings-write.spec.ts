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

import { FieldValue } from 'firebase-admin/firestore'
import { SERVER_TIMESTAMP, settingsFirestoreDouble } from '../testing/settings-firestore-double'
import {
  applySiteSettingsChanges,
  settleSiteSettingsCache,
  stageSiteSettingsWrite,
  writeSiteSettings,
} from './site-settings-write'

const NOW = new Date('2026-11-19T12:00:00Z')

describe('stageSiteSettingsWrite (AGL-4235)', () => {
  it('stages the changes with updatedAt, and a site-wide outbox entry beside them', () => {
    const tx = { update: jest.fn(), set: jest.fn() }
    const firestore = {
      collection: (name: string) => ({ doc: (id: string) => ({ name, id }) }),
    } as unknown as FirebaseFirestore.Firestore
    const hostRef = { id: 'host-1' } as unknown as FirebaseFirestore.DocumentReference
    const outboxId = stageSiteSettingsWrite(tx, firestore, {
      hostRef,
      hostId: 'host-1',
      changes: [{ path: 'seo.title', value: 'Bakery' }, { path: 'seo.titlePattern', remove: true }],
      now: NOW,
    })
    expect(tx.update).toHaveBeenCalledWith(hostRef, {
      updatedAt: NOW,
      'seo.title': 'Bakery',
      'seo.titlePattern': FieldValue.delete(),
    })
    expect(tx.set).toHaveBeenCalledWith(
      { name: 'publishOutbox', id: outboxId },
      { hostId: 'host-1', paths: ['/'], entireHost: true, createdAt: FieldValue.serverTimestamp(), attempts: 0 },
    )
    expect(outboxId).toEqual(expect.any(String))
  })
})

describe('applySiteSettingsChanges (AGL-4235)', () => {
  it('sets and deletes by dotted path without changing what it was given', () => {
    const stored = { seo: { title: 'Old', titlePattern: 'x' }, business: { address: 'A' } }
    const next = applySiteSettingsChanges(stored, [
      { path: 'seo.title', value: 'New' },
      { path: 'seo.titlePattern', remove: true },
      { path: 'seo.entity.email', value: 'hello@example.com' },
      { path: 'missing.deep', remove: true },
    ])
    expect(next).toEqual({ seo: { title: 'New', entity: { email: 'hello@example.com' } }, business: { address: 'A' } })
    expect(stored).toEqual({ seo: { title: 'Old', titlePattern: 'x' }, business: { address: 'A' } })
  })
})

describe('writeSiteSettings (AGL-4235)', () => {
  it('writes what the plan asks of the stored host, with the outbox entry, in one transaction', async () => {
    const double = settingsFirestoreDouble({ 'hosts/host-1': { seo: { title: 'Old' } } })
    const written = await writeSiteSettings(double.firestore, {
      hostId: 'host-1',
      now: NOW,
      plan: (host) => ({ changes: [{ path: 'seo.title', value: `${(host['seo'] as { title: string }).title}er` }] }),
    })
    expect(written).toEqual({
      ok: true,
      host: { seo: { title: 'Older' }, updatedAt: NOW },
      changed: ['seo.title'],
      outboxId: expect.any(String),
    })
    expect(double.read('hosts/host-1')).toEqual({ seo: { title: 'Older' }, updatedAt: NOW })
    const [[path, entry]] = double.outbox()
    expect(path).toBe(`publishOutbox/${written.ok && written.outboxId}`)
    expect(entry).toEqual({ hostId: 'host-1', paths: ['/'], entireHost: true, createdAt: SERVER_TIMESTAMP, attempts: 0 })
  })

  it('writes nothing and announces nothing when the plan changes nothing', async () => {
    const double = settingsFirestoreDouble({ 'hosts/host-1': { seo: { title: 'Same' } } })
    const written = await writeSiteSettings(double.firestore, { hostId: 'host-1', now: NOW, plan: () => ({ changes: [] }) })
    expect(written).toEqual({ ok: true, host: { seo: { title: 'Same' } }, changed: [], outboxId: null })
    expect(double.writes).toEqual([])
  })

  it('answers a missing site and a refusal without writing', async () => {
    const double = settingsFirestoreDouble({ 'hosts/host-1': {} })
    expect(await writeSiteSettings(double.firestore, { hostId: 'nope', now: NOW, plan: () => ({ changes: [] }) })).toEqual({ ok: false, missing: true })
    expect(await writeSiteSettings(double.firestore, { hostId: 'host-1', now: NOW, plan: () => ({ refuse: 'no' }) })).toEqual({ ok: false, refusal: 'no' })
    expect(double.writes).toEqual([])
  })
})

describe('settleSiteSettingsCache (AGL-4235)', () => {
  it('drops the whole site and releases the entry only when the drop certainly happened', async () => {
    const double = settingsFirestoreDouble({ 'publishOutbox/entry-1': { hostId: 'host-1' } })
    const dropCache = jest.fn(async () => ({ dropped: 1, skipped: 0, complete: true }))
    expect(await settleSiteSettingsCache(double.firestore, { hostId: 'host-1', outboxId: 'entry-1', reason: 'r' }, { dropCache })).toBe(true)
    expect(dropCache).toHaveBeenCalledWith({ hostIds: ['host-1'], reason: 'r' })
    expect(double.read('publishOutbox/entry-1')).toBeUndefined()
  })

  it('leaves the entry for the drain when the drop fell short or threw', async () => {
    for (const dropCache of [
      jest.fn(async () => ({ dropped: 0, skipped: 0, complete: false })),
      jest.fn(async () => {
        throw new Error('down')
      }),
    ]) {
      const double = settingsFirestoreDouble({ 'publishOutbox/entry-1': { hostId: 'host-1' } })
      expect(await settleSiteSettingsCache(double.firestore, { hostId: 'host-1', outboxId: 'entry-1', reason: 'r' }, { dropCache })).toBe(false)
      expect(double.read('publishOutbox/entry-1')).toEqual({ hostId: 'host-1' })
    }
  })
})
