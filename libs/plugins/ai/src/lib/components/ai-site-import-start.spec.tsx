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
 * Bring my site's read step asks how the new site should look (AGL-4152):
 * Improve it preselected with Also improve my wording on, Keep my site one
 * click away, and the job the read starts carries the answer.
 */

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/acme/hosts/harbor',
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { AiSiteImportStart } from './ai-site-import-start.component'

const user = { uid: 'u1', getIdToken: async () => 'tok' }
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

const claim = {
  domain: 'harbor-dental.com',
  status: 'proven',
  current: true,
  provenMethod: 'dns',
  provenAt: 1,
  provenDetail: null,
  lastChecks: {},
  dns: { host: '_aglyn-challenge.harbor-dental.com', type: 'TXT', value: 'aglyn-domain-verification=t' },
  meta: { name: 'aglyn-site-verification', content: 't', tag: '<meta name="aglyn-site-verification" content="t">' },
  email: { domain: 'harbor-dental.com', pendingAddress: null, expiresAt: null, attemptsLeft: null },
}

let mockFetch: jest.Mock
beforeEach(() => {
  mockPush.mockReset()
  mockFetch = jest.fn()
  global.fetch = mockFetch as unknown as typeof fetch
})

/** The read step, reached as a person reaches it: the address typed, a site already proved. */
async function atTheRead(generative = false) {
  const view = render(<AiSiteImportStart orgId="org-1" orgSlug="acme" hostId="host-1" host="harbor" user={user} onBack={jest.fn()} generative={generative} />)
  fireEvent.change(screen.getByLabelText('Website address'), { target: { value: 'harbor-dental.com' } })
  mockFetch.mockResolvedValueOnce(json({ claim }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Bring in harbor-dental.com' })
  return view
}

/** What the read's POST asked for. */
async function readMySite(): Promise<Record<string, unknown>> {
  mockFetch.mockResolvedValueOnce(json({ job: { id: 'job-1', orgId: 'org-1', hostId: 'host-1', kind: 'import', status: 'queued' } }))
  fireEvent.click(screen.getByRole('button', { name: 'Read my site' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
  const [path, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
  expect(path).toBe('/api/ai/jobs')
  return JSON.parse(init.body)
}

describe('how should your new site look?', () => {
  it('preselects Improve it with Also improve my wording on, and says what each means and what the wording adds', async () => {
    await atTheRead()
    expect(screen.getByRole('radiogroup', { name: 'How should your new site look?' })).toBeTruthy()
    expect((screen.getByRole('radio', { name: /^Improve it/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: /^Keep my site/ }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('switch', { name: 'Also improve my wording' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('About 25 more AI credits for each main page.')).toBeTruthy()
    expect(screen.getByText('You can change this before each wave.')).toBeTruthy()
  })

  it('starts the read with Improve it and the wording, as preselected', async () => {
    await atTheRead()
    const body = await readMySite()
    expect(body).toMatchObject({ orgId: 'org-1', hostId: 'host-1', kind: 'import', inputs: { domain: 'harbor-dental.com', finish: 'improve', wording: true } })
    expect(mockPush).toHaveBeenCalledWith('/acme/hosts/harbor/ai-jobs/job-1')
  })

  it('starts it with Improve it alone when the wording is switched off', async () => {
    await atTheRead()
    fireEvent.click(screen.getByRole('switch', { name: 'Also improve my wording' }))
    const body = await readMySite()
    expect(body['inputs']).toEqual({ domain: 'harbor-dental.com', finish: 'improve', wording: false })
  })

  it('starts it with Keep my site, which rewords nothing and shows no wording switch', async () => {
    await atTheRead()
    fireEvent.click(screen.getByRole('radio', { name: /^Keep my site/ }))
    expect(screen.queryByRole('switch', { name: 'Also improve my wording' })).toBeNull()
    const body = await readMySite()
    expect(body['inputs']).toEqual({ domain: 'harbor-dental.com', finish: 'keep', wording: false })
  })

  it('names the switch for what it does where a generative Improve it is on, and asks the same two answers (AGL-4152)', async () => {
    await atTheRead(true)
    expect((screen.getByRole('switch', { name: 'Also write new copy' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('switch', { name: 'Also improve my wording' })).toBeNull()
    expect(screen.getByText(/never makes up a name, number, price, date, testimonial, client, award, credential, address or guarantee/)).toBeTruthy()
    expect(screen.getByText(/Off, every word stays as you wrote it, and your layout and menu are still redesigned/)).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Also write new copy' }))
    const body = await readMySite()
    expect(body['inputs']).toEqual({ domain: 'harbor-dental.com', finish: 'improve', wording: false })
  })

  it('has no axe violations', async () => {
    const { container } = await atTheRead()
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
