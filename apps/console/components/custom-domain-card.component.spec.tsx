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
 * AGL-1913: what the card is allowed to say about a connected domain.
 *
 * It had two things to say — a green chip, or "attachment pending" when our own
 * attach call failed — and everything that actually happens to a customer
 * between pointing DNS and having a working site sat inside the green one. A
 * certificate still issuing and a domain that will never work rendered
 * identically, so the product could not tell the customer to wait in one case
 * and to act in the other.
 *
 * Every case here asserts the CLAIM rather than the fetch: the point is not
 * that a status request happens, it is that the wrong status is never
 * asserted — including when the request fails, where the card must fall back
 * to what it knew rather than inventing a fault.
 */

import { render, screen, waitFor } from '@testing-library/react'

const mockEnqueueSnackbar = jest.fn()
/** The host document the card reads, swapped per case. */
let mockHost: Record<string, unknown> = {}

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('firebase/firestore', () => ({ doc: () => ({}) }))

jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))

jest.mock('../constants/entitlements', () => ({ hasEntitlement: () => true }))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'starter' }, ready: true, orgId: 'org-1' }),
}))

jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: mockHost }),
}))

const { CustomDomainCard } = require('./custom-domain-card.component') as {
  CustomDomainCard: (props: { hostId: string }) => JSX.Element
}

/** `/api/domains/status` answers with `body`; anything else 200s empty. */
function serveStatus(body: unknown, ok = true) {
  global.fetch = jest.fn(async (url: string) =>
    String(url).includes('/api/domains/status')
      ? ({ ok, status: ok ? 200 : 500, json: async () => body } as Response)
      : ({ ok: true, status: 200, json: async () => ({}) } as Response),
  ) as unknown as typeof fetch
}

beforeEach(() => {
  mockHost = { $id: 'host-1', cname: 'example.com' }
  mockEnqueueSnackbar.mockReset()
  serveStatus({ domain: 'example.com', state: 'serving', verification: [], conflicts: [] })
})

afterEach(() => jest.restoreAllMocks())

describe('the connected-domain chip says which state it is in', () => {
  it('calls a serving domain live', async () => {
    render(<CustomDomainCard hostId="host-1" />)
    expect(await screen.findByText('example.com — live')).toBeTruthy()
  })

  it('separates a certificate still issuing from a live domain, and says to wait', async () => {
    serveStatus({
      domain: 'example.com',
      state: 'certificate-pending',
      verification: [],
      conflicts: [],
    })
    render(<CustomDomainCard hostId="host-1" />)
    expect(await screen.findByText('example.com — issuing certificate')).toBeTruthy()
    expect(screen.queryByText('example.com — live')).toBeNull()
    expect(
      screen.getByText(/still being issued/i).textContent,
    ).toMatch(/nothing to do but wait/i)
  })

  it('names the exact record when the platform wants ownership proved', async () => {
    // Without the record itself, "prove you own the domain" is a dead end —
    // nothing else in the product says which record, name, or value.
    serveStatus({
      domain: 'example.com',
      state: 'ownership-pending',
      verification: [
        {
          type: 'TXT',
          domain: '_vercel.example.com',
          value: 'vc-domain-verify=example.com,abc123',
        },
      ],
      conflicts: [],
    })
    render(<CustomDomainCard hostId="host-1" />)
    expect(
      await screen.findByText('example.com — ownership check needed'),
    ).toBeTruthy()
    expect(
      // Whitespace-normalised by testing-library; the rendered line pads the
      // columns the same way the DNS instructions above it do.
      screen.getByText(
        'TXT _vercel.example.com → vc-domain-verify=example.com,abc123',
      ),
    ).toBeTruthy()
  })

  it('says DNS no longer points here rather than showing a healthy domain', async () => {
    serveStatus({
      domain: 'example.com',
      state: 'dns-misconfigured',
      verification: [],
      conflicts: [],
    })
    render(<CustomDomainCard hostId="host-1" />)
    expect(
      await screen.findByText('example.com — DNS not pointing here'),
    ).toBeTruthy()
    expect(screen.getByText(/no longer resolves to us/i)).toBeTruthy()
  })

  it('reports a domain that is saved here but attached nowhere', async () => {
    serveStatus({
      domain: 'example.com',
      state: 'not-attached',
      verification: [],
      conflicts: [],
    })
    render(<CustomDomainCard hostId="host-1" />)
    expect(await screen.findByText('example.com — not attached')).toBeTruthy()
    expect(screen.getByText(/serves nothing/i)).toBeTruthy()
  })

  it('warns about conflicting records on a domain that is otherwise SERVING', async () => {
    // The stale-A-shadowing case: it works most of the time, which is exactly
    // why nothing else in the flow would ever mention it.
    serveStatus({
      domain: 'example.com',
      state: 'serving',
      verification: [],
      conflicts: [{ type: 'A', name: 'example.com', value: '203.0.113.9' }],
    })
    render(<CustomDomainCard hostId="host-1" />)
    expect(await screen.findByText('example.com — live')).toBeTruthy()
    expect(
      screen.getByText(/load intermittently/i).textContent,
    ).toContain('A example.com 203.0.113.9')
  })
})

describe('it never asserts a status it does not have', () => {
  it('falls back to the plain chip when the status request fails', async () => {
    serveStatus({ error: 'boom' }, false)
    render(<CustomDomainCard hostId="host-1" />)
    // The domain, with no verdict attached — not "broken", which the failed
    // request did not earn, and not "live", which it did not earn either.
    expect(await screen.findByText('example.com')).toBeTruthy()
    expect(screen.queryByText(/not attached/i)).toBeNull()
    expect(screen.queryByText(/issuing certificate/i)).toBeNull()
  })

  it('keeps showing OUR pending flag when the platform cannot be asked', async () => {
    mockHost = { $id: 'host-1', cname: 'example.com', cnameAttachmentPending: true }
    serveStatus({ domain: 'example.com', state: 'unknown', verification: [], conflicts: [] })
    render(<CustomDomainCard hostId="host-1" />)
    expect(
      await screen.findByText('example.com — attachment pending'),
    ).toBeTruthy()
  })

  it('asks for no status at all when no domain is connected', async () => {
    mockHost = { $id: 'host-1' }
    render(<CustomDomainCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByLabelText('Domain')).toBeTruthy())
    const calls = (global.fetch as jest.Mock).mock.calls
    expect(calls.some(([url]) => String(url).includes('/api/domains/status'))).toBe(
      false,
    )
  })
})
