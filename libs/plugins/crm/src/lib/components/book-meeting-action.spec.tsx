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
 * THE BOOKING DOOR ON A RECORD (AGL-2660).
 *
 * The action is drawn only where a booking can be taken — the Bookings
 * plugin runs on the record's site and the plan is entitled to it — and is
 * absent, not disabled, everywhere else. The dialog lists the site's
 * services with the link the Bookings model builds, carrying the record as
 * `?crm=kind:id`; from the email dialog each service also inserts.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BookMeetingButton, insertLinkAtCaret } from './book-meeting-action'

/** The site document the door reads: its naming and its per-site deny-list. */
let hostDoc: Record<string, unknown> | undefined
/** The site's services, as the dialog lists them. */
let services: Array<Record<string, unknown>> = []

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (ref: unknown) => ref,
  limit: () => undefined,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const ref = build()
    if (!ref) return { data: undefined, status: 'success' }
    return { data: hostDoc, status: 'success' }
  },
  useFirestoreCollection: () => ({ data: services, status: 'success' }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useSitePluginConfig: () => ({ config: { bookingPath: '/book' }, overrides: [], ready: true }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: () => undefined }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  MdiIcon: () => null,
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
}))

/** A workspace running Bookings on a plan that includes it. */
const org = { enabledPlugins: ['bookings', 'crm'], entitlements: { features: { bookings: true } } }

beforeEach(() => {
  hostDoc = { subdomain: 'acme', cname: null }
  services = [
    { $id: 'svc-1', name: 'Intro call', durationMinutes: 30, priceUsd: 0 },
    { $id: 'svc-2', name: 'Consultation', durationMinutes: 60, priceUsd: 150 },
  ]
})

describe('BookMeetingButton', () => {
  it('renders nothing where the site has switched Bookings off', () => {
    hostDoc = { subdomain: 'acme', disabledPlugins: ['bookings'] }
    render(<BookMeetingButton hostId="host-1" org={org} kind="contact" recordId="c-1" />)
    expect(screen.queryByRole('button', { name: 'Book a meeting' })).toBeNull()
  })

  it('renders nothing where the workspace never enabled Bookings', () => {
    render(
      <BookMeetingButton
        hostId="host-1"
        org={{ ...org, enabledPlugins: ['crm'] }}
        kind="contact"
        recordId="c-1"
      />,
    )
    expect(screen.queryByRole('button', { name: 'Book a meeting' })).toBeNull()
  })

  it('renders nothing where the plan is not entitled to Bookings', () => {
    render(
      <BookMeetingButton
        hostId="host-1"
        org={{ enabledPlugins: ['bookings'], entitlements: { features: { bookings: false } } }}
        kind="contact"
        recordId="c-1"
      />,
    )
    expect(screen.queryByRole('button', { name: 'Book a meeting' })).toBeNull()
  })

  it('renders nothing for a record no site has captured', () => {
    render(<BookMeetingButton hostId={null} org={org} kind="deal" recordId="d-1" />)
    expect(screen.queryByRole('button', { name: 'Book a meeting' })).toBeNull()
  })

  it('lists each service with its link carrying the record, sorted by name', () => {
    render(<BookMeetingButton hostId="host-1" org={org} kind="lead" recordId="lead-9" />)
    fireEvent.click(screen.getByRole('button', { name: 'Book a meeting' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const links = screen
      .getAllByText(/^https:\/\//)
      .map((node) => node.textContent)
    expect(links).toEqual([
      'https://acme.aglyn.app/book?service=svc-2&crm=lead%3Alead-9',
      'https://acme.aglyn.app/book?service=svc-1&crm=lead%3Alead-9',
    ])
    expect(screen.getByText('60 min · $150')).toBeTruthy()
    expect(screen.getByText('30 min · free')).toBeTruthy()
    // Without an email draft to insert into, there is nothing to insert.
    expect(screen.queryByRole('button', { name: 'Insert into email' })).toBeNull()
  })

  it('says why there is no link on a site with no public address, and cannot copy one', () => {
    hostDoc = { subdomain: null, cname: null }
    render(<BookMeetingButton hostId="host-1" org={org} kind="contact" recordId="c-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Book a meeting' }))
    expect(
      screen.getAllByText('This site has no public address yet, so there is no link.'),
    ).toHaveLength(2)
    expect(
      (screen.getByRole('button', { name: 'Copy link for Intro call' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('points at the services page when there is nothing bookable yet', () => {
    services = []
    render(<BookMeetingButton hostId="host-1" org={org} kind="contact" recordId="c-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Book a meeting' }))
    expect(screen.getByText('No bookable services yet.', { exact: false })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Set up services' }).getAttribute('href')).toBe(
      '/acme/hosts/site/bookings',
    )
  })

  it('as a chip, hands the chosen link to the email draft and closes', () => {
    const onInsert = jest.fn()
    render(
      <BookMeetingButton
        variant="chip"
        hostId="host-1"
        org={org}
        kind="deal"
        recordId="deal-3"
        onInsert={onInsert}
      />,
    )
    fireEvent.click(screen.getByText('Insert booking link'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Insert into email' })[1])
    expect(onInsert).toHaveBeenCalledWith(
      'https://acme.aglyn.app/book?service=svc-1&crm=deal%3Adeal-3',
    )
  })
})

describe('insertLinkAtCaret', () => {
  const link = 'https://acme.aglyn.app/?service=s'

  it('drops the link at the caret with a space on each side where the text runs into it', () => {
    const out = insertLinkAtCaret('Book here please', link, 9, 9)
    expect(out.text).toBe(`Book here ${link} please`)
    expect(out.caret).toBe(`Book here ${link}`.length)
  })

  it('adds no space beside whitespace, a line end, or an edge of the draft', () => {
    expect(insertLinkAtCaret('', link, 0, 0).text).toBe(link)
    expect(insertLinkAtCaret('Hello\n', link, 6, 6).text).toBe(`Hello\n${link}`)
    expect(insertLinkAtCaret('Hi ', link, 3, 3).text).toBe(`Hi ${link}`)
    expect(insertLinkAtCaret('a\nb', link, 1, 1).text).toBe(`a ${link}\nb`)
  })

  it('replaces the selection and clamps a caret past the end', () => {
    expect(insertLinkAtCaret('Book HERE now', link, 5, 9).text).toBe(`Book ${link} now`)
    const out = insertLinkAtCaret('Hi', link, 50, 50)
    expect(out.text).toBe(`Hi ${link}`)
    expect(out.caret).toBe(out.text.length)
  })
})
