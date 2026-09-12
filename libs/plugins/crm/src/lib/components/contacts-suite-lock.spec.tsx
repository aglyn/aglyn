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
 * THE CONTACTS LIST ON A PLAN WITHOUT THE CRM SUITE (AGL-2788).
 *
 * The list is on every plan, and working its people by hand is the suite's.
 * What must hold on the section the shell mounts — the same component at the
 * organization level and under a site:
 *
 *  1. On Free, **New contact** and **Import CSV** stand locked — present and
 *     disabled — in the toolbar and in the empty state, while **Export CSV**,
 *     the workspace's own data, does not.
 *  2. On Free the list carries the shell's own notice: the plan that includes
 *     the suite, and a link to the plans.
 *  3. On Free every act on a saved view stands locked in the views menu.
 *  4. On Starter none of it is locked and no notice is drawn.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import CrmConsolePage from './crm-console-page'
import { CRM_CONSOLE_SECTIONS } from './crm-console-sections'

const FREE = { $id: 'org-1', plan: 'free' }
const STARTER = { $id: 'org-1', plan: 'starter' }

const CONTACT_ROWS = [
  {
    $id: 'con-1',
    email: 'ada@example.test',
    name: 'Ada',
    sources: ['form'],
    interactions: [],
    tags: [],
    notes: '',
  },
]
/** What the contacts listener answers; emptied by the empty-state case. */
let mockContacts: Array<Record<string, unknown>> = CONTACT_ROWS

/** Stable, as the real hooks' references are — see `contacts-head-count.spec.tsx`. */
const FIRESTORE = {}
const DATA_SCOPE = { scope: ['orgs', 'org-1'] as const }

jest.mock('./recent-activity-feed', () => ({
  __esModule: true,
  default: () => null,
  RecentActivityFeed: () => null,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  listFilterConstraints: jest.requireActual('@aglyn/tenant-feature-instance')
    .listFilterConstraints,
  listFilterPlan: jest.requireActual('@aglyn/tenant-feature-instance').listFilterPlan,
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => DATA_SCOPE,
  useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
  useFirestoreCollection: (build: () => unknown) => ({
    data: build() === 'contacts' ? mockContacts : [],
    status: 'success',
    fromCache: false,
  }),
  useFirestoreDoc: () => ({ data: { total: 0 }, status: 'success', fromCache: false }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
  useUser: () => ({ data: { uid: 'user-1' } }),
  useHostActivityLogger: () => jest.fn(),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => value,
  doc: () => ({}),
  getCountFromServer: async (path: string) => ({
    data: () => ({ count: path === 'contacts' ? mockContacts.length : 0 }),
  }),
  addDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HelpTip: () => null,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('@aglyn/shared-ui-next', () => ({
  HubSections: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
}))

const BASE_PATH = '/acme/hosts/shop/crm'

const mount = (org: Record<string, unknown>) =>
  render(
    <CrmConsolePage
      hostId="host-1"
      entitled
      org={org as never}
      releaseFlag={{ released: true, ready: true }}
      basePath={BASE_PATH}
      sections={CRM_CONSOLE_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        href: `${BASE_PATH}/${section.id}`,
        visible: true,
      }))}
      section="contacts"
      segments={['contacts']}
    />,
  )

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => {
  mockContacts = CONTACT_ROWS
})

describe('the Contacts list on Free', () => {
  it('locks adding a contact and importing a file, and keeps the export', () => {
    mount(FREE)
    expect(button('New contact').disabled).toBe(true)
    expect(button('Import CSV').disabled).toBe(true)
    expect(button('Export CSV').disabled).toBe(false)
  })

  it("carries the shell's notice: the plan that includes the suite, and the way to it", () => {
    mount(FREE)
    expect(screen.getByText(/part of the CRM\. Included from Starter\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View plans' }).getAttribute('href')).toBe(
      '/acme/billing',
    )
  })

  it('locks every act on a saved view, and keeps choosing the plain list', () => {
    mount(FREE)
    fireEvent.click(screen.getByRole('button', { name: 'View: All contacts' }))
    const saveAs = screen.getByRole('menuitem', { name: /Save as view/ })
    expect(saveAs.getAttribute('aria-disabled')).toBe('true')
    expect(within(saveAs).getByText('Part of the CRM, included from Starter')).toBeTruthy()
    expect(
      screen.getByRole('menuitem', { name: 'All contacts' }).getAttribute('aria-disabled'),
    ).toBeNull()
  })

  it('locks the same two acts in the empty state, and says contacts arrive on their own', () => {
    mockContacts = []
    mount(FREE)
    const creates = screen.getAllByRole('button', { name: 'New contact' })
    const imports = screen.getAllByRole('button', { name: 'Import CSV' })
    // The toolbar's and the empty state's.
    expect(creates).toHaveLength(2)
    expect(imports).toHaveLength(2)
    for (const locked of [...creates, ...imports]) {
      expect((locked as HTMLButtonElement).disabled).toBe(true)
    }
    expect(
      screen.getByText(
        'Form submissions, member sign-ups, orders and bookings become contacts on their own.',
      ),
    ).toBeTruthy()
  })
})

describe('the Contacts list on Starter', () => {
  it('opens every act and draws no notice', () => {
    mount(STARTER)
    expect(button('New contact').disabled).toBe(false)
    expect(button('Import CSV').disabled).toBe(false)
    expect(screen.queryByText(/part of the CRM/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View: All contacts' }))
    expect(
      screen.getByRole('menuitem', { name: /Save as view/ }).getAttribute('aria-disabled'),
    ).toBeNull()
  })
})
