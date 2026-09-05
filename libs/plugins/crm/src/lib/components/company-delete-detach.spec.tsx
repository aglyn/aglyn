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
 * Deleting a company DETACHES it from every contact first, bounded, and
 * never leaves a link behind (AGL-2597).
 *
 * Firestore does not cascade. A bare `deleteDoc` would leave every contact
 * at the company naming a record that no longer exists — their page linking
 * to nothing, and the `companyIds` mirror still matching a ghost in every
 * query. So the delete is a detach pass and then a delete, and the pass is
 * bounded by what one batch can hold.
 *
 * Two contracts:
 *
 *  1. UNDER THE BOUND, every linked contact is updated in one batch — the
 *     id leaves the mirror and the facet that named it is cleared — and
 *     only then is the document deleted.
 *  2. PAST THE BOUND, the pass detaches what a batch can hold, the document
 *     is NOT deleted, and the person is told more remain. A company is never
 *     deleted while a contact still points at it.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import CompanyDetailPage from './company-detail-page'

const COMPANY_ID = 'c-acme'

/** How many contacts the fake collection holds for this run. */
let linkedContacts = 0
const batchUpdates: Array<{ path: string; update: Record<string, unknown> }> = []
const committed: number[] = []
const deleted: string[] = []
const notices: Array<{ message: string; variant?: string }> = []
const pushes: string[] = []
/** The probe query's `limit`, so the bound is asserted rather than assumed. */
let probeLimit: number | null = null

const contactSnapshot = (index: number) => ({
  id: `con-${index}`,
  ref: { path: `orgs/org-1/contacts/con-${index}` },
  data: () => ({
    email: `person-${index}@acme.com`,
    companyIds: [COMPANY_ID],
    facets: { 'host-1': { sources: {}, interactions: [], companyId: COMPANY_ID } },
  }),
})

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: { path: string }, ...clauses: Array<{ kind: string; value?: number }>) => ({
    ...base,
    limit: clauses.find((clause) => clause.kind === 'limit')?.value ?? null,
  }),
  where: () => ({ kind: 'where' }),
  orderBy: () => ({ kind: 'orderBy' }),
  limit: (value: number) => ({ kind: 'limit', value }),
  getDocs: async (spec: { path: string; limit: number | null }) => {
    probeLimit = spec.limit
    const count = Math.min(linkedContacts, spec.limit ?? linkedContacts)
    return { docs: Array.from({ length: count }, (_, index) => contactSnapshot(index)) }
  },
  getCountFromServer: async () => ({ data: () => ({ count: linkedContacts }) }),
  writeBatch: () => {
    const pending: typeof batchUpdates = []
    return {
      update: (ref: { path: string }, update: Record<string, unknown>) => {
        pending.push({ path: ref.path, update })
      },
      commit: async () => {
        batchUpdates.push(...pending)
        committed.push(pending.length)
      },
    }
  },
  deleteDoc: async (ref: { path: string }) => {
    deleted.push(ref.path)
  },
  updateDoc: jest.fn(),
  setDoc: jest.fn(),
  arrayRemove: (...values: unknown[]) => ({ op: 'arrayRemove', values }),
  arrayUnion: (...values: unknown[]) => ({ op: 'arrayUnion', values }),
  deleteField: () => ({ op: 'delete' }),
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  startAt: () => ({ kind: 'startAt' }),
  endAt: () => ({ kind: 'endAt' }),
}))

const FIRESTORE = {}
// One object for the session, as the real hook hands back.
const USER = { uid: 'uid-1', getIdToken: async () => 'token' }
const DATA_SCOPE = { scope: ['orgs', 'org-1'] as const, orgId: 'org-1', ready: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useUser: () => ({ data: USER }),
  useFirestoreDoc: () => ({
    data: { name: 'Acme', domain: 'acme.com', visibleTo: ['host:host-1'] },
    status: 'success',
    fromCache: false,
  }),
  useFirestoreCollection: () => ({ data: [], status: 'success', fromCache: false }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async () => ({ ok: true, json: async () => ({ members: [] }) }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushes.push(href), replace: jest.fn() }),
  usePathname: () => '/',
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: string, options?: { variant?: string }) =>
      notices.push({ message, variant: options?.variant }),
  }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HelpTip: () => null,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  // The person confirms. `confirm` resolves on accept and rejects on cancel.
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: () => null,
}))

const BASE_PATH = '/acme/hosts/shop/crm'

const mount = () =>
  render(
    <CompanyDetailPage
      id={COMPANY_ID}
      basePath={BASE_PATH}
      hostId="host-1"
      org={{ $id: 'org-1' } as any}
    />,
  )

const clickDelete = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('Delete'))
  })
}

beforeEach(() => {
  linkedContacts = 0
  batchUpdates.length = 0
  committed.length = 0
  deleted.length = 0
  notices.length = 0
  pushes.length = 0
  probeLimit = null
})

describe('deleting a company detaches it from its contacts (AGL-2597)', () => {
  it('unlinks every contact in one batch, then deletes the document', async () => {
    linkedContacts = 3
    mount()

    await clickDelete()

    await waitFor(() => expect(deleted).toEqual([`orgs/org-1/companies/${COMPANY_ID}`]))
    // The probe asks for one past the bound, so "more remain" is a fact.
    expect(probeLimit).toBe(501)
    expect(committed).toEqual([3])
    expect(batchUpdates.map((entry) => entry.path)).toEqual([
      'orgs/org-1/contacts/con-0',
      'orgs/org-1/contacts/con-1',
      'orgs/org-1/contacts/con-2',
    ])
    // The mirror loses the id AND the facet that named it is cleared —
    // half of that is a link that still renders on the contact's page.
    expect(batchUpdates[0].update).toEqual({
      companyIds: { op: 'arrayRemove', values: [COMPANY_ID] },
      'facets.host-1.companyId': { op: 'delete' },
      updatedAt: { op: 'serverTimestamp' },
    })
    // And the page leaves the record it just removed.
    expect(pushes).toEqual([`${BASE_PATH}/companies`])
  })

  it('deletes a company nobody is linked to without a batch', async () => {
    linkedContacts = 0
    mount()

    await clickDelete()

    await waitFor(() => expect(deleted).toHaveLength(1))
    expect(committed).toEqual([])
  })

  it('past the bound: detaches 500, keeps the company, and says more remain', async () => {
    linkedContacts = 750
    mount()

    await clickDelete()

    await waitFor(() => expect(committed).toEqual([500]))
    expect(deleted).toEqual([])
    expect(pushes).toEqual([])
    expect(notices).toContainEqual({
      message: expect.stringMatching(/500 contacts were unlinked .* more remain/),
      variant: 'warning',
    })
  })
})
