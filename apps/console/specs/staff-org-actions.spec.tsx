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
 *
 * Override and erasure each write their org document and their audit row in
 * ONE BATCH (AGL-1784), so the assertions below read the batch rather than
 * `setDoc`/`addDoc` — which now stand as tripwires for a return to two
 * independent writes. The atomicity itself is covered in
 * staff-org-actions-atomic-audit.spec.tsx; what these cases pin is that the
 * PAYLOADS AGL-201/939/1109/1635/1652 established are unchanged by the move.
 */

/** Un-batched writes. Must stay uncalled: nothing here writes directly. */
const mockSetDoc = jest.fn(async () => undefined)
const mockAddDoc = jest.fn(async () => undefined)
/**
 * Writes a COMMITTED batch applied: `[ref, data, options]`, the shape the
 * `setDoc`/`addDoc` assertions already read. Staged writes are recorded only
 * when `commit()` resolves — a double that recorded each `set()` as it
 * arrived would pass against the split-write this replaced.
 */
const mockBatchWrites: Array<
  [{ path: string }, Record<string, any>, unknown]
> = []
const mockCommit = jest.fn(async () => undefined)
let mockAutoId = 0
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  // `doc(db, 'orgs', id)` names a document; `doc(collectionRef)` mints the
  // auto-id `addDoc` used to generate, which a batch needs up front.
  doc: (parent: any, ...segments: string[]) =>
    segments.length > 0
      ? { path: segments.join('/') }
      : { path: `${parent?.path ?? ''}/auto-${++mockAutoId}` },
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  setDoc: (...args: unknown[]) => mockSetDoc(...(args as [])),
  addDoc: (...args: unknown[]) => mockAddDoc(...(args as [])),
  deleteField: () => '__DELETE__',
  writeBatch: () => {
    const staged: Array<[{ path: string }, Record<string, any>, unknown]> = []
    return {
      set: (ref: { path: string }, data: Record<string, any>, options?: unknown) => {
        staged.push([ref, data, options])
      },
      commit: async () => {
        await mockCommit()
        mockBatchWrites.push(...staged)
      },
    }
  },
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

/** The org-document write out of the committed batch. */
const setDocPayload = (index = 0) =>
  mockBatchWrites.filter(
    ([ref]) => !ref.path.startsWith('adminAudit'),
  )[index] as unknown as [
    { path: string },
    Record<string, unknown>,
    { merge: boolean },
  ]

/** The `adminAudit` row out of the same committed batch. */
const auditPayload = (index = 0) =>
  mockBatchWrites.filter(([ref]) =>
    ref.path.startsWith('adminAudit'),
  )[index] as unknown as [{ path: string }, Record<string, any>]

describe('StaffOrgActions (AGL-939)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBatchWrites.length = 0
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
    // client write turns these red — direct or batched — because the route
    // is the only writer (and it writes the audit row server-side).
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockAddDoc).not.toHaveBeenCalled()
    // Batched or not, still no client write (AGL-1784 gave this component a
    // second way to reach Firestore, and the tripwire has to cover it).
    expect(mockCommit).not.toHaveBeenCalled()
    expect(mockBatchWrites).toEqual([])
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
    // Batched or not, still no client write (AGL-1784 gave this component a
    // second way to reach Firestore, and the tripwire has to cover it).
    expect(mockCommit).not.toHaveBeenCalled()
    expect(mockBatchWrites).toEqual([])
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
    // Batched or not, still no client write (AGL-1784 gave this component a
    // second way to reach Firestore, and the tripwire has to cover it).
    expect(mockCommit).not.toHaveBeenCalled()
    expect(mockBatchWrites).toEqual([])
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
    // Batched or not, still no client write (AGL-1784 gave this component a
    // second way to reach Firestore, and the tripwire has to cover it).
    expect(mockCommit).not.toHaveBeenCalled()
    expect(mockBatchWrites).toEqual([])
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
    // An override needs a REASON since AGL-1652 — Save is refused without
    // one, so every case that saves has to give one.
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Reason' }))
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'Negotiated enterprise or custom contract',
      }),
    )
    fireEvent.click(within(dialog).getByText('Save (audited)'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [target, write] = setDocPayload()
    expect(target.path).toBe('orgs/org-1')
    expect(write['plan']).toBe('pro')
    expect((write['entitlements'] as any).hostLimit).toBe(5)
    const [, audit] = auditPayload()
    expect(audit.action).toBe('org.override')
    expect(audit.actorUid).toBe('staff-1')
    // WHO and WHY, not just who (AGL-1652). The note is an explicit null,
    // never a dropped key — Firestore rejects `undefined`, and an absent
    // key would read as a row written before the field existed.
    expect(audit.reason).toBe('enterprise')
    expect(audit.note).toBeNull()
    // `releaseFlags` joined the audited before-state in AGL-1635; an org
    // with no per-org release override records an explicit null rather than
    // omitting the key, so a reader can tell "none set" from "not recorded".
    expect(audit.before).toEqual({
      plan: 'pro',
      entitlements: { hostLimit: 5 },
      releaseFlags: null,
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
