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
 * THE CONTROL IS CLICKABLE (AGL-2265).
 *
 * the standing rule is that a capability is not a feature until the console
 * exposes it, and `admin-free-workspace-cap-route.spec.ts` proves only that
 * the endpoint exists. This file proves a staff member can see the number and
 * change it: the assertions read rendered TEXT and drive real clicks, and the
 * saving case checks the request that actually leaves the page.
 *
 * The other half is the LOADING window. A card that renders `0` before the
 * endpoint answers says the platform is refusing every signup; one that
 * renders a blank where the limit goes says nothing is enforced. Both are
 * believable and neither is true, which is the `checkQuota(undefined)` shape
 * this codebase has already shipped once — so the first two cases below are
 * about the moment before any number exists.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({
    header,
    subheader,
    children,
  }: {
    header: React.ReactNode
    subheader: React.ReactNode
    children: React.ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      <p>{subheader}</p>
      {children}
    </section>
  ),
}))

// A STABLE object. `useUser`'s result is a dependency of the card's `load`
// callback, so a fresh object per render would re-run the load effect forever
// and every `mockResolvedValueOnce` below would be eaten by a re-fetch rather
// than by the click it was queued for.
const USER = { data: { uid: 'staff-1', getIdToken: async () => 'tok' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => (globalThis as any).__staffCapUser,
}))
;(globalThis as any).__staffCapUser = USER

const mockEnqueue = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: (...args: unknown[]) => mockEnqueue(...args) }),
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

import StaffFreeWorkspaceCapCard from '../components/staff-free-workspace-cap-card.component'

function body(overrides?: Record<string, unknown>) {
  return {
    role: 'super',
    config: {
      limit: 3,
      enabled: true,
      note: '',
      updatedAtMs: null,
      updatedByEmail: null,
      ready: true,
    },
    bounds: { min: 1, max: 500 },
    ...overrides,
  }
}

/** A fetch that never settles — the loading window, held open. */
function hangingFetch() {
  return jest.fn(() => new Promise(() => undefined)) as any
}

function respondingFetch(payload: unknown, ok = true, status = 200) {
  return jest.fn(async () => ({
    ok,
    status,
    json: async () => payload,
  })) as any
}

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  jest.clearAllMocks()
})

describe('while the limit has not loaded', () => {
  beforeEach(() => {
    global.fetch = hangingFetch()
  })

  it('shows no number at all — not a zero, not a blank field', () => {
    render(<StaffFreeWorkspaceCapCard />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    // No limit anywhere on the card — not the built-in 3 standing in for an
    // answer that has not arrived, and not a zero.
    expect(screen.queryByText('3')).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText(/^Limit:/)).toBeNull()
    expect(screen.queryByRole('spinbutton')).toBeNull()
  })

  it('offers nothing to click, so nobody can set a limit they cannot see', () => {
    render(<StaffFreeWorkspaceCapCard />)
    expect(screen.queryByRole('button', { name: 'Set limit' })).toBeNull()
  })
})

describe('once the limit has loaded', () => {
  it('shows the number, and the input carries it', async () => {
    global.fetch = respondingFetch(body())
    render(<StaffFreeWorkspaceCapCard />)
    await screen.findByText('3')
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('3')
  })

  it('says what counts, because that is what support is asked', async () => {
    global.fetch = respondingFetch(body())
    render(<StaffFreeWorkspaceCapCard />)
    await screen.findByText('3')
    expect(screen.getByText(/Paid workspaces do not count/i)).toBeTruthy()
    expect(screen.getByText(/invited/i)).toBeTruthy()
  })

  // A stand-in must announce itself. Silently presenting the built-in default
  // as "the setting" is how an operator changes a number that was never read.
  it('says so when the stored value could not be read', async () => {
    global.fetch = respondingFetch(
      body({
        config: { ...body().config, ready: false },
      }),
    )
    render(<StaffFreeWorkspaceCapCard />)
    expect(
      await screen.findByText(/could not be read just now/i),
    ).toBeTruthy()
  })

  it('does not claim a stand-in when the value WAS read', async () => {
    global.fetch = respondingFetch(body())
    render(<StaffFreeWorkspaceCapCard />)
    await screen.findByText('3')
    expect(screen.queryByText(/could not be read just now/i)).toBeNull()
  })
})

describe('changing it', () => {
  it('a SUPER staff member can type a number and save it', async () => {
    const fetchMock = respondingFetch(body())
    global.fetch = fetchMock
    render(<StaffFreeWorkspaceCapCard />)
    await screen.findByText('3')

    const save = screen.getByRole('button', { name: 'Set limit' })
    // Nothing changed yet, so there is nothing to save.
    expect((save as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Why (audited)'), {
      target: { value: 'agency beta' },
    })
    expect((save as HTMLButtonElement).disabled).toBe(false)

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, config: { limit: 8, enabled: true } }),
    })
    fireEvent.click(save)

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (call: any[]) => call[1]?.method === 'PUT',
      )
      expect(put).toBeTruthy()
      expect(put[0]).toBe('/api/admin/free-workspace-cap')
      expect(JSON.parse(put[1].body)).toEqual({
        limit: 8,
        enabled: true,
        note: 'agency beta',
      })
    })
  })

  it('a non-super staff member is told who may, and gets no control', async () => {
    global.fetch = respondingFetch(body({ role: 'support' }))
    render(<StaffFreeWorkspaceCapCard />)
    await screen.findByText('3')
    expect(screen.queryByRole('button', { name: 'Set limit' })).toBeNull()
    expect(screen.getByText(/needs the super staff role/i)).toBeTruthy()
  })

  it('says plainly that lowering it takes nothing away', async () => {
    global.fetch = respondingFetch(body())
    render(<StaffFreeWorkspaceCapCard />)
    await screen.findByText('3')
    expect(
      screen.getByText(/never removes anybody's existing/i),
    ).toBeTruthy()
  })

  it('surfaces a refusal instead of pretending the change landed', async () => {
    const fetchMock = respondingFetch(body())
    global.fetch = fetchMock
    render(<StaffFreeWorkspaceCapCard />)
    await screen.findByText('3')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '900' } })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'limit must be between 1 and 500' }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set limit' }))
    await waitFor(() => {
      expect(mockEnqueue).toHaveBeenCalledWith(
        'limit must be between 1 and 500',
        expect.objectContaining({ variant: 'warning' }),
      )
    })
  })
})
