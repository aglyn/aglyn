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

import ConfirmationProviderComponent from '@aglyn/shared-ui-jsx/components/confirmation-provider.component'
import { fireEvent, render as renderBare, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import {
  PluginConnectionRouteError,
  type PluginConnectionsApi,
  type PluginConnectionsStatusAnswer,
} from '../hooks/use-plugin-connections-api'
import type { PluginConnectionStatusEntry, PluginConnectionView } from '../model/plugin-connections'
import SitePluginConnectionsCard from './site-plugin-connections-card.component'

/**
 * The generic site connection card (AGL-4196): one card per connection the
 * pinned manifest declares, in every state the status route can answer, with
 * every prerequisite on screen. The routes are a stub; no provider is called.
 */

const render = (ui: ReactElement) => renderBare(<ConfirmationProviderComponent>{ui}</ConfirmationProviderComponent>)

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar }) }))

const mockBlockedKeys = new Set<string>()
jest.mock('@aglyn/tenant-feature-instance/hooks/use-site-keys', () => ({
  useSiteKeys: () => ({ blocked: (key: string) => mockBlockedKeys.has(key) }),
}))

jest.mock('../hooks/use-plugin-connections-api', () => ({
  ...jest.requireActual('../hooks/use-plugin-connections-api'),
  usePluginConnectionsApi: () => ({}),
}))

const PERMISSION_REFUSAL = 'Your role does not include "Manage a site’s plugin connections" — ask an organization admin'
const PLAN_REFUSAL = 'Connecting a plugin to another service comes with the Starter, Pro and Custom plans.'

const PIN = {
  version: '1.2.0',
  displayName: 'Review Wall',
  manifest: {
    id: 'review-wall',
    connections: [
      {
        id: 'gbp',
        provider: 'google',
        label: 'Google Business Profile',
        description: 'Your reviews and rating.',
        sync: { intervalHours: 6 },
      },
    ],
  },
}

const RESOURCES = [
  { id: 'accounts', label: 'Account' },
  { id: 'locations', label: 'Location' },
]

function view(overrides: Partial<PluginConnectionView> = {}): PluginConnectionView {
  return {
    listingId: 'listing-1',
    connectionId: 'gbp',
    provider: 'google',
    status: 'connected',
    choices: {
      accounts: { id: 'accounts/1', label: 'Candle Co' },
      locations: { id: 'locations/9', label: 'Main Street' },
    },
    ready: true,
    scopes: ['business.manage'],
    connectedAtMs: Date.UTC(2026, 10, 1),
    lastSyncAtMs: Date.UTC(2026, 10, 5, 12),
    lastError: null,
    ...overrides,
  }
}

function entry(overrides: Partial<PluginConnectionStatusEntry> = {}): PluginConnectionStatusEntry {
  return {
    listingId: 'listing-1',
    connectionId: 'gbp',
    provider: 'google',
    label: 'Google Business Profile',
    description: 'Your reviews and rating.',
    resources: RESOURCES,
    connection: null,
    credentialsSet: true,
    planAllows: true,
    hosts: ['accounts.google.com', 'mybusiness.googleapis.com', 'oauth2.googleapis.com'],
    ...overrides,
  }
}

function status(one: Partial<PluginConnectionStatusEntry> = {}, top: Partial<PluginConnectionsStatusAnswer> = {}) {
  return { configured: true, planAllows: true, connections: [entry(one)], ...top }
}

function stubApi(answer: PluginConnectionsStatusAnswer | Error): jest.Mocked<PluginConnectionsApi> {
  return {
    status: jest.fn(async () => {
      if (answer instanceof Error) throw answer
      return answer
    }),
    connectStart: jest.fn(async () => ({ authorizeUrl: 'https://accounts.example.com/o/oauth2/auth?state=s' })),
    resources: jest.fn(async ({ resource }: { resource: string }) => ({
      items:
        resource === 'accounts'
          ? [
              { id: 'accounts/1', label: 'Candle Co' },
              { id: 'accounts/2', label: 'Wax Works' },
            ]
          : [{ id: 'locations/9', label: 'Main Street' }],
    })),
    choose: jest.fn(),
    sync: jest.fn(),
    disconnect: jest.fn(async () => ({ connection: null })),
  } as unknown as jest.Mocked<PluginConnectionsApi>
}

const navigate = jest.fn()

const open = (api: PluginConnectionsApi, pin: Record<string, unknown> | null = PIN) =>
  render(
    <SitePluginConnectionsCard hostId="host-1" orgSlug="acme" pluginRef="listing-1" pin={pin} api={api} navigate={navigate} />,
  )

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const findButton = async (name: string | RegExp) => (await screen.findByRole('button', { name })) as HTMLButtonElement

beforeEach(() => {
  enqueueSnackbar.mockReset()
  navigate.mockReset()
  mockBlockedKeys.clear()
  window.history.replaceState(null, '', '/acme/hosts/main/admin/plugins/listing-1')
})

describe('SitePluginConnectionsCard (AGL-4196)', () => {
  it('draws nothing for a plugin whose manifest declares no connection, and asks nothing', () => {
    const api = stubApi(status())
    const { container } = open(api, { version: '1.0.0', manifest: { id: 'plain' } })
    expect(container.textContent).toBe('')
    expect(api.status).not.toHaveBeenCalled()
  })

  it('reads the status for this site and listing', async () => {
    const api = stubApi(status())
    open(api)
    await findButton('Connect')
    expect(api.status).toHaveBeenCalledWith('listing-1')
  })

  it('not connected: Connect sends the browser to the provider, returning to this page', async () => {
    const api = stubApi(status())
    open(api)
    expect(await screen.findByText('Not connected')).toBeTruthy()
    expect(screen.getByText(/Connect Google Business Profile so Review Wall can use it on this site/)).toBeTruthy()
    fireEvent.click(button('Connect'))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://accounts.example.com/o/oauth2/auth?state=s'))
    expect(api.connectStart).toHaveBeenCalledWith({
      listingId: 'listing-1',
      connectionId: 'gbp',
      returnTo: 'http://localhost/acme/hosts/main/admin/plugins/listing-1',
    })
  })

  it('not set up by the publisher: shown, with Connect off and the reason said', async () => {
    open(stubApi(status({ credentialsSet: false })))
    expect(await screen.findByText('Waiting on the publisher')).toBeTruthy()
    expect(screen.getAllByText(/has not finished setting up Google Business Profile yet/).length).toBeGreaterThan(0)
    expect(button('Connect').disabled).toBe(true)
  })

  it('deployment not configured: shown, with Connect off and the reason said', async () => {
    open(stubApi(status({}, { configured: false })))
    expect(await screen.findByText('Not available yet')).toBeTruthy()
    expect(screen.getAllByText('Connecting plugins to other services is not available here yet.').length).toBeGreaterThan(0)
    expect(button('Connect').disabled).toBe(true)
  })

  it('Free plan: the card stays, disabled, with the reason and an upgrade link', async () => {
    open(stubApi(status({ planAllows: false }, { planAllows: false })))
    expect(await screen.findByText(PLAN_REFUSAL)).toBeTruthy()
    expect(button('Connect').disabled).toBe(true)
    const upgrade = screen.getByText('Upgrade').closest('a')
    expect(upgrade?.getAttribute('href')).toBe('/acme/billing#plans')
  })

  it('Free plan with a connection left over: Sync and Change are off, Disconnect still works', async () => {
    const api = stubApi(status({ planAllows: false, connection: view() }, { planAllows: false }))
    open(api)
    expect(await screen.findByText(`${PLAN_REFUSAL} You can still disconnect it.`)).toBeTruthy()
    expect(button('Sync now').disabled).toBe(true)
    expect(button('Change').disabled).toBe(true)
    expect(button('Disconnect').disabled).toBe(false)
  })

  it('without the site key: the permission is named, never a role, and Connect is off', async () => {
    mockBlockedKeys.add('marketplace.siteConnections')
    open(stubApi(status()))
    expect(await screen.findByText(PERMISSION_REFUSAL)).toBeTruthy()
    expect(button('Connect').disabled).toBe(true)
  })

  it('a status refusal for the key reads the same way', async () => {
    open(stubApi(new PluginConnectionRouteError(PERMISSION_REFUSAL, 403, 'permission')))
    expect(await screen.findByText(PERMISSION_REFUSAL)).toBeTruthy()
    expect(button('Connect').disabled).toBe(true)
    expect(screen.getByText('Google Business Profile')).toBeTruthy()
  })

  it('a status that fails for another reason says so, with Try again', async () => {
    const api = stubApi(new PluginConnectionRouteError('Site not found', 404, null))
    open(api)
    expect(await screen.findByText('Site not found')).toBeTruthy()
    fireEvent.click(button('Try again'))
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(2))
  })

  it('connected, picking each resource in order: the first, then the next', async () => {
    const api = stubApi(status({ connection: view({ choices: {}, ready: false, lastSyncAtMs: null }) }))
    api.choose.mockResolvedValueOnce({
      connection: view({ choices: { accounts: { id: 'accounts/2', label: 'Wax Works' } }, ready: false, lastSyncAtMs: null }),
    })
    open(api)
    expect(await screen.findByText('Finish setting up')).toBeTruthy()
    await waitFor(() => expect(api.resources).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp', resource: 'accounts' }))
    expect(button('Use this account').disabled).toBe(true)
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Wax Works' }))
    fireEvent.click(button('Use this account'))
    await waitFor(() =>
      expect(api.choose).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp', resource: 'accounts', id: 'accounts/2' }),
    )
    // The next resource is asked for, and its one item is preselected.
    await waitFor(() => expect(api.resources).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp', resource: 'locations' }))
    await waitFor(() => expect(button('Use this location').disabled).toBe(false))
  })

  it('connected: shows the choices, last sync and next sync, with Sync now, Change and Disconnect', async () => {
    const api = stubApi(status({ connection: view() }))
    api.sync.mockResolvedValueOnce({ connection: view({ lastSyncAtMs: Date.UTC(2026, 10, 6) }), synced: true })
    open(api)
    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByText('Candle Co')).toBeTruthy()
    expect(screen.getByText('Main Street')).toBeTruthy()
    expect(screen.getByText(/^Last synced /)).toBeTruthy()
    expect(screen.getByText(/^Next sync /)).toBeTruthy()
    fireEvent.click(button('Sync now'))
    await waitFor(() => expect(api.sync).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp' }))
    expect(enqueueSnackbar).toHaveBeenCalledWith('Google Business Profile is up to date.', { variant: 'success' })
    expect(screen.getByText('Shares data with: accounts.google.com, mybusiness.googleapis.com, oauth2.googleapis.com')).toBeTruthy()
  })

  it('a sync the provider refused comes back as the error state, said as a warning', async () => {
    const api = stubApi(status({ connection: view() }))
    api.sync.mockResolvedValueOnce({ connection: view({ status: 'error', lastError: 'The provider answered 503' }), synced: false })
    open(api)
    fireEvent.click(await findButton('Sync now'))
    expect(await screen.findByText('Sync failed')).toBeTruthy()
    expect(enqueueSnackbar).toHaveBeenCalledWith('Google Business Profile did not sync. See why below.', { variant: 'warning' })
  })

  it('Sync now within a minute of the last one is a plain-words wait, not an error', async () => {
    const api = stubApi(status({ connection: view() }))
    api.sync.mockRejectedValueOnce(
      new PluginConnectionRouteError('Google Business Profile synced less than a minute ago.', 429, 'too-soon', {
        retryAfterMs: 30_000,
        connection: view(),
      }),
    )
    open(api)
    fireEvent.click(await findButton('Sync now'))
    expect(await screen.findByText('Google Business Profile synced moments ago. You can sync it again in 30 seconds.')).toBeTruthy()
    expect(screen.queryByText('Google Business Profile synced less than a minute ago.')).toBeNull()
  })

  it('a pinned version that declares no sync offers no Sync now and no sync times', async () => {
    const pin = { ...PIN, manifest: { id: 'review-wall', connections: [{ id: 'gbp', label: 'Google Business Profile' }] } }
    open(stubApi(status({ connection: view() })), pin)
    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
    expect(screen.queryByText(/^Last synced /)).toBeNull()
    expect(button('Disconnect')).toBeTruthy()
  })

  it('a sync the route does not serve yet is an error on the card, not a crash', async () => {
    const api = stubApi(status({ connection: view() }))
    api.sync.mockRejectedValueOnce(new PluginConnectionRouteError('That did not work. Try again.', 404, null))
    open(api)
    fireEvent.click(await findButton('Sync now'))
    expect(await screen.findByText('That did not work. Try again.')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('Change walks the resources again from the first', async () => {
    const api = stubApi(status({ connection: view() }))
    open(api)
    fireEvent.click(await findButton('Change'))
    await waitFor(() => expect(api.resources).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp', resource: 'accounts' }))
    expect(button('Cancel')).toBeTruthy()
    fireEvent.click(button('Cancel'))
    expect(screen.queryByRole('button', { name: 'Use this account' })).toBeNull()
  })

  it('Disconnect asks first, then forgets the connection', async () => {
    const api = stubApi(status({ connection: view() }))
    open(api)
    fireEvent.click(await findButton('Disconnect'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Disconnect Google Business Profile?')).toBeTruthy()
    expect(within(dialog).getByText(/what it last brought in is removed from the site/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp' }))
    expect(await screen.findByText('Not connected')).toBeTruthy()
  })

  it('reconnect required: says so, with Reconnect', async () => {
    const api = stubApi(status({ connection: view({ status: 'reconnect_required' }) }))
    open(api)
    expect(await screen.findByText('Reconnect needed')).toBeTruthy()
    expect(screen.getByText(/no longer accepts this connection/)).toBeTruthy()
    fireEvent.click(button('Reconnect'))
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })

  it('error: a provider sentence that ends in a period is not given a second one', async () => {
    open(stubApi(status({ connection: view({ status: 'error', lastError: 'Google Business Profile did not answer: Internal error encountered.' }) })))
    expect(await screen.findByText('Sync failed')).toBeTruthy()
    expect(
      screen.getByText(
        'The last sync did not work: Google Business Profile did not answer: Internal error encountered. It tries again on schedule, or you can sync now.',
      ),
    ).toBeTruthy()
  })

  it('a plan without connections shows no next sync, which the schedule would never run', async () => {
    open(stubApi(status({ planAllows: false, connection: view() }, { planAllows: false })))
    expect(await screen.findByText('Connected')).toBeTruthy()
    expect(screen.getByText(/^Last synced /)).toBeTruthy()
    expect(screen.queryByText(/^Next sync/)).toBeNull()
  })

  it('error: the last error and Sync now', async () => {
    open(stubApi(status({ connection: view({ status: 'error', lastError: 'The provider answered 503' }) })))
    expect(await screen.findByText('Sync failed')).toBeTruthy()
    expect(screen.getByText(/The last sync did not work: The provider answered 503/)).toBeTruthy()
    expect(button('Sync now').disabled).toBe(false)
  })

  it('coming back from the provider: a snackbar says what happened and the address is cleaned', async () => {
    window.history.replaceState(
      null,
      '',
      '/acme/hosts/main/admin/plugins/listing-1?tab=x&pluginConnectionListing=listing-1&pluginConnection=gbp&pluginConnectionResult=connected',
    )
    open(stubApi(status({ connection: view({ choices: {}, ready: false }) })))
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalledWith('Connected Google Business Profile.', { variant: 'success' }))
    expect(window.location.search).toBe('?tab=x')
  })

  it('a refused consent says nothing was connected', async () => {
    window.history.replaceState(
      null,
      '',
      '/acme/hosts/main/admin/plugins/listing-1?pluginConnectionListing=listing-1&pluginConnection=gbp&pluginConnectionResult=denied',
    )
    open(stubApi(status()))
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith('Access to Google Business Profile was not granted, so nothing was connected.', {
        variant: 'warning',
      }),
    )
    expect(window.location.search).toBe('')
  })

  it("another listing's outcome is left for its own card", async () => {
    window.history.replaceState(
      null,
      '',
      '/acme/hosts/main/admin/plugins/listing-1?pluginConnectionListing=listing-2&pluginConnection=gbp&pluginConnectionResult=connected',
    )
    open(stubApi(status()))
    await findButton('Connect')
    expect(enqueueSnackbar).not.toHaveBeenCalled()
    expect(window.location.search).toContain('pluginConnectionListing=listing-2')
  })
})
