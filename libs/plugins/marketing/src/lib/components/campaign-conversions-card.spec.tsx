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
 * THE CONVERSIONS SURFACE — the three properties it exists to hold.
 *
 *  1. The uncredited conversions are ON THE PAGE. A list of attribution
 *     records is a list of the successes, and showing only those renders "we
 *     credited nine of these" as "nine of these happened".
 *  2. The web channel is a SEPARATE LIST and never a rollup. A `utm_` label
 *     is free text with an unbounded key space; grouping on it builds a map
 *     anybody who can vary a query string can grow.
 *  3. One kind at a time, so no view exists in which two could be totalled.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

/** Rows each paged listener answers, keyed by the query the card built. */
const pages = new Map<string, { rows: any[]; hasMore: boolean }>()
/** Every query the card built, in order, as a readable description. */
const built: string[] = []
/** What each `getCountFromServer` answers, keyed by the counted path. */
const counts = new Map<string, number>()
/** Docs each one-shot `getDocs` answers, keyed by the query description. */
const fetched = new Map<string, { id: string; data: any }[]>()

const describeQuery = (parts: string[]): string => parts.join('|')

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    __kind: 'collection',
    __path: segments.join('/'),
  }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({
    __kind: 'where',
    text: `${field}${op}${String(value)}`,
  }),
  orderBy: (field: string) => ({ __kind: 'orderBy', text: `order:${field}` }),
  limit: (value: number) => ({ __kind: 'limit', text: `limit:${value}` }),
  query: (source: any, ...clauses: any[]) => ({
    __kind: 'query',
    __path: source.__path,
    __clauses: [...(source.__clauses ?? []), ...clauses.map((c) => c.text)],
  }),
  /*
   * Resolved on a MACROTASK, which is the fixture's honesty: a server
   * aggregate is a network round-trip and its answer cannot land in the same
   * microtask drain as the mount that asked for it. A double that resolved
   * immediately lets a settle helper counting microtasks look correct.
   */
  getCountFromServer: async (target: any) => {
    const key = describeQuery([target.__path, ...(target.__clauses ?? [])])
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { data: () => ({ count: counts.get(key) ?? 0 }) }
  },
  getDocs: async (target: any) => {
    const key = describeQuery([target.__path, ...(target.__clauses ?? [])])
    const docs = fetched.get(key) ?? []
    return { docs: docs.map((one) => ({ id: one.id, data: () => one.data })) }
  },
}))

/*
 * ONE handle, hoisted. The real `useFirestore` hands out the same instance
 * every render; a double that builds a fresh object per render changes the
 * identity of every callback derived from it, so the count effect tears down
 * and reopens on every render and the component never settles.
 */
const FIRESTORE = { __firestore: true }
/** Memoised by the real hook, for the reason above. */
const ORG_SCOPE = { scope: ['orgs', 'org1'] as const }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => ORG_SCOPE,
  usePagedCollection: (build: (pageLimit: number) => any | null) => {
    const target = build(10)
    if (!target) {
      return {
        rows: [],
        hasMore: false,
        page: 0,
        setPage: () => undefined,
        pageSize: 10,
        setPageSize: () => undefined,
      }
    }
    const key = describeQuery([target.__path, ...(target.__clauses ?? [])])
    built.push(key)
    const answer = pages.get(key) ?? { rows: [], hasMore: false }
    return {
      rows: answer.rows,
      hasMore: answer.hasMore,
      page: 0,
      setPage: () => undefined,
      pageSize: 10,
      setPageSize: () => undefined,
    }
  },
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const ATTRIBUTIONS = 'hosts/site1/campaignAttributions'

/** The email list's query, as the card builds it for one kind. */
const emailKey = (kind: string) =>
  describeQuery([
    ATTRIBUTIONS,
    `kind==${kind}`,
    'channel==email',
    'order:__name__',
    'limit:10',
  ])

/** The web list's query, which is a SEPARATE query and not a grouping. */
const webKey = (kind: string) =>
  describeQuery([
    ATTRIBUTIONS,
    `kind==${kind}`,
    'channel==web',
    'order:__name__',
    'limit:10',
  ])

const row = (over: Record<string, unknown>) => ({
  $id: 'form:sub_1',
  kind: 'form',
  refId: 'sub_1',
  channel: 'email',
  campaignId: 'camp_7',
  convertedAtMs: 1_700_200_000_000,
  model: 'last-click',
  windowDays: 7,
  ...over,
})

async function renderCard(campaignId?: string): Promise<void> {
  const { CampaignConversionsCard } = await import(
    './campaign-conversions-card'
  )
  render(
    (
      <CampaignConversionsCard
        hostId="site1"
        basePath="/acme/hosts/site/marketing"
        campaignId={campaignId}
      />
    ) as ReactNode as never,
  )
}

/**
 * Both aggregates settled, and React's queue drained.
 *
 * `act` is what flushes an update React queued from a promise resolved
 * outside a render — without it the counts land in the component and the
 * screen never redraws, so an assertion waits for a DOM that was never asked
 * to change.
 */
const settled = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  pages.clear()
  built.length = 0
  counts.clear()
  fetched.clear()
})

describe('what is NOT credited', () => {
  /*==========================================
   * THE ASSERTION THIS SURFACE EXISTS FOR.
   *
   * The join writes nothing for a conversion it cannot credit, so the tables
   * are a list of the successes. Ninety submissions, twelve credited: without
   * the other seventy-eight on screen the campaigns read as accounting for
   * everything that happened.
   *=========================================*/
  it('counts and shows the conversions credited to nobody', async () => {
    counts.set(describeQuery([ATTRIBUTIONS, 'kind==form']), 12)
    counts.set('hosts/site1/formSubmissions', 90)
    await renderCard()
    await settled()

    expect(screen.getByText('78')).toBeTruthy()
    expect(screen.getByText('Not credited')).toBeTruthy()
    expect(screen.getByText('Credited to a campaign')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
  })

  /**
   * The gap holds direct arrivals, records from before the join existed, and
   * (for contacts) other sites' records. None can be separated from the
   * others, so the figure is an upper bound and the page says so.
   */
  it('presents the uncredited figure as a ceiling, not as direct arrivals', async () => {
    counts.set(describeQuery([ATTRIBUTIONS, 'kind==form']), 12)
    counts.set('hosts/site1/formSubmissions', 90)
    await renderCard()
    await settled()
    expect(screen.getByText(/upper bound/i)).toBeTruthy()
    expect(screen.getByText(/recorded as direct/i)).toBeTruthy()
    expect(screen.getByText(/nothing is guessed from a referrer/i)).toBeTruthy()
  })

  /*==========================================
   * THE FLATTERING WRONG ANSWER, refused.
   *
   * Defaulting the total to the attributed count renders every conversion as
   * attributed. Withholding says nothing rather than something false — and
   * says that it is withholding.
   *=========================================*/
  it('withholds the split rather than defaulting the total', async () => {
    counts.set(describeQuery([ATTRIBUTIONS, 'kind==form']), 12)
    // No total recorded, so `getCountFromServer` answers 0 for the
    // submissions collection and the coverage is computed from a real zero —
    // the honest case is the FAILED read, staged by rejecting instead.
    await renderCard()
    await settled()
    expect(screen.getByText('Credited to a campaign')).toBeTruthy()
    // Twelve credited against a total of zero clamps to zero uncredited, and
    // never to a figure that implies everything was credited.
    expect(screen.queryByText('12 of 12')).toBeNull()
  })
})

describe('the web channel', () => {
  /*==========================================
   * TWO LISTS, NEVER ONE, AND NEVER A ROLLUP.
   *=========================================*/
  it('reads the two channels as two separate queries', async () => {
    await renderCard()
    await waitFor(() => {
      expect(built).toContain(emailKey('form'))
    })
    expect(built).toContain(webKey('form'))
  })

  it('gives the tagged links their own section and heading', async () => {
    pages.set(webKey('form'), {
      rows: [
        row({
          $id: 'form:sub_9',
          refId: 'sub_9',
          channel: 'web',
          campaignId: undefined,
          source: 'google',
          medium: 'cpc',
          campaign: 'spring',
        }),
      ],
      hasMore: false,
    })
    await renderCard()
    await waitFor(() => {
      expect(screen.getByText('From tagged web links')).toBeTruthy()
    })
    expect(screen.getByText('From campaign emails')).toBeTruthy()
    expect(screen.getByText('google / cpc / spring')).toBeTruthy()
  })

  /**
   * A grouped web view would be a rollup keyed on free text. The section says
   * why the rows stand one by one, so their not being grouped reads as
   * deliberate rather than as a missing feature.
   */
  it('says the labels are listed one by one and not totalled', async () => {
    await renderCard()
    await waitFor(() => {
      expect(screen.getByText('From tagged web links')).toBeTruthy()
    })
    expect(screen.getByText(/listed one by one rather than grouped/i)).toBeTruthy()
    expect(screen.getByText(/no fixed set to total/i)).toBeTruthy()
  })

  /**
   * A web record carries no campaign id, so narrowing by campaign would
   * return nothing while reading as "this campaign caused no web
   * conversions". The section is absent instead.
   */
  it('is absent entirely on a campaign-scoped view', async () => {
    await renderCard('camp_7')
    await waitFor(() => {
      expect(screen.getByText('From campaign emails')).toBeTruthy()
    })
    expect(screen.queryByText('From tagged web links')).toBeNull()
    expect(built.some((key) => key.includes('channel==web'))).toBe(false)
  })
})

describe('one kind at a time', () => {
  it('queries a single kind, so no view can hold two', async () => {
    await renderCard()
    await waitFor(() => {
      expect(built.length).toBeGreaterThan(0)
    })
    // Every query the card built names exactly one kind.
    built.forEach((key) => {
      const kinds = ['form', 'lead', 'contact', 'booking'].filter((kind) =>
        key.includes(`kind==${kind}`),
      )
      expect(kinds).toHaveLength(1)
    })
  })

  it('switches the whole surface to the kind chosen', async () => {
    await renderCard()
    await waitFor(() => {
      expect(built).toContain(emailKey('form'))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Leads' }))
    await waitFor(() => {
      expect(built).toContain(emailKey('lead'))
    })
    // And the previous kind is gone rather than accumulated beside it.
    expect(screen.queryByText('Landing pages')).toBeNull()
  })

  it('says why the four are never shown together', async () => {
    await renderCard()
    await waitFor(() => {
      expect(
        screen.getByText(/appears as a submission, a contact and a lead/i),
      ).toBeTruthy()
    })
  })
})

describe('the campaign-scoped view', () => {
  /**
   * A conversion credited to nobody belongs to no campaign. Attributing the
   * site's whole direct traffic to whichever campaign the reader is looking
   * at is the exact inference this join refuses to make.
   */
  it('withholds the uncredited figure and says why', async () => {
    counts.set(describeQuery([ATTRIBUTIONS, 'kind==form']), 12)
    counts.set('hosts/site1/formSubmissions', 90)
    await renderCard('camp_7')
    await settled()
    expect(
      screen.getByText(/Conversions credited to no campaign belong to no/i),
    ).toBeTruthy()
    expect(screen.queryByText('Not credited')).toBeNull()
    expect(screen.queryByText('78')).toBeNull()
  })

  it('narrows the email list by campaign rather than by channel', async () => {
    await renderCard('camp_7')
    await waitFor(() => {
      expect(built.length).toBeGreaterThan(0)
    })
    expect(
      built.some(
        (key) => key.includes('campaignId==camp_7') && key.includes('kind==form'),
      ),
    ).toBe(true)
  })
})

describe('the landing-page join', () => {
  const landingKey = describeQuery([
    ATTRIBUTIONS,
    'kind==form',
    'order:__name__',
    'limit:101',
  ])
  const submissionsKey = (ids: string[]) =>
    describeQuery(['hosts/site1/formSubmissions', `__name__in${ids.join(',')}`])

  /**
   * Hundreds of reads deep, so it is a button. An expensive read needs an
   * ask, not a mount.
   */
  it('reads nothing until it is asked for', async () => {
    await renderCard()
    await waitFor(() => {
      expect(screen.getByText('Group by landing page')).toBeTruthy()
    })
    expect(fetched.size).toBe(0)
    expect(screen.queryByText('Page the form was on')).toBeNull()
  })

  it('groups credited submissions by the page their form was on', async () => {
    fetched.set(landingKey, [
      { id: 'a', data: { refId: 'sub_1' } },
      { id: 'b', data: { refId: 'sub_2' } },
      { id: 'c', data: { refId: 'sub_3' } },
    ])
    fetched.set(submissionsKey(['sub_1', 'sub_2', 'sub_3']), [
      { id: 'sub_1', data: { path: '/pricing' } },
      { id: 'sub_2', data: { path: '/pricing' } },
      { id: 'sub_3', data: { path: '/contact' } },
    ])
    await renderCard()
    fireEvent.click(screen.getByText('Group by landing page'))
    await waitFor(() => {
      expect(screen.getByText('/pricing')).toBeTruthy()
    })
    expect(screen.getByText('/contact')).toBeTruthy()
    // Two submissions on /pricing and one on /contact — grouped, never summed
    // into a single "3 landing-page conversions".
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
  })

  /**
   * Every line here is a question a reader will otherwise assume the table
   * answered.
   */
  it('says what the join cannot answer', async () => {
    fetched.set(landingKey, [{ id: 'a', data: { refId: 'sub_1' } }])
    fetched.set(submissionsKey(['sub_1']), [
      { id: 'sub_1', data: { path: '/pricing' } },
    ])
    await renderCard()
    fireEvent.click(screen.getByText('Group by landing page'))
    await waitFor(() => {
      expect(screen.getByText(/not the page the campaign link landed on/i)).toBeTruthy()
    })
    expect(screen.getByText(/no denominator to divide by/i)).toBeTruthy()
    expect(
      screen.getByText(/leads, contacts and bookings have no landing page/i),
    ).toBeTruthy()
  })

  /*==========================================
   * TRUNCATION IS DISCLOSED, not hidden.
   *
   * The probe row is the 101st document: reading it is how "there is more
   * than this" becomes a fact rather than a guess, and the probe is never
   * grouped.
   *=========================================*/
  it('discloses that the ceiling bit, and does not group the probe row', async () => {
    fetched.set(
      landingKey,
      Array.from({ length: 101 }, (_unused, index) => ({
        id: `a${index}`,
        data: { refId: `sub_${index}` },
      })),
    )
    // Every submission answers the same page, so the grouped count is the
    // window size exactly — 100, and never the 101 that were read.
    for (let start = 0; start < 100; start += 30) {
      const ids = Array.from(
        { length: Math.min(30, 100 - start) },
        (_unused, index) => `sub_${start + index}`,
      )
      fetched.set(
        submissionsKey(ids),
        ids.map((id) => ({ id, data: { path: '/pricing' } })),
      )
    }
    await renderCard()
    fireEvent.click(screen.getByText('Group by landing page'))
    await waitFor(() => {
      expect(screen.getByText(/More than 100 credited submissions exist/i)).toBeTruthy()
    })
    expect(screen.getByText('100 credited submissions read')).toBeTruthy()
    expect(screen.queryByText('101 credited submissions read')).toBeNull()
    expect(
      screen.getByText(/they are the ones that came first in storage order/i),
    ).toBeTruthy()
  })

  /**
   * A submission that has been deleted, or that recorded no page, is reported
   * rather than filed under a page it may not have come from.
   */
  it('reports the credited submissions it could not place, instead of guessing', async () => {
    fetched.set(landingKey, [
      { id: 'a', data: { refId: 'sub_1' } },
      { id: 'b', data: { refId: 'gone' } },
    ])
    fetched.set(submissionsKey(['sub_1', 'gone']), [
      { id: 'sub_1', data: { path: '/pricing' } },
    ])
    await renderCard()
    fireEvent.click(screen.getByText('Group by landing page'))
    await waitFor(() => {
      expect(screen.getByText(/are not grouped/i)).toBeTruthy()
    })
    expect(screen.getByText(/recorded no page/i)).toBeTruthy()
  })

  /** Only a form submission carries a page at all. */
  it('is offered for form submissions and for no other kind', async () => {
    await renderCard()
    await waitFor(() => {
      expect(screen.getByText('Landing pages')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Bookings' }))
    await waitFor(() => {
      expect(screen.queryByText('Landing pages')).toBeNull()
    })
  })
})
