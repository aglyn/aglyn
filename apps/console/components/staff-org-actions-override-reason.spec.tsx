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
 * AGL-1652/1786: a staff org override may not reach the org document without
 * a reason on its audit row.
 *
 * Every case asserts what LEAVES THE BROWSER, not the disabled attribute on
 * a button. The button is a hint an operator can be shown; the request is
 * what eventually becomes the row a billing dispute reads six months later,
 * and a reason enforced only by a disabled button would be one browser
 * console away from an override nobody can explain.
 *
 * That last sentence used to be the honest LIMIT of this file: the write was
 * a client batch, so the gate was the dialog and this suite could only pin
 * the dialog. Since AGL-1786 the write is `/api/admin/org-override`, and the
 * same `normalizeOrgOverrideReason` runs there — a reasonless request is
 * refused by the ROUTE, asserted in specs/org-override-route.spec.ts, which
 * is where the audit row's own `reason`/`note` are now checked too. What
 * stays here is the dialog's half: the vocabulary it offers, that Save
 * refuses to SEND without one, and that the code and note it does send are
 * the ones chosen.
 *
 * The pairing matters: "nothing was sent" would also pass on a component
 * that crashed on open, so each refusal case is paired with the positive one
 * that proves the same click DOES send once the reason is given.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * Every write a COMMITTED batch applied: [path, data]. The override and its
 * audit row are one batch since AGL-1784, so a refusal has to be read here —
 * and only after `commit()`, never off a staged write.
 */
const mockWrites: Array<[string, Record<string, unknown>]> = []
/** Un-batched writes. The tripwire — nothing here writes directly. */
const mockDirectWrites: string[] = []
/** Snackbar messages, so a refusal can be shown to SAY something. */
const mockSnacks: string[] = []
let mockAutoId = 0

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  // `doc(collectionRef)` — one argument, no segments — is the auto-id form a
  // batch needs, since the reference has to exist before the commit.
  doc: (parent: unknown, ...segments: string[]) =>
    segments.length > 0
      ? segments.join('/')
      : `${String(parent ?? '')}/auto-${++mockAutoId}`,
  deleteField: () => '<<delete>>',
  setDoc: (path: string) => {
    mockDirectWrites.push(`setDoc ${path}`)
    return Promise.resolve()
  },
  addDoc: (path: string) => {
    mockDirectWrites.push(`addDoc ${path}`)
    return Promise.resolve({ id: 'audit-1' })
  },
  writeBatch: () => {
    const staged: Array<[string, Record<string, unknown>]> = []
    return {
      set: (path: string, data: Record<string, unknown>) => {
        staged.push([path, data])
      },
      commit: async () => {
        mockWrites.push(...staged)
      },
    }
  },
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 1_700_000_000, nanoseconds: 0 }) },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: string) => {
      mockSnacks.push(String(message))
    },
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockRejectedValue(new Error('cancelled')),
  }),
}))

// `@aglyn/aglyn` is NOT mocked: the reason vocabulary, its gate and the plan
// model are the code under test here, and staging them would test the mock.
import StaffOrgActions from './staff-org-actions.component'

const ORG = { $id: 'org-1', plan: 'business' }

/** Open the Override dialog and hand back its container. */
const openOverride = (): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name: 'Override' }))
  return screen.getByRole('dialog')
}

/** Pick an option from one of the dialog's MUI selects, by its label. */
const chooseOption = (label: string, optionText: string): void => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }))
  const listbox = screen.getByRole('listbox')
  fireEvent.click(within(listbox).getByText(optionText))
}

const saveButton = (): HTMLButtonElement =>
  screen.getByRole('button', {
    name: 'Save (audited)',
  }) as HTMLButtonElement

const clickSave = (): void => {
  fireEvent.click(saveButton())
}

const auditRows = () =>
  mockWrites
    .filter(([path]) => path.startsWith('adminAudit/'))
    .map(([, data]) => data)

/** The org-document writes that actually landed. */
const orgWrites = () => mockWrites.filter(([path]) => path === 'orgs/org-1')

/** Override requests the component sent, newest last. */
const mockOverridePosts: any[] = []
/**
 * The bodies of the override POSTs — what the gate actually lets out. The
 * org document and its audit row are written from these by the route, not by
 * this component, so a client-side write of either is a regression that
 * `orgWrites()`/`auditRows()` catch as tripwires.
 */
const overrideBodies = () =>
  mockOverridePosts.map((init) => JSON.parse(init.body))

beforeEach(() => {
  mockWrites.length = 0
  mockDirectWrites.length = 0
  mockSnacks.length = 0
  mockOverridePosts.length = 0
  mockAutoId = 0
  global.fetch = jest.fn(async (url: string, init: any) => {
    if (String(url) === '/api/admin/org-override') mockOverridePosts.push(init)
    return { ok: true, status: 200, json: async () => ({ ok: true, written: true }) }
  }) as unknown as typeof fetch
})

describe('staff org override — the reason gate', () => {
  it('sends no override request at all with no reason chosen', () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    openOverride()
    clickSave()

    // Not just "no audit row" — nothing may leave for the org document
    // either. An override that landed and then failed to be audited is the
    // worse half of this bug, not a partial fix of it.
    expect(mockOverridePosts).toHaveLength(0)
    expect(orgWrites()).toHaveLength(0)
    expect(auditRows()).toHaveLength(0)
  })

  it('tells the operator what is missing rather than refusing silently', () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    const dialog = openOverride()
    // Save is unavailable AND the dialog says why — a greyed-out button with
    // no stated requirement is a refusal an operator cannot act on.
    expect(saveButton().disabled).toBe(true)
    expect(
      screen.getByRole('combobox', { name: 'Reason' }).getAttribute(
        'aria-required',
      ),
    ).toBe('true')
    expect(within(dialog).getByText(/append-only/i)).toBeTruthy()
  })

  it('sends the reason code once one is chosen', async () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    openOverride()
    chooseOption('Reason', 'Negotiated enterprise or custom contract')
    clickSave()

    await waitFor(() => expect(mockOverridePosts).toHaveLength(1))
    const body = overrideBodies()[0]
    expect(body['reason']).toBe('enterprise')
    // Explicit null, never undefined — the route writes this straight onto
    // the row, Firestore rejects `undefined`, and a dropped key reads as a
    // row that predates the field.
    expect(body).toHaveProperty('note', null)
    expect(Object.values(body)).not.toContain(undefined)
    // It names the org it is about, and nothing is written from here: the
    // org document and the audit row are both the route's (AGL-1786).
    expect(body['orgId']).toBe('org-1')
    expect(orgWrites()).toHaveLength(0)
    expect(auditRows()).toHaveLength(0)
    expect(mockDirectWrites).toEqual([])
  })

  it('carries the note through when one is typed', async () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    openOverride()
    chooseOption('Reason', 'Support remediation or goodwill')
    fireEvent.change(
      screen.getByLabelText(/Note \(optional/),
      { target: { value: '  ticket 4471 — refunded SLA breach ' } },
    )
    clickSave()

    await waitFor(() => expect(mockOverridePosts).toHaveLength(1))
    expect(overrideBodies()[0]['reason']).toBe('support')
    // Trimmed by the shared normalizer, the same one the route re-runs.
    expect(overrideBodies()[0]['note']).toBe('ticket 4471 — refunded SLA breach')
  })

  it('refuses "other" until the note explains it, then accepts', async () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    openOverride()
    chooseOption('Reason', 'Other — say what, below')
    clickSave()
    // `other` is the one code that means nothing by itself, so choosing it
    // must not be a cheaper way to satisfy the gate than the real codes.
    expect(mockOverridePosts).toHaveLength(0)
    expect(orgWrites()).toHaveLength(0)

    fireEvent.change(screen.getByLabelText(/Note \(required/), {
      target: { value: 'legacy 2024 contract terms' },
    })
    clickSave()
    await waitFor(() => expect(mockOverridePosts).toHaveLength(1))
    expect(overrideBodies()[0]['reason']).toBe('other')
    expect(overrideBodies()[0]['note']).toBe('legacy 2024 contract terms')
  })

  it('does not carry a reason over into the next override', async () => {
    render(<StaffOrgActions org={ORG} onChanged={jest.fn()} />)
    openOverride()
    chooseOption('Reason', 'Correcting an earlier mistake')
    clickSave()
    await waitFor(() => expect(mockOverridePosts).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Reopening must not present the previous reason as this one's — an
    // inherited reason is a reason nobody gave.
    openOverride()
    // MUI renders an empty Select as a zero-width space, so assert the
    // PREVIOUS label is gone rather than that the node is literally empty.
    expect(
      screen.getByRole('combobox', { name: 'Reason' }).textContent,
    ).not.toContain('Correcting')
    expect(saveButton().disabled).toBe(true)
    clickSave()
    expect(mockOverridePosts).toHaveLength(1)
  })
})
