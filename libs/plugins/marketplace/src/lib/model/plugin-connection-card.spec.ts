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

import {
  declaredPluginConnections,
  declaredSyncIntervalHours,
  nextResourceToChoose,
  pluginConnectionNextSyncAtMs,
  pluginConnectionPhase,
  pluginConnectionRedirectUri,
  pluginConnectionSharesText,
  pluginConnectionTooSoonText,
  readPluginConnectionReturn,
} from './plugin-connection-card'
import type { PluginConnectionStatusEntry, PluginConnectionView } from './plugin-connections'

const view = (overrides: Partial<PluginConnectionView> = {}): PluginConnectionView => ({
  listingId: 'listing-1',
  connectionId: 'gbp',
  provider: 'google',
  status: 'connected',
  choices: {},
  ready: false,
  scopes: [],
  connectedAtMs: 1,
  lastSyncAtMs: null,
  lastError: null,
  ...overrides,
})

const entry = (overrides: Partial<PluginConnectionStatusEntry> = {}): PluginConnectionStatusEntry => ({
  listingId: 'listing-1',
  connectionId: 'gbp',
  provider: 'google',
  label: 'Google Business Profile',
  resources: [
    { id: 'accounts', label: 'Account' },
    { id: 'locations', label: 'Location' },
  ],
  connection: null,
  credentialsSet: true,
  planAllows: true,
  hosts: [],
  ...overrides,
})

describe('the connection card model (AGL-4196)', () => {
  it('the redirect URI is the console origin plus the callback route', () => {
    expect(pluginConnectionRedirectUri('https://app.aglyn.com/')).toBe('https://app.aglyn.com/api/plugin-connections/connect/callback')
    expect(pluginConnectionRedirectUri()).toBe('https://app.aglyn.com/api/plugin-connections/connect/callback')
  })

  it('a wait says how long, in plain words', () => {
    expect(pluginConnectionTooSoonText('Google Business Profile', 41_200)).toBe(
      'Google Business Profile synced moments ago. You can sync it again in 42 seconds.',
    )
    expect(pluginConnectionTooSoonText('Google Business Profile', null)).toBe(
      'Google Business Profile synced moments ago. You can sync it again in a minute.',
    )
  })

  it('names where the data goes, or nothing', () => {
    expect(pluginConnectionSharesText(['mybusiness.googleapis.com', 'oauth2.googleapis.com'])).toBe(
      'Shares data with: mybusiness.googleapis.com, oauth2.googleapis.com',
    )
    expect(pluginConnectionSharesText([])).toBeNull()
  })

  it.each([
    [entry(), false, 'not-configured'],
    [entry({ credentialsSet: false }), true, 'not-set-up'],
    [entry(), true, 'not-connected'],
    [entry({ connection: view() }), true, 'choosing'],
    [entry({ connection: view({ ready: true }) }), true, 'connected'],
    [entry({ connection: view({ status: 'reconnect_required' }) }), true, 'reconnect'],
    [entry({ connection: view({ status: 'error' }) }), true, 'error'],
    // A grant outlives the publisher clearing the app: it still reads as what it is.
    [entry({ credentialsSet: false, connection: view({ ready: true }) }), true, 'connected'],
  ] as const)('phase %#', (one, configured, phase) => {
    expect(pluginConnectionPhase(one, configured)).toBe(phase)
  })

  it('picks resources in order', () => {
    expect(nextResourceToChoose(entry())?.id).toBe('accounts')
    expect(nextResourceToChoose(entry({ connection: view({ choices: { accounts: { id: 'a', label: 'A' } } }) }))?.id).toBe('locations')
    expect(
      nextResourceToChoose(
        entry({ connection: view({ choices: { accounts: { id: 'a', label: 'A' }, locations: { id: 'l', label: 'L' } } }) }),
      ),
    ).toBeNull()
  })

  it('reads the outcome for its own listing and cleans only its three parameters', () => {
    const back = readPluginConnectionReturn(
      'https://app.aglyn.com/acme/hosts/x/admin/plugins/listing-1?tab=a&pluginConnectionListing=listing-1&pluginConnection=gbp&pluginConnectionResult=connected#top',
      'listing-1',
    )
    expect(back).toEqual({
      listingId: 'listing-1',
      connectionId: 'gbp',
      result: 'connected',
      cleanUrl: '/acme/hosts/x/admin/plugins/listing-1?tab=a#top',
    })
    expect(
      readPluginConnectionReturn('https://app.aglyn.com/p?pluginConnectionListing=other&pluginConnectionResult=connected', 'listing-1'),
    ).toBeNull()
    expect(
      readPluginConnectionReturn('https://app.aglyn.com/p?pluginConnectionListing=listing-1&pluginConnectionResult=bogus', 'listing-1'),
    ).toBeNull()
  })

  it('next sync: the recorded time, else the last plus the interval, else soon', () => {
    expect(pluginConnectionNextSyncAtMs(view({ ready: true, nextSyncAtMs: 99 } as never), 6)).toBe(99)
    expect(pluginConnectionNextSyncAtMs(view({ ready: true, lastSyncAtMs: 1000 }), 2)).toBe(1000 + 2 * 3_600_000)
    expect(pluginConnectionNextSyncAtMs(view({ ready: true }), 2)).toBe('soon')
    expect(pluginConnectionNextSyncAtMs(view({ ready: false }), 2)).toBeNull()
    expect(pluginConnectionNextSyncAtMs(view({ ready: true, status: 'reconnect_required' }), 2)).toBeNull()
    expect(pluginConnectionNextSyncAtMs(view({ ready: true, status: 'error', lastSyncAtMs: 5 }), 2)).toBeNull()
    expect(pluginConnectionNextSyncAtMs(view({ ready: true, lastSyncAtMs: 5 }), null)).toBeNull()
  })

  it('reads the declared connections and their interval off a pinned manifest, ignoring junk', () => {
    const manifest = {
      connections: [
        { id: 'gbp', label: 'Google Business Profile', description: 'Reviews', sync: { intervalHours: 6 } },
        { id: 'bad' },
        null,
      ],
    }
    expect(declaredPluginConnections(manifest)).toEqual([{ id: 'gbp', label: 'Google Business Profile', description: 'Reviews' }])
    expect(declaredSyncIntervalHours(manifest, 'gbp')).toBe(6)
    expect(declaredSyncIntervalHours(manifest, 'bad')).toBeNull()
    expect(declaredPluginConnections(undefined)).toEqual([])
  })
})
