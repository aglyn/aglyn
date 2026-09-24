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
 * What one MARKETING console load actually READS (AGL-2501).
 *
 * The meter, before the conversion rather than after it. `HubTabs lazy` already
 * mounts one panel, so the question this file exists to answer is not "is the
 * page cheap" but "would routing the sections make it MORE expensive" — and
 * that has to be measured, because converting a surface whose before/after
 * nobody recorded is how a routed section quietly costs more than the flag it
 * replaced.
 *
 * It is answered in listens and documents rather than in rendered output: a
 * spec that asserts on what is on screen passes identically whether the other
 * sections are mounted or not, which is the entire cost in question. Every
 * query is recorded with the `limit()` it carries, because that limit IS the
 * billable ceiling — Firestore charges per document returned, and a card that
 * listens with `limit(200)` to render twenty rows is buying two hundred.
 *
 * So the meter sits at the Firestore boundary. Every query the page builds is
 * recorded with the `limit()` it carries, because that limit IS the billable
 * ceiling — Firestore charges per document returned, and a card that listens
 * with `limit(500)` to render twenty rows is buying five hundred.
 */

import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  MARKETING_CONSOLE_SECTIONS,
  MARKETING_ORG_CONSOLE_SECTIONS,
} from './marketing-console-sections'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { LIVE_OVERLAY_CEILING } from './host-marketing-summary-card.component'
import { ORG_EXPERIMENTS_PER_SITE } from './org-experiments-card'
import { ORG_OVERVIEW_SITE_CAP } from './org-marketing-overview-card'
import { ORG_OVERLAYS_PER_SITE } from './org-overlays-card'
import { ORG_SITES_PER_PAGE } from './use-one-shot-reads'

/**
 * Every query built during a render, as `path` + the `limit()` on it.
 *
 * Module-scoped and `mock`-prefixed so the `jest.mock` factories below may
 * close over it — jest's out-of-scope-variable guard admits that one prefix.
 */
const mockListens: Array<{ path: string; limit: number }> = []

/**
 * Every ONE-SHOT read issued during a render: a `getDocs`/`getDoc`, a server
 * count, a server aggregate.
 *
 * Kept apart from the listens because they bill apart. A listen and a
 * `getDocs` both pay per document returned, so `limit` is their ceiling; an
 * aggregation pays per thousand index entries it scans, so it is counted as
 * ONE read each, which is its floor and, over collections of a few thousand
 * documents, its cost. `filters` and `fields` say which question each one
 * asked, so two aggregations over one collection are told apart.
 */
const mockOneShots: Array<{
  kind: 'get' | 'count' | 'aggregate'
  path: string
  limit: number
  filters: string[]
  fields: string[]
}> = []

/**
 * A query with no `limit()` still reads the whole collection. Counting it as
 * zero would let an unbounded listen look CHEAPER than a bounded one, which
 * inverts the measurement. This stands for "unbounded" at a figure no console
 * collection is expected to exceed, and is reported separately below so the
 * headline number can be read with and without the estimate.
 */
const UNBOUNDED_ESTIMATE = 100

jest.mock('firebase/firestore', () => {
  const marker = (kind: string) => (...args: unknown[]) => ({
    __constraint: kind,
    args,
  })
  return {
    __esModule: true,
    collection: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
    }),
    doc: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
      __doc: true,
    }),
    query: (
      base: { __path?: string; __limit?: number; __where?: string[] },
      ...constraints: unknown[]
    ) => {
      const limits = constraints
        .filter(
          (c): c is { __constraint: string; args: number[] } =>
            !!c && (c as { __constraint?: string }).__constraint === 'limit',
        )
        .map((c) => c.args[0])
        .filter((n) => typeof n === 'number')
      const wheres = constraints
        .filter(
          (c): c is { __constraint: string; args: unknown[] } =>
            !!c && (c as { __constraint?: string }).__constraint === 'where',
        )
        .map(
          (c) =>
            `${String(c.args[0])}${String(c.args[1])}${
              Array.isArray(c.args[2])
                ? c.args[2].join(',')
                : String(c.args[2])
            }`,
        )
      return {
        __path: base?.__path ?? '(unknown)',
        __limit: limits.length ? Math.max(...limits) : (base?.__limit ?? 0),
        __where: [...(base?.__where ?? []), ...wheres],
      }
    },
    limit: marker('limit'),
    where: marker('where'),
    orderBy: marker('orderBy'),
    documentId: () => '__name__',
    count: marker('count'),
    sum: marker('sum'),
    onSnapshot: (
      ref: { __path?: string; __limit?: number; __doc?: boolean },
      ...rest: unknown[]
    ) => {
      mockListens.push({
        path: ref?.__path ?? '(unknown)',
        // A single-document listen reads exactly one document.
        limit: ref?.__doc ? 1 : (ref?.__limit ?? 0),
      })
      /*
       * A DOCUMENT listen ANSWERS, with an empty document.
       *
       * Collection listens stay silent, which is all this meter needs: a query
       * is recorded when it is opened. A document listen is different, because
       * the campaign page depends on the answer rather than the payload — it
       * renders nothing until it knows whether the id names a container or a
       * single send, because guessing flashes the wrong screen, and a page
       * stuck on that branch would have the meter measuring the spinner.
       *
       * A container id that turns out to name a SEND is the campaign route's
       * fall-through case, and it is the only ABSENT document this meter
       * needs; every other subject is present.
       */
      const next = rest.find((argument) => typeof argument === 'function') as
        | ((snapshot: unknown) => void)
        | undefined
      if (ref?.__doc && next) {
        next({
          exists: () => !String(ref.__path ?? '').includes('/emailCampaigns/'),
          data: () =>
            String(ref.__path ?? '').includes('/emailCampaigns/')
              ? undefined
              : {},
          id: String(ref.__path ?? '').split('/').pop() ?? '',
          metadata: { hasPendingWrites: false, fromCache: false },
        })
      }
      return () => undefined
    },
    getDocs: async (ref: {
      __path?: string
      __limit?: number
      __where?: string[]
    }) => {
      mockOneShots.push({
        kind: 'get',
        path: ref?.__path ?? '(unknown)',
        limit: ref?.__limit ?? 0,
        filters: ref?.__where ?? [],
        fields: [],
      })
      return {
        docs: [],
        empty: true,
        size: 0,
        forEach: () => undefined,
      }
    },
    getDocsFromServer: async () => ({ docs: [], empty: true, size: 0 }),
    getDoc: async (ref: { __path?: string }) => {
      mockOneShots.push({
        kind: 'get',
        path: ref?.__path ?? '(unknown)',
        limit: 1,
        filters: [],
        fields: [],
      })
      return { exists: () => false, data: () => undefined }
    },
    getCountFromServer: async (ref: { __path?: string; __where?: string[] }) => {
      mockOneShots.push({
        kind: 'count',
        path: ref?.__path ?? '(unknown)',
        limit: 0,
        filters: ref?.__where ?? [],
        fields: [],
      })
      return { data: () => ({ count: 0 }) }
    },
    getAggregateFromServer: async (
      ref: { __path?: string; __where?: string[] },
      spec: Record<string, { args?: unknown[] }>,
    ) => {
      mockOneShots.push({
        kind: 'aggregate',
        path: ref?.__path ?? '(unknown)',
        limit: 0,
        filters: ref?.__where ?? [],
        fields: Object.values(spec ?? {}).map((field) => String(field?.args?.[0])),
      })
      return { data: () => ({}) }
    },
    addDoc: async () => ({ id: 'x' }),
    setDoc: async () => undefined,
    updateDoc: async () => undefined,
    deleteDoc: async () => undefined,
    runTransaction: async () => undefined,
    Timestamp: { now: () => ({ toMillis: () => 0, toDate: () => new Date(0) }) },
    serverTimestamp: () => ({ __serverTimestamp: true }),
  }
})


/*
 * Every mocked hook answers the SAME object on every call.
 *
 * A fresh object per render is not a harmless detail here: the cards put
 * `firestore` and the plan doc in their query dependency lists, so a new
 * identity each render re-subscribes, which re-renders, which re-subscribes.
 * The spec hangs rather than failing, and the meter counts a loop instead of
 * a load.
 */
const mockFirestore = { __firestore: true }
const mockUser = { data: { uid: 'u1' }, status: 'success' }
const mockOrgId = { orgId: 'org1', ready: true }
/*
 * The org lookup, ALREADY SETTLED.
 *
 * `useOrgDataScope` resolves the owning org with an async `getDoc` and hands
 * back `scope: null` until it lands, and every org-scoped card holds its query
 * until it does. Left unmocked, nothing behind that promise ever runs: the
 * campaigns section's two org-scoped listens are issued in a browser and are
 * invisible to a harness whose org never resolves. A card whose reads are all
 * behind an unresolved promise is not a cheap card, it is an unmeasured one.
 */
const mockScope = { orgId: 'org1', ready: true, scope: ['orgs', 'org1'] }
const mockHostRoute = { orgSlug: 'acme', subdomain: 'site', base: '/acme/hosts/site' }
const mockPlan = { org: { plan: 'business', features: {} }, ready: true }
const mockResourceApi = { data: undefined, loading: false }
/*
 * The provider the data hooks read their services out of.
 *
 * Stubbed rather than wrapped in a real provider, and `usePagedCollection` is
 * deliberately NOT mocked: it builds real queries against the mocked
 * `firebase/firestore` above, so its reads land on the meter. Mocking it would
 * make the paged sections look free, which is the opposite of measuring them.
 */
const mockServices = {
  app: {},
  firestore: mockFirestore,
  auth: { currentUser: { uid: 'u1' } },
  storage: {},
}

jest.mock('@aglyn/tenant-feature-instance', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance')
  return {
    ...actual,
    useFirestore: () => mockFirestore,
    useUser: () => mockUser,
    useHostOrgId: () => mockOrgId,
    useOrgDataScope: () => mockScope,
    useConsoleHostRoute: () => mockHostRoute,
    // Entitled and settled: an unentitled org renders upsells instead of
    // cards, which would measure the refusal rather than the page.
    useOrgPlan: () => mockPlan,
    useHostResourceApi: () => mockResourceApi,
    useFirebaseServices: () => mockServices,
  }
})

/*
 * The services module, mocked at its OWN path rather than through the barrel.
 *
 * Overriding `useFirestore` on the barrel only rebinds what the CARDS import.
 * Hooks inside the library — `useHostOrgId` and friends — call it through the
 * module-internal binding, which a barrel mock cannot reach, so they went on
 * demanding a real `FirebaseServicesProvider`. Mocking the defining module
 * replaces the binding every one of them resolves.
 *
 * `useFirestoreCollection`, `useFirestoreDoc` and `usePagedCollection` are
 * deliberately left REAL: they build their queries against the mocked
 * `firebase/firestore` above, which is what puts those reads on the meter.
 */
jest.mock(
  '../../../../../tenant/feature/instance/src/lib/hooks/firebase/firebase-services',
  () => ({
    __esModule: true,
    useFirestore: () => mockFirestore,
    useFirebaseServices: () => mockServices,
    useUser: () => mockUser,
    useAnalytics: () => undefined,
    useAuth: () => mockServices.auth,
    useDatabase: () => ({}),
    useStorage: () => ({}),
    FirebaseServicesProvider: ({ children }: { children?: unknown }) => children,
  }),
)

jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    checkEntitlement: () => true,
    checkQuota: () => ({ allowed: true, used: 0, limit: 100 }),
    useMediaPicker: () => ({ pickMedia: async () => null }),
  }
})

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: () => undefined,
    closeSnackbar: () => undefined,
  }),
}))

/** The section the URL names, moved between renders to stand for a link. */
let mockSection = ''

const BASE_PATH = '/acme/hosts/site/marketing'

jest.mock('next/navigation', () => ({
  usePathname: () => (mockSection ? `${BASE_PATH}/${mockSection}` : BASE_PATH),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
}))

/** Documents the recorded listens would return at their limits. */
function documentCeiling(listens: Array<{ path: string; limit: number }>) {
  return listens.reduce(
    (total, listen) => total + (listen.limit || UNBOUNDED_ESTIMATE),
    0,
  )
}

function summarize(label: string, listens: Array<{ path: string; limit: number }>) {
  const bounded = listens.filter((l) => l.limit > 0)
  const unbounded = listens.length - bounded.length
  console.log(
    `\n[${label}] listens=${listens.length} ` +
      `(bounded=${bounded.length}, unbounded=${unbounded}) ` +
      `documents<=${documentCeiling(listens)}\n` +
      listens
        .map((l) => `    ${String(l.limit || `~${UNBOUNDED_ESTIMATE}`).padStart(4)}  ${l.path}`)
        .join('\n'),
  )
}

/**
 * Collections only ONE section's cards read, keyed by that section.
 *
 * `campaigns` reads the collection of the same name because that is where a
 * SENT MESSAGE is stored; the CONTAINER that groups sends is
 * `emailCampaigns`, and the section reads both.
 */
const SECTION_COLLECTIONS = {
  overview: ['overlays'],
  campaigns: ['emailCampaigns'],
  experiments: ['experiments'],
} as const

/**
 * The campaigns section's ceiling, in documents.
 *
 * Campaigns is the most expensive section on this surface, and this is the
 * number that says how expensive it is allowed to be. Three listens, and each
 * of the three is drawn on screen:
 *
 *   31   `campaigns`       the send ceiling, plus the probe that says there
 *                          are more
 *   51   `emailCampaigns`  the container ceiling, plus its probe
 *   50   `lists`           so the Lists column names what a campaign is aimed
 *                          at rather than printing document ids
 *
 * The org's TOPIC CATALOG is deliberately not among them, and it is the
 * biggest single read this section could make at 200 documents. It fills one
 * picker in the create drawer and is drawn nowhere in the table, so it sits
 * behind the click that opens that drawer. `does not read the topic catalog
 * until somebody asks to create` below is the assertion that keeps it there;
 * the reading that proves it is read once the drawer OPENS is in
 * `campaigns-table.spec.tsx`, which can drive the button.
 *
 * A number rather than "no more than before": what is being guarded is what
 * Firestore is asked to RETURN, and a card that listens with `limit(200)` to
 * render twenty rows is buying two hundred.
 */
const CAMPAIGNS_DOCUMENT_CEILING = 132

function listenedCollections(): Set<string> {
  return new Set(mockListens.map((listen) => listen.path.split('/').pop() ?? ''))
}

/** Every collection read at all — listened to, fetched once, or aggregated. */
function readCollections(): Set<string> {
  return new Set(
    [...mockListens, ...mockOneShots].map(
      (read) => read.path.split('/').pop() ?? '',
    ),
  )
}

/**
 * One one-shot read as a line — `kind path filters fields limit` — so a
 * section's whole bill can be pinned with one `toEqual`.
 */
function describeOneShot(read: (typeof mockOneShots)[number]): string {
  return [
    read.kind,
    read.path,
    ...read.filters,
    ...read.fields.map((field) => `sum(${field})`),
    ...(read.kind === 'get' ? [`limit=${read.limit}`] : []),
  ].join(' ')
}

/**
 * The one-shot reads' answers landed and React's queue drained. Every read is
 * recorded when it is ISSUED, inside the render's effects; this only keeps
 * the answers from arriving after the test, outside `act`.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * The section list the SHELL would hand the page, resolved from the registry's
 * own declaration rather than retyped here — a second copy would let this spec
 * go on passing after a section was renamed out from under it.
 */
function shellSections() {
  return MARKETING_CONSOLE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    href: `${BASE_PATH}/${section.id}`,
    visible: true,
  }))
}

/**
 * @param section the section id the URL names.
 * @param detail  segments BENEATH the section — `['camp_1']` for
 *                `/marketing/campaigns/camp_1`. A section owns its own
 *                subtree, so what those cost is a question this meter has to
 *                be able to ask.
 */
async function renderConsole(section: string, detail: string[] = []) {
  mockSection = [section, ...detail].filter(Boolean).join('/')
  mockListens.length = 0
  mockOneShots.length = 0
  const { MarketingConsolePage } = await import('./marketing-console-page')
  return render(
    <MarketingConsolePage
      hostId="site1"
      entitled
      org={{ plan: 'business' } as never}
      permissions={{} as never}
      basePath={BASE_PATH}
      sections={shellSections()}
      section={section || undefined}
      segments={section ? [section, ...detail] : []}
    /> as ReactNode as never,
  )
}

describe('marketing console read cost (AGL-2501)', () => {
  afterEach(() => {
    mockSection = ''
    mockListens.length = 0
    mockOneShots.length = 0
  })

  /*
   * The CONTROL for every assertion below.
   *
   * The cost assertions are all of the form "collection X was NOT listened
   * to", and a meter that records nothing satisfies every one of them. This is
   * the reading that proves the meter is live: the section the URL names does
   * listen, and it listens for its OWN collection.
   */
  it('CONTROL: the open section does read, and its own collection', async () => {
    await renderConsole('overview')
    await settle()
    expect(mockListens.length + mockOneShots.length).toBeGreaterThan(0)
    expect(readCollections()).toContain('overlays')
  })

  /*==========================================
   * THE SITE OVERVIEW, counted rather than sampled.
   *
   * Its figures were three listeners at `limit(50)` summed in the browser,
   * so a site past fifty sends reported the totals of whichever fifty the
   * server returned first. Every total is now a server aggregate — one per
   * field, because an aggregation over two fields drops the documents that
   * lack either — and the one figure that needs code, how many overlays are
   * live right now, reads the overlays themselves under a ceiling. Nothing
   * is listened to: the overlays' counters move on every impression.
   *=========================================*/
  it('the site overview is aggregates and one capped read, and no listener', async () => {
    await renderConsole('overview')
    await settle()
    expect(mockListens).toHaveLength(0)
    expect(mockOneShots.map(describeOneShot)).toEqual([
      'aggregate hosts/site1/overlays sum(stats.impressions)',
      'aggregate hosts/site1/overlays sum(stats.clicks)',
      `get hosts/site1/overlays limit=${LIVE_OVERLAY_CEILING + 1}`,
      'aggregate orgs/org1/campaigns visibleToarray-contains-anyhost:site1 sum(stats.sent)',
      'aggregate orgs/org1/campaigns visibleToarray-contains-anyhost:site1 sum(stats.opens)',
      'aggregate orgs/org1/campaigns visibleToarray-contains-anyhost:site1 sum(stats.clicks)',
      'count orgs/org1/campaigns visibleToarray-contains-anyhost:site1 status==scheduled',
      'count hosts/site1/experiments status==running',
      'count hosts/site1/experiments winnerVariantId!=null',
    ])
  })

  /*
   * The surface's own URL, which names no section (AGL-2501).
   *
   * The page renders nothing and reads nothing. The REDIRECT itself is the
   * shell's — it lives above the `lazy()` boundary so a bare hub URL never
   * downloads this chunk at all — and is asserted in
   * `apps/console/specs/plugin-section-routes.spec.tsx`. What belongs here is
   * the half this file can prove: that the page issues no query while the URL
   * names no section. Rendering a default section instead would pay for its
   * listens on a URL that is already being replaced.
   */
  it('the sectionless URL reads nothing', async () => {
    await renderConsole('')
    summarize('no section', mockListens)
    expect(mockListens).toHaveLength(0)
  })

  it('an unopened section issues no query', async () => {
    await renderConsole('experiments')
    summarize('experiments section', mockListens)
    const seen = listenedCollections()
    expect(seen).toContain('experiments')
    expect(seen).not.toContain('overlays')
    // Campaigns is the expensive one on this surface, and it is not open.
    expect(seen).not.toContain('campaigns')
    expect(seen).not.toContain('emailCampaigns')
  })

  /*==========================================
   * THE PER-CAMPAIGN REPORT.
   *
   * The reason this belongs on the meter rather than in a rendering test: the
   * obvious implementation of a campaign report aggregates the per-recipient
   * delivery log, which is ONE DOCUMENT PER RECIPIENT, re-read on every
   * mount. A 50,000-recipient send would then cost 50,000 reads to render
   * seven numbers, and nothing about the screen would look different.
   *
   * So the counters are written at delivery time and the report is a handful
   * of single-document reads — the campaign, its link rollup and its revenue
   * rollup — whatever the audience was. These assertions are what stop that
   * quietly becoming a query again.
   *
   * The revenue rollup is the same argument one collection along. Joining
   * orders to campaigns at read time would mean querying the host's orders
   * for every render of this screen; the join is done once at the sale and
   * summed into one document, so the report pays for one listen and not for
   * one order.
   *=========================================*/
  it('the campaign report reads five documents, and no collection', async () => {
    await renderConsole('campaigns', ['camp_1'])
    summarize('campaign report', mockListens)

    /*
     * FIVE, and the first of them is what keeps this URL working at all.
     *
     * `/marketing/campaigns/{id}` names either a campaign CONTAINER or a
     * single SEND — a message that belongs to no container carries only its
     * own id, and that id is in merchants' pasted links and inside the HMAC
     * of every delivered unsubscribe footer. Which one it is can only be
     * settled by reading `emailCampaigns/{id}`, and that read is the price of
     * never rewriting a send id.
     *
     * What the ceiling still buys is the property this file exists for: the
     * report is a fixed number of SINGLE-DOCUMENT reads whatever the size of
     * the audience, and the campaign view's own collection queries do not open
     * on a send URL — they are gated on the container having been found.
     *
     * The conversions rollup is the revenue argument once more. Counting what
     * a campaign caused at read time would mean querying the host's
     * attribution records on every render of this screen; the join is done
     * once at the conversion and summed into one document, so the report pays
     * for one listen and not for one conversion.
     */
    expect(mockListens.every((listen) => listen.limit === 1)).toBe(true)
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(5)
    expect(mockListens.map((listen) => listen.path)).toEqual([
      'orgs/org1/emailCampaigns/camp_1',
      'orgs/org1/campaigns/camp_1',
      'orgs/org1/campaigns/camp_1/reports/links',
      'orgs/org1/campaigns/camp_1/reports/revenue',
      'orgs/org1/campaigns/camp_1/reports/conversions',
    ])
  })

  /*==========================================
   * THE CONVERSIONS SECTION.
   *
   * The surface most at risk of becoming a scan: "show me what the campaigns
   * caused" reads naturally as "read every attribution record and group
   * them", which is one document per conversion on every visit and grows with
   * the site's success.
   *
   * What it costs instead is two PAGED windows — one per channel, because the
   * two are never merged into one list — each bounded by the shared page size
   * with one probe row past it. The uncredited figure is a server aggregate,
   * billed per thousand index entries rather than per document, and the
   * landing-page join is behind a button. So the section's standing cost is
   * fixed by the page size and not by the history.
   *=========================================*/
  it('the conversions section pages both channels and scans neither', async () => {
    await renderConsole('conversions')
    summarize('conversions section', mockListens)

    const attributionListens = mockListens.filter((listen) =>
      listen.path.endsWith('/campaignAttributions'),
    )
    // TWO windows: the email channel and the web channel, separately.
    expect(attributionListens).toHaveLength(2)
    // Each is the shared page size plus the probe row that turns "there is
    // more" into a fact — never a ceiling in the hundreds.
    attributionListens.forEach((listen) => {
      expect(listen.limit).toBe(TABLE_PAGE_SIZE_DEFAULT + 1)
    })
    // And it reads nothing else — not the campaigns it links to, not the
    // submissions the landing-page join would need.
    const paths = mockListens.map((listen) => listen.path)
    expect(paths).not.toContain('orgs/org1/campaigns')
    expect(paths).not.toContain('orgs/org1/emailCampaigns')
    expect(paths).not.toContain('hosts/site1/formSubmissions')
  })

  it('the report does not mount the composer or the history', async () => {
    await renderConsole('campaigns', ['camp_1'])

    // The campaigns SECTION reads a 30-send ceiling plus the campaign
    // containers, the org's lists, screens and experiments. A reader who came
    // for one campaign's numbers must not pay for any of it — and
    // `emailDeliveries` must never appear at all, at any limit.
    const paths = mockListens.map((listen) => listen.path)
    expect(paths).not.toContain('orgs/org1/campaigns')
    expect(paths).not.toContain('orgs/org1/emailCampaigns')
    // The rollup says how many; the RECORDS behind it are a paged read on
    // another section, reached by a link. Listening for them here would put a
    // collection query back on the page this ceiling protects.
    expect(paths).not.toContain('hosts/site1/campaignAttributions')
    expect(paths.some((path) => path.endsWith('/lists'))).toBe(false)
    expect(paths.some((path) => path.includes('emailDeliveries'))).toBe(false)
    expect(paths.some((path) => path.endsWith('/screens'))).toBe(false)
    expect(paths.some((path) => path.endsWith('/experiments'))).toBe(false)
  })

  /*
   * ANTI-VACUITY for the pair above. Both are of the form "X was not read",
   * and a page that rendered nothing satisfies them. This is the reading that
   * proves the section without a campaign id still costs what it does.
   */
  it('CONTROL: the campaigns section itself still reads its collection', async () => {
    await renderConsole('campaigns')
    expect(listenedCollections()).toContain('campaigns')
    expect(documentCeiling(mockListens)).toBeGreaterThan(2)
  })

  /*==========================================
   * CAMPAIGNS, metered rather than merely reported.
   *
   * The most expensive section on this surface. Two of its listens are
   * org-scoped, which makes them invisible to this harness unless
   * `useOrgDataScope` is mocked: they are always issued in a browser and the
   * meter simply cannot see them. A section whose reads are behind an
   * unresolved promise is not a cheap section, it is an unmeasured one.
   *=========================================*/
  describe('the campaigns section', () => {
    it('opens THREE listens, inside the page budget', async () => {
      await renderConsole('campaigns')
      summarize('campaigns section', mockListens)
      expect(mockListens).toHaveLength(3)
      expect(documentCeiling(mockListens)).toBeLessThanOrEqual(
        CAMPAIGNS_DOCUMENT_CEILING,
      )
    })

    it('reads only the collections the table DRAWS', async () => {
      await renderConsole('campaigns')
      // Each of the three has a column or a chip that needs it: the sends and
      // the containers are the rows, the lists are the Lists column.
      expect([...listenedCollections()].sort()).toEqual([
        'campaigns',
        'emailCampaigns',
        'lists',
      ])
    })

    /*
     * THE ASSERTION. The topic catalog is 200 documents — more than the rest
     * of the section put together — and nothing in the table shows a topic.
     * Reading it on mount would charge every operator who came to look at
     * their campaigns for a dropdown in a drawer they never opened.
     */
    it('does not read the topic catalog until somebody asks to create', async () => {
      await renderConsole('campaigns')
      expect(listenedCollections()).not.toContain('emailTopics')
      expect(
        mockListens.filter((listen) => listen.path.includes('emailTopics')),
      ).toHaveLength(0)
    })

    it('does not reach the other sections\u2019 collections either', async () => {
      await renderConsole('campaigns')
      const seen = listenedCollections()
      expect(seen).not.toContain('overlays')
      expect(seen).not.toContain('experiments')
      expect(seen).not.toContain('contactSegments')
    })
  })
})

/*==========================================
 * THE ORGANIZATION'S HUB, `/[orgSlug]/marketing`.
 *
 * Mounted with no site and an org mount, it carries the site rail's sections
 * over every site. What belongs to the organization is read once for all of
 * them: the campaigns and their sends are two ceilinged windows over the
 * org's collections, and the Overview's email figures are four aggregations
 * over the same sends. What belongs to a SITE — its overlays, its A/B tests,
 * its visitors' conversions — is read per site, and every one of those reads
 * is BOUNDED: the Overview reads a capped number of sites, the two lists
 * read one page of sites at a time, and Conversions reads the one site the
 * reader picked. These are the numbers that say so.
 *=========================================*/
describe('the org Marketing hub’s read cost', () => {
  const ORG_BASE = '/acme/marketing'
  const ONE_SITE = [{ id: 'site1', name: 'Site', subdomain: 'site' }]
  /** An organization of `count` sites, `site1` first. */
  const sitesOf = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `site${index + 1}`,
      name: `Site ${index + 1}`,
      subdomain: `site-${index + 1}`,
    }))

  afterEach(() => {
    mockSection = ''
    mockListens.length = 0
    mockOneShots.length = 0
    window.sessionStorage.clear()
  })

  async function renderOrgConsole(
    section: string,
    detail: string[] = [],
    hosts: Array<{ id: string; name: string; subdomain: string }> = ONE_SITE,
  ) {
    mockSection = [section, ...detail].filter(Boolean).join('/')
    mockListens.length = 0
    mockOneShots.length = 0
    const { MarketingConsolePage } = await import('./marketing-console-page')
    const rendered = render(
      <MarketingConsolePage
        hostId={null}
        orgMount={{
          orgId: 'org1',
          orgSlug: 'acme',
          hosts,
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
        entitled
        org={{ plan: 'business' } as never}
        permissions={{} as never}
        basePath={ORG_BASE}
        sections={MARKETING_ORG_CONSOLE_SECTIONS.map((item) => ({
          id: item.id,
          label: item.label,
          href: `${ORG_BASE}/${item.id}`,
          visible: true,
        }))}
        section={section}
        segments={[section, ...detail]}
      /> as ReactNode as never,
    )
    await settle()
    return rendered
  }

  /*
   * THE LANDING. A bare `/[orgSlug]/marketing` lands on the rail's first
   * section, so whatever that section costs is what every visit costs.
   */
  it('lands on Overview, and carries the site rail in the site rail’s order', () => {
    expect(MARKETING_ORG_CONSOLE_SECTIONS[0].id).toBe('overview')
    expect(
      MARKETING_ORG_CONSOLE_SECTIONS.map((item) => [item.id, item.label]),
    ).toEqual(MARKETING_CONSOLE_SECTIONS.map((item) => [item.id, item.label]))
  })

  it('the landing listens to nothing and reads a fixed set of aggregates', async () => {
    await renderOrgConsole('overview')
    expect(mockListens).toHaveLength(0)
    expect(mockOneShots.map(describeOneShot)).toEqual([
      // The email figures: ONE org collection, every site's sends.
      'aggregate orgs/org1/campaigns sum(stats.sent)',
      'aggregate orgs/org1/campaigns sum(stats.opens)',
      'aggregate orgs/org1/campaigns sum(stats.clicks)',
      'count orgs/org1/campaigns status==scheduled',
      // Then four per site: its overlays' engagement and its tests' states.
      'aggregate hosts/site1/overlays sum(stats.impressions)',
      'aggregate hosts/site1/overlays sum(stats.clicks)',
      'count hosts/site1/experiments status==running',
      'count hosts/site1/experiments winnerVariantId!=null',
    ])
  })

  it('bounds the landing at the site cap however many sites there are', async () => {
    await renderOrgConsole('overview', [], sitesOf(ORG_OVERVIEW_SITE_CAP + 5))
    const perSite = mockOneShots.filter((read) => read.path.startsWith('hosts/'))
    expect(perSite).toHaveLength(4 * ORG_OVERVIEW_SITE_CAP)
    expect(new Set(perSite.map((read) => read.path.split('/')[1])).size).toBe(
      ORG_OVERVIEW_SITE_CAP,
    )
    expect(
      perSite.some((read) =>
        read.path.startsWith(`hosts/site${ORG_OVERVIEW_SITE_CAP + 1}/`),
      ),
    ).toBe(false)
    expect(mockOneShots).toHaveLength(4 + 4 * ORG_OVERVIEW_SITE_CAP)
    expect(mockListens).toHaveLength(0)
  })

  it('lists campaigns from the org collections, and nothing of any one site', async () => {
    await renderOrgConsole('campaigns')
    summarize('org campaigns section', mockListens)

    const paths = mockListens.map((listen) => listen.path)
    expect(paths).toContain('orgs/org1/emailCampaigns')
    expect(paths).toContain('orgs/org1/campaigns')
    expect(paths.some((path) => path.startsWith('hosts/'))).toBe(false)
    expect(
      mockListens.find((listen) => listen.path === 'orgs/org1/campaigns')?.limit,
    ).toBe(31)
  })

  /*
   * A conversion is one site's, so the section reads ONE site: the first by
   * default. Its bill is the site hub's own conversions section, unchanged —
   * two paged windows over that site's attributions — and no other site is
   * touched.
   */
  it('reads the conversions of one site, the first by default', async () => {
    await renderOrgConsole('conversions', [], sitesOf(3))
    const attributions = mockListens.filter((listen) =>
      listen.path.endsWith('/campaignAttributions'),
    )
    expect(attributions.map((listen) => listen.path)).toEqual([
      'hosts/site1/campaignAttributions',
      'hosts/site1/campaignAttributions',
    ])
    attributions.forEach((listen) => {
      expect(listen.limit).toBe(TABLE_PAGE_SIZE_DEFAULT + 1)
    })
    const everyPath = [...mockListens, ...mockOneShots].map((read) => read.path)
    expect(
      everyPath.some(
        (path) => path.startsWith('hosts/site2/') || path.startsWith('hosts/site3/'),
      ),
    ).toBe(false)
    // The retired per-site leads path is never counted: leads are the org's.
    expect(everyPath).not.toContain('hosts/site1/leads')
  })

  /*
   * THE LISTS, one page of sites at a time. Each site on the page costs one
   * ceilinged read of its overlays and its site document; the sites on the
   * next page cost nothing until somebody turns to it. No 14-day analytics
   * row either — that is a document per day per site.
   */
  it('reads one page of sites’ overlays, ceilinged per site', async () => {
    await renderOrgConsole('overlays', [], sitesOf(ORG_SITES_PER_PAGE + 5))
    expect(mockListens).toHaveLength(0)
    const overlays = mockOneShots.filter((read) => read.path.endsWith('/overlays'))
    expect(overlays).toHaveLength(ORG_SITES_PER_PAGE)
    overlays.forEach((read) => {
      expect(read.kind).toBe('get')
      expect(read.limit).toBe(ORG_OVERLAYS_PER_SITE + 1)
    })
    const siteDocuments = mockOneShots.filter((read) =>
      /^hosts\/[^/]+$/.test(read.path),
    )
    expect(siteDocuments).toHaveLength(ORG_SITES_PER_PAGE)
    expect(mockOneShots).toHaveLength(2 * ORG_SITES_PER_PAGE)
    expect(mockOneShots.some((read) => read.path.includes('/analytics'))).toBe(
      false,
    )
    expect(
      mockOneShots.some((read) =>
        read.path.startsWith(`hosts/site${ORG_SITES_PER_PAGE + 1}`),
      ),
    ).toBe(false)
  })

  it('reads one page of sites’ tests, and no results until somebody asks', async () => {
    await renderOrgConsole('experiments', [], sitesOf(ORG_SITES_PER_PAGE + 5))
    expect(mockListens).toHaveLength(0)
    expect(mockOneShots).toHaveLength(ORG_SITES_PER_PAGE)
    mockOneShots.forEach((read) => {
      expect(read.kind).toBe('get')
      expect(read.path).toMatch(/^hosts\/site\d+\/experiments$/)
      expect(read.limit).toBe(ORG_EXPERIMENTS_PER_SITE + 1)
    })
    // A test's per-variant counters are read behind its Results button.
    expect(mockOneShots.some((read) => read.path.endsWith('/stats'))).toBe(false)
  })

  it('carries no emails section — the messages are the org’s Emails page', () => {
    expect(MARKETING_ORG_CONSOLE_SECTIONS.map((item) => item.id)).not.toContain(
      'emails',
    )
  })
})
