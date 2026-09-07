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
 * THE SITE-LEVEL NOTE, AFTER ITS PIECES WERE SHARED (AGL-2612, AGL-2638).
 *
 * The reader, the switch and the two rows now serve the organization-level
 * note as well; this pins the one-site composition they were lifted from —
 * the sentence, the form's link through the site's console route, and a
 * switch that writes to the site's form and names no site in its toast,
 * because under a site there is only one.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LEAD_ROUTING_NEEDS_CONSENT_FIELD } from '../model/lead-surfaces'
import LeadSurfacesNote from './lead-surfaces-note'

type FakeRef = { path: string }

const FORMS = [
  {
    $id: 'contact',
    displayName: 'Contact',
    routing: { lead: true },
    consentFieldName: 'optIn',
    fields: [{ fieldName: 'email', fieldType: 'email' }],
  },
  {
    $id: 'quote',
    displayName: 'Ask for a quote',
    consentFieldName: 'optIn',
    fields: [{ fieldName: 'email', fieldType: 'email' }],
  },
  {
    $id: 'newsletter',
    displayName: 'Newsletter',
    fields: [{ fieldName: 'email', fieldType: 'email' }],
  },
]

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
  useConsoleHostRoute: () => ({
    base: '/acme/hosts/site',
    orgSlug: 'acme',
    subdomain: 'site',
  }),
  useFirestoreCollection: (buildQuery: () => FakeRef) =>
    buildQuery().path === 'hosts/host-1/forms'
      ? { data: FORMS, status: 'success', fromCache: false }
      : { data: [], status: 'success', fromCache: false },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

beforeEach(() => {
  updateDoc.mockClear()
  enqueueSnackbar.mockClear()
})

describe('LeadSurfacesNote', () => {
  it('names the routed forms in one sentence, each linked through the site route', () => {
    render(<LeadSurfacesNote hostId="host-1" />)
    expect(
      screen.getByText(/Leads are created by member sign-ups, bookings, and forms with lead routing on:/),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe(
      '/acme/hosts/site/forms/contact',
    )
    expect(screen.getByText('Not routing leads:')).toBeTruthy()
  })

  it("writes the switch to the site's form, and the toast names no site", async () => {
    render(<LeadSurfacesNote hostId="host-1" />)
    const live = screen
      .getAllByRole('button', { name: 'Turn on lead routing' })
      .filter((button) => !(button as HTMLButtonElement).disabled)
    expect(live).toHaveLength(1)
    fireEvent.click(live[0])
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'hosts/host-1/forms/quote' },
      { 'routing.lead': true, updatedAt: { op: 'serverTimestamp' } },
    )
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        '"Ask for a quote" now files a lead from every submission that carries an email address.',
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('refuses the form that records no consent, with the reason as the tooltip', () => {
    render(<LeadSurfacesNote hostId="host-1" />)
    const reason = screen.getByLabelText(LEAD_ROUTING_NEEDS_CONSENT_FIELD)
    expect((reason.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
