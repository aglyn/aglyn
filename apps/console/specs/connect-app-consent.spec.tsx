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
 * The consent screen (AGL-4225): what a person is shown, what they may pick,
 * and the one rule that matters most — the page goes only where the consent
 * route sends it, never to an address it read from its own query.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'user-1' } }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/background-image.component', () => ({
  BackgroundImageComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import ConnectAppConsent from '../components/connect-app-consent.component'

const assign = jest.fn()
const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

const DESCRIPTION = {
  app: { name: 'Claude', returnsTo: 'claude.ai', local: false },
  workspaces: [
    { orgId: 'org-1', name: 'Acme', slug: 'acme', entitled: true },
    { orgId: 'org-2', name: 'Side Project', slug: 'side', entitled: false },
  ],
  access: [
    { level: 'view', areas: [{ area: 'Contacts', abilities: ['See your contacts'] }] },
    { level: 'change', areas: [{ area: 'Contacts', abilities: ['See your contacts', 'Add, edit and delete contacts'] }] },
  ],
}

beforeEach(() => {
  mockFetch.mockReset()
  assign.mockReset()
  window.history.replaceState(null, '', '/oauth/authorize?client_id=c&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&state=s')
})

const bodyOf = (call: unknown[]) => JSON.parse((call[2] as { body: string }).body)

describe('the consent screen (AGL-4225)', () => {
  it('names the app and where it goes back to, and offers both levels in plain words', async () => {
    mockFetch.mockResolvedValueOnce(answer(200, DESCRIPTION))
    render(<ConnectAppConsent navigate={assign} />)
    expect(await screen.findByText('Connect Claude')).toBeTruthy()
    expect(screen.getByText(/go back to claude\.ai/)).toBeTruthy()
    expect(screen.getByLabelText('View only')).toBeTruthy()
    expect(screen.getByLabelText('View and make changes')).toBeTruthy()
    expect(screen.getByText('See your contacts')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/oauth|scope|token|grant/i)
    // The request is forwarded verbatim for the server to judge.
    expect(bodyOf(mockFetch.mock.calls[0])).toEqual({
      action: 'describe',
      query: 'client_id=c&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&state=s',
    })
  })

  it('shows a workspace without the plan, but it cannot be chosen', async () => {
    mockFetch.mockResolvedValueOnce(answer(200, DESCRIPTION))
    render(<ConnectAppConsent navigate={assign} />)
    const side = (await screen.findByLabelText('Side Project')) as HTMLInputElement
    expect(side.disabled).toBe(true)
    expect(screen.getByText('See plans').closest('a')?.getAttribute('href')).toBe('/side/billing#plans')
    expect((screen.getByLabelText('Acme') as HTMLInputElement).checked).toBe(true)
  })

  it('sends Allow with the chosen workspace and level, and follows only the address returned', async () => {
    mockFetch
      .mockResolvedValueOnce(answer(200, DESCRIPTION))
      .mockResolvedValueOnce(answer(200, { redirectTo: 'https://claude.ai/api/mcp/auth_callback?code=c&state=s' }))
    render(<ConnectAppConsent navigate={assign} />)
    fireEvent.click(await screen.findByLabelText('View and make changes'))
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://claude.ai/api/mcp/auth_callback?code=c&state=s'))
    expect(bodyOf(mockFetch.mock.calls[1])).toMatchObject({ action: 'allow', orgId: 'org-1', access: 'change' })
  })

  it('never navigates on a request the server refused to trust', async () => {
    mockFetch.mockResolvedValueOnce(answer(400, { error: 'invalid_redirect_uri', reason: 'invalid_redirect_uri' }))
    render(<ConnectAppConsent navigate={assign} />)
    expect(await screen.findByText('This link can’t connect an app')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })
})
