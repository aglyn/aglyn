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
 * WHAT REACHES THE SCREEN.
 *
 * `campaign-report.spec.ts` proves the arithmetic; this file proves the
 * arithmetic is what a reader sees. Those are separate failures: a model that
 * returns `denominatorLabel` correctly and a card that renders the percentage
 * without it produces exactly the ambiguous "43% open rate" the whole feature
 * exists to refuse, and every unit test still passes.
 *
 * So the assertions here are on rendered TEXT, and specifically on the
 * denominator appearing beside its number.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CampaignStats } from '../model/campaign-report'

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
  __esModule: true,
  pluginDocsHelp: () => undefined,
}))

const CAMPAIGN_PATH = 'hosts/site1/campaigns/camp_1'
const LINKS_PATH = 'hosts/site1/campaigns/camp_1/reports/links'

/**
 * 1,000 sent, 900 delivered — the two differ, and by the bounce count, so an
 * assertion that reads a denominator off the screen can tell them apart. On a
 * campaign with no bounces every candidate denominator is the same number and
 * the test would pass against any of them.
 */
const STATS: CampaignStats = {
  audienceSize: 1200,
  recipients: 1000,
  sent: 1000,
  delivered: 900,
  opens: 500,
  uniqueOpens: 300,
  clicks: 120,
  uniqueClicks: 90,
  bounced: 100,
  complained: 9,
  unsubscribes: 18,
  consentWithheld: 100,
  suppressed: 40,
  clickTracked: true,
}

async function renderReport(
  stats: CampaignStats | undefined,
  links?: unknown,
): Promise<void> {
  mockDocs.clear()
  if (stats) mockDocs.set(CAMPAIGN_PATH, { subject: 'Spring sale', stats })
  if (links) mockDocs.set(LINKS_PATH, links)
  const { CampaignReportCard } = await import('./campaign-report-card')
  render(
    (
      <CampaignReportCard
        hostId="site1"
        campaignId="camp_1"
        basePath="/acme/hosts/site/emails"
      />
    ) as ReactNode as never,
  )
}

describe('the campaign report names its denominators on screen', () => {
  /*
   * THE ASSERTION THE FEATURE IS FOR. `33.3%` alone is not a readable open
   * rate — it is readable only beside the population it was taken over, and
   * that has to be in the DOM rather than in a tooltip, because somebody
   * comparing two rates cannot hover both at once.
   */
  it('renders the open rate beside "300 of 900 delivered"', async () => {
    await renderReport(STATS)

    expect(screen.getByText('Open rate')).toBeTruthy()
    expect(screen.getByText('33.3%')).toBeTruthy()
    expect(screen.getByText('300 of 900 delivered')).toBeTruthy()
  })

  it('renders the bounce rate over SENT, not over delivered', async () => {
    await renderReport(STATS)

    expect(screen.getByText('100 of 1,000 sent')).toBeTruthy()
  })

  it('keeps the click rate and the click-to-open rate apart on screen', async () => {
    await renderReport(STATS)

    expect(screen.getByText('Click rate')).toBeTruthy()
    expect(screen.getByText('90 of 900 delivered')).toBeTruthy()
    expect(screen.getByText('Click-to-open rate')).toBeTruthy()
    expect(screen.getByText('90 of 300 unique openers')).toBeTruthy()
  })

  it('shows a rate it cannot compute as a dash, never as 0%', async () => {
    const legacy: CampaignStats = { ...STATS }
    delete legacy.delivered
    delete legacy.uniqueOpens
    delete legacy.uniqueClicks

    await renderReport(legacy)

    expect(screen.queryByText('0.0%')).toBeNull()
    expect(
      screen.getAllByText('— not enough recorded to compute').length,
    ).toBeGreaterThan(0)
    // And the reason, on screen rather than left to be inferred from a dash.
    expect(
      screen.getByText(/No delivery events have been recorded/),
    ).toBeTruthy()
  })

  it('shows an unrecorded delivered count as a dash, not as zero', async () => {
    const legacy: CampaignStats = { ...STATS }
    delete legacy.delivered

    await renderReport(legacy)

    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  /*
   * ANTI-VACUITY for the two above: the same card WITH the delivery count
   * renders neither the dash nor the caveat. Without this, a card that
   * rendered nothing would satisfy both.
   */
  it('CONTROL: a campaign with delivery events shows neither', async () => {
    await renderReport(STATS)

    expect(screen.queryByText('— not enough recorded to compute')).toBeNull()
    expect(screen.queryByText(/No delivery events have been recorded/)).toBeNull()
  })

  it('names the populations the send measured, each against its own whole', async () => {
    await renderReport(STATS)

    expect(screen.getByText('of 1,200 audience')).toBeTruthy()
    expect(screen.getByText('of 1,000 addressed')).toBeTruthy()
  })

  it('separates open EVENTS from the readers who opened', async () => {
    await renderReport(STATS)

    expect(screen.getByText('Opens')).toBeTruthy()
    expect(screen.getByText('Readers who opened')).toBeTruthy()
    expect(screen.getByText('500')).toBeTruthy()
    expect(screen.getByText('300')).toBeTruthy()
  })

  it('withholds the click rate for a send whose links were untrackable', async () => {
    const untracked: CampaignStats = { ...STATS }
    delete untracked.clickTracked

    await renderReport(untracked)

    expect(
      screen.getByText(/did not record carrying an HTML part/),
    ).toBeTruthy()
    // The count is still there — it is a real count of real events.
    expect(screen.getByText('120')).toBeTruthy()
  })

  it('renders the link table with each share over the clicks it counted', async () => {
    await renderReport(STATS, {
      links: {
        a: { url: 'https://shop.example/sale', clicks: 60 },
        b: { url: 'https://shop.example/new', clicks: 40 },
      },
    })

    expect(screen.getByText('https://shop.example/sale')).toBeTruthy()
    expect(screen.getByText('60.0% of 100 link clicks counted')).toBeTruthy()
  })

  /*
   * The normalisation is a real limitation and it is stated on the screen
   * rather than left for a merchant to discover by wondering why two links
   * they built appear as one row.
   */
  it('says on screen that links are counted without their query strings', async () => {
    await renderReport(STATS, {
      links: { a: { url: 'https://shop.example/sale', clicks: 60 } },
    })

    expect(screen.getByText(/query strings are dropped/)).toBeTruthy()
  })

  it('distinguishes a campaign it cannot read from one with no engagement', async () => {
    await renderReport(undefined)

    expect(screen.getByText(/could not be loaded/)).toBeTruthy()
  })
})
