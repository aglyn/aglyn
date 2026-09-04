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
 * The dashboard's inbox glance.
 *
 * A form submission is the one thing on a site that is waiting for a REPLY,
 * and the dashboard said nothing about it — the count and the senders were
 * two clicks away on the Inbox page.
 *
 * The card is a preview, so what it must not do is claim more than it read:
 * it renders three rows over a four-document window, and the fourth is the
 * PROBE that lets it say there are more without counting the collection.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/** The window the card asked for, and what Firestore answers with. */
let submissions: Array<Record<string, unknown>>
let askedLimit: number | undefined
let askedOrder: string | undefined

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (factory: () => unknown) => {
    factory()
    return { data: submissions, status: 'success', fromCache: false }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: (value: number) => {
    askedLimit = value
    return undefined
  },
  orderBy: (field: string, direction: string) => {
    askedOrder = `${field} ${direction}`
    return undefined
  },
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'demo' }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({
    children,
    header,
    HeaderProps,
  }: {
    children: ReactNode
    header: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      <h2>{header}</h2>
      {HeaderProps?.action}
      {children}
    </div>
  ),
}))

import InboxGlanceCard from './inbox-glance-card.component'

const minutesAgo = (minutes: number) => {
  const at = new Date(Date.now() - minutes * 60_000)
  return { toDate: () => at }
}

const submission = (
  id: string,
  fields: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  $id: id,
  fields,
  formName: 'Contact',
  createdAt: minutesAgo(5),
  read: true,
  ...extra,
})

beforeEach(() => {
  submissions = []
  askedLimit = undefined
  askedOrder = undefined
})

describe('the inbox glance card', () => {
  it('renders nothing until the site has a submission', () => {
    // An empty card about forms on a site with no form is an advertisement,
    // not a summary — the rule every other capability glance follows.
    const { container } = render(<InboxGlanceCard hostId="host-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('names each sender, their form, and how long ago it arrived', () => {
    submissions = [
      submission('s-1', { name: 'Priya Nair', email: 'priya@lumen.co' }),
      submission(
        's-2',
        { email: 'sam@okafor.dev' },
        { formName: 'Quote request', createdAt: minutesAgo(180) },
      ),
    ]
    render(<InboxGlanceCard hostId="host-1" />)
    expect(screen.getByText('Priya Nair')).toBeTruthy()
    expect(screen.getByText('Contact')).toBeTruthy()
    // No name field, so the sender falls back to the email — the same
    // resolution the Inbox page uses, not a second one written here.
    expect(screen.getByText('sam@okafor.dev')).toBeTruthy()
    expect(screen.getByText('Quote request')).toBeTruthy()
    expect(screen.getByText('5m')).toBeTruthy()
    expect(screen.getByText('3h')).toBeTruthy()
  })

  it('reads the newest first, and only a preview of them', () => {
    submissions = [submission('s-1', { name: 'Priya Nair' })]
    render(<InboxGlanceCard hostId="host-1" />)
    // Ordered, because an unordered `limit` is answered in document-id order
    // and would make "newest" a pseudo-random sample.
    expect(askedOrder).toBe('createdAt desc')
    // Three rows plus the probe. A card that read a page of ten to draw
    // three would bill the site for seven documents nobody sees.
    expect(askedLimit).toBe(4)
  })

  it('draws three rows and says the rest are in the Inbox', () => {
    submissions = ['a', 'b', 'c', 'd'].map((id, index) =>
      submission(id, { name: `Sender ${id.toUpperCase()}` }, {
        createdAt: minutesAgo(index + 1),
      }),
    )
    render(<InboxGlanceCard hostId="host-1" />)
    expect(screen.getByText('Sender C')).toBeTruthy()
    // The fourth document is the probe: it is a FACT that more exist, and it
    // is never drawn as a row.
    expect(screen.queryByText('Sender D')).toBeNull()
    expect(screen.getByText(/more in the Inbox/)).toBeTruthy()
  })

  it('counts the unread rows it is actually showing', () => {
    submissions = [
      submission('s-1', { name: 'Priya Nair' }, { read: false }),
      submission('s-2', { name: 'Sam Okafor' }, { read: false }),
      submission('s-3', { name: 'Rae Visitor' }),
    ]
    render(<InboxGlanceCard hostId="host-1" />)
    expect(screen.getByText(/2 unread here/)).toBeTruthy()
    // The dot is the Inbox's own unread mark, one per unread row.
    expect(screen.getAllByLabelText('Unread')).toHaveLength(2)
  })

  it('says so when nothing is waiting', () => {
    submissions = [submission('s-1', { name: 'Priya Nair' })]
    render(<InboxGlanceCard hostId="host-1" />)
    expect(screen.getByText('All caught up')).toBeTruthy()
    expect(screen.queryByLabelText('Unread')).toBeNull()
  })

  it('THE CONTROL: the fixture reaches the card', () => {
    // Guard the guard. Every assertion above is about rendered text, and a
    // mock that answered `undefined` would make the empty-state test pass
    // while proving nothing about the rest.
    submissions = [submission('s-1', { name: 'Priya Nair' })]
    render(<InboxGlanceCard hostId="host-1" />)
    expect(screen.getByText('Inbox')).toBeTruthy()
    expect(screen.getByText('Open inbox')).toBeTruthy()
  })
})
