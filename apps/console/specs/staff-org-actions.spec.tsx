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
 * page carries them too. Pinned here per the issue's contract: every action
 * writes the org doc AND an `adminAudit` entry with the actor uid, suspension
 * sits behind its reason dialog, and erasure is two-step (button → explicit
 * confirmation) that only FLAGS the org — a declined confirmation must write
 * nothing at all.
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

  it('suspends through the reason dialog: org doc flagged, audit entry with the actor', async () => {
    const onChanged = jest.fn()
    render(<StaffOrgActions org={org()} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Suspend'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(
      within(dialog).getByLabelText('Reason (shown to the owner)'),
      { target: { value: 'spam network' } },
    )
    fireEvent.click(within(dialog).getByText('Suspend'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [target, write, options] = setDocPayload()
    expect(target.path).toBe('orgs/org-1')
    expect(options).toEqual({ merge: true })
    expect(write['suspendedAt']).toEqual({ seconds: 1_700_000_000 })
    expect(write['suspendedReason']).toBe('spam network')
    const [auditTarget, audit] = auditPayload()
    expect(auditTarget.path).toBe('adminAudit')
    expect(audit.action).toBe('org.suspend')
    expect(audit.actorUid).toBe('staff-1')
    expect(audit.target).toBe('orgs/org-1')
    expect(audit.after).toEqual({ suspended: true, reason: 'spam network' })
  })

  it('unsuspends: the flag keys become delete sentinels, audited as org.unsuspend', async () => {
    const onChanged = jest.fn()
    render(
      <StaffOrgActions
        org={org({ suspendedAt: { seconds: 1 }, suspendedReason: 'spam' })}
        onChanged={onChanged}
      />,
    )
    fireEvent.click(screen.getByText('Unsuspend'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Unsuspend'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [, write] = setDocPayload()
    expect(write['suspendedAt']).toBe('__DELETE__')
    expect(write['suspendedReason']).toBe('__DELETE__')
    expect(auditPayload()[1].action).toBe('org.unsuspend')
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
