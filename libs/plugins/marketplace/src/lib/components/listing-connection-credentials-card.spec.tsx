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
  type PluginConnectionCredentialsAnswer,
  type PluginConnectionCredentialsApi,
} from '../hooks/use-plugin-connections-api'
import ListingConnectionCredentialsCard from './listing-connection-credentials-card.component'

/**
 * The publisher's credentials form (AGL-4196): write-only, "Set" or "Not
 * set" and nothing more, the redirect URI to register, and the publisher key
 * named when it is missing. The routes are a stub.
 */

const render = (ui: ReactElement) => renderBare(<ConfirmationProviderComponent>{ui}</ConfirmationProviderComponent>)

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar }) }))

jest.mock('../hooks/use-plugin-connections-api', () => ({
  ...jest.requireActual('../hooks/use-plugin-connections-api'),
  usePluginConnectionCredentialsApi: () => ({}),
}))

const REFUSAL = 'Your role does not include "Set a listing’s connection credentials" — ask an organization admin'

const answer = (set: boolean, configured = true): PluginConnectionCredentialsAnswer => ({
  configured,
  credentials: [{ connectionId: 'gbp', label: 'Google Business Profile', set, updatedAtMs: set ? Date.UTC(2026, 10, 2) : null }],
})

function stubApi(first: PluginConnectionCredentialsAnswer | Error): jest.Mocked<PluginConnectionCredentialsApi> {
  return {
    read: jest.fn(async () => {
      if (first instanceof Error) throw first
      return first
    }),
    save: jest.fn(async () => answer(true)),
    clear: jest.fn(async () => answer(false)),
  } as unknown as jest.Mocked<PluginConnectionCredentialsApi>
}

const open = (api: PluginConnectionCredentialsApi, permissions?: Record<string, boolean | undefined>) =>
  render(
    <ListingConnectionCredentialsCard
      listingId="listing-1"
      permissions={permissions}
      api={api}
      origin="https://app.aglyn.com"
    />,
  )

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => enqueueSnackbar.mockReset())

describe('ListingConnectionCredentialsCard (AGL-4196)', () => {
  it('draws nothing for a listing whose latest version declares no connection', async () => {
    const api = stubApi({ configured: true, credentials: [] })
    const { container } = open(api)
    await waitFor(() => expect(api.read).toHaveBeenCalledWith('listing-1'))
    expect(container.textContent).toBe('')
  })

  it('not set: says so, shows the redirect URI to register, and offers Set credentials', async () => {
    open(stubApi(answer(false)))
    expect(await screen.findByText('Not set')).toBeTruthy()
    expect((screen.getByLabelText('Redirect URI') as HTMLInputElement).value).toBe(
      'https://app.aglyn.com/api/plugin-connections/connect/callback',
    )
    expect(button('Set credentials').disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('sets the pair: Save stays off until both are entered, then the card says Set and the fields empty', async () => {
    const api = stubApi(answer(false))
    open(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Set credentials' }))
    expect(button('Save').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: ' client-123 ' } })
    expect(button('Save').disabled).toBe(true)
    const secret = screen.getByLabelText('Client secret') as HTMLInputElement
    expect(secret.type).toBe('password')
    fireEvent.change(secret, { target: { value: 'shh' } })
    fireEvent.click(button('Save'))
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp', clientId: 'client-123', clientSecret: 'shh' }),
    )
    expect(await screen.findByText('Set')).toBeTruthy()
    expect(screen.queryByLabelText('Client ID')).toBeNull()
    expect(screen.queryByDisplayValue('shh')).toBeNull()
    expect(enqueueSnackbar).toHaveBeenCalledWith('Google Business Profile credentials saved.', { variant: 'success' })
  })

  it('set: never shows a value, offers Replace and Clear, and Clear asks first', async () => {
    const api = stubApi(answer(true))
    open(api)
    expect(await screen.findByText('Set')).toBeTruthy()
    expect(screen.queryByLabelText('Client ID')).toBeNull()
    expect(button('Replace').disabled).toBe(false)
    fireEvent.click(button('Clear'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(api.clear).toHaveBeenCalledWith({ listingId: 'listing-1', connectionId: 'gbp' }))
    expect(await screen.findByText('Not set')).toBeTruthy()
  })

  it('a refused save keeps the form and says why', async () => {
    const api = stubApi(answer(false))
    api.save.mockRejectedValueOnce(new PluginConnectionRouteError('Enter the OAuth app’s client id and client secret.', 400, null))
    open(api)
    fireEvent.click(await screen.findByRole('button', { name: 'Set credentials' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'y' } })
    fireEvent.click(button('Save'))
    expect(await screen.findByText('Enter the OAuth app’s client id and client secret.')).toBeTruthy()
    expect(screen.getByLabelText('Client ID')).toBeTruthy()
  })

  it('without the publisher key: the card stays, its buttons off, with the permission named', async () => {
    open(stubApi(answer(true)), { 'marketplace.connectionCredentials': false })
    expect(await screen.findByText(REFUSAL)).toBeTruthy()
    expect(button('Replace').disabled).toBe(true)
    expect(button('Clear').disabled).toBe(true)
  })

  it('a route refusal for the key is named the same way', async () => {
    open(stubApi(new PluginConnectionRouteError(REFUSAL, 403, 'permission')))
    expect(await screen.findByText(REFUSAL)).toBeTruthy()
  })

  it('a deployment without the sealing key cannot take credentials yet, and says so', async () => {
    open(stubApi(answer(false, false)))
    expect(await screen.findAllByText('Connecting plugins to other services is not available here yet.')).toBeTruthy()
    expect(button('Set credentials').disabled).toBe(true)
  })
})
