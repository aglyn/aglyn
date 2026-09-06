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
 * THE ORG-LEVEL LEADS SECTION SAYS WHAT CREATES A LEAD, PER SITE (AGL-2638).
 *
 * The note is pinned on the four things the site note could not do at the
 * org level: it groups by site, with the always-on surfaces named once; its
 * switch writes to THAT site's form and says which site in the toast; a
 * refused form keeps its reason as the tooltip; and past the first three
 * sites it folds, reading nothing for a site it has not opened.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { LEAD_ROUTING_NEEDS_EMAIL_FIELD } from '../model/lead-surfaces'
import OrgLeadSurfacesNote from './org-lead-surfaces-note'

type FakeRef = { path: string }
type FormDoc = Record<string, unknown> & { $id: string }

/** The forms each site's listener answers with, by collection path. */
const FORMS: Record<string, FormDoc[]> = {
  'hosts/host-a/forms': [
    {
      $id: 'wholesale',
      displayName: 'Wholesale inquiry',
      routing: { lead: true },
      consentFieldName: 'optIn',
      fields: [{ fieldName: 'email', fieldType: 'email' }],
    },
    {
      $id: 'catering',
      displayName: 'Catering',
      consentFieldName: 'optIn',
      fields: [{ fieldName: 'email', fieldType: 'email' }],
    },
    {
      $id: 'poll',
      displayName: 'Poll',
      fields: [{ fieldName: 'answer', fieldType: 'text' }],
    },
  ],
  'hosts/host-b/forms': [],
  'hosts/host-c/forms': [
    {
      $id: 'contact',
      displayName: 'Contact',
      routing: { lead: true },
      consentFieldName: 'optIn',
      fields: [{ fieldName: 'email', fieldType: 'email' }],
    },
  ],
}

/** Which collections have been listened to — the fan-out this spec bounds. */
const listened = new Set<string>()
const updateDoc = jest.fn(async () => undefined)
const enqueueSnackbar = jest.fn()

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]): FakeRef => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]): FakeRef => ({ path: segments.join('/') }),
  query: (base: FakeRef) => base,
  orderBy: () => undefined,
  limit: () => undefined,
  serverTimestamp: () => ({ op: 'serverTimestamp' }),
  updateDoc: (...args: unknown[]) => updateDoc(...(args as [])),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (buildQuery: () => FakeRef) => {
    const { path } = buildQuery()
    listened.add(path)
    return { data: FORMS[path] ?? [], status: 'success', fromCache: false }
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

const HOSTS = [
  { id: 'host-a', name: 'Site A', subdomain: 'a' },
  { id: 'host-b', name: 'Site B', subdomain: 'b' },
  // Its subdomain never resolved: named, not linked.
  { id: 'host-c', name: 'Site C', subdomain: null },
]

function mountWith(hosts: typeof HOSTS) {
  return function Mount({ children }: { children: ReactNode }) {
    return (
      <CrmOrgMountProvider
        mount={{ orgId: 'org-1', hostsReady: true, hostsPath: '/acme/hosts', hosts }}
      >
        {children}
      </CrmOrgMountProvider>
    )
  }
}

beforeEach(() => {
  listened.clear()
  updateDoc.mockClear()
  enqueueSnackbar.mockClear()
})

describe('OrgLeadSurfacesNote', () => {
  it('groups the forms by site, naming the always-on surfaces once', () => {
    render(<OrgLeadSurfacesNote />, { wrapper: mountWith(HOSTS) })
    // Sign-ups and bookings are named at the top and nowhere else.
    expect(screen.getAllByText(/member sign-ups, bookings/)).toHaveLength(1)
    // Every site is a group; its forms sit under it and link into the site.
    expect(screen.getByRole('link', { name: 'Site A' }).getAttribute('href')).toBe(
      '/acme/hosts/a/crm/leads',
    )
    expect(screen.getByRole('link', { name: 'Wholesale inquiry' }).getAttribute('href')).toBe(
      '/acme/hosts/a/forms/wholesale',
    )
    expect(screen.getByText('No forms on this site yet.')).toBeTruthy()
    // An unresolved site is named, not linked — and so are its forms.
    expect(screen.queryByRole('link', { name: 'Site C' })).toBeNull()
    expect(screen.getByText('Site C')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Contact' })).toBeNull()
    expect(screen.getByText('Contact')).toBeTruthy()
    // Group order is the mount's: A, then B, then C.
    const a = screen.getByText('Site A')
    const b = screen.getByText('Site B')
    const c = screen.getByText('Site C')
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("writes the switch to that site's form and names the site in the toast", async () => {
    render(<OrgLeadSurfacesNote />, { wrapper: mountWith(HOSTS) })
    const switches = screen.getAllByRole('button', { name: 'Turn on lead routing' })
    // Catering is the one form that could route and does not: one live switch.
    const live = switches.filter((button) => !(button as HTMLButtonElement).disabled)
    expect(live).toHaveLength(1)
    fireEvent.click(live[0])
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'hosts/host-a/forms/catering' },
      { 'routing.lead': true, updatedAt: { op: 'serverTimestamp' } },
    )
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        '"Catering" on Site A now files a lead from every submission that carries an email address.',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('refuses a form that cannot route, with the reason as the tooltip', () => {
    render(<OrgLeadSurfacesNote />, { wrapper: mountWith(HOSTS) })
    const reason = screen.getByLabelText(LEAD_ROUTING_NEEDS_EMAIL_FIELD)
    const button = reason.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('folds past the first three sites, with the count, and reads nothing for a folded site', () => {
    const many = [
      ...HOSTS,
      { id: 'host-d', name: 'Site D', subdomain: 'd' },
      { id: 'host-e', name: 'Site E', subdomain: 'e' },
    ]
    render(<OrgLeadSurfacesNote />, { wrapper: mountWith(many) })
    expect(screen.queryByText('Site D')).toBeNull()
    expect(listened.has('hosts/host-d/forms')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more sites' }))
    expect(screen.getByText('Site D')).toBeTruthy()
    expect(screen.getByText('Site E')).toBeTruthy()
    expect(listened.has('hosts/host-e/forms')).toBe(true)
  })

  it('renders nothing under a site', () => {
    const { container } = render(<OrgLeadSurfacesNote />)
    expect(container.innerHTML).toBe('')
    expect(listened.size).toBe(0)
  })
})
