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
 * WHAT THE CONVERSIONS LOOK LIKE ON SCREEN.
 *
 * `campaign-conversions.spec.ts` proves the model refuses to produce a total.
 * This proves the CARD does not produce one either — a model with no total,
 * rendered by JSX that adds the four figures in a footer row, ships the
 * trebled number the model exists to prevent. They are separate failures.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CampaignConversionsRollup } from '@aglyn/shared-ui-email-campaigns/model/campaign-conversions'

/** What each `useFirestoreDoc` call answers, keyed by document path. */
const mockDocs = new Map<string, unknown>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  useFirestoreDoc: (build: () => { __path?: string } | null) => ({
    data: mockDocs.get(build()?.__path ?? ''),
  }),
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

const CAMPAIGN_PATH = 'hosts/site1/campaigns/camp_1'
const CONVERSIONS_PATH = 'hosts/site1/campaigns/camp_1/reports/conversions'

async function renderReport(
  conversions?: CampaignConversionsRollup,
): Promise<void> {
  mockDocs.clear()
  mockDocs.set(CAMPAIGN_PATH, {
    subject: 'Spring sale',
    stats: { recipients: 1000, sent: 1000, delivered: 900, clickTracked: true },
  })
  if (conversions) mockDocs.set(CONVERSIONS_PATH, conversions)
  const { CampaignReportCard } = await import('./campaign-report-card')
  render(
    (
      <CampaignReportCard
        hostId="site1"
        campaignId="camp_1"
        basePath="/acme/hosts/site/marketing"
      />
    ) as ReactNode as never,
  )
}

/**
 * The four counts are chosen so their sum is UNIQUE on the page.
 *
 * 3 + 2 + 5 + 1 = 11, and nothing else this card renders is 11: the audience
 * figures are 1,000 and 900, the window is 7 days. So finding "11" anywhere
 * in the document is finding a total that somebody added.
 */
const ROLLUP: CampaignConversionsRollup = {
  model: 'last-click',
  windowDays: 7,
  byKind: { form: 3, lead: 2, contact: 5, booking: 1 },
}

describe('the conversions section never totals the kinds', () => {
  it('renders each kind under its own label', async () => {
    await renderReport(ROLLUP)
    expect(screen.getByText('Form submissions')).toBeTruthy()
    expect(screen.getByText('Leads')).toBeTruthy()
    expect(screen.getByText('Contacts')).toBeTruthy()
    expect(screen.getByText('Bookings')).toBeTruthy()
  })

  /*==========================================
   * THE ASSERTION THIS FILE IS FOR.
   *
   * One form submission by a new person writes a submission, a contact AND a
   * lead. A card that added the four would report eleven conversions for what
   * may be as few as three visits, and the number would look like a bigger
   * version of a real one.
   *=========================================*/
  it('renders the sum of the kinds NOWHERE in the document', async () => {
    await renderReport(ROLLUP)
    // Every visible figure, as the reader would read it.
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    // And the total is not among them.
    expect(screen.queryByText('11')).toBeNull()
    expect(screen.queryByText('Total conversions')).toBeNull()
    expect(screen.queryByText('All conversions')).toBeNull()
  })

  it('says why they are not added, rather than leaving a total merely absent', async () => {
    await renderReport(ROLLUP)
    expect(
      screen.getByText(/deliberately not added together/i),
    ).toBeTruthy()
    expect(screen.getByText(/count that visit three times/i)).toBeTruthy()
  })

  /**
   * The rollup is incremented for the EMAIL channel only — a `utm_` label has
   * no document to hang a report on and an unbounded key space to grow one
   * with. A reader looking at these figures has to be told what is not in
   * them, or they read as every conversion the campaign caused.
   */
  it('says the figures cover campaign emails and not tagged links', async () => {
    await renderReport(ROLLUP)
    expect(screen.getByText(/Campaign emails only/i)).toBeTruthy()
  })

  /**
   * A kind the rollup never recorded draws a dash. A site with no booking
   * form has never written a booking conversion, and a measured zero invites
   * the reader to conclude the campaign failed at something it never tried.
   */
  it('draws an em dash for a kind the rollup does not mention', async () => {
    await renderReport({ byKind: { form: 3 } })
    expect(screen.getByText('3')).toBeTruthy()
    // Three kinds are unrecorded, so three dashes and three "not recorded"
    // notes — never a zero.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText('not recorded').length).toBeGreaterThanOrEqual(3)
  })

  /**
   * "This campaign caused nothing" and "this campaign predates the join" lead
   * a merchant to opposite conclusions about whether to send another one.
   */
  it('distinguishes an absent rollup from a recorded empty one', async () => {
    await renderReport(undefined)
    expect(
      screen.getByText(/No conversions have been attributed to this campaign/i),
    ).toBeTruthy()

    await renderReport({})
    expect(
      screen.getByText(/Nothing has been credited to this campaign yet/i),
    ).toBeTruthy()
  })

  it('states the rule the figures were credited under', async () => {
    await renderReport(ROLLUP)
    expect(
      screen.getByText(
        /last campaign whose link the visitor clicked, within 7 days/i,
      ),
    ).toBeTruthy()
  })

  /**
   * The window comes off the RECORD, not off today's constant: a campaign
   * credited under an older window has to print the window it was credited
   * under, or the report describes a rule the numbers were not judged by.
   */
  it('prints the stored window rather than the current one', async () => {
    await renderReport({ ...ROLLUP, windowDays: 30 })
    expect(screen.getByText(/within 30 days/i)).toBeTruthy()
    expect(screen.queryByText(/within 7 days of that click/i)).toBeNull()
  })

  /**
   * The rollup counts the credited ones. Somebody has to say the rest exist,
   * and the campaign's own page cannot count them — they belong to no
   * campaign — so it points at the surface that can.
   */
  it('says the uncredited conversions are counted somewhere else', async () => {
    await renderReport(ROLLUP)
    expect(screen.getByText(/credited to no campaign at all/i)).toBeTruthy()
    expect(screen.getByText('See these conversions')).toBeTruthy()
  })
})
