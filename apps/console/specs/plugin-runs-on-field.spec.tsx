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
 * A built-in plugin's "Runs on" field (AGL-4047): read across the sites' own
 * plugin lists, offering All sites and All sites except… (never Selected
 * sites), off with the reason when it can't be changed, and saved through
 * `/api/orgs/plugin-sites`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockFetch = jest.fn()
const mockSnack = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnack }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import PluginRunsOnField, { type PluginRunsOnFieldProps } from '../components/plugin-runs-on-field.component'

const org = { enabledPlugins: ['crm', 'commerce', 'accounts', 'forms'] }
const sites = [
  { id: 'a', name: 'Bakery', enabledPlugins: ['accounts'] },
  { id: 'b', name: 'Cafe', disabledPlugins: ['crm'] },
  { id: 'c', name: 'Deli' },
]

const field = (props: Partial<PluginRunsOnFieldProps> = {}) =>
  render(
    <PluginRunsOnField
      orgId="o1"
      pluginId="crm"
      org={org}
      sites={sites}
      sitesReady
      onForWorkspace
      permissionsLoaded
      canChange
      {...props}
    />,
  )

const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

beforeEach(() => {
  mockFetch.mockReset()
  mockSnack.mockReset()
})

describe('PluginRunsOnField', () => {
  it('reads the sites whose own lists switch it off as the ones left out', () => {
    field()
    expect(radio(/^All sites except/).checked).toBe(true)
    expect(box('Cafe').checked).toBe(true)
    expect(box('Bakery').checked).toBe(false)
  })

  it('offers All sites and All sites except…, never Selected sites', () => {
    field()
    expect(screen.queryByRole('radio', { name: /Selected sites/ })).toBeNull()
    expect(radio(/^All sites$/)).toBeTruthy()
  })

  it('says plainly that a site left out can turn it back on for itself', () => {
    field()
    expect(
      screen.getByText(/A site left out can turn it back on for itself: anyone holding “Manage site settings”/),
    ).toBeTruthy()
  })

  it('saves the choice through the route and says so', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    field()
    fireEvent.click(box('Deli'))
    expect(screen.getByText('Takes CRM off 1 site.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/orgs/plugin-sites')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'o1',
      pluginId: 'crm',
      choice: { mode: 'allExcept', exceptHostIds: ['b', 'c'] },
    })
    await waitFor(() => expect(mockSnack).toHaveBeenCalledWith('Saved where CRM runs', expect.anything()))
  })

  it('shows the route’s refusal, and keeps the choice', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'On Deli: no' }) })
    field()
    fireEvent.click(box('Deli'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('On Deli: no')).toBeTruthy()
    expect(box('Deli').checked).toBe(true)
  })

  it('refuses before saving what would strand a plugin on a site', () => {
    field({ pluginId: 'commerce' })
    fireEvent.click(radio(/^All sites except/))
    fireEvent.click(box('Bakery'))
    expect(
      screen.getByText('User Accounts on Bakery needs Commerce. Switch it off on that site first, or keep the site in.'),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is off with the permission named for a member without "Organization settings"', () => {
    field({ canChange: false })
    expect(
      screen.getByText('Your role does not include "Organization settings" — ask an organization admin'),
    ).toBeTruthy()
    expect(radio(/^All sites$/).disabled).toBe(true)
  })

  it('names no refusal while the permissions load', () => {
    field({ canChange: false, permissionsLoaded: false })
    expect(screen.queryByText(/Your role does not include/)).toBeNull()
    expect(radio(/^All sites$/).disabled).toBe(true)
  })

  it('is off with the reason when the workspace has it switched off', () => {
    field({ onForWorkspace: false })
    expect(screen.getByText(/switched off for this workspace, so it runs on no site/)).toBeTruthy()
  })

  it('with one site, All sites except… is off with the reason', () => {
    field({ sites: [{ id: 'a', name: 'Bakery' }] })
    expect(radio(/^All sites except/).disabled).toBe(true)
    expect(screen.getByText('This workspace has one site, so there is nothing to leave out.')).toBeTruthy()
  })

  it('says a site’s opt-in still decides for User Accounts', () => {
    field({ pluginId: 'accounts' })
    expect(screen.getByText(/User Accounts still runs only on the sites that turned it on/)).toBeTruthy()
  })

  it('says what leaving a site out stops, for a plugin that declares it', () => {
    field({ pluginId: 'forms', sites: [...sites.slice(0, 2), { id: 'c', name: 'Deli', disabledPlugins: ['forms'] }] })
    expect(screen.getByText(/^On each site left out: Switching Forms off for this site stops forms rendering/)).toBeTruthy()
  })
})
