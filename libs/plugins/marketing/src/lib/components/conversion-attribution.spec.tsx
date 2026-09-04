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
 * ATTRIBUTION ON THE RECORD ITSELF.
 *
 * The failure this file exists for is the one the join's own docblock warns
 * about from the writer's side: a conversion with no touch writes NO RECORD,
 * so the ordinary case here is a missing document. A component that read a
 * missing document as an empty one would render a campaign with a zero beside
 * it, and "came from no campaign" and "came from this campaign, which caused
 * nothing" are opposite facts about the same lead.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What the keyed read answers, keyed by document path. */
const mockDocs = new Map<string, unknown>()
/** Every path the component actually asked for. */
const asked: string[] = []

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  useFirestoreDoc: (build: () => { __path?: string } | null) => {
    const ref = build()
    if (ref?.__path) asked.push(ref.__path)
    return {
      data: ref ? mockDocs.get(ref.__path ?? '') : undefined,
      // A settled read either way — the component holds its output back
      // while loading, and every assertion here is about what it settles on.
      status: 'success',
    }
  },
}))

/*
 * `useParams` is what resolves the marketing hub from the URL the console is
 * already on; the rest are what `AppLink` reads to decide whether it is
 * pointing at the current page.
 */
jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}))

async function renderAttribution(options: {
  kind?: 'form' | 'lead' | 'contact' | 'booking'
  refId?: string
  record?: Record<string, unknown>
  quiet?: boolean
}): Promise<void> {
  mockDocs.clear()
  asked.length = 0
  const kind = options.kind ?? 'form'
  const refId = options.refId ?? 'sub_1'
  if (options.record) {
    mockDocs.set(
      `hosts/site1/campaignAttributions/${kind}:${refId}`,
      options.record,
    )
  }
  const { ConversionAttribution } = await import(
    './conversion-attribution.component'
  )
  render(
    (
      <ConversionAttribution
        hostId="site1"
        kind={kind}
        refId={refId}
        quiet={options.quiet}
      />
    ) as ReactNode as never,
  )
}

describe('a record with no attribution', () => {
  /*==========================================
   * THE ASSERTION THIS FILE IS FOR.
   *=========================================*/
  it('says it was credited to nobody, and shows no campaign and no zero', async () => {
    await renderAttribution({})
    expect(screen.getByText(/Not credited to a campaign/i)).toBeTruthy()
    // Not a figure, not an empty chip, not a campaign name.
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('Campaign email')).toBeNull()
    expect(screen.queryByText('Web link')).toBeNull()
  })

  /**
   * The absence is deliberate on the writer's side — no `utm_source=direct`
   * placeholder, no referrer inference, no most-recent-campaign fallback — so
   * the reader is told that, rather than being left to wonder whether the
   * product simply failed to record something.
   */
  it('says nothing was guessed, rather than leaving the absence unexplained', async () => {
    await renderAttribution({})
    expect(screen.getByText(/Nothing is inferred from a referrer/i)).toBeTruthy()
    expect(
      screen.getByText(/no campaign is credited for being the most recent/i),
    ).toBeTruthy()
  })

  it('renders nothing at all where the surface asked to stay quiet', async () => {
    await renderAttribution({ quiet: true })
    expect(screen.queryByText(/Not credited to a campaign/i)).toBeNull()
  })
})

describe('the keyed read', () => {
  /**
   * One document, on a known path. No query, no index, nothing that can be
   * truncated — which is what makes this affordable on a detail surface.
   */
  it('asks for exactly one document, at {kind}:{refId}', async () => {
    await renderAttribution({ kind: 'lead', refId: 'lead_9' })
    expect(asked).toEqual(['hosts/site1/campaignAttributions/lead:lead_9'])
  })

  /**
   * A ref that could name a document in another collection is refused by the
   * id builder, and a refused id must not become a read of a wrong path.
   */
  it('asks for nothing when the record id cannot form a valid attribution id', async () => {
    await renderAttribution({ kind: 'form', refId: 'a/b' })
    expect(asked).toEqual([])
    // And it states no fact it did not check.
    expect(screen.queryByText(/Not credited to a campaign/i)).toBeNull()
  })
})

describe('an email-channel attribution', () => {
  const RECORD = {
    kind: 'form',
    refId: 'sub_1',
    channel: 'email',
    campaignId: 'camp_7',
    touchedAtMs: 1_700_000_000_000,
    convertedAtMs: 1_700_200_000_000,
    model: 'last-click',
    windowDays: 7,
  }

  it('links to the campaign it credits', async () => {
    await renderAttribution({ record: RECORD })
    const link = screen.getByText('camp_7').closest('a')
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/site/marketing/campaigns/camp_7',
    )
  })

  it('names the channel, so a linkable credit is distinguishable', async () => {
    await renderAttribution({ record: RECORD })
    expect(screen.getByText('Campaign email')).toBeTruthy()
  })

  it('states the rule the credit was decided under, from the record', async () => {
    await renderAttribution({ record: { ...RECORD, windowDays: 30 } })
    expect(screen.getByText(/within 30 days of that click/i)).toBeTruthy()
  })
})

describe('a web-channel attribution', () => {
  const RECORD = {
    kind: 'form',
    refId: 'sub_1',
    channel: 'web',
    source: 'google',
    medium: 'cpc',
    campaign: 'spring',
    touchedAtMs: 1_700_000_000_000,
    convertedAtMs: 1_700_200_000_000,
    model: 'last-click',
    windowDays: 7,
  }

  /*==========================================
   * A `utm_` LABEL IS NOT A DOCUMENT.
   *
   * There is nothing at the other end of it, so a link would resolve nowhere
   * — and a link that resolves nowhere is worse than plain text, because the
   * reader spends a page load finding out.
   *=========================================*/
  it('names the label as text and never as a link', async () => {
    await renderAttribution({ record: RECORD })
    const label = screen.getByText('google / cpc / spring')
    expect(label.closest('a')).toBeNull()
    expect(screen.getByText('Web link')).toBeTruthy()
  })

  it('leaves an absent utm part out rather than printing a placeholder', async () => {
    await renderAttribution({
      record: { ...RECORD, medium: undefined, campaign: undefined },
    })
    expect(screen.getByText('google')).toBeTruthy()
    expect(screen.queryByText(/\(none\)/)).toBeNull()
  })
})
