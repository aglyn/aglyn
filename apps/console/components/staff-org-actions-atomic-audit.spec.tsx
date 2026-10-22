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
 * AGL-1784/1786: a staff org override and its audit row cannot land
 * separately, and a failure has to say which of them did.
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
 * Every case here asserts both — what left the browser, and what the
 * operator was told.
 *
 * THE OVERRIDE IS NOW A ROUTE (AGL-1786), so its half of this file changed
 * shape. `/api/admin/org-override` holds the atomicity (one Admin SDK batch,
 * covered in specs/org-override-route.spec.ts) and the reason gate; what is
 * asserted HERE is the two things only the client can get wrong:
 *
 *  - it must not write either document itself. The Firestore doubles stay,
 *    and for the override path they are pure TRIPWIRES: any batch, `setDoc`
 *    or `addDoc` on the override path is a return to the client write.
 *  - THE MESSAGE MUST STILL MATCH WHAT HAPPENED, and a route makes that
 *    harder rather than easier. A rejected client commit PROVED nothing was
 *    written; a request that dies in the network proves nothing at all. So
 *    "the organization is unchanged" is claimed only on an explicit
 *    `written: false` from the route, and each of the four other failure
 *    shapes — token refresh, transport, a body without the field, a refusal
 *    that carries it — has its own case below asserting it says something
 *    true.
 *
 * ERASURE IS STILL A CLIENT BATCH, and its cases are unchanged. The
 * Firestore double models atomicity for them: a batch stages writes and
 * applies them only when `commit()` resolves, and a rejected commit applies
 * NONE of them. A double that recorded each `set()` as it was staged would
 * pass against the very split write this replaced. The fault injected,
 * `mockAuditRefused`, is stated on the COLLECTION rather than on the batch,
 * so it reaches an un-batched `setDoc`-then-`addDoc` shape too — where it
 * leaves the flag applied and no audit row.
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

/**
 * What `/api/admin/org-override` answers with. Swapped per case so each of
 * the FIVE distinguishable failure shapes can be produced exactly:
 * a token refresh that throws, a transport failure, a refusal that carries
 * `written: false`, a response that carries no such field, and success.
 */
let mockOverrideResponse: () => Promise<{
  ok: boolean
  status: number
  json: () => Promise<any>
}> = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })

/** Every fetch the component made: `[url, init]`. */
const mockFetches: Array<[string, any]> = []

const overrideCalls = () =>
  mockFetches.filter(([url]) => url === '/api/admin/org-override')
/** The JSON body of the single override POST. */
const overrideBody = () => JSON.parse(overrideCalls()[0][1].body)

beforeEach(() => {
  mockApplied.length = 0
  mockDirect.length = 0
  mockCommits.length = 0
  mockSnacks.length = 0
  mockFetches.length = 0
  mockAuditRefused = false
  mockGetIdToken = async () => 'tok'
  mockConfirmResult = async () => undefined
  mockOverrideResponse = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, written: true }),
  })
  global.fetch = jest.fn(async (url: string, init: any) => {
    mockFetches.push([String(url), init])
    if (String(url) === '/api/admin/org-override') {
      return mockOverrideResponse()
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }) as unknown as typeof fetch
})

describe('staff org override — the write is the route, and nothing else', () => {
  it('POSTs the override and writes NOTHING from the client', async () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(overrideCalls()).toHaveLength(1))
    const [, init] = overrideCalls()[0]
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    // The three tripwires together: no batch, no `setDoc`, no `addDoc`. The
    // reason gate is only a boundary while the client is not also a writer —
    // a component that posted AND wrote would leave the un-audited path open
    // beside the audited one.
    expect(mockCommits).toEqual([])
    expect(mockApplied).toEqual([])
    expect(mockDirect).toEqual([])
  })

  it('sends INTENT, never a payload — a sentinel cannot cross JSON', async () => {
    // The sharpest trap in the migration (AGL-1109/1786). `deleteField()` is
    // the sentinel "inherit" needs under `{ merge: true }`, and it has no
    // JSON form: serialised it arrives as `{}`, which a merge ignores, so a
    // posted payload would silently restore the very no-op the sentinel
    // exists to prevent. Absence is the inherit signal; the route expands it.
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(overrideCalls()).toHaveLength(1))
    const body = overrideBody()
    // The double renders `deleteField()` as the string `__DELETE__`, so a
    // component that built the payload here would be visible in the wire
    // body — as that string, or as the `{}` a real sentinel serialises to.
    expect(JSON.stringify(body)).not.toContain('__DELETE__')
    // Untouched flags are ABSENT, not `{}` and not `null`.
    expect(body.features).toEqual({})
    expect(body.releaseFlags).toEqual({})
    expect(body.orgId).toBe('org-1')
    expect(body.reason).toBe('enterprise')
    expect(body.note).toBeNull()
  })

  it('says the organization is unchanged ONLY on the route’s own written:false', async () => {
    mockOverrideResponse = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Staff only', written: false }),
    })
    const onChanged = jest.fn()
    render(<StaffOrgActions org={ORG} onChanged={onChanged} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(errorSnacks()).toHaveLength(1))
    const message = errorSnacks()[0].message
    // "Write failed" was true of the write and silent about the org, which
    // an operator reads as "nothing happened" — the one thing it could not
    // promise. Here it can, because the route said so.
    expect(message).toMatch(/nothing was written/i)
    expect(message).toMatch(/unchanged/i)
    expect(message).toMatch(/safe to retry/i)
    // And it repeats what the route refused it for, or the operator has to
    // guess which of six validations they tripped.
    expect(message).toContain('Staff only')
    expect(mockSnacks.some((snack) => snack.variant === 'success')).toBe(false)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('refuses to claim "unchanged" for a failure that never reached the route', async () => {
    // THE COST OF THE ROUTE, asserted rather than assumed. A gateway 502, an
    // HTML error page, a proxy timeout: the request may well have committed.
    // A client batch could promise otherwise; this cannot, and AGL-1784's
    // lesson is that the harm was the RETRY a wrong "nothing happened"
    // invited, not the failure itself.
    mockOverrideResponse = async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    })
    const onChanged = jest.fn()
    render(<StaffOrgActions org={ORG} onChanged={onChanged} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(errorSnacks()).toHaveLength(1))
    const message = errorSnacks()[0].message
    expect(message).toMatch(/not known/i)
    expect(message).not.toMatch(/safe to retry/i)
    expect(message).not.toMatch(/nothing was written/i)
    // It has to say what to DO, or "unknown" is just an apology.
    expect(message).toMatch(/audit/i)
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('says the same about a request that never got an answer at all', async () => {
    mockOverrideResponse = async () => {
      throw new TypeError('Failed to fetch')
    }
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(errorSnacks()).toHaveLength(1))
    expect(errorSnacks()[0].message).toMatch(/not known/i)
    expect(errorSnacks()[0].message).not.toMatch(/safe to retry/i)
  })

  it('a failed token refresh IS "nothing was sent" — it never left the browser', async () => {
    // The distinction the route makes possible and a single `try` would
    // destroy: this one really is safe to retry, and saying "unknown" here
    // would send an operator to check an audit log for a request that was
    // never made.
    mockGetIdToken = async () => {
      throw new Error('token refresh failed')
    }
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(errorSnacks()).toHaveLength(1))
    expect(errorSnacks()[0].message).toMatch(/nothing was sent/i)
    expect(errorSnacks()[0].message).toMatch(/safe to retry/i)
    expect(overrideCalls()).toEqual([])
  })

  it('reports success only after the route answers OK', async () => {
    const onChanged = jest.fn()
    render(<StaffOrgActions org={ORG} onChanged={onChanged} />)
    const dialog = await openOverrideWithReason()
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(lastMessage()).toBe('Organization updated (audited)')
    expect(errorSnacks()).toEqual([])
    expect(overrideCalls()).toHaveLength(1)
  })

  it('makes no request at all for a reasonless override', async () => {
    // The gate that DECIDES is the route (specs/org-override-route.spec.ts);
    // the dialog keeps its own so the operator gets an answer about the
    // field in front of them rather than a round trip. Asserted as "nothing
    // was sent" rather than as a disabled attribute — a Save that posted and
    // was refused would still be a regression of the local gate.
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Override' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('Save (audited)'))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(overrideCalls()).toEqual([])
    expect(mockApplied).toEqual([])
    expect(mockSnacks.some((snack) => snack.variant === 'success')).toBe(false)
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
