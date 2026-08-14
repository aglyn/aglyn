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
 * The AGL-1700 deny-list table, driven.
 *
 * The table exists for one situation: the list is full, the next takedown is
 * refused with a 409, and the remedy is "release stale entries" — which is
 * impossible while the only route to an entry is knowing a media id it
 * covers. Every property below is load-bearing for exactly that:
 *
 *  1. **It enumerates without being asked.** An operator arriving from a 409
 *     should not have to know there is a button.
 *  2. **A row's Release names the KEY.** `by: "media"` would clear every key
 *     covering the same file — right on the lookup card, wrong here, where
 *     the entry may be a digest covering workspaces this row never mentions.
 *  3. **Oldest first, and expired rows called out.** Expired entries enforce
 *     nothing and still consume the cap, so they are the safest thing to
 *     clear — and nothing else on the platform would have told you they exist.
 *  4. **The two facts AGL-1631's runbook work recorded are on screen**: a
 *     release removes only the key it names, and a full list refuses the next
 *     takedown.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardDisplay: ({
    header,
    children,
  }: {
    header: React.ReactNode
    children: React.ReactNode
  }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

let mockRole = 'super'
jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => true,
  useStaffRole: () => mockRole,
}))

import AdminMediaQuarantine from '../app/(app)/admin/media-quarantine/page'

const SHA_KEY = `hash--${'a'.repeat(64)}`
const LEGACY_KEY = 'hash--0123456789abcdef'
const ASSET_KEY = 'asset--org:acme--m1'

/** The server's read time — every "expired?" verdict is taken against it. */
const READ_AT = 1_700_000_000_000

const denyList = (over: Record<string, unknown> = {}) => ({
  records: [
    {
      key: SHA_KEY,
      reason: 'dmca',
      note: 'notice 2026-114, Meridian Publishing',
      atMs: READ_AT - 1_000,
      untilMs: null,
      actorUid: 'staff-super-1',
      originScopeSegment: 'org:acme',
      originMediaId: 'm1',
    },
    {
      // Expired: `untilMs` is behind the read time, so nothing enforces it
      // and no write ever said so.
      key: LEGACY_KEY,
      reason: 'malware',
      note: null,
      atMs: READ_AT - 90_000_000,
      untilMs: READ_AT - 10_000,
      actorUid: 'staff-super-2',
      originScopeSegment: null,
      originMediaId: null,
    },
    {
      // Undated — predates `atMs`, which makes it the oldest thing here.
      key: ASSET_KEY,
      reason: 'abuse',
      note: null,
      actorUid: 'staff-super-1',
      originScopeSegment: 'org:acme',
      originMediaId: 'm1',
    },
  ],
  count: 3,
  maxEntries: 2000,
  readAtMs: READ_AT,
  ...over,
})

let listReply: Record<string, unknown>
let postReply: Record<string, unknown>
let postOk: boolean
const posted: Record<string, unknown>[] = []
const fetched: string[] = []

beforeEach(() => {
  jest.clearAllMocks()
  posted.length = 0
  fetched.length = 0
  mockRole = 'super'
  listReply = denyList()
  postOk = true
  postReply = { ok: true, action: 'release', key: SHA_KEY, keys: [SHA_KEY], confirmed: true }
  global.fetch = jest.fn(async (input: any, init?: any) => {
    fetched.push(String(input))
    if (init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)))
      return { ok: postOk, status: 409, json: async () => postReply } as any
    }
    return { ok: true, json: async () => listReply } as any
  }) as any
})

/** Render and wait for the mount read to land. */
async function open() {
  render(<AdminMediaQuarantine />)
  await waitFor(() => screen.getByText(SHA_KEY))
}

const releaseButtons = () =>
  screen.getAllByRole('button', { name: 'Release' }) as HTMLButtonElement[]

describe('AGL-1700 · the list enumerates itself', () => {
  it('reads the whole deny list on arrival, with no query and no media read', async () => {
    await open()
    expect(fetched).toEqual(['/api/admin/media-quarantine'])
    expect(posted).toEqual([])
  })

  it('renders every entry, with the staff note and the origin breadcrumb', async () => {
    await open()
    expect(screen.getByText(LEGACY_KEY)).toBeTruthy()
    expect(screen.getByText(ASSET_KEY)).toBeTruthy()
    expect(document.body.textContent).toContain(
      'notice 2026-114, Meridian Publishing',
    )
    // The one breadcrumb from a digest key back to a file, in the payload
    // since AGL-1512 and never rendered until now.
    expect(document.body.textContent).toContain('org:acme / m1')
    // And it says so where the operator would otherwise assume that IS the
    // reach of the key.
    expect(document.body.textContent).toContain('a breadcrumb, not the reach')
  })

  it('sorts oldest first, with an undated entry ahead of every dated one', async () => {
    await open()
    const order = Array.from(document.querySelectorAll('tbody tr')).map((row) =>
      String(row.textContent),
    )
    expect(order).toHaveLength(3)
    expect(order[0]).toContain(ASSET_KEY)
    expect(order[1]).toContain(LEGACY_KEY)
    expect(order[2]).toContain(SHA_KEY)
  })

  it('says so plainly when nothing is taken down', async () => {
    listReply = denyList({ records: [], count: 0 })
    render(<AdminMediaQuarantine />)
    await waitFor(() => screen.getByText(/deny list is empty/))
    expect(document.body.textContent).toContain('0 of 2000 entries in use')
  })
})

describe('AGL-1700 · a row is a key, not a file', () => {
  it('releases by: "key" and names that exact key', async () => {
    await open()
    // Row order is oldest-first, so the first button is the undated per-asset
    // entry — released on its own terms, not as "everything covering m1".
    fireEvent.click(releaseButtons()[0])
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      action: 'release',
      by: 'key',
      key: ASSET_KEY,
    })
    expect(posted[0]['by']).not.toBe('media')
    expect(posted[0]['mediaId']).toBeUndefined()
  })

  it('re-reads the list after a release rather than mutating it locally', async () => {
    await open()
    fireEvent.click(releaseButtons()[0])
    await waitFor(() => expect(fetched.length).toBeGreaterThan(1))
    expect(fetched[fetched.length - 1]).toBe('/api/admin/media-quarantine')
  })

  it('shouts when the server read-back still shows the entry set', async () => {
    postReply = { ok: true, action: 'release', key: ASSET_KEY, confirmed: false }
    await open()
    fireEvent.click(releaseButtons()[0])
    await waitFor(() => screen.getByText(/NOT CONFIRMED/))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('still shows it SET'),
      expect.objectContaining({ variant: 'error' }),
    )
  })

  it('tells the operator a release lifts only the key it names', async () => {
    await open()
    expect(document.body.textContent).toContain(
      'Release removes only the key it names',
    )
  })
})

describe('AGL-1700 · what is dead weight, and what a full list costs', () => {
  it('marks an expired entry and counts it as the safest thing to clear', async () => {
    await open()
    expect(document.body.textContent).toContain('EXPIRED')
    expect(document.body.textContent).toContain(
      '1 of these 3 entries enforce nothing right now',
    )
  })

  it('counts an entry no reader can parse as dead weight too', async () => {
    listReply = denyList({
      records: [
        { key: SHA_KEY, reason: 'sometime-reason', atMs: READ_AT - 1 },
      ],
      count: 1,
    })
    render(<AdminMediaQuarantine />)
    await waitFor(() => screen.getByText('UNREADABLE'))
    expect(document.body.textContent).toContain(
      '1 of these 1 entries enforce nothing right now',
    )
  })

  it('reports the count against the cap, and what a full one refuses', async () => {
    listReply = denyList({ count: 2000 })
    render(<AdminMediaQuarantine />)
    await waitFor(() => screen.getByText(/deny list is FULL/))
    expect(document.body.textContent).toContain('2000 of 2000 entries in use')
    expect(document.body.textContent).toContain('refused with a 409')
    // Release stays live: clearing is the only way out of a full list.
    expect(releaseButtons().every((button) => !button.disabled)).toBe(true)
  })
})

describe('AGL-1700 · reading is open, releasing is not', () => {
  it('lets support read the list and disables every Release', async () => {
    mockRole = 'support'
    await open()
    expect(screen.getByText(SHA_KEY)).toBeTruthy()
    expect(releaseButtons().every((button) => button.disabled)).toBe(true)
    expect(document.body.textContent).toContain(
      'Releasing requires the super staff role',
    )
  })
})
