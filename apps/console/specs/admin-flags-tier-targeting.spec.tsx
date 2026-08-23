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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The tier-targeting control on /admin/flags (AGL-2486), rendered.
 *
 * The evaluator's semantics are pinned in
 * `libs/aglyn/.../release-flag-plan-targeting.spec.ts`. What can only be
 * checked here is whether the STAFF PAGE tells the truth about them — an
 * operator who cannot predict who gets a flag will not stage a rollout, and
 * the two ways this page could lie are both silent:
 *
 *  - showing a blank tier control for a flag that reaches everyone, which
 *    reads as "nobody";
 *  - omitting `plans` from the publish, which the route would then treat as
 *    "keep what is published" — so clearing a tier list would appear to work
 *    and change nothing.
 *
 * The plan model is REAL here, not mocked. A page that renders its own idea
 * of the tier ladder is the `PLAN_OPTIONS` bug (stuck at Business while three
 * tiers shipped), and a mocked ladder would hide exactly that.
 */

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
  CardDisplay: ({ children }: any) => <div>{children}</div>,
  Container: ({ children }: any) => <div>{children}</div>,
  HelpTip: () => null,
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))
jest.mock('../components/layouts/authenticated.layout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))
jest.mock('../components/layouts/main.layout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => true,
  useStaffRole: () => 'super',
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => ({}),
}))

import AdminFlags from '../app/(app)/admin/flags/page'

let putBodies: any[]

/** One flag row, as `GET /api/admin/flags` returns it. */
const flagRow = (value: Record<string, unknown>) => ({
  key: 'release_contacts',
  label: 'Contacts CRM',
  description: 'Unified contacts list.',
  value,
  published: true,
})

const mockApi = (value: Record<string, unknown>) => {
  putBodies = []
  ;(globalThis as any).fetch = jest.fn(async (_url: string, init: any = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          etag: 'etag-1',
          role: 'super',
          flags: [flagRow(value)],
        }),
      }
    }
    putBodies.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ etag: 'etag-2' }) }
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockApi({ enabled: false, rolloutPercent: 25 })
})

describe('/admin/flags tier targeting (AGL-2486)', () => {
  it('reads an untargeted flag as "All tiers", never as blank', async () => {
    render(<AdminFlags />)
    // The stored flag has no `plans` key at all — the shape every flag
    // published before this issue has. An empty control would read as "no
    // tiers", which is the inverted reading this label exists to prevent.
    expect(await screen.findByText('All tiers')).toBeTruthy()
    expect(screen.getByText(/Every tier\./)).toBeTruthy()
  })

  it('shows no tier chip for an untargeted flag', async () => {
    render(<AdminFlags />)
    await screen.findByText('Contacts CRM')
    expect(screen.queryByText(/^Tiers: /)).toBeNull()
  })

  it('names the targeted tiers in a chip, for an ON flag too', async () => {
    // The filter binds the fully-enabled path as well as the rollout, so an
    // "On" chip alone would read as "every customer has this" for a flag only
    // the top of the ladder can see.
    mockApi({ enabled: true, plans: ['agency', 'enterprise'] })
    render(<AdminFlags />)
    expect(await screen.findByText('Tiers: Agency, Enterprise')).toBeTruthy()
    expect(screen.getByText('On')).toBeTruthy()
  })

  it('offers every tier the plan model declares, in ladder order', async () => {
    render(<AdminFlags />)
    await screen.findByText('Contacts CRM')
    fireEvent.mouseDown(screen.getByLabelText('Contacts CRM tiers'))
    const options = (await screen.findAllByRole('option')).map(
      (option) => option.textContent,
    )
    expect(options).toEqual([
      'Free',
      'Starter',
      'Pro',
      'Business',
      'Scale',
      'Advanced',
      'Agency',
      'Enterprise',
    ])
  })

  it('expands the lowest picked tier upward with "and above"', async () => {
    mockApi({ enabled: false, rolloutPercent: 50, plans: ['pro'] })
    render(<AdminFlags />)
    await screen.findByText('Tiers: Pro')
    fireEvent.click(screen.getByRole('button', { name: 'and above' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'Tiers: Pro, Business, Scale, Advanced, Agency, Enterprise',
        ),
      ).toBeTruthy(),
    )
  })

  it('explains that the percentage is drawn from the targeted tiers', async () => {
    mockApi({ enabled: false, rolloutPercent: 50, plans: ['pro'] })
    render(<AdminFlags />)
    // The sentence an operator needs in order to predict the audience. It has
    // to say the bucket is the org id, because that is what makes editing the
    // tier list safe for orgs already inside the rollout.
    expect(
      await screen.findByText(/50% rollout is drawn from those tiers/),
    ).toBeTruthy()
    expect(
      screen.getByText(/never reshuffles who already has it/),
    ).toBeTruthy()
  })

  it('publishes the tier list', async () => {
    mockApi({ enabled: false, rolloutPercent: 50, plans: ['pro'] })
    render(<AdminFlags />)
    await screen.findByText('Tiers: Pro')
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0]).toMatchObject({
      key: 'release_contacts',
      plans: ['pro'],
      rolloutPercent: 50,
    })
  })

  it('ALWAYS sends plans, even when nothing is selected', async () => {
    // The route only touches targeting for a caller that sends the key, so
    // omitting it here would make "clear the tier list" the one edit this
    // page could never perform — and it would look like it had worked.
    render(<AdminFlags />)
    await screen.findByText('Contacts CRM')
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(Object.prototype.hasOwnProperty.call(putBodies[0], 'plans')).toBe(
      true,
    )
    expect(putBodies[0].plans).toEqual([])
  })
})
