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
 * AGL-1571 — the panic page can no longer let an operator believe a lock was
 * lifted when it was not.
 *
 * During the production drill two clicks landed on empty space (the page
 * re-flows for seconds after load) and the page said nothing either way. One
 * was a LIFT: `uploads` stayed locked for another ~90 seconds while the
 * operator believed it released, caught only because the drill went back to
 * Firestore instead of trusting the click.
 *
 * The fix is not "make the buttons easier to hit" — a moving target can
 * always be missed. It is to make the dangerous belief unholdable, and these
 * tests pin the three mechanisms that do it:
 *
 *  1. a write answers with the server's READ-BACK of what it wrote, and the
 *     page states that verified post-condition instead of assuming it;
 *  2. that panel is stamped with the time it was read and is discarded the
 *     instant the target changes — a stale panel would be the same bug with
 *     a reassuring face;
 *  3. every action that reached the server lands in a timestamped log, so a
 *     click that never registered is visible as an ABSENCE the operator can
 *     look for.
 *
 * Plus the smaller trap the issue names: the id used to be cleared on submit,
 * which disabled Lock AND Unlock — during an incident that reads as "the
 * unlock button doesn't work".
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

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

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => true,
}))

import AdminLockdown from '../app/(app)/admin/lockdown/page'

/** The server's read-back shape (`LockState` in the route). */
const state = (over: Record<string, unknown> = {}) => ({
  scope: 'org',
  targetId: 'hz_KgetqSq',
  exists: true,
  locked: true,
  reason: 'security',
  message: null,
  untilMs: null,
  atMs: Date.now(),
  readAtMs: Date.now(),
  ...over,
})

let postReply: Record<string, unknown>
let probeReply: Record<string, unknown>
const posted: Record<string, unknown>[] = []
const probed: string[] = []

beforeEach(() => {
  jest.clearAllMocks()
  posted.length = 0
  probed.length = 0
  postReply = { ok: true, scope: 'org', action: 'lock', verified: state(), confirmed: true }
  probeReply = { state: state({ locked: false, reason: null, atMs: null }) }
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (init?.method === 'POST') {
      posted.push(JSON.parse(init.body))
      return { ok: true, json: async () => postReply }
    }
    if (url.includes('scope=')) {
      probed.push(url)
      return { ok: true, json: async () => probeReply }
    }
    return { ok: true, json: async () => ({ records: [] }) }
  }) as unknown as typeof fetch
})

/**
 * Render and settle the mount-time state load.
 *
 * Deliberately NOT wrapped in an async `act`: the page mounts a full MUI
 * tree whose effects re-enter, and the wrapper never settles here. `waitFor`
 * flushes what the assertions need; React's act warnings on the console are
 * noise, not failures.
 */
async function renderPage() {
  render(<AdminLockdown />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
}

const orgIdField = () => screen.getByLabelText('Org id') as HTMLInputElement
const lockButton = () =>
  screen.getByRole('button', { name: 'Lock' }) as HTMLButtonElement
const unlockButton = () =>
  screen.getByRole('button', { name: 'Unlock' }) as HTMLButtonElement

/** The card under test — the page also logs actions, so scope the reads. */
const cardNamed = (name: string) =>
  screen.getByRole('heading', { name }).closest('section') as HTMLElement
const scopedCard = () => cardNamed('Workspace, site or account')
const logCard = () => cardNamed('Actions taken in this session')

async function lockOrg(id = 'hz_KgetqSq') {
  fireEvent.change(orgIdField(), { target: { value: id } })
  fireEvent.click(lockButton())
  await waitFor(() => expect(posted).toHaveLength(1))
}

describe('AGL-1571 · the panic page states a verified post-condition', () => {
  it('keeps the target id after a lock, so Unlock is not a dead control', async () => {
    await renderPage()
    await lockOrg()
    // The id used to be cleared here, which disabled BOTH buttons — the
    // obvious next click during an incident landed on a dead Unlock.
    await waitFor(() => expect(orgIdField().value).toBe('hz_KgetqSq'))
    expect(unlockButton().disabled).toBe(false)
    expect(lockButton().disabled).toBe(false)
  })

  it("renders the server's read-back, not the fact that a request returned", async () => {
    await renderPage()
    await lockOrg()
    await screen.findByText('LOCKED')
    const card = scopedCard()
    expect(within(card).getByText('org hz_KgetqSq')).toBeTruthy()
    // The read time is the whole point: a panel with no timestamp is an
    // implicit claim about NOW, and that is the claim that was false.
    expect(within(card).getByText(/Read from the server at /)).toBeTruthy()
  })

  it('a lift shows NOT LOCKED only because the server said so afterwards', async () => {
    await renderPage()
    fireEvent.change(orgIdField(), { target: { value: 'hz_KgetqSq' } })
    postReply = {
      ok: true,
      verified: state({ locked: false, reason: null, atMs: null }),
      confirmed: true,
    }
    fireEvent.click(unlockButton())
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ action: 'unlock', scope: 'org' })
    await screen.findByText('NOT LOCKED')
  })

  it('discards the panel the moment the target changes', async () => {
    await renderPage()
    await lockOrg()
    await screen.findByText('LOCKED')
    fireEvent.change(orgIdField(), { target: { value: 'other-org' } })
    // A verdict about hz_KgetqSq sitting beside an id reading `other-org` is
    // exactly the misreading this issue is about.
    expect(within(scopedCard()).queryByText('LOCKED')).toBeNull()
    expect(
      within(scopedCard()).getByText(/No verified state for this target/),
    ).toBeTruthy()
  })

  it('"Check state" re-reads one target without acting on it', async () => {
    await renderPage()
    fireEvent.change(orgIdField(), { target: { value: 'hz_KgetqSq' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check state' }))
    await waitFor(() => expect(probed).toHaveLength(1))
    expect(probed[0]).toContain('scope=org')
    expect(probed[0]).toContain('targetId=hz_KgetqSq')
    // Read-only: the drill's safety move must never itself change anything.
    expect(posted).toHaveLength(0)
    await screen.findByText('NOT LOCKED')
  })

  it('logs every action that reached the server, stamped, newest first', async () => {
    await renderPage()
    // The empty state has to teach the operator to read ABSENCE, because
    // absence is the only signal a click that never landed produces.
    expect(within(logCard()).getByText(/the click did not register/)).toBeTruthy()

    await lockOrg()
    await waitFor(() =>
      expect(within(logCard()).getByText(/Locked org hz_KgetqSq/)).toBeTruthy(),
    )
    expect(within(logCard()).getByText('verified')).toBeTruthy()
  })

  it('a write that returns but does NOT take is an alarm, never a success', async () => {
    await renderPage()
    postReply = {
      ok: true,
      // The route re-read the target after writing and it still disagrees.
      verified: state({ locked: false }),
      confirmed: false,
    }
    await lockOrg()
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('OPPOSITE state'),
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    expect(within(logCard()).getByText('NOT CONFIRMED')).toBeTruthy()
  })
})
