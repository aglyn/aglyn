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
 * The AGL-1687 staff form, driven.
 *
 * Four properties, each of which a plausible implementation gets wrong in a
 * way nobody notices until an incident:
 *
 *  1. **It sends an ASSET, never a digest.** The whole point of `by: "media"`
 *     is that the server picks the key; a form that "helpfully" posted the
 *     `contentHash` it had would put the AGL-1631 mistake back.
 *  2. **The reach of the key is on screen before the button.** A digest key
 *     takes the file down in every workspace that shares the bytes; the
 *     per-asset key takes down one copy. Same button, different blast radius.
 *  3. **`confirmed: false` is loud.** A 200 says the request was accepted.
 *     Only the read-back says the state changed, and a lift you believe
 *     happened is the AGL-1571 failure this family exists to prevent.
 *  4. **Writing is super-only in the UI too.** The route enforces it; a page
 *     that offered the button anyway would send a support operator to a 403
 *     mid-incident.
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
const ASSET_KEY = 'asset--org:acme--m1'

const lookupReply = (over: Record<string, unknown> = {}) => ({
  asset: {
    scopeSegment: 'org:acme',
    mediaId: 'm1',
    fileName: 'invoice.pdf',
    hasStrongDigest: true,
    hasLegacyDigest: true,
    deleted: false,
  },
  keys: [
    { key: SHA_KEY, kind: 'sha256', state: null, note: null },
    { key: 'hash--0123456789abcdef', kind: 'legacy', state: null, note: null },
    { key: ASSET_KEY, kind: 'asset', state: null, note: null },
  ],
  quarantined: false,
  count: 3,
  maxEntries: 2000,
  readAtMs: 1_700_000_000_000,
  ...over,
})

let getReply: Record<string, unknown>
let postReply: Record<string, unknown>
const posted: Record<string, unknown>[] = []
const fetched: string[] = []
/** Just the asset lookups — the page also GETs the whole deny list on mount
 * (AGL-1700), which would otherwise sit at `fetched[0]` and make every
 * position-based assertion below about the wrong request. */
const lookups = () => fetched.filter((url) => url.includes('?'))

beforeEach(() => {
  jest.clearAllMocks()
  posted.length = 0
  fetched.length = 0
  mockRole = 'super'
  getReply = lookupReply()
  postReply = { ok: true, action: 'quarantine', key: SHA_KEY, keys: [SHA_KEY], confirmed: true }
  global.fetch = jest.fn(async (input: any, init?: any) => {
    fetched.push(String(input))
    if (init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)))
      return { ok: true, json: async () => postReply } as any
    }
    // The listing GET carries no query; the lookup GET carries the ids.
    if (!String(input).includes('?')) {
      return {
        ok: true,
        json: async () => ({
          records: [],
          count: 0,
          maxEntries: 2000,
          readAtMs: 1_700_000_000_000,
        }),
      } as any
    }
    return { ok: true, json: async () => getReply } as any
  }) as any
})

/** Fill the two ids and press Look it up, then wait for the panel. */
async function lookUp() {
  render(<AdminMediaQuarantine />)
  fireEvent.change(screen.getByLabelText('Workspace id'), {
    target: { value: 'acme' },
  })
  fireEvent.change(screen.getByLabelText('Media id'), {
    target: { value: 'm1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
  await waitFor(() => screen.getByText('NOT DISABLED'))
}

describe('AGL-1687 · the form names a file, not a key', () => {
  it('looks the asset up with a GET carrying orgId and mediaId', async () => {
    await lookUp()
    expect(posted).toEqual([])
    expect(lookups()[0]).toContain('mediaId=m1')
    expect(lookups()[0]).toContain('orgId=acme')
  })

  it('posts by: "media" and no digest at all', async () => {
    await lookUp()
    fireEvent.click(screen.getByRole('button', { name: 'Disable this file' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]['by']).toBe('media')
    expect(posted[0]['orgId']).toBe('acme')
    expect(posted[0]['mediaId']).toBe('m1')
    expect(posted[0]['contentHash']).toBeUndefined()
    expect(posted[0]['scopeSegment']).toBeUndefined()
  })
})

describe('AGL-1687 · the reach is on screen before the button', () => {
  it('names the sha256 key and says it covers every copy', async () => {
    await lookUp()
    // Twice on purpose: once in the key list, once in the "this will be
    // written under …" alert that sits directly above the button.
    const pending = screen.getByText(/This will be written under/)
    expect(pending.textContent).toContain(SHA_KEY)
    expect(pending.textContent).toContain('every workspace')
  })

  it('switches to the per-asset key, and its narrower reach, on demand', async () => {
    await lookUp()
    fireEvent.click(
      screen.getByLabelText('Disable only this copy (per-asset key)'),
    )
    await waitFor(() =>
      screen.getByText(/this one document in this one workspace\./),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Disable this file' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]['prefer']).toBe('asset')
  })

  it('defaults to the digest key — the stronger one', async () => {
    await lookUp()
    fireEvent.click(screen.getByRole('button', { name: 'Disable this file' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]['prefer']).toBe('hash')
  })

  it('warns when the file carries only the legacy digest', async () => {
    getReply = lookupReply({
      asset: { ...(lookupReply().asset as any), hasStrongDigest: false },
    })
    await lookUp()
    expect(document.body.textContent).toContain('legacy 64-bit digest')
  })

  it('says a digest-less file is covered at delivery only', async () => {
    getReply = lookupReply({
      asset: {
        ...(lookupReply().asset as any),
        hasStrongDigest: false,
        hasLegacyDigest: false,
      },
    })
    await lookUp()
    expect(document.body.textContent).toContain('NO digest at all')
    expect(document.body.textContent).toContain('only at delivery')
  })
})

describe('AGL-1687 · never take a lift on trust', () => {
  it('logs a confirmed action', async () => {
    await lookUp()
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    await waitFor(() => screen.getByText(/Released m1/))
    expect(document.body.textContent).not.toContain('NOT CONFIRMED')
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('verified on the server'),
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('shouts when the server read-back disagrees', async () => {
    postReply = { ok: true, action: 'release', key: SHA_KEY, keys: [SHA_KEY], confirmed: false }
    await lookUp()
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    await waitFor(() => screen.getByText(/NOT CONFIRMED/))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('OPPOSITE state'),
      expect.objectContaining({ variant: 'error' }),
    )
  })

  it('starts by telling the operator an absent line means the click missed', () => {
    render(<AdminMediaQuarantine />)
    expect(document.body.textContent).toContain('did not reach the server')
  })
})

describe('AGL-1687 · the cap has a surface', () => {
  it('reports the count against the cap', async () => {
    await lookUp()
    expect(document.body.textContent).toContain('3 of 2000 entries in use')
  })

  it('refuses a NEW takedown, loudly, when the list is full', async () => {
    getReply = lookupReply({ count: 2000 })
    await lookUp()
    expect(document.body.textContent).toContain('The deny list is FULL')
    expect(
      (screen.getByRole('button', { name: 'Disable this file' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    // Release stays live — clearing stale entries is the way OUT of a full
    // list, so disabling it would trap the operator.
    expect(
      (screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})

describe('AGL-1687 · the role gate, in the UI too', () => {
  it('offers both buttons to a super operator', async () => {
    await lookUp()
    expect(
      (screen.getByRole('button', { name: 'Disable this file' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('disables them for support, and says why', async () => {
    mockRole = 'support'
    await lookUp()
    expect(document.body.textContent).toContain('requires the super staff role')
    expect(
      (screen.getByRole('button', { name: 'Disable this file' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
