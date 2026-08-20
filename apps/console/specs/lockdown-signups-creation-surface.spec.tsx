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
 * THE PANIC PAGE TELLS THE TRUTH ABOUT THE SIGNUPS LEVER (AGL-1531).
 *
 * A capability that is not surfaced in the console does not count as
 * shipped, and "surfaced" here has a sharper meaning than usual: the same
 * switch means two different things depending on something this repo does
 * not control. With the `beforeUserCreated` blocking function registered in
 * Identity Platform, locking signups stops accounts BEING CREATED. Without
 * it, the very same switch only turns away the session — the bot wave's
 * accounts are still born. Merging does not deploy the function, and
 * deploying does not by itself register the trigger.
 *
 * Three things are pinned here, and each is a belief an operator could
 * otherwise hold at 3am and act on:
 *
 *  1. the page reports which of those two worlds it is in, from a real read
 *     of Identity Platform rather than from the fact that the code exists;
 *  2. an UNKNOWN answer renders as unknown, never as armed — "we could not
 *     check" and "it is on" are the two answers an incident cannot merge;
 *  3. the checklist does not claim a capability is "on" before the state has
 *     loaded. `records` starts empty, so every feature used to paint a green
 *     "on" during the first frames and forever after a failed load — the
 *     loading-default trap, on the one page whose whole job is to say
 *     whether something is locked.
 *
 * Plus: who pulled the lever, which was on the wire and in the page's own
 * type but rendered nowhere.
 */

import { render, screen, waitFor, within } from '@testing-library/react'

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
  useStaffRole: () => 'super',
}))

import AdminLockdown from '../app/(app)/admin/lockdown/page'

/** What GET /api/admin/lockdown answers this test with. */
let getReply: Record<string, unknown>
/** Held open so a test can assert what the page paints BEFORE it resolves. */
let releaseGet: (() => void) | null = null

beforeEach(() => {
  jest.clearAllMocks()
  releaseGet = null
  getReply = { records: [], signupsCreationTrigger: { status: 'absent' } }
  global.fetch = jest.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (init?.method === 'POST') {
      return { ok: true, json: async () => ({ ok: true }) }
    }
    if (url.includes('scope=') || url.includes('verdict=')) {
      return { ok: true, json: async () => ({ state: null }) }
    }
    if (releaseGet) {
      await new Promise<void>((resolve) => {
        releaseGet = resolve
      })
    }
    return { ok: true, json: async () => getReply }
  }) as unknown as typeof fetch
})

const featuresCard = () =>
  screen.getByRole('heading', { name: 'Features' }).closest('section') as HTMLElement

async function renderPage() {
  render(<AdminLockdown />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
}

describe('AGL-1531 · the page says whether creation itself is refused', () => {
  it('warns, loudly, when no beforeCreate trigger is registered', async () => {
    getReply = { records: [], signupsCreationTrigger: { status: 'absent' } }
    await renderPage()
    const card = await waitFor(() => featuresCard())
    await waitFor(() =>
      expect(
        within(card).getByText(/Account creation is NOT refused/),
      ).toBeTruthy(),
    )
    // The remedy, on the page, because the operator reading this is not
    // going to go and find the runbook first.
    expect(
      within(card).getByText(/firebase deploy --only functions/),
    ).toBeTruthy()
  })

  it('states the valve is armed, and names the function it found', async () => {
    getReply = {
      records: [],
      signupsCreationTrigger: {
        status: 'armed',
        functionUri:
          'https://us-central1-aglyn-main.cloudfunctions.net/beforeSignupCreate',
        updateTime: '2026-08-20T00:00:00Z',
      },
    }
    await renderPage()
    const card = await waitFor(() => featuresCard())
    await waitFor(() =>
      expect(
        within(card).getByText(/Account creation is REFUSED too/),
      ).toBeTruthy(),
    )
    expect(within(card).getByText(/beforeSignupCreate/)).toBeTruthy()
  })

  /**
   * The one that matters most. A probe that could not run is not evidence of
   * a valve that is running, and the failure mode of getting this wrong is
   * an operator who believes the wave has been stopped from creating
   * accounts when it has only been stopped from using them.
   */
  it('renders an unreadable probe as UNKNOWN, never as armed', async () => {
    getReply = {
      records: [],
      signupsCreationTrigger: {
        status: 'unknown',
        reason: 'Identity Platform config read returned 403.',
      },
    }
    await renderPage()
    const card = await waitFor(() => featuresCard())
    await waitFor(() =>
      expect(within(card).getByText(/Account creation: UNKNOWN/)).toBeTruthy(),
    )
    expect(within(card).queryByText(/is REFUSED too/)).toBeNull()
    expect(within(card).getByText(/Treat as sessions-only/)).toBeTruthy()
  })

  it('treats a server that reports nothing as sessions-only', async () => {
    // An older deployment, or a GET that lost the field. Silence is not
    // permission to assume the stronger control.
    getReply = { records: [] }
    await renderPage()
    const card = await waitFor(() => featuresCard())
    await waitFor(() =>
      expect(
        within(card).getByText(/not reported by this server/),
      ).toBeTruthy(),
    )
  })
})

describe('AGL-1531 · an unresolved lock state does not read as unlocked', () => {
  it('shows "checking…" rather than a green "on" before the load lands', async () => {
    releaseGet = () => undefined
    render(<AdminLockdown />)
    // Five capabilities, none of them yet known to be anything.
    await waitFor(() => expect(screen.getAllByText('checking…').length).toBe(5))
    expect(screen.queryByText('on')).toBeNull()
    // And the controls do not act on a state nobody has read.
    for (const button of screen.getAllByRole('button', { name: 'Disable' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('resolves to the real state once the load lands', async () => {
    getReply = {
      records: [
        {
          id: 'feature--signups',
          scope: 'feature',
          feature: 'signups',
          reason: 'security',
          atMs: 1_700_000_000_000,
          actorUid: 'staff-zach',
        },
      ],
      signupsCreationTrigger: { status: 'absent' },
    }
    await renderPage()
    const card = await waitFor(() => featuresCard())
    await waitFor(() => expect(within(card).getByText('LOCKED')).toBeTruthy())
    expect(within(card).queryByText('checking…')).toBeNull()
    // Four other capabilities are genuinely on, and now say so.
    expect(within(card).getAllByText('on').length).toBe(4)
  })

  it('names who pulled the lever', async () => {
    getReply = {
      records: [
        {
          id: 'feature--signups',
          scope: 'feature',
          feature: 'signups',
          reason: 'security',
          atMs: 1_700_000_000_000,
          actorUid: 'staff-zach',
        },
      ],
      signupsCreationTrigger: { status: 'absent' },
    }
    await renderPage()
    const card = await waitFor(() => featuresCard())
    await waitFor(() =>
      expect(within(card).getByText(/set by staff-zach/)).toBeTruthy(),
    )
  })
})
