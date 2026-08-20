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
 * AGL-2011 — the staff view of a customer's custom domain.
 *
 * `/api/domains/status` has admitted staff since AGL-1913 and nothing called
 * it, so the staff host page rendered `domain: {cname}` — the name, with no
 * verdict — and a broken domain looked exactly like a working one on the page
 * support looks at while the customer is on the phone.
 *
 * The load-bearing case here is the VOCABULARY one: a staff surface that
 * described the same verdict in its own words would pass a test that only
 * asked "does it say something". So the customer's card and this card are
 * rendered against the SAME status payload and asserted to produce the same
 * chip text — the property that makes a support conversation work.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mockEnqueueSnackbar = jest.fn()
let mockRole: string | null = 'super'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

// The signed-in user is ONE object across renders, because that is what
// reactfire gives you: `useUser()` returns a fresh status wrapper each render
// but `.data` is the same Firebase `User` instance while the session lasts. A
// mock that minted a new `data` per render would model a product that does not
// exist, and the fetch-count assertion below — the one that catches a refetch
// loop — would be measuring the mock.
const mockUser = { uid: 'staff-1', getIdToken: async () => 'tok' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
}))

jest.mock('firebase/firestore', () => ({ doc: () => ({}) }))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))
jest.mock('../constants/entitlements', () => ({ hasEntitlement: () => true }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'starter' }, ready: true, orgId: 'org-1' }),
}))

// Only the CLAIM is doubled. `staff-super-only.component` itself is real, so
// the gate around Re-attach is the shipped one rather than a stand-in — a
// mocked gate would let a card that forgot to wrap the button pass.
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useStaffRole: () => mockRole,
  useIsStaff: () => mockRole !== null,
}))

// The customer's card is rendered alongside for the vocabulary comparison, so
// its host-document hook has to answer too.
let mockHost: Record<string, unknown> = {}
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: mockHost }),
}))

const { StaffDomainCard } = require('./staff-domain-card.component') as {
  StaffDomainCard: (props: { hostId: string; host: unknown }) => JSX.Element
}
const { CustomDomainCard } = require('./custom-domain-card.component') as {
  CustomDomainCard: (props: { hostId: string }) => JSX.Element
}

let fetchMock: jest.Mock

/** `/api/domains/status` answers with `body`; the admin route 200s `ok`. */
function serveStatus(body: unknown, ok = true) {
  fetchMock = jest.fn(async (url: string) =>
    String(url).includes('/api/domains/status')
      ? ({ ok, status: ok ? 200 : 500, json: async () => body } as Response)
      : ({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, serving: true }),
        } as Response),
  ) as unknown as jest.Mock
  global.fetch = fetchMock as unknown as typeof fetch
}

const SERVING = {
  domain: 'shop.example.com',
  state: 'serving',
  verification: [],
  conflicts: [],
}

const host = (extra: Record<string, unknown> = {}) => ({
  cname: 'shop.example.com',
  ...extra,
})

beforeEach(() => {
  mockRole = 'super'
  mockHost = { $id: 'host-1', cname: 'shop.example.com' }
  mockEnqueueSnackbar.mockReset()
  serveStatus(SERVING)
})

afterEach(() => jest.restoreAllMocks())

describe('the staff card reports the live verdict, not just the name', () => {
  it.each([
    ['serving', 'shop.example.com — live'],
    ['certificate-pending', 'shop.example.com — issuing certificate'],
    ['ownership-pending', 'shop.example.com — ownership check needed'],
    ['dns-misconfigured', 'shop.example.com — DNS not pointing here'],
    ['not-attached', 'shop.example.com — not attached'],
  ])('%s renders as "%s"', async (state, label) => {
    serveStatus({ ...SERVING, state })
    render(<StaffDomainCard hostId="host-1" host={host()} />)
    expect(await screen.findByText(label)).toBeTruthy()
  })

  it('says the SAME words the customer is reading (AGL-2011)', async () => {
    // The whole point of sharing `utils/domain-status.ts` rather than writing
    // a second vocabulary. Reword either surface independently and this fails.
    serveStatus({ ...SERVING, state: 'dns-misconfigured' })
    const staff = render(<StaffDomainCard hostId="host-1" host={host()} />)
    const staffLabel = await staff.findByText(/shop\.example\.com —/)
    staff.unmount()
    const customer = render(<CustomDomainCard hostId="host-1" />)
    const customerLabel = await customer.findByText(/shop\.example\.com —/)
    expect(staffLabel.textContent).toBe(customerLabel.textContent)
  })

  it('shows the ownership record support gets asked for by name', async () => {
    serveStatus({
      ...SERVING,
      state: 'ownership-pending',
      verification: [
        { type: 'TXT', domain: '_vercel.example.com', value: 'vc-domain-abc' },
      ],
    })
    render(<StaffDomainCard hostId="host-1" host={host()} />)
    expect(
      await screen.findByText(/_vercel\.example\.com.*vc-domain-abc/),
    ).toBeTruthy()
  })

  it('shows conflicting records even when the domain is serving', async () => {
    // The "it works for me" report: a stale A record answering alongside a
    // correct ALIAS, winning some of the time. A card that only showed
    // conflicts on a failing state would hide it in the exact case it matters.
    serveStatus({
      ...SERVING,
      conflicts: [{ type: 'A', name: 'shop', value: '203.0.113.9' }],
    })
    render(<StaffDomainCard hostId="host-1" host={host()} />)
    expect(await screen.findByText(/A shop 203\.0\.113\.9/)).toBeTruthy()
    expect(screen.getByText('shop.example.com — live')).toBeTruthy()
  })

  it('surfaces the attachment flags the customer card only implies', async () => {
    render(
      <StaffDomainCard
        hostId="host-1"
        host={host({ cnameAttachmentPending: true, cnameDetachmentPending: true })}
      />,
    )
    expect(await screen.findByText('attachment pending')).toBeTruthy()
    expect(screen.getByText('detachment pending')).toBeTruthy()
  })

  it('asserts nothing when the status read fails', async () => {
    // A staff page inventing a fault is worse than one that says nothing —
    // it becomes what support tells the customer.
    //
    // THE AWAIT IS THE TEST. Written as `findByText('shop.example.com')` this
    // passed against a card that DID invent `not-attached`: `findByText`
    // resolves on the first synchronous paint, where the status is still null
    // and the label is the bare name either way, and the negative queries then
    // ran before the fetch had settled. It asserted the initial render and
    // called it the failure path. Waiting for the request AND flushing the
    // state update it schedules is what makes the negatives mean anything.
    serveStatus({}, false)
    render(<StaffDomainCard hostId="host-1" host={host()} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(screen.queryByText(/— not attached/)).toBeNull()
    expect(screen.queryByText(/— DNS not pointing here/)).toBeNull()
    expect(screen.getByText('shop.example.com')).toBeTruthy()
  })

  it('does not call the status endpoint for a site with no domain', async () => {
    render(<StaffDomainCard hostId="host-1" host={{}} />)
    expect(await screen.findByText(/No custom domain/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Re-attach', () => {
  it('is offered to super staff and posts the staff action', async () => {
    render(<StaffDomainCard hostId="host-1" host={host()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Re-attach' }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === '/api/admin/host'),
      ).toBe(true),
    )
    const call = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/admin/host',
    )
    // No domain in the body — the route re-attaches `host.cname` and the card
    // must not start offering it one.
    expect(JSON.parse(String(call[1].body))).toEqual({
      hostId: 'host-1',
      action: 'reattach-domain',
    })
  })

  it('is withheld from a support-role staff member', async () => {
    mockRole = 'support'
    render(<StaffDomainCard hostId="host-1" host={host()} />)
    // The verdict is still readable — only the write is gated.
    expect(await screen.findByText('shop.example.com — live')).toBeTruthy()
    const button = screen.queryByRole('button', { name: 'Re-attach' })
    expect(button === null || (button as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not claim success when the domain still is not serving', async () => {
    fetchMock = jest.fn(async (url: string) =>
      String(url).includes('/api/domains/status')
        ? ({ ok: true, status: 200, json: async () => SERVING } as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, serving: false }),
          } as Response),
    ) as unknown as jest.Mock
    global.fetch = fetchMock as unknown as typeof fetch
    render(<StaffDomainCard hostId="host-1" host={host()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Re-attach' }))
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(String(mockEnqueueSnackbar.mock.calls[0][0])).toMatch(
      /still not serving/i,
    )
    expect(mockEnqueueSnackbar.mock.calls[0][1]).toMatchObject({
      variant: 'warning',
    })
  })
})

describe('the staff host page actually renders it', () => {
  /*
   * THE BUG CLASS OF AGL-2011 ITSELF. `/api/domains/status` admitted staff for
   * a full release and no staff surface called it — a capability that exists
   * and is not reachable is not a feature. A card with fourteen green cases
   * that no page mounts would be the same defect wearing this issue's number,
   * and every case above would still pass.
   */
  const page = readFileSync(
    join(
      __dirname,
      '../app/(app)/admin/orgs/[orgId]/host/[hostId]/page.tsx',
    ),
    'utf8',
  )

  it('imports and mounts StaffDomainCard', () => {
    expect(page).toMatch(/import \{ StaffDomainCard \}/)
    expect(page).toMatch(/<StaffDomainCard\b/)
  })

  it('passes it the host document, not just the id', () => {
    // Without `host` the pending flags are invisible and the card silently
    // degrades to the chip-only view this issue was filed about.
    expect(page).toMatch(/<StaffDomainCard[^/]*host=\{host\}/)
  })

  it('no longer renders the bare domain chip it replaced', () => {
    expect(page).not.toMatch(/label=\{`domain: \$\{host\.cname\}`\}/)
  })
})
