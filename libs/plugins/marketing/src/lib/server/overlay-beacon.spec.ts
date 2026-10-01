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
 * What an overlay beacon counts, once the site collector has handed it here.
 * Which beacons reach this plugin, after which gates, is the collector's own
 * spec (`apps/tenant/specs/analytics-collect.spec.ts`).
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (by: number) => ({ __increment: by }) },
}))

import { pluginSiteBeaconFor } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerMarketingServerDeclarations } from '../declarations.server'
import { countOverlayBeacon, OVERLAY_BEACON_EVENTS } from './overlay-beacon'

const HOST = 'host-1'
const DAY = '2026-09-30'
const EXPIRES = new Date('2027-03-29T00:00:00.000Z')

type Write = { path: string; kind: 'set' | 'update'; data: Record<string, unknown>; merge?: boolean }

/** Records every write; `update` on a document not in `existing` throws, as Firestore's does. */
function firestoreRecording(existing: string[] = []) {
  const writes: Write[] = []
  const docAt = (path: string): any => ({
    collection: (name: string) => ({ doc: (id: string) => docAt(`${path}/${name}/${id}`) }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push({ path, kind: 'set', data, merge: options?.merge })
    },
    update: async (data: Record<string, unknown>) => {
      if (!existing.includes(path)) throw new Error(`no document at ${path}`)
      writes.push({ path, kind: 'update', data })
    },
  })
  const firestore = {
    collection: (name: string) => ({ doc: (id: string) => docAt(`${name}/${id}`) }),
  } as unknown as FirebaseFirestore.Firestore
  return { firestore, writes }
}

const request = (body: Record<string, unknown>) => ({
  hostId: HOST,
  day: DAY,
  dayExpiresAt: EXPIRES,
  body,
})

describe('an overlay beacon', () => {
  it('counts the event on the site’s day, stamped with the platform’s expiry', async () => {
    const { firestore, writes } = firestoreRecording()
    await countOverlayBeacon(request({ overlay: 'barImpression' }), firestore)
    expect(writes).toEqual([
      {
        path: `hosts/${HOST}/analytics/${DAY}`,
        kind: 'set',
        data: { overlays: { barImpression: { __increment: 1 } }, expiresAt: EXPIRES },
        merge: true,
      },
    ])
  })

  it('counts on the overlay’s own document too, by the kind of event', async () => {
    const overlayPath = `hosts/${HOST}/overlays/bar-1`
    const { firestore, writes } = firestoreRecording([overlayPath])
    for (const event of ['popupImpression', 'barClick', 'popupDismiss']) {
      await countOverlayBeacon(request({ overlay: event, overlayId: 'bar-1' }), firestore)
    }
    expect(writes.filter((write) => write.kind === 'update').map((write) => write.data)).toEqual([
      { 'stats.impressions': { __increment: 1 } },
      { 'stats.clicks': { __increment: 1 } },
      { 'stats.dismissals': { __increment: 1 } },
    ])
  })

  it('does not resurrect a deleted overlay as a stats-only document', async () => {
    const { firestore, writes } = firestoreRecording()
    await expect(
      countOverlayBeacon(request({ overlay: 'popupClick', overlayId: 'gone' }), firestore),
    ).resolves.toBeUndefined()
    expect(writes.map((write) => write.kind)).toEqual(['set'])
  })

  it('counts nothing for an event it does not know, or an overlay id past the ceiling', async () => {
    const { firestore, writes } = firestoreRecording([`hosts/${HOST}/overlays/${'x'.repeat(65)}`])
    await countOverlayBeacon(request({ overlay: 'popupHover' }), firestore)
    expect(writes).toEqual([])
    await countOverlayBeacon(request({ overlay: 'barImpression', overlayId: 'x'.repeat(65) }), firestore)
    expect(writes.map((write) => write.kind)).toEqual(['set'])
  })

  it('knows the six events the bar and the popup report', () => {
    expect([...OVERLAY_BEACON_EVENTS].sort()).toEqual(
      ['barClick', 'barDismiss', 'barImpression', 'popupClick', 'popupDismiss', 'popupImpression'],
    )
  })
})

describe('registration', () => {
  afterEach(() => resetPluginServicesForTests())

  it('claims the `overlay` beacon field from the server declarations', () => {
    registerMarketingServerDeclarations()
    expect(pluginSiteBeaconFor({ overlay: 'barImpression' })?.pluginId).toBe('marketing')
    expect(pluginSiteBeaconFor({ path: '/' })).toBeNull()
  })
})
