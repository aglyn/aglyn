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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * AGL-939: the shared staff org actions — override, suspend/unsuspend and
 * erasure request — extracted from the Organizations list so the org detail
 * page carries them too. Override and erasure write the org doc AND an
 * `adminAudit` entry with the actor uid; erasure is two-step (button →
 * explicit confirmation) that only FLAGS the org — a declined confirmation
 * must write nothing at all.
 *
 * SUSPENSION IS DIFFERENT (AGL-1505): it must flow through the lockdown
 * core — `POST /api/admin/lockdown { scope: 'org' }` — and must NEVER touch
 * Firestore from the client. The legacy client write set the flag and
 * nothing else, so the `orgSuspended` member projection, token revocation
 * and tenant cache eviction never happened. The suspend tests here assert
 * both directions: the route IS called with the core's shape, and the
 * Firestore mocks are NOT — re-adding a direct write turns them red.
 *
 * Authorization is server-side (the scoped Firestore rules and the
 * staff-gated endpoints); the non-staff 403 is asserted against
 * /api/admin/org-usage in org-usage-authz.spec.ts.
 */

const mockSetDoc = jest.fn(async () => undefined)
const mockAddDoc = jest.fn(async () => undefined)
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
  addDoc: (...args: unknown[]) => mockAddDoc(...(args as [])),
  deleteField: () => '__DELETE__',
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 1_700_000_000 }) },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({
    data: { uid: 'staff-1', getIdToken: async () => 'tok' },
  }),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

const mockConfirm = jest.fn()
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

import StaffOrgActions from '../components/staff-org-actions.component'

const org = (over: Record<string, unknown> = {}) => ({
  $id: 'org-1',
  plan: 'pro',
  ...over,
})

const setDocPayload = (index = 0) =>
  mockSetDoc.mock.calls[index] as unknown as [
    { path: string },
    Record<string, unknown>,
    { merge: boolean },
  ]

const auditPayload = (index = 0) =>
  mockAddDoc.mock.calls[index] as unknown as [
    { path: string },
    Record<string, any>,
  ]

describe('StaffOrgActions (AGL-939)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch
  })

  it('suspend flows through the lockdown core: POST /api/admin/lockdown, org scope, reason code + notice', async () => {
    const onChanged = jest.fn()
    render(<StaffOrgActions org={org()} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Suspend'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(
      within(dialog).getByLabelText('Notice (shown to the owner and visitors)'),
      { target: { value: 'spam network' } },
    )
    fireEvent.click(within(dialog).getByText('Suspend'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('/api/admin/lockdown')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({
      scope: 'org',
      targetId: 'org-1',
      action: 'lock',
      reason: 'manual',
      message: 'spam network',
    })
    // The AGL-1505 tripwire: the legacy path wrote the org doc and an
    // adminAudit row from the CLIENT, which set the flag without the
    // projection fan-out, revocation or cache eviction. Re-adding ANY
    // direct write turns these red — the route is the only writer (and it
    // writes the audit row server-side).
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('unsuspend posts action:unlock to the same route — still no direct write', async () => {
    const onChanged = jest.fn()
    render(
      <StaffOrgActions
        org={org({
          suspendedAt: { seconds: 1 },
          suspendedReasonCode: 'security',
        })}
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByText('Unsuspend'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Unsuspend'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { method: string; body: string },
    ]
    expect(url).toBe('/api/admin/lockdown')
    expect(JSON.parse(init.body)).toEqual({
      scope: 'org',
      targetId: 'org-1',
      action: 'unlock',
    })
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('the suspend dialog prefills the stored lockdown reason code and notice', () => {
    render(
      <StaffOrgActions
        org={org({
          suspendedReasonCode: 'security',
          suspendedMessage: 'Account compromised',
        })}
        onChanged={jest.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Suspend'))
    const dialog = screen.getByRole('dialog')
    const notice = within(dialog).getByLabelText(
      'Notice (shown to the owner and visitors)',
    ) as HTMLInputElement
    expect(notice.value).toBe('Account compromised')
    // The MUI select renders its current value as text.
    expect(within(dialog).getByText('security')).toBeTruthy()
  })

  it('a lockdown route failure surfaces the server error and writes nothing', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Requires the super staff role' }),
    })
    const onChanged = jest.fn()
    render(<StaffOrgActions org={org()} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Suspend'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Suspend'))
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Requires the super staff role',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    expect(onChanged).not.toHaveBeenCalled()
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockAddDoc).not.toHaveBeenCalled()
    // The dialog stays open so the operator can retry or bail.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('erasure is two-step: the confirmation names the 7-day hold, then flags and audits', async () => {
    mockConfirm.mockResolvedValueOnce(undefined)
    const onChanged = jest.fn()
    render(<StaffOrgActions org={org()} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Erasure'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Step one: the explicit confirmation, spelling out what happens (and
    // does NOT happen) on confirm.
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Request erasure for this organization?',
        confirmationText: 'Request erasure',
      }),
    )
    // Step two: the flag only — nothing is deleted here.
    const [target, write] = setDocPayload()
    expect(target.path).toBe('orgs/org-1')
    expect(write['erasureRequestedAt']).toEqual({ seconds: 1_700_000_000 })
    const [, audit] = auditPayload()
    expect(audit.action).toBe('org.erasureRequested')
    expect(audit.actorUid).toBe('staff-1')
    // The owner acknowledgement goes to the staff-gated endpoint.
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/erasure-request',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        body: JSON.stringify({ orgId: 'org-1' }),
      }),
    )
  })

  it('a declined erasure confirmation writes NOTHING', async () => {
    mockConfirm.mockRejectedValueOnce(new Error('declined'))
    const onChanged = jest.fn()
    render(<StaffOrgActions org={org()} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Erasure'))
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockAddDoc).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('override saves the plan and explicit entitlements, audited as org.override', async () => {
    const onChanged = jest.fn()
    render(
      <StaffOrgActions
        org={org({ entitlements: { hostLimit: 5 } })}
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByText('Override'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Save (audited)'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [target, write] = setDocPayload()
    expect(target.path).toBe('orgs/org-1')
    expect(write['plan']).toBe('pro')
    expect((write['entitlements'] as any).hostLimit).toBe(5)
    const [, audit] = auditPayload()
    expect(audit.action).toBe('org.override')
    expect(audit.actorUid).toBe('staff-1')
    expect(audit.before).toEqual({
      plan: 'pro',
      entitlements: { hostLimit: 5 },
    })
    // The audit row records resulting STATE — no delete sentinels.
    expect(audit.after.plan).toBe('pro')
    expect(audit.after.entitlements.hostLimit).toBe(5)
    expect(Object.values(audit.after.entitlements.features)).not.toContain(
      '__DELETE__',
    )
  })

  it('renders disabled actions for a null org instead of crashing', () => {
    render(<StaffOrgActions org={null} onChanged={jest.fn()} />)
    for (const label of ['Override', 'Suspend', 'Erasure']) {
      expect(
        (screen.getByText(label).closest('button') as HTMLButtonElement)
          .disabled,
      ).toBe(true)
    }
  })
})
