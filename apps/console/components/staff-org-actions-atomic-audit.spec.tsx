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
 * AGL-1784: a staff org override and its audit row cannot land separately,
 * and a failure has to say which of them did.
 *
 * The override used to be two sequential awaits in one `try` — the org
 * document, then the `adminAudit` row. A failure on the second (a rules
 * denial, App Check, a dropped connection) left the org's plan, entitlements
 * and fee percentages already changed with nothing recording who changed
 * them or why, under a snackbar reading "Write failed", which an operator
 * takes as "nothing happened". The retry that invites then records a
 * `before` that is the already-overridden state, so even the row that
 * eventually lands misrepresents the change.
 *
 * Two halves, and the second does not come free with the first: an atomic
 * write fixes the STATE, but the message is still whatever the catch says.
 * Every case here asserts both — what reached Firestore, and what the
 * operator was told.
 *
 * THE FIRESTORE DOUBLE BELOW IS THE LOAD-BEARING PART, in two ways.
 *
 * It models atomicity: a batch stages writes and applies them only when
 * `commit()` resolves, and a rejected commit applies NONE of them. A double
 * that recorded each `set()` as it was staged, or that let a failed commit
 * leave its earlier writes behind, would pass against the very component
 * this file exists to catch.
 *
 * And it injects ONE FAULT, `mockAuditRefused` — the `adminAudit` write is
 * denied — rather than a fault peculiar to batches. The same fault reaches
 * an un-batched `setDoc`-then-`addDoc` component, where it leaves the org
 * document applied and no audit row, so these cases fail against that shape
 * by naming the defect (`orgWrites()` is not empty) instead of merely
 * finding no batch to break.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

interface Applied {
  /** Which batch staged it — two writes in one batch share this. */
  batch: number
  path: string
  data: Record<string, any>
  options?: unknown
}

/**
 * Writes that actually reached the store, in order — applied by a committed
 * batch, or applied immediately if made un-batched.
 */
const mockApplied: Applied[] = []
/**
 * Un-batched writes. The tripwire: the split-write this issue is about is
 * exactly a `setDoc` followed by an `addDoc`, so re-adding either to these
 * handlers turns the atomicity cases below meaningless — and this red.
 */
const mockDirect: string[] = []
/** Commits attempted, successful or not. */
const mockCommits: number[] = []
/**
 * THE FAULT: the `adminAudit` write is refused — a rules denial, App Check,
 * a dropped connection. Stated as a property of the collection, not of the
 * batch, so the same fault is injectable into either shape.
 */
let mockAuditRefused = false
const mockDenial = () => new Error('permission-denied: adminAudit')
const mockIsAudit = (path: string) => path.startsWith('adminAudit/')
let mockBatchSeq = 0
let mockAutoId = 0

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  // Two forms: `doc(db, 'orgs', id)` addresses a known document, and
  // `doc(collectionRef)` mints the client-side auto-id that `addDoc` would
  // have generated server-side — the form a batch needs, since it must hold
  // the reference before the commit.
  doc: (parent: any, ...segments: string[]) =>
    segments.length > 0
      ? { path: segments.join('/') }
      : { path: `${parent?.path ?? ''}/auto-${++mockAutoId}` },
  deleteField: () => '__DELETE__',
  // An un-batched write applies on its own, the moment it succeeds — which
  // is the whole problem: the org document is already there when the audit
  // row is refused.
  setDoc: (ref: any, data: Record<string, any>, options?: unknown) => {
    mockDirect.push(`setDoc ${ref?.path}`)
    if (mockAuditRefused && mockIsAudit(ref?.path)) {
      return Promise.reject(mockDenial())
    }
    mockApplied.push({ batch: 0, path: ref?.path, data, options })
    return Promise.resolve()
  },
  addDoc: (ref: any, data: Record<string, any>) => {
    const path = `${ref?.path}/auto-${++mockAutoId}`
    mockDirect.push(`addDoc ${ref?.path}`)
    if (mockAuditRefused && mockIsAudit(path)) {
      return Promise.reject(mockDenial())
    }
    mockApplied.push({ batch: 0, path, data })
    return Promise.resolve({ id: 'audit-1' })
  },
  writeBatch: () => {
    const batch = ++mockBatchSeq
    const staged: Applied[] = []
    return {
      set: (ref: any, data: Record<string, any>, options?: unknown) => {
        staged.push({ batch, path: ref?.path, data, options })
      },
      update: (ref: any, data: Record<string, any>) => {
        staged.push({ batch, path: ref?.path, data })
      },
      delete: (ref: any) => {
        staged.push({ batch, path: ref?.path, data: { __deleted: true } })
      },
      commit: async () => {
        mockCommits.push(batch)
        // ATOMIC. A batch carrying a refused document applies NOTHING — not
        // "the ones before it", which is precisely the behaviour under test.
        if (mockAuditRefused && staged.some((w) => mockIsAudit(w.path))) {
          throw mockDenial()
        }
        mockApplied.push(...staged)
      },
    }
  },
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }) },
}))

/** Swapped per-test so a token refresh can be made to fail. */
let mockGetIdToken: () => Promise<string> = async () => 'tok'
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({
    data: { uid: 'staff-1', getIdToken: () => mockGetIdToken() },
  }),
}))

const mockSnacks: Array<{ message: string; variant?: string }> = []
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: (message: string, options?: { variant?: string }) => {
      mockSnacks.push({ message: String(message), variant: options?.variant })
    },
  }),
}))

let mockConfirmResult: () => Promise<unknown> = async () => undefined
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  useConfirmationContext: () => ({ confirm: () => mockConfirmResult() }),
}))

import StaffOrgActions from './staff-org-actions.component'

const ORG = { $id: 'org-1', plan: 'business', entitlements: { hostLimit: 5 } }

const orgWrites = () =>
  mockApplied.filter((write) => write.path === 'orgs/org-1')
const auditRows = () =>
  mockApplied.filter((write) => write.path.startsWith('adminAudit/'))

const errorSnacks = () =>
  mockSnacks.filter((snack) => snack.variant === 'error')
const lastMessage = () => mockSnacks[mockSnacks.length - 1]?.message ?? ''

/** Open Override and give the reason AGL-1652 requires, so Save is live. */
const openOverrideWithReason = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: 'Override' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Reason' }))
  fireEvent.click(
    await screen.findByRole('option', {
      name: 'Negotiated enterprise or custom contract',
    }),
  )
  return dialog
}

beforeEach(() => {
  mockApplied.length = 0
  mockDirect.length = 0
  mockCommits.length = 0
  mockSnacks.length = 0
  mockAuditRefused = false
  mockGetIdToken = async () => 'tok'
  mockConfirmResult = async () => undefined
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({}),
  })) as unknown as typeof fetch
})

describe('staff org override — the org doc and its audit row are one write', () => {
  it('commits BOTH documents in a single batch, never as two writes', async () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(auditRows()).toHaveLength(1))
    expect(orgWrites()).toHaveLength(1)
    // One commit, and both writes staged on the SAME batch. Two batches
    // committed back to back would be the same bug wearing the new API.
    expect(mockCommits).toHaveLength(1)
    expect(auditRows()[0].batch).toBe(orgWrites()[0].batch)
    // And nothing went around the batch.
    expect(mockDirect).toEqual([])
    // The AGL-201/1652 contract is unchanged by the batching: the org write
    // is still a merge, and the row still carries actor, action and reason.
    expect(orgWrites()[0].options).toEqual({ merge: true })
    expect(auditRows()[0].data.action).toBe('org.override')
    expect(auditRows()[0].data.actorUid).toBe('staff-1')
    expect(auditRows()[0].data.reason).toBe('enterprise')
    expect(auditRows()[0].data.note).toBeNull()
    // Firestore rejects `undefined`; an explicit null is the contract.
    expect(Object.values(auditRows()[0].data)).not.toContain(undefined)
  })

  it('a refused commit leaves the ORG DOCUMENT untouched, not just the row', async () => {
    // The defect exactly: the audit row is the write that fails, and the
    // override has already landed by then.
    mockAuditRefused = true
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(errorSnacks()).toHaveLength(1))
    // THE defect, asserted first so a regression reads as "the override
    // landed anyway" rather than as some downstream bookkeeping difference.
    expect(orgWrites()).toEqual([])
    expect(auditRows()).toEqual([])
    expect(mockCommits).toHaveLength(1)
    expect(mockDirect).toEqual([])
  })

  it('says the organization is unchanged, rather than only that a write failed', async () => {
    mockAuditRefused = true
    const onChanged = jest.fn()
    render(<StaffOrgActions org={ORG} onChanged={onChanged} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(errorSnacks()).toHaveLength(1))
    const message = errorSnacks()[0].message
    // "Write failed" was true of the write and silent about the org, which
    // an operator reads as "nothing happened" — the one thing it could not
    // promise. The message has to state the outcome it now can promise.
    expect(message).toMatch(/nothing was written/i)
    expect(message).toMatch(/unchanged/i)
    expect(message).not.toMatch(/^Write failed/)
    // No success claim alongside it, and the dialog stays open so the
    // operator can retry from the values they entered.
    expect(mockSnacks.some((snack) => snack.variant === 'success')).toBe(false)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('reports success only after the commit resolves', async () => {
    const onChanged = jest.fn()
    render(<StaffOrgActions org={ORG} onChanged={onChanged} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(lastMessage()).toBe('Organization updated (audited)')
    expect(errorSnacks()).toEqual([])
    expect(auditRows()).toHaveLength(1)
  })
})

describe('erasure request — the same shape, the same guarantee', () => {
  const clickErasure = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Erasure' }))
  }

  it('commits the flag and its audit row together', async () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    clickErasure()

    await waitFor(() => expect(auditRows()).toHaveLength(1))
    expect(mockCommits).toHaveLength(1)
    expect(orgWrites()).toHaveLength(1)
    expect(auditRows()[0].batch).toBe(orgWrites()[0].batch)
    expect(auditRows()[0].data.action).toBe('org.erasureRequested')
    expect(mockDirect).toEqual([])
  })

  it('a refused commit leaves the org unflagged, and says so', async () => {
    mockAuditRefused = true
    const onChanged = jest.fn()
    render(<StaffOrgActions org={ORG} onChanged={onChanged} />)
    clickErasure()

    await waitFor(() => expect(errorSnacks()).toHaveLength(1))
    // The flag is the defect here too: un-batched, it is already set by the
    // time the audit row is refused.
    expect(orgWrites()).toEqual([])
    expect(auditRows()).toEqual([])
    expect(errorSnacks()[0].message).toMatch(/nothing was written/i)
    // The owner is not told an erasure was requested that was not.
    expect(global.fetch).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('a failed owner acknowledgement is NOT reported as a failed write', async () => {
    // The other half of the trap. The token refresh and the best-effort
    // /api/admin/erasure-request call happen AFTER the commit; if they sit
    // inside the same `try`, their failure reaches a catch that announces
    // "nothing was written" about a write that landed — the original lie,
    // relocated. Everything after the commit belongs outside it.
    mockGetIdToken = async () => {
      throw new Error('token refresh failed')
    }
    const onChanged = jest.fn()
    render(<StaffOrgActions org={ORG} onChanged={onChanged} />)
    clickErasure()

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(auditRows()).toHaveLength(1)
    expect(errorSnacks()).toEqual([])
    expect(lastMessage()).toMatch(/Erasure requested/)
  })

  it('a declined confirmation commits nothing at all', async () => {
    mockConfirmResult = async () => {
      throw new Error('declined')
    }
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    clickErasure()

    await waitFor(() => expect(mockCommits).toEqual([]))
    expect(mockApplied).toEqual([])
    expect(mockDirect).toEqual([])
  })
})
