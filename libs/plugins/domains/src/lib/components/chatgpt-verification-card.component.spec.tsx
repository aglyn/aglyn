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
 * "Verify with ChatGPT" on a site's SEO setup: the record is added from a
 * paste when the site's domain keeps its DNS here, and the card says where it
 * goes when it doesn't.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

import ChatgptVerificationCard from './chatgpt-verification-card.component'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
const VALUE = 'openai-business-claim=pMWmOoxSrczpNWx3baISGFkU5Xl33YxUTyJjCdG1TFk'
const OURS = { ours: true, nameservers: ['ns1.vercel-dns.com'], siteConnected: true, records: [] }
const EXISTING = {
  id: 'rec_9',
  type: 'TXT',
  name: 'openai-business-claim',
  value: 'openai-business-claim=anOlderValue0123456789',
  ttl: 60,
  priority: null,
  managed: false,
  editable: true,
}

/** GETs answer `listed` (with `status`); a POST answers ok. */
function answers(listed: unknown, status = 200) {
  mockFetch.mockImplementation(async (_user: unknown, _url: string, init: RequestInit = {}) =>
    init.method === 'POST' ? json({ ok: true }) : json(listed, status),
  )
}

const gets = () => mockFetch.mock.calls.filter(([, , init]) => (init as RequestInit | undefined)?.method !== 'POST')
const posts = () => mockFetch.mock.calls.filter(([, , init]) => (init as RequestInit | undefined)?.method === 'POST')
const sent = () => JSON.parse(String((posts()[0][2] as RequestInit).body))
const card = (connectedDomain: string | null) => (
  <ChatgptVerificationCard hostId="h1" orgId="org-1" orgSlug="acme" host="bakery" connectedDomain={connectedDomain} />
)
const paste = (text: string) =>
  fireEvent.change(screen.getByLabelText('Value from ChatGPT'), { target: { value: text } })

beforeEach(() => mockFetch.mockReset())

describe('Verify with ChatGPT card', () => {
  it('adds the record from a paste when the domain’s DNS is kept here', async () => {
    answers(OURS)
    render(card('www.testbakery.com'))
    await waitFor(() => expect(gets()).toHaveLength(1))
    expect(String(gets()[0][1])).toContain('domain=testbakery.com')
    fireEvent.click(screen.getByRole('button', { name: 'Verify testbakery.com' }))
    paste(`"${VALUE}"`)
    fireEvent.click(await screen.findByRole('button', { name: 'Add record' }))
    expect(await screen.findByText(/choose Verify domain\. If ChatGPT/)).toBeTruthy()
    expect(sent()).toEqual({
      orgId: 'org-1',
      domain: 'testbakery.com',
      action: 'create',
      record: { type: 'TXT', name: 'openai-business-claim', value: VALUE, ttl: 60 },
    })
  })

  it('says the domain is verified already, and replaces the record with a new value', async () => {
    answers({ ...OURS, records: [EXISTING] })
    render(card('testbakery.com'))
    expect(await screen.findByText(/testbakery\.com has a ChatGPT verification record/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verify testbakery.com' }))
    paste(VALUE)
    fireEvent.click(screen.getByRole('button', { name: 'Replace record' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(sent()).toMatchObject({ action: 'update', recordId: 'rec_9' })
  })

  it('writes nothing for a paste that is not ChatGPT’s value', async () => {
    answers(OURS)
    render(card('testbakery.com'))
    await waitFor(() => expect(gets()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Verify testbakery.com' }))
    paste('google-site-verification=abc')
    fireEvent.click(await screen.findByRole('button', { name: 'Add record' }))
    expect(await screen.findByText(/doesn’t look like ChatGPT’s value/)).toBeTruthy()
    expect(posts()).toHaveLength(0)
  })

  it('says where the record goes for a domain that isn’t held here', async () => {
    answers({ error: 'That domain isn’t one this workspace holds here.' }, 404)
    render(card('testbakery.com'))
    await waitFor(() => expect(gets()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Verify testbakery.com' }))
    expect(await screen.findByText(/keeps its DNS with another provider/)).toBeTruthy()
    expect(screen.queryByLabelText('Value from ChatGPT')).toBeNull()
    expect(posts()).toHaveLength(0)
  })

  it('asks a site on its free address to connect a domain first', () => {
    answers(OURS)
    render(card(null))
    expect(screen.getByText(/Connect a domain first/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Verify / })).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
