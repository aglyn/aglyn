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
 * @jest-environment jsdom
 */

const mockGetDoc = jest.fn()
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => path.join('/'),
  getDoc: (path: string) => mockGetDoc(path),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))
jest.mock('next/navigation', () => ({ usePathname: () => '/acme/hosts/main' }))

import { EditorPluginConnectionsContext, type EditorPluginConnections } from '@aglyn/aglyn/app-utils/plugin-connection-editor'
import { render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { EditorConnectionsProvider, loadEditorPluginConnections } from './editor-connections-provider.component'

/**
 * The editor's view of a site's declared connections (AGL-4196): read only on
 * the Besigner and Preview, and quiet about every refusal. No provider and no
 * route is called for real.
 */

const MANIFEST = {
  connections: [
    {
      id: 'gbp',
      provider: 'google',
      label: 'Google Business Profile',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      apiHosts: ['mybusiness.googleapis.com'],
      sync: {
        intervalHours: 6,
        requests: [{ id: 'reviews', method: 'GET', url: 'https://mybusiness.googleapis.com/v4/reviews' }],
        record: { fields: { rating: { type: 'number', path: 'averageRating', request: 'reviews' } } },
      },
    },
  ],
}

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

function Probe() {
  const value = useContext(EditorPluginConnectionsContext)
  return <span data-testid="probe">{value ? value.variables.map((one) => `${one.label}=${one.value}`).join('|') : 'none'}</span>
}

const VALUE: EditorPluginConnections = {
  listingFor: () => null,
  records: {},
  variables: [{ id: 'L__gbp-rating', label: 'Google Business Profile: Rating', value: '4.8' }],
}

describe('EditorConnectionsProvider (AGL-4196)', () => {
  beforeEach(() => mockGetDoc.mockReset())

  it('provides the site’s connections on the Besigner and on Preview', async () => {
    for (const pathname of ['/acme/hosts/main/screens/s1/versions/v1/besigner', '/acme/hosts/main/screens/s1/versions/v1/preview']) {
      const load = jest.fn(async () => VALUE)
      const { unmount } = render(
        <EditorConnectionsProvider orgId="org-1" hostId="host-1" pathname={pathname} load={load}>
          <Probe />
        </EditorConnectionsProvider>,
      )
      await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Google Business Profile: Rating=4.8'))
      expect(load).toHaveBeenCalledWith({ orgId: 'org-1', hostId: 'host-1' })
      unmount()
    }
  })

  it('reads nothing anywhere else in the console', async () => {
    const load = jest.fn(async () => VALUE)
    render(
      <EditorConnectionsProvider orgId="org-1" hostId="host-1" pathname="/acme/hosts/main/admin/plugins" load={load}>
        <Probe />
      </EditorConnectionsProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('none')
    expect(load).not.toHaveBeenCalled()
  })

  it('reads the realm installs, the pins that declare a syncing connection, and each record', async () => {
    mockGetDoc.mockImplementation(async (path: string) => ({
      exists: () => path === 'hosts/host-1/installs/L',
      data: () => ({ manifest: MANIFEST }),
    }))
    const fetcher = jest.fn(async (path: string) => {
      if (path.startsWith('/api/orgs/realm-plugins?')) {
        return json(200, { installs: [{ listingId: 'L', identity: 'acme' }, { listingId: 'M', identity: 'other' }] })
      }
      if (path.startsWith('/api/plugin-connections/record?')) {
        return json(200, { record: { kind: 'record', fields: { rating: 4.8 }, items: [], syncedAtMs: 5 }, planAllows: true })
      }
      return json(404, {})
    })
    const value = await loadEditorPluginConnections({ firestore: {} as never, fetcher }, { orgId: 'org-1', hostId: 'host-1' })
    expect(fetcher).toHaveBeenCalledWith('/api/orgs/realm-plugins?orgId=org-1&hostId=host-1')
    expect(fetcher).toHaveBeenCalledWith('/api/plugin-connections/record?hostId=host-1&listingId=L&connectionId=gbp')
    expect(value?.records).toEqual({ L: { gbp: { fields: { rating: 4.8 }, items: [], syncedAtMs: 5 } } })
    expect(value?.variables).toEqual([{ id: 'L__gbp-rating', label: 'Google Business Profile: Rating', value: '4.8', synced: true }])
    expect(value?.listingFor('acme.wall')).toBe('L')
  })

  it('a refused record (no site key, no plan) is quietly no record, and the variable still lists', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ manifest: MANIFEST }) })
    const fetcher = jest.fn(async (path: string) =>
      path.startsWith('/api/orgs/realm-plugins?') ? json(200, { installs: [{ listingId: 'L', identity: 'acme' }] }) : json(403, { reason: 'permission' }),
    )
    const value = await loadEditorPluginConnections({ firestore: {} as never, fetcher }, { orgId: 'org-1', hostId: 'host-1' })
    expect(value?.records).toEqual({})
    expect(value?.variables).toEqual([{ id: 'L__gbp-rating', label: 'Google Business Profile: Rating', value: null, synced: false }])
  })

  it('a site with no plugin that declares a connection gets nothing', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ manifest: { id: 'plain' } }) })
    const fetcher = jest.fn(async () => json(200, { installs: [{ listingId: 'L', identity: 'acme' }] }))
    await expect(loadEditorPluginConnections({ firestore: {} as never, fetcher }, { orgId: 'o', hostId: 'h' })).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
