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
 * WHAT A CAMPAIGN PAGE IS ABOUT, PROVED FOR BOTH SHAPES OF CAMPAIGN.
 *
 * `/marketing/campaigns/{id}` resolves to two different components, and which
 * one a reader gets is decided by their data rather than by anything they
 * chose. A campaign holding SEVERAL emails has a container document and gets
 * `campaign-detail-card.tsx`; a campaign holding ONE has no container — the id
 * in the URL is the send's own — and gets `campaign-report-card.tsx`, which
 * collapses the campaign into that email's report.
 *
 * The collapse is why the outcome sections went missing from the shape most
 * merchants actually have. They were added to the container page, they were
 * proved on the container page, and the campaign of one — which never renders
 * that component — went on opening with delivery, engagement and rates. So the
 * assertions below are written ONCE and run over BOTH shapes: a section that
 * exists on one page and not the other fails here, which is the failure the
 * per-component specs could not see.
 *
 * `campaign-report-card.spec.tsx` and `campaign-reach-sections.spec.tsx` prove
 * what each section SAYS. This file proves only what the reader meets first,
 * and that neither shape is missing it.
 */

import { act, render, screen } from '@testing-library/react'

/** Documents answered by a single-document listen, keyed by path. */
const listened = new Map<string, unknown>()
/** Documents answered by a one-off `getDoc`, keyed by path. */
const fetched = new Map<string, Record<string, unknown>>()
/** What each aggregation answers, keyed by its description. */
const counts = new Map<string, number>()
/** Aggregations that are refused rather than answered. */
const countRefusals = new Set<string>()
/** The campaign's emails, served to the container page's send query. */
let sends: Record<string, unknown>[] = []

const describeQuery = (parts: string[]): string => parts.join('|')

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  doc: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (base: any, ...constraints: any[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  where: (field: string, op: string, value: unknown) => ({
    where: field,
    op,
    value,
    text: `${field} ${op} ${
      Array.isArray(value) ? `[${value.join(',')}]` : String(value)
    }`,
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  updateDoc: async () => undefined,
  deleteField: () => ({ __delete: true }),
  /*
   * Resolved on a MACROTASK, which is the fixture's honesty: an aggregate is
   * a network round-trip and its answer cannot land in the same microtask
   * drain as the mount that asked for it.
   */
  getCountFromServer: async (target: any) => {
    const key = describeQuery([
      target.path,
      ...(target.constraints ?? []).map((clause: any) => clause.text),
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (countRefusals.has(key)) throw new Error('denied')
    return { data: () => ({ count: counts.get(key) ?? 0 }) }
  },
  getDoc: async (target: any) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { data: () => fetched.get(String(target.path)) }
  },
}))

/** ONE handle, hoisted — a fresh object per render restarts every effect. */
const FIRESTORE = { __firestore: true }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  useFirestoreDoc: (build: () => { path?: string } | null) => ({
    data: listened.get(build()?.path ?? ''),
    status: 'success',
  }),
  useFirestoreCollection: (build: () => { path?: string } | null) => {
    const name = String(build()?.path ?? '').split('/').pop() ?? ''
    return {
      data:
        name === 'campaigns'
          ? sends
          : name === 'lists'
            ? [{ $id: 'list-1', name: 'Newsletter' }]
            : [],
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({ orgSlug: 'acme', host: 'store' }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

/*
 * The composer and the topic catalog, stubbed because they open listens of
 * their own and this file asserts nothing about either.
 */
jest.mock('@aglyn/plugins-email/components/campaign-composer', () => ({
  __esModule: true,
  default: () => <div>{'composer'}</div>,
}))
jest.mock('@aglyn/plugins-email/components/use-org-email-topics', () => ({
  __esModule: true,
  useOrgEmailTopics: () => ({ topics: [] }),
}))

/*
 * NOTHING ELSE IS STUBBED. The reach sections in particular are real here:
 * stubbing them is what let the container page's own spec pass while the
 * headings this file is about existed on one shape only.
 */
import CampaignDetailCard from './campaign-detail-card'
import CampaignReportCard from './campaign-report-card'

const HOST = 'host-1'
const BASE = '/acme/hosts/store/marketing'
const ATTRIBUTIONS = `hosts/${HOST}/campaignAttributions`

/** The description one kind's aggregation carries for a set of send ids. */
const countKey = (kind: string, ids: string[]): string =>
  describeQuery([
    ATTRIBUTIONS,
    `kind == ${kind}`,
    `campaignId in [${ids.join(',')}]`,
  ])

/** A send's delivery counters, with a recorded delivery figure. */
const STATS = {
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
  clickTracked: true,
}

/**
 * Every section heading on the page, in the order a reader meets them.
 *
 * `Section` draws its title as an `overline`, and so does the emails section's
 * own heading on the container page, so this reads the page's rail rather than
 * a list this file keeps in step by hand.
 */
const headings = (): string[] =>
  [...document.querySelectorAll('.MuiTypography-overline')].map((node) =>
    String(node.textContent ?? '').trim(),
  )

/** Headings that describe the CAMPAIGN — what it did, beyond the mail. */
const OUTCOME_HEADINGS = ['What it caused', 'Where it sent people']

/**
 * Figures that describe the MAIL, named by what they LABEL rather than by the
 * heading they sit under.
 *
 * A heading is renameable and the earlier version of this file compared
 * headings against a list of known ones, so moving the mail back to the top
 * under a heading the list did not know about passed. These two labels are
 * drawn by the figure components themselves on both shapes of page: a
 * delivered count and an open rate are mail mechanics wherever they are put,
 * and a page cannot show them above the outcomes without failing here.
 */
const MAIL_FIGURES = ['Delivered', 'Open rate']

/** Whether `first` comes before `second` in the rendered document. */
const precedes = (first: Element, second: Element): boolean =>
  Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  )

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * The two shapes a campaign URL resolves to, each mounted the way the router
 * mounts it.
 *
 * `oneEmail` deliberately renders `CampaignReportCard` DIRECTLY rather than
 * letting the container page fall through to it, so a change that broke the
 * fall-through could not disguise itself as this file passing — the
 * fall-through itself is `campaign-detail-card.spec.tsx`'s subject.
 */
interface Shape {
  name: string
  /** Proof the mounted page really is this shape and not the other one. */
  proof: RegExp
  /** The ids the outcome figures are counted over. */
  sendIds: string[]
  /** Mounts the page over the delivery counters it is handed. */
  mount: (stats?: Record<string, number | boolean>) => Promise<void>
}

const oneEmail: Shape = {
  name: 'a campaign of one email',
  proof: /This campaign is one email/i,
  sendIds: ['send-1'],
  mount: async (stats = STATS) => {
    listened.set(`hosts/${HOST}/campaigns/send-1`, {
      subject: 'Spring sale',
      status: 'sent',
      stats,
    })
    render(
      <CampaignReportCard hostId={HOST} campaignId="send-1" basePath={BASE} />,
    )
    await settle()
  },
}

const severalEmails: Shape = {
  name: 'a campaign of several emails',
  proof: /Emails \(2\)/,
  sendIds: ['send-1', 'send-2'],
  mount: async (stats = STATS) => {
    listened.set(`hosts/${HOST}/emailCampaigns/camp-1`, {
      name: 'Spring sale',
      startAtMs: Date.UTC(2026, 2, 1),
      endAtMs: Date.UTC(2026, 2, 31),
      listIds: ['list-1'],
    })
    sends = [
      { $id: 'send-1', subject: 'First mailing', status: 'sent', stats },
      { $id: 'send-2', subject: 'Second mailing', status: 'sent', stats },
    ]
    render(
      <CampaignDetailCard hostId={HOST} campaignId="camp-1" basePath={BASE} />,
    )
    await settle()
  },
}

const SHAPES = [oneEmail, severalEmails]

beforeEach(() => {
  listened.clear()
  fetched.clear()
  counts.clear()
  countRefusals.clear()
  sends = []
})

describe.each(SHAPES)('$name', (shape: Shape) => {
  /*
   * THE CONTROL, and it runs first.
   *
   * Both entries in the table above render "a campaign page", and the two
   * assertions after this one would pass just as happily if the table held
   * the container page twice. It held the equivalent of that for real: the
   * outcome sections were proved against the container and the campaign of
   * one was never mounted, so the shape most merchants have went unmeasured.
   *
   * The proof is a string only that shape can produce — the collapsed page
   * says it is one email, and the container counts the emails it holds.
   */
  it('is the shape it claims to be, and not the other one', async () => {
    await shape.mount()

    expect(screen.getByText(shape.proof)).toBeTruthy()
    const other = SHAPES.find((entry) => entry !== shape) as Shape
    expect(screen.queryByText(other.proof)).toBeNull()
  })

  it('leads with what the campaign caused, not with how its mail did', async () => {
    await shape.mount()

    /*
     * Every outcome heading above every mail figure. Delivery and rates are
     * facts about a message; a page that met the reader with them and reached
     * what the campaign DID only after scrolling was a mail report whatever
     * its headings claimed, which is the report the owner read twice.
     *
     * Compared by DOCUMENT POSITION rather than by an index into a list of
     * headings this file keeps: the positions are what a reader experiences,
     * and they cannot be satisfied by renaming a section.
     */
    for (const heading of OUTCOME_HEADINGS) {
      const section = screen.getByText(heading)
      for (const label of MAIL_FIGURES) {
        expect(precedes(section, screen.getAllByText(label)[0])).toBe(true)
      }
    }
    // And it is the first thing on the page, not merely somewhere above the
    // mail: a campaign page opens on what the campaign did.
    expect(headings()[0]).toBe('What it caused')
  })

  it('withholds a conversion figure it could not read, rather than showing 0', async () => {
    /*
     * Refused for the container's aggregation, and absent for the collapsed
     * page's rollup listen — the two ways a count fails to arrive on the two
     * shapes. Neither may resolve to a zero: "we could not read this" and
     * "this campaign caused nothing" are opposite facts, and only one of them
     * flatters the campaign.
     */
    countRefusals.add(countKey('lead', shape.sendIds))
    await shape.mount()

    expect(screen.queryByText('Form submissions')).toBeNull()
    expect(screen.queryByText('Leads')).toBeNull()
  })

  it('never turns an absent delivery count into a zero', async () => {
    /*
     * The delivery webhook reaches a deploy that can be behind, so a campaign
     * whose delivery events were never recorded is a live state rather than a
     * hypothetical. Reordering the page must not have handed anything a
     * default: an absent denominator stays visibly absent, and the rate over
     * it stays unprinted.
     */
    const noDelivery = { ...STATS }
    delete (noDelivery as Record<string, unknown>).delivered
    await shape.mount(noDelivery)

    const delivered = screen
      .getAllByText('Delivered')
      .map((node) => node.parentElement?.querySelector('h6')?.textContent)
      .find((text): text is string => typeof text === 'string')
    expect(delivered).toBe('—')
    expect(screen.getAllByText(/not recorded/i).length).toBeGreaterThan(0)
  })
})
