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
 *
 * The forms now carry figures, which adds three more — the ways a membership
 * number turns into a claim the campaign cannot support:
 *
 *  4. **A windowed campaign reports windowed figures.** A form's flat
 *     counters are lifetime and include submissions from before it was ever
 *     filed here.
 *  5. **A campaign with no dates says its figures are lifetime.** The number
 *     is honest; the label is what stops it reading as the campaign's.
 *  6. **A form in two campaigns says so on its row.** The same submissions
 *     count toward both, and the total is disclosed as non-exclusive.
 *
 * And the figures cost NOTHING: the counters ride on the documents the
 * membership query already returns, so no new listener may appear.
 */

import { displayNameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import type { ListQueryPlan } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/** Every listener the section opened, in order, as a readable description. */
const queries: string[] = []
/** What each listener answers, keyed by its description. */
const rows = new Map<string, Array<Record<string, unknown>>>()
/** The documents each collection holds, for the tables' queries. */
const stored = new Map<string, Array<Record<string, unknown>>>()
/** The plan each table's query was last built from, by collection path. */
const plans = new Map<string, ListQueryPlan>()

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
   * fixture. Only the forms' figures window reads through it.
   */
  useFirestoreCollection: (build: () => any) => {
    const target = build()
    const key = [target.__path, ...(target.__clauses ?? [])].join('|')
    if (!queries.includes(key)) queries.push(key)
    return { data: rows.get(key) ?? [], status: 'success' }
  },
}))

/*
 * Each table is its own query (AGL-3321), answered by the shared double the
 * way Firestore would answer the plan — `deletedAt == null` matches only a
 * document that HOLDS a null, `orderBy` drops one missing its field — over
 * the documents the collection holds.
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => ({
  useListQuery: (options: any) => {
    const path = String(options.collection?.__path ?? '')
    const result = jest
      .requireActual('@aglyn/tenant-feature-instance/testing/list-query-double')
      .useListQueryDouble(() => stored.get(path) ?? [], options)
    plans.set(path, result.plan)
    return result
  },
}))

import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import CampaignMembersSection from './campaign-members-section'

const HOST = 'host-1'
const CAMPAIGN = 'spring-2026'
const SCREENS = `hosts/${HOST}/screens`
const FORMS = `hosts/${HOST}/forms`

/** The figures window over the campaign's forms. */
const FIGURES_KEY = [
  FORMS,
  `campaignIds array-contains ${CAMPAIGN}`,
  'orderBy id',
  'limit 26',
].join('|')

/** A screen as every writer now stores it: its name keys, not deleted. */
const screenDoc = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  $id: id,
  displayName: name,
  versionId: 'v1',
  campaignIds: [CAMPAIGN],
  deletedAt: null,
  ...displayNameSearchFields(name),
  ...extra,
})

/** A form as every writer stores it. */
const formDoc = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  $id: id,
  displayName: name,
  campaignIds: [CAMPAIGN],
  retired: false,
  ...displayNameSearchFields(name),
  ...extra,
})

/**
 * A form's page and the Contacts list are other plugins' (AGL-3080): the
 * section asks the record-route registry, so this stands in the addresses the
 * forms and CRM plugins publish. What each publishes is held in its own spec.
 */
function standInMemberRoutes() {
  registerPluginRecordRoute(
    'form',
    {
      list: () => null,
      record: ({ orgSlug, host }, id) => `/${orgSlug}/hosts/${host}/forms/${id}`,
    },
    { pluginId: 'forms' },
  )
  registerPluginRecordRoute(
    'contact',
    {
      list: ({ orgSlug, host }) => `/${orgSlug}/hosts/${host}/crm/contacts`,
      record: () => null,
    },
    { pluginId: 'crm' },
  )
}

beforeEach(() => {
  standInMemberRoutes()
  queries.length = 0
  rows.clear()
  stored.clear()
  plans.clear()
})

const draw = (span?: { startAtMs?: number | null; endAtMs?: number | null }) =>
  render(
    <CampaignMembersSection
      hostId={HOST}
      campaignId={CAMPAIGN}
      startAtMs={span?.startAtMs ?? null}
      endAtMs={span?.endAtMs ?? null}
    />,
  )

describe('finding the records that name this campaign', () => {
  it('asks each collection for the documents whose array CONTAINS it', () => {
    draw()

    // The control for property (1). An `==` here would be a query that
    // matches only single-campaign records.
    for (const path of [SCREENS, FORMS]) {
      expect(plans.get(path)?.filters).toContainEqual({
        path: 'campaignIds',
        op: 'array-contains',
        value: CAMPAIGN,
      })
      expect(
        plans.get(path)?.filters.some(
          (filter) => filter.path === 'campaignIds' && filter.op === '==',
        ),
      ).toBe(false)
    }
  })

  it('orders on the document name, which every record has', () => {
    draw()
    // `orderBy` matches only documents that HAVE the field, so ordering a
    // membership list on a date would drop the members missing it.
    for (const path of [SCREENS, FORMS]) {
      expect(plans.get(path)?.orderBy).toEqual({ path: '__name__', direction: 'asc' })
    }
    expect(queries).toEqual([FIGURES_KEY])
  })

  it('lists the screens and forms it found, by name', () => {
    stored.set(SCREENS, [screenDoc('landing', 'Spring landing page')])
    stored.set(FORMS, [formDoc('signup', 'Newsletter signup')])

    draw()

    expect(screen.getByText('Spring landing page')).toBeTruthy()
    expect(screen.getByText('Newsletter signup')).toBeTruthy()
  })

  it('lists each kind in the shared grid, which scrolls its own columns (AGL-3045)', () => {
    stored.set(SCREENS, [screenDoc('landing', 'Spring landing page')])
    stored.set(FORMS, [formDoc('signup', 'Newsletter signup')])

    const { container } = draw()

    expect(container.querySelectorAll('table')).toHaveLength(0)
    const grids = screen.getAllByRole('grid')
    expect(grids).toHaveLength(2)
    const [screensGrid, formsGrid] = grids
    expect(within(screensGrid).getByText('Spring landing page')).toBeTruthy()
    // Only the forms carry their own counters, so only they grow the columns.
    const headers = (grid: HTMLElement) =>
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    expect(headers(screensGrid)).toEqual(['Name'])
    expect(headers(formsGrid)).toEqual(['Name', 'Views', 'Started', 'Submissions', 'Leads'])
  })

  it('links a member to its own page', () => {
    stored.set(FORMS, [formDoc('signup', 'Newsletter signup')])

    draw()

    const link = screen.getByText('Newsletter signup').closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/shop/forms/signup')
  })

  it('keeps a screen with no saved version, and says why it has no link', () => {
    // The control for property (2).
    stored.set(SCREENS, [
      screenDoc('draft-page', 'Unsaved landing page', { versionId: undefined }),
    ])

    draw()

    expect(screen.getByText('Unsaved landing page')).toBeTruthy()
    expect(screen.getByText('Unsaved landing page').closest('a')).toBeNull()
    expect(
      screen.getByText('This screen has no saved version yet'),
    ).toBeTruthy()
  })

  it('leaves a deleted screen out ON THE QUERY, by the flag every screen stores', () => {
    /*
     * A soft delete leaves the document and its membership in place. The
     * query asks `deletedAt == null`, which every screen create stamps and
     * the backfill stamped on the older ones — so the tombstone is not a row
     * on any page, rather than a row dropped from the one on screen.
     */
    stored.set(SCREENS, [
      screenDoc('gone', 'Retired page', { deletedAt: 1 }),
      screenDoc('landing', 'Spring landing page'),
    ])

    draw()

    expect(plans.get(SCREENS)?.filters).toContainEqual({
      path: 'deletedAt',
      op: '==',
      value: null,
    })
    expect(screen.getByText('Spring landing page')).toBeTruthy()
    expect(screen.queryByText('Retired page')).toBeNull()
  })

  it('keeps a retired form, which has no soft delete to filter', () => {
    // A form is deleted outright; retired, it still holds what it collected.
    stored.set(FORMS, [formDoc('old', 'Last year’s signup', { retired: true })])

    draw()

    expect(
      plans.get(FORMS)?.filters.map((filter) => filter.path),
    ).toEqual(['campaignIds'])
    expect(screen.getByText('Last year’s signup')).toBeTruthy()
  })

  it('pages through every member, not a window of the first ones', () => {
    stored.set(
      SCREENS,
      Array.from({ length: 30 }, (_, at) =>
        screenDoc(`s-${String(at).padStart(2, '0')}`, `Landing ${at}`),
      ),
    )

    draw()

    expect(screen.queryByText(/More than 25 screens/)).toBeNull()
    const [screensGrid] = screen.getAllByRole('grid')
    expect(within(screensGrid).getByText('Landing 0')).toBeTruthy()
    expect(within(screensGrid).queryByText('Landing 29')).toBeNull()
  })

  it('finds a member past the first page by the start of its name', async () => {
    stored.set(SCREENS, [
      ...Array.from({ length: 30 }, (_, at) =>
        screenDoc(`s-${String(at).padStart(2, '0')}`, `Landing ${at}`),
      ),
      screenDoc('z-last', 'Zebra promo'),
    ])

    draw()
    const [box] = screen.getAllByRole('searchbox')
    act(() => {
      fireEvent.change(box, { target: { value: 'zeb' } })
    })

    await waitFor(() => expect(screen.getByText('Zebra promo')).toBeTruthy())
    // The word is a prefix range on the stored `nameLower`, beside the
    // membership — which holds the query's one array clause.
    const plan = plans.get(SCREENS)
    expect(plan?.refused).toEqual([])
    expect(plan?.filters).toEqual(
      expect.arrayContaining([
        { path: 'nameLower', op: '>=', value: 'zeb' },
        expect.objectContaining({ path: 'nameLower', op: '<=' }),
        { path: 'deletedAt', op: '==', value: null },
      ]),
    )
    expect(plan?.orderBy).toEqual({ path: 'nameLower', direction: 'asc' })
    expect(screen.getByText('Zebra promo')).toBeTruthy()
    expect(screen.getByText(/matches the start of a name/)).toBeTruthy()
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

  it('offers the Contacts page and admits the link is unfiltered', () => {
    // A link that implied a campaign filter would promise a screen the query
    // rule above makes impossible to build.
    draw()
    const link = screen.getByText('Open Contacts').closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/shop/crm/contacts')
    expect(screen.getByText(/opens unfiltered/)).toBeTruthy()
  })

  it('refuses a screen views column and says where views are measured', () => {
    /*
     * A screen keeps no counter on its own document — traffic is a day doc
     * per screen — so a figure here would be a read across screens times days
     * on every open, for a paid entitlement this section does not resolve.
     */
    stored.set(SCREENS, [screenDoc('landing', 'Spring landing page')])

    draw()

    expect(screen.getByText(/Page views are not shown here/)).toBeTruthy()
    const link = screen
      .getByText('The site’s analytics measures it by screen.')
      .closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/shop/analytics')
  })
})

/**
 * A form's counters, arranged so lifetime and windowed answers differ.
 *
 * Forty submissions ever, twenty of them in February and March. A fixture
 * where the two agreed would pass whichever one the component printed.
 */
const FORM_WITH_HISTORY = {
  $id: 'contact',
  displayName: 'Contact',
  campaignIds: [CAMPAIGN],
  stats: {
    submissions: 40,
    views: 400,
    starts: 150,
    periods: {
      '2026-01': { submissions: 20, views: 200, starts: 80 },
      '2026-02': { submissions: 12, views: 120, starts: 40 },
      '2026-03': { submissions: 8, views: 80, starts: 30 },
    },
  },
}

/**
 * The forms, as both reads see them: the table's query and the figures'
 * window hold the same documents.
 */
const holdForms = (forms: Array<Record<string, unknown>>) => {
  const stamped = forms.map((form) => ({
    retired: false,
    ...displayNameSearchFields(form['displayName']),
    ...form,
  }))
  stored.set(FORMS, stamped)
  rows.set(FIGURES_KEY, stamped)
}

describe('what the forms in a campaign hold', () => {
  it('adds up the figures from one window of their own, and no more listeners', () => {
    // The table pages by its query; the sum is one bounded read beside it.
    holdForms([FORM_WITH_HISTORY])

    draw()

    expect(queries).toEqual([FIGURES_KEY])
    expect(screen.getByText('What these forms hold')).toBeTruthy()
  })

  it('says the figures cover the first forms when the campaign holds more', () => {
    holdForms(
      Array.from({ length: 26 }, (_, at) => ({
        ...FORM_WITH_HISTORY,
        $id: `f-${String(at).padStart(2, '0')}`,
        displayName: `Form ${at}`,
      })),
    )

    draw()

    expect(screen.getByText(/These figures add up the first 25 forms/)).toBeTruthy()
  })

  it('windows the figures to a dated campaign’s months', () => {
    // The control for property (4). The lifetime 40 is the number a naive
    // sum would print, and it is the wrong one for a campaign that ran in
    // February and March.
    holdForms([FORM_WITH_HISTORY])

    draw({ startAtMs: Date.UTC(2026, 1, 10), endAtMs: Date.UTC(2026, 2, 20) })

    expect(screen.getAllByText('20').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('40')).toHaveLength(0)
    expect(screen.getByText(/Whole calendar months/)).toBeTruthy()
  })

  it('says a dateless campaign’s figures are lifetime', () => {
    // The control for property (5). The number is right; unlabeled, it reads
    // as something this campaign produced.
    holdForms([FORM_WITH_HISTORY])

    draw()

    expect(screen.getAllByText('40').length).toBeGreaterThan(0)
    expect(screen.getByText(/lifetime totals/)).toBeTruthy()
    expect(screen.getByText(/each form’s whole history/)).toBeTruthy()
  })

  it('never lets a figure read as something the campaign caused', () => {
    holdForms([FORM_WITH_HISTORY])

    draw()

    expect(
      screen.getByText(/not this campaign’s results/),
    ).toBeTruthy()
  })

  it('discloses a form that lends its figures to another campaign', () => {
    // The control for property (6).
    holdForms([
      { ...FORM_WITH_HISTORY, campaignIds: [CAMPAIGN, 'summer-2026'] },
    ])

    draw()

    expect(screen.getByText('Also in 1 other campaign')).toBeTruthy()
    expect(screen.getByText(/not exclusive to this campaign/)).toBeTruthy()
  })

  it('draws a counter nobody wrote as a dash, never as a zero', () => {
    /*
     * `stats.leads` is incremented only for a form whose routing declares it.
     * A zero would say these forms produced no leads, which is a measurement
     * nobody took.
     */
    holdForms([FORM_WITH_HISTORY])

    draw()

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('0')).toHaveLength(0)
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('adds nothing for a form that recorded nothing in the campaign’s months', () => {
    /*
     * A form whose counters predate the month series has no windowed figure.
     * Counting it as zero would claim its quiet months were measured; the
     * note says how many forms the total actually covers instead.
     */
    holdForms([
      FORM_WITH_HISTORY,
      { $id: 'old', displayName: 'Legacy form', stats: { submissions: 500 } },
    ])

    draw({ startAtMs: Date.UTC(2026, 1, 10), endAtMs: Date.UTC(2026, 2, 20) })

    expect(screen.getAllByText('across 1 of 2 forms').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('500')).toHaveLength(0)
  })

  it('draws no holdings block for a campaign with no forms', () => {
    // Nothing to total is not a total of nothing.
    draw()
    expect(screen.queryByText('What these forms hold')).toBeNull()
  })
})
