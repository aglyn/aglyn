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
 *
 * @jest-environment jsdom
 */

/**
 * THE OTHER END OF THE EDGE.
 *
 * A record names its campaigns; this section is the campaign asking who names
 * it. Three properties make that answer trustworthy, and each of them is a
 * way the section could be quietly wrong instead:
 *
 *  1. **The join is `array-contains`, on the member's own field.** Equality
 *     would match only a record whose ENTIRE membership is this one campaign,
 *     so every landing page re-run for a second push would vanish from the
 *     campaign that still holds it.
 *  2. **A member with nowhere to link stays visible.** A screen with no saved
 *     version has no console address; dropping it would under-report the
 *     campaign, and linking it anyway would 404.
 *  3. **Contacts are named and not listed, on purpose.** Every client read of
 *     the contact collection spends its one array clause on `visibleTo`, so
 *     there is no query that also filters by campaign. The section says so
 *     rather than leaving contacts out, which would read as "a contact cannot
 *     be assigned" — the opposite of the truth.
 */

import { render, screen } from '@testing-library/react'

/** Every query the section built, in order, as a readable description. */
const queries: string[] = []
/** What each query answers, keyed by its description. */
const rows = new Map<string, Array<Record<string, unknown>>>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  documentId: () => ({ __clause: 'id' }),
  limit: (max: number) => ({ __clause: `limit ${max}` }),
  orderBy: (field: any) => ({ __clause: `orderBy ${field.__clause ?? field}` }),
  where: (field: string, op: string, value: unknown) => ({
    __clause: `${field} ${op} ${String(value)}`,
  }),
  query: (source: any, ...clauses: any[]) => ({
    __path: source.__path,
    __clauses: clauses.map((clause) => clause.__clause),
  }),
}))

const FIRESTORE = { __firestore: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'shop' }),
  /*
   * The listener double records the query it was handed and answers from the
   * fixture. Recording is half the point: an implementation that read the
   * whole collection and filtered in JavaScript would render exactly the same
   * rows on a fixture this small, and only the query text tells them apart.
   */
  useFirestoreCollection: (build: () => any) => {
    const target = build()
    const key = [target.__path, ...(target.__clauses ?? [])].join('|')
    if (!queries.includes(key)) queries.push(key)
    return { data: rows.get(key) ?? [], status: 'success' }
  },
}))

import CampaignMembersSection from './campaign-members-section'

const HOST = 'host-1'
const CAMPAIGN = 'spring-2026'

const queryKey = (collectionName: string) =>
  [
    `hosts/${HOST}/${collectionName}`,
    `campaignIds array-contains ${CAMPAIGN}`,
    'orderBy id',
    'limit 26',
  ].join('|')

beforeEach(() => {
  queries.length = 0
  rows.clear()
})

const draw = () =>
  render(<CampaignMembersSection hostId={HOST} campaignId={CAMPAIGN} />)

describe('finding the records that name this campaign', () => {
  it('asks each collection for the documents whose array CONTAINS it', () => {
    draw()

    // The control for property (1). An `==` here would be a query that
    // matches only single-campaign records.
    expect(queries).toContain(queryKey('forms'))
    expect(queries).toContain(queryKey('screens'))
    for (const built of queries) {
      expect(built).toContain('array-contains')
      expect(built).not.toContain('campaignIds == ')
    }
  })

  it('orders on the document name, which every record has', () => {
    draw()
    // `orderBy` matches only documents that HAVE the field, so ordering a
    // membership list on a date would drop the members missing it.
    for (const built of queries) expect(built).toContain('orderBy id')
  })

  it('lists the screens and forms it found, by name', () => {
    rows.set(queryKey('screens'), [
      { $id: 'landing', displayName: 'Spring landing page', versionId: 'v1' },
    ])
    rows.set(queryKey('forms'), [
      { $id: 'signup', displayName: 'Newsletter signup' },
    ])

    draw()

    expect(screen.getByText('Spring landing page')).toBeTruthy()
    expect(screen.getByText('Newsletter signup')).toBeTruthy()
  })

  it('links a member to its own page', () => {
    rows.set(queryKey('forms'), [
      { $id: 'signup', displayName: 'Newsletter signup' },
    ])

    draw()

    const link = screen.getByText('Newsletter signup').closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/shop/forms/signup')
  })

  it('keeps a screen with no saved version, and says why it has no link', () => {
    // The control for property (2).
    rows.set(queryKey('screens'), [
      { $id: 'draft-page', displayName: 'Unsaved landing page' },
    ])

    draw()

    expect(screen.getByText('Unsaved landing page')).toBeTruthy()
    expect(screen.getByText('Unsaved landing page').closest('a')).toBeNull()
    expect(
      screen.getByText('This screen has no saved version yet'),
    ).toBeTruthy()
  })

  it('drops a member the console has already deleted', () => {
    /*
     * A soft delete leaves the document and its membership in place, so the
     * campaign's query still returns it. Listing it would offer a link to a
     * record the reader cannot open — and it cannot be filtered in the query,
     * because an equality on `deletedAt` matches only documents that HAVE
     * the field, which would hide every live record instead.
     */
    rows.set(queryKey('screens'), [
      {
        $id: 'gone',
        displayName: 'Retired page',
        versionId: 'v1',
        deletedAt: 1,
      },
      { $id: 'landing', displayName: 'Spring landing page', versionId: 'v1' },
    ])

    draw()

    expect(screen.getByText('Spring landing page')).toBeTruthy()
    expect(screen.queryByText('Retired page')).toBeNull()
  })

  it('says a campaign holds nothing rather than drawing an empty table', () => {
    draw()
    expect(screen.getByText(/No screen is in this campaign/)).toBeTruthy()
    expect(screen.getByText(/No form is in this campaign/)).toBeTruthy()
  })
})

describe('what the section refuses to claim', () => {
  it('names the assignment as a grouping, not as reach', () => {
    draw()
    /*
     * Every figure above this section on the campaign page is measured from
     * the campaign's own sends. This one is a declaration, and the copy has
     * to keep a reader from adding them together.
     */
    expect(screen.getByText(/Assignment is a grouping/)).toBeTruthy()
  })

  it('names contacts, and does not query them', () => {
    // The control for property (3): a section that quietly listed contacts
    // would be issuing a query the rules refuse for a scoped member.
    draw()
    expect(screen.getByText('Contacts')).toBeTruthy()
    for (const built of queries) expect(built).not.toContain('contacts')
  })
})
