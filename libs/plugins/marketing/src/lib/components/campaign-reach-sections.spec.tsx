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
 * A CAMPAIGN BEYOND ITS MAIL — the properties these three sections hold.
 *
 *  1. All of them join on the campaign's SEND IDS, because that is the only
 *     handle `campaignAttributions`, the revenue rollups and the click
 *     reports offer. A campaign owns no screen and no form, so there is
 *     nothing else to join on.
 *  2. The conversion figures are AGGREGATE COUNTS, never a listing, and a
 *     refused count is withheld rather than rendered as a zero — "we could
 *     not read this" and "this campaign caused nothing" are opposite facts.
 *  3. The destinations and the revenue are read ONLY WHEN ASKED, because
 *     each costs one document per email in the campaign.
 *  4. The revenue is reported PER CURRENCY and never totalled across them —
 *     currency is to money what kind is to a conversion, and a suite that
 *     only ever saw one currency would pass against an implementation that
 *     added them.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** What each `getCountFromServer` answers, keyed by the query description. */
const counts = new Map<string, number>()
/** Query descriptions whose read is refused rather than answered. */
const countRefusals = new Set<string>()
/** Every aggregate asked for, in order — the read-cost meter. */
const countCalls: string[] = []
/** Every document read one at a time, in order — the other meter. */
const docCalls: string[] = []
/** What each `getDoc` answers, keyed by the document path. */
const documents = new Map<string, Record<string, unknown>>()
/** Document paths whose read is refused rather than answered. */
const docRefusals = new Set<string>()

const describeQuery = (parts: string[]): string => parts.join('|')

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    __kind: 'collection',
    __path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({
    __kind: 'doc',
    __path: segments.join('/'),
  }),
  where: (field: string, op: string, value: unknown) => ({
    __kind: 'where',
    text: `${field} ${op} ${
      Array.isArray(value) ? `[${value.join(',')}]` : String(value)
    }`,
  }),
  query: (source: any, ...clauses: any[]) => ({
    __kind: 'query',
    __path: source.__path,
    __clauses: [...(source.__clauses ?? []), ...clauses.map((c) => c.text)],
  }),
  /*
   * Resolved on a MACROTASK, which is the fixture's honesty: a server
   * aggregate is a network round-trip and its answer cannot land in the same
   * microtask drain as the mount that asked for it.
   */
  getCountFromServer: async (target: any) => {
    const key = describeQuery([target.__path, ...(target.__clauses ?? [])])
    countCalls.push(key)
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (countRefusals.has(key)) {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' })
    }
    return { data: () => ({ count: counts.get(key) ?? 0 }) }
  },
  getDoc: async (target: any) => {
    const path = String(target.__path)
    docCalls.push(path)
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (docRefusals.has(path)) {
      throw Object.assign(new Error('denied'), { code: 'permission-denied' })
    }
    /*
     * `undefined` for a document that does not exist, which is what the real
     * SDK answers and what the absent-versus-zero branch turns on.
     */
    return { data: () => documents.get(path) }
  },
}))

/*
 * ONE handle, hoisted. The real `useFirestore` hands out the same instance
 * every render; a double that builds a fresh object per render changes the
 * identity of the effect's dependency, so the count tears down and reopens on
 * every render and the section never settles.
 */
const FIRESTORE = { __firestore: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
}))

import {
  CampaignConversionsSection,
  CampaignDestinationsSection,
  CampaignRevenueSection,
} from './campaign-reach-sections'

const ATTRIBUTIONS = 'hosts/host-1/campaignAttributions'

/** The description one kind's count carries for a given set of send ids. */
const countKey = (kind: string, ids: string[]): string =>
  describeQuery([
    ATTRIBUTIONS,
    `kind == ${kind}`,
    `campaignId in [${ids.join(',')}]`,
  ])

/**
 * A figure's value, read by its LABEL.
 *
 * Two of these figures are legitimately equal on most fixtures, so a text
 * query for the number would pass while pointing at the wrong one.
 */
const figure = (label: string): string =>
  screen
    .getAllByText(label)
    .map((node) => node.parentElement?.querySelector('h6')?.textContent)
    .find((text): text is string => typeof text === 'string') ?? ''

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  counts.clear()
  countRefusals.clear()
  countCalls.length = 0
  docCalls.length = 0
  documents.clear()
  docRefusals.clear()
})

describe('what a campaign caused', () => {
  it('counts each kind against the campaign’s OWN emails', async () => {
    counts.set(countKey('form', ['send-1', 'send-2']), 4)
    counts.set(countKey('lead', ['send-1', 'send-2']), 3)
    counts.set(countKey('contact', ['send-1', 'send-2']), 3)
    counts.set(countKey('booking', ['send-1', 'send-2']), 1)

    render(
      <CampaignConversionsSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
        basePath="/acme/hosts/store/marketing"
      />,
    )
    await settle()

    // One aggregate per kind, and every one of them narrowed by the send ids.
    // A count over the whole collection would be the site's figure printed
    // under this campaign's name.
    expect(countCalls).toHaveLength(4)
    expect(countCalls.every((call) => call.includes('campaignId in ['))).toBe(
      true,
    )
    expect(figure('Form submissions')).toBe('4')
    expect(figure('Leads')).toBe('3')
    expect(figure('Bookings')).toBe('1')
  })

  it('never totals the kinds, and says why they stand apart', async () => {
    counts.set(countKey('form', ['send-1']), 2)
    counts.set(countKey('contact', ['send-1']), 2)

    render(
      <CampaignConversionsSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated={false}
        basePath="/acme/hosts/store/marketing"
      />,
    )
    await settle()

    // A total would count one visit several times and would look exactly like
    // a bigger number, so the reason is on the page rather than inferred.
    expect(
      screen.getByText(/deliberately not added together/i),
    ).toBeTruthy()
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('names the two populations it cannot count', async () => {
    counts.set(countKey('form', ['send-1']), 1)

    render(
      <CampaignConversionsSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated={false}
        basePath="/acme/hosts/store/marketing"
      />,
    )
    await settle()

    // A campaign container carries no `utm_` label, so the web channel can
    // never join to it; a conversion with no touch is credited to nobody.
    // Both are on the site's list, and the copy sends the reader there.
    expect(screen.getByText(/utm_ parameters/)).toBeTruthy()
    expect(screen.getByText(/arrived directly/)).toBeTruthy()
    expect(
      screen.getByText('All conversions').closest('a')?.getAttribute('href'),
    ).toBe('/acme/hosts/store/marketing/conversions')
  })

  it('chunks past Firestore’s cap and sums the chunks', async () => {
    // Thirty-five emails is two `in` filters per kind. A single filter would
    // be refused by Firestore; taking only the first thirty would silently
    // under-count the campaign.
    const ids = Array.from({ length: 35 }, (_, index) => `send-${index}`)
    counts.set(countKey('form', ids.slice(0, 30)), 7)
    counts.set(countKey('form', ids.slice(30)), 5)

    render(
      <CampaignConversionsSection
        hostId="host-1"
        sendIds={ids}
        truncated={false}
        basePath="/acme/hosts/store/marketing"
      />,
    )
    await settle()

    expect(countCalls).toHaveLength(8)
    expect(figure('Form submissions')).toBe('12')
  })

  it('WITHHOLDS the figures when a count is refused, rather than zeroing them', async () => {
    countRefusals.add(countKey('lead', ['send-1']))

    render(
      <CampaignConversionsSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated={false}
        basePath="/acme/hosts/store/marketing"
      />,
    )
    await settle()

    // "We could not read this" and "this campaign caused nothing" are
    // opposite facts, and only one of them flatters the campaign.
    expect(screen.getByText(/could not be counted/i)).toBeTruthy()
    expect(screen.queryByText('Form submissions')).toBeNull()
  })

  it('asks for nothing at all when the campaign has sent nothing', async () => {
    render(
      <CampaignConversionsSection
        hostId="host-1"
        sendIds={[]}
        truncated={false}
        basePath="/acme/hosts/store/marketing"
      />,
    )
    await settle()

    expect(countCalls).toHaveLength(0)
    expect(screen.getByText(/nothing can be credited to it yet/i)).toBeTruthy()
  })

  it('says the figures cover only the emails the page holds', async () => {
    counts.set(countKey('form', ['send-1']), 1)

    render(
      <CampaignConversionsSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated
        basePath="/acme/hosts/store/marketing"
      />,
    )
    await settle()

    expect(screen.getByText(/has sent more than the page holds/i)).toBeTruthy()
  })
})

describe('where a campaign sent people', () => {
  const rollup = (
    links: Record<string, { url: string; clicks: number }>,
    extra: Record<string, unknown> = {},
  ) => ({ links, ...extra })

  it('reads NOTHING until it is asked, and says what asking costs', async () => {
    render(
      <CampaignDestinationsSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
      />,
    )
    await settle()

    // One document per email is the per-record read every figure on the
    // campaign page is arranged to avoid, so it is asked for.
    expect(docCalls).toHaveLength(0)
    expect(screen.getByText(/Reads one record per email — 2 of them\./)).toBeTruthy()
  })

  it('merges the rollups, counting emails and summing clicks', async () => {
    documents.set(
      'hosts/host-1/campaigns/send-1/reports/links',
      rollup({
        a: { url: 'https://shop.test/sale', clicks: 9 },
        b: { url: 'https://shop.test/new', clicks: 2 },
      }),
    )
    documents.set(
      'hosts/host-1/campaigns/send-2/reports/links',
      rollup({ a: { url: 'https://shop.test/sale', clicks: 4 } }),
    )

    render(
      <CampaignDestinationsSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
      />,
    )
    await settle()
    fireEvent.click(screen.getByText('Show destinations'))
    await waitFor(() =>
      expect(screen.queryByText('https://shop.test/sale')).toBeTruthy(),
    )

    expect(docCalls).toEqual([
      'hosts/host-1/campaigns/send-1/reports/links',
      'hosts/host-1/campaigns/send-2/reports/links',
    ])
    // Clicks descending, and the leading row names BOTH emails that carried
    // the link — a destination reached by two mailings is one row about two
    // emails, not two rows.
    const cells = [...document.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    )
    expect(cells[0]).toEqual(['https://shop.test/sale', '2', '13'])
    expect(cells[1]).toEqual(['https://shop.test/new', '1', '2'])
  })

  it('states the clicks no row accounts for', async () => {
    documents.set(
      'hosts/host-1/campaigns/send-1/reports/links',
      rollup(
        { a: { url: 'https://shop.test/sale', clicks: 3 } },
        { overflowClicks: 6, unattributedClicks: 2 },
      ),
    )

    render(
      <CampaignDestinationsSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated={false}
      />,
    )
    await settle()
    fireEvent.click(screen.getByText('Show destinations'))
    await waitFor(() =>
      expect(screen.queryByText('https://shop.test/sale')).toBeTruthy(),
    )

    // The table's total must reconcile with the campaign's click figure, and
    // it only can if the two excluded populations are stated.
    expect(screen.getByText(/6 further clicks/)).toBeTruthy()
    expect(screen.getByText(/2 clicks arrived naming no destination/)).toBeTruthy()
    // Two links to one page that differ only in tracking are one row, which
    // the reader has to be told rather than discover.
    expect(screen.getByText(/without its query string/)).toBeTruthy()
  })

  it('says so when no email has recorded a followed link', async () => {
    render(
      <CampaignDestinationsSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated={false}
      />,
    )
    await settle()
    fireEvent.click(screen.getByText('Show destinations'))
    await waitFor(() =>
      expect(screen.queryByText(/has recorded a followed link/i)).toBeTruthy(),
    )

    expect(document.querySelectorAll('tbody tr')).toHaveLength(0)
  })
})

/**
 * WHAT A CAMPAIGN OF SEVERAL EMAILS EARNED.
 *
 * The merge is proved in `campaign-revenue.spec.ts`; this proves the merge is
 * what a reader sees, and that the read is paid for the way this page pays
 * for per-record reads.
 *
 * The MULTI-CURRENCY case is the control the rest of the file cannot stand in
 * for. An implementation that adds a USD amount to a EUR amount passes every
 * single-currency fixture ever written, so a suite that only ever sees one
 * currency proves nothing about the one property this section exists to hold.
 */
describe('what a campaign earned', () => {
  /**
   * The figures on screen, with the currency symbols and separators off.
   *
   * Stripped rather than compared as formatted money, so the assertions do
   * not turn on the runtime's locale. The currency headings share the `h6`
   * tag and strip to nothing, so they drop out here and are asserted for by
   * name instead.
   */
  const amounts = (): string[] =>
    [...document.querySelectorAll('h6')]
      .map((node) => (node.textContent ?? '').replace(/[^\d.]/g, ''))
      .filter(Boolean)

  const revenuePath = (sendId: string): string =>
    `hosts/host-1/campaigns/${sendId}/reports/revenue`

  const show = async () => {
    fireEvent.click(screen.getByText('Show revenue'))
    await settle()
  }

  it('reads NOTHING until it is asked, and says what asking costs', async () => {
    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2', 'send-3']}
        truncated={false}
      />,
    )
    await settle()

    /*
     * One document per email, against a section above it that runs on mount.
     * The conversions counts are aggregations — billed per thousand index
     * entries, so four honest figures cost about one row whatever the size of
     * the campaign — and this cannot meet that budget, so it asks.
     */
    expect(docCalls).toHaveLength(0)
    expect(
      screen.getByText(/Reads one record per email — 3 of them\./),
    ).toBeTruthy()
  })

  it('reads one revenue record per email, and merges them', async () => {
    documents.set(revenuePath('send-1'), {
      model: 'last-click',
      windowDays: 7,
      byCurrency: {
        usd: { grossCents: 50_000, refundedCents: 5_000, orders: 4 },
      },
    })
    documents.set(revenuePath('send-2'), {
      model: 'last-click',
      windowDays: 7,
      byCurrency: { usd: { grossCents: 30_000, orders: 2 } },
    })

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    expect(docCalls).toEqual([revenuePath('send-1'), revenuePath('send-2')])
    // Net, gross, refunded, then the two order counts. One currency, so no
    // per-currency email count and no heading — a `USD` label over a report
    // that only ever shows dollars is noise.
    expect(amounts()).toEqual(['750.00', '800.00', '50.00', '6', '0'])
    expect(screen.queryByText('USD')).toBeNull()
    expect(screen.getByText(/6 orders credited, across 2 of/)).toBeTruthy()
  })

  it('reports several currencies APART, and totals none of them', async () => {
    documents.set(revenuePath('send-1'), {
      byCurrency: { usd: { grossCents: 50_000, orders: 3 } },
    })
    documents.set(revenuePath('send-2'), {
      byCurrency: { eur: { grossCents: 30_000, orders: 2 } },
    })
    documents.set(revenuePath('send-3'), {
      byCurrency: { gbp: { grossCents: 10_000, orders: 1 } },
    })

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2', 'send-3']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    /*
     * THE CONTROL. 900.00 is 500 + 300 + 100 and is a figure in no currency —
     * an implementation that summed the buckets would print it here and would
     * pass every other assertion in this file.
     */
    expect(amounts().filter((text) => text === '900.00')).toEqual([])
    // Three blocks, largest net first, each complete and each its own unit.
    expect(amounts()).toEqual([
      '500.00',
      '500.00',
      '0.00',
      '3',
      '0',
      '1',
      '300.00',
      '300.00',
      '0.00',
      '2',
      '0',
      '1',
      '100.00',
      '100.00',
      '0.00',
      '1',
      '0',
      '1',
    ])
    // The layout says it and the words say it. A reader who scans the blocks
    // and a reader who reads the note reach the same conclusion.
    expect(screen.getByText('USD')).toBeTruthy()
    expect(screen.getByText('EUR')).toBeTruthy()
    expect(screen.getByText('GBP')).toBeTruthy()
    expect(screen.getByText(/deliberately no combined total/i)).toBeTruthy()
    // Orders are a COUNT, so they may cross currencies where the money may
    // not: six orders is six orders whatever they were paid in.
    expect(screen.getByText(/6 orders credited, across 3 of/)).toBeTruthy()
  })

  it('names the emails behind each currency once there is more than one', async () => {
    documents.set(revenuePath('send-1'), {
      byCurrency: { usd: { grossCents: 20_000, orders: 2 } },
    })
    documents.set(revenuePath('send-2'), {
      byCurrency: { usd: { grossCents: 20_000, orders: 2 } },
    })
    documents.set(revenuePath('send-3'), {
      byCurrency: { eur: { grossCents: 90_000, orders: 1 } },
    })

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2', 'send-3']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    // A currency block is a part of the campaign, not a view of all of it.
    expect(screen.getByText('earned in EUR')).toBeTruthy()
    expect(screen.getByText('earned in USD')).toBeTruthy()
  })

  it('reads a campaign that earned NOTHING as zero, not as absent', async () => {
    // The record exists, so the join has run against these emails and found
    // no sale. That is a real zero and a merchant may act on it.
    documents.set(revenuePath('send-1'), { byCurrency: {} })

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    expect(
      screen.getByText('No orders have been credited to this campaign.'),
    ).toBeTruthy()
    expect(screen.queryByText(/never show a figure here/)).toBeNull()
  })

  it('reads a campaign with no record as absent, not as zero', async () => {
    // No email has a revenue record. That is not "earned nothing" — it is
    // also every campaign sent before the join existed and every site with no
    // store, and the copy names both rather than printing a confident 0.
    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    expect(screen.getByText(/never show a figure here/)).toBeTruthy()
    expect(
      screen.queryByText('No orders have been credited to this campaign.'),
    ).toBeNull()
    expect(amounts()).toEqual([])
  })

  it('WITHHOLDS the figures when a read is refused, rather than zeroing them', async () => {
    const errors = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    documents.set(revenuePath('send-1'), {
      byCurrency: { usd: { grossCents: 50_000, orders: 3 } },
    })
    docRefusals.add(revenuePath('send-2'))

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    /*
     * "We could not read this" and "this campaign earned nothing" are
     * opposite facts, and only one of them flatters the campaign. Neither the
     * partial figures nor a zero is shown: a campaign whose second email
     * could not be read has an unknown total, not a smaller one.
     */
    expect(screen.getByText(/could not be read/i)).toBeTruthy()
    expect(amounts()).toEqual([])
    expect(screen.queryByText(/orders credited, across/)).toBeNull()
    expect(
      screen.queryByText('No orders have been credited to this campaign.'),
    ).toBeNull()
    errors.mockRestore()
  })

  it('drops figures already on screen when a re-read is refused', async () => {
    const errors = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    documents.set(revenuePath('send-1'), {
      byCurrency: { usd: { grossCents: 50_000, orders: 3 } },
    })

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated={false}
      />,
    )
    await settle()
    await show()
    expect(amounts()).toEqual(['500.00', '500.00', '0.00', '3', '0'])

    docRefusals.add(revenuePath('send-1'))
    fireEvent.click(screen.getByText('Read again'))
    await settle()

    // A stale total under a fresh error is the one arrangement that looks
    // authoritative and is not.
    expect(screen.getByText(/could not be read/i)).toBeTruthy()
    expect(amounts()).toEqual([])
    errors.mockRestore()
  })

  it('states the rule the amounts were credited under', async () => {
    documents.set(revenuePath('send-1'), {
      model: 'last-click',
      windowDays: 7,
      byCurrency: { usd: { grossCents: 10_000, orders: 1 } },
    })

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    expect(
      screen.getByText(
        /Credited to the last campaign whose link the buyer clicked, within 7 days/,
      ),
    ).toBeTruthy()
    /*
     * NO PER-MESSAGE AVERAGE. The send report divides by that send's own
     * delivered count; a container's revenue and its delivery total cover
     * different subsets of its emails, so the quotient would be an average
     * over a population nobody named — and the delivery denominators on this
     * page are the ones already known to read as unrecorded.
     */
    expect(screen.queryByText(/per delivered message/i)).toBeNull()
  })

  it('says so when the emails were not all credited under one rule', async () => {
    documents.set(revenuePath('send-1'), {
      windowDays: 7,
      byCurrency: { usd: { grossCents: 10_000, orders: 1 } },
    })
    documents.set(revenuePath('send-2'), {
      windowDays: 30,
      byCurrency: { usd: { grossCents: 10_000, orders: 1 } },
    })

    render(
      <CampaignRevenueSection
        hostId="host-1"
        sendIds={['send-1', 'send-2']}
        truncated={false}
      />,
    )
    await settle()
    await show()

    expect(
      screen.getByText(/not all credited under the same rule/i),
    ).toBeTruthy()
    // One unit, so the amounts still add — this is a comparability warning,
    // not the refusal two currencies get.
    expect(amounts()[0]).toBe('200.00')
  })

  it('asks for nothing at all when the campaign has sent nothing', async () => {
    render(
      <CampaignRevenueSection hostId="host-1" sendIds={[]} truncated={false} />,
    )
    await settle()

    expect(docCalls).toHaveLength(0)
    expect(screen.queryByText('Show revenue')).toBeNull()
    expect(screen.getByText(/nothing can be credited to it yet/i)).toBeTruthy()
  })

  it('says the amounts cover only the emails the page holds', async () => {
    documents.set(revenuePath('send-1'), {
      byCurrency: { usd: { grossCents: 10_000, orders: 1 } },
    })

    render(
      <CampaignRevenueSection hostId="host-1" sendIds={['send-1']} truncated />,
    )
    await settle()
    await show()

    expect(screen.getByText(/The campaign has sent more\./)).toBeTruthy()
  })

  it('names the population behind an EMPTY answer too', async () => {
    render(
      <CampaignRevenueSection hostId="host-1" sendIds={['send-1']} truncated />,
    )
    await settle()
    await show()

    // "Nothing was credited" over part of a campaign is a claim about that
    // part. The emptier the answer, the more it needs its population named.
    expect(screen.getByText(/never show a figure here/)).toBeTruthy()
    expect(screen.getByText(/The campaign has sent more\./)).toBeTruthy()
  })
})
