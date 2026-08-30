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

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MARKETING_CONSOLE_SECTIONS } from './marketing-console-sections'

/**
 * Every query built during a render, as `path` + the `limit()` on it.
 *
 * Module-scoped and `mock`-prefixed so the `jest.mock` factories below may
 * close over it — jest's out-of-scope-variable guard admits that one prefix.
 */
const mockListens: Array<{ path: string; limit: number }> = []

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
    query: (base: { __path?: string }, ...constraints: unknown[]) => {
      const limits = constraints
        .filter(
          (c): c is { __constraint: string; args: number[] } =>
            !!c && (c as { __constraint?: string }).__constraint === 'limit',
        )
        .map((c) => c.args[0])
        .filter((n) => typeof n === 'number')
      return {
        __path: base?.__path ?? '(unknown)',
        __limit: limits.length ? Math.max(...limits) : 0,
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
    getDocs: async () => ({ docs: [], empty: true, size: 0 }),
    getDocsFromServer: async () => ({ docs: [], empty: true, size: 0 }),
    getDoc: async () => ({ exists: () => false, data: () => undefined }),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    getAggregateFromServer: async () => ({ data: () => ({}) }),
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
  })

  /*
   * The CONTROL for every assertion below.
   *
   * The cost assertions are all of the form "collection X was NOT listened
   * to", and a meter that records nothing satisfies every one of them. This is
   * the reading that proves the meter is live: the section the URL names does
   * listen, and it listens for its OWN collection.
   */
  it('CONTROL: the open section does listen, and for its own collection', async () => {
    await renderConsole('overview')
    summarize('overview section', mockListens)
    expect(mockListens.length).toBeGreaterThan(0)
    expect(listenedCollections()).toContain('overlays')
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
  it('the campaign report reads four documents, and no collection', async () => {
    await renderConsole('campaigns', ['camp_1'])
    summarize('campaign report', mockListens)

    /*
     * FOUR, and the first of them is what keeps this URL working at all.
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
     */
    expect(mockListens.every((listen) => listen.limit === 1)).toBe(true)
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(4)
    expect(mockListens.map((listen) => listen.path)).toEqual([
      'hosts/site1/emailCampaigns/camp_1',
      'hosts/site1/campaigns/camp_1',
      'hosts/site1/campaigns/camp_1/reports/links',
      'hosts/site1/campaigns/camp_1/reports/revenue',
    ])
  })

  it('the report does not mount the composer or the history', async () => {
    await renderConsole('campaigns', ['camp_1'])

    // The campaigns SECTION reads a 30-send ceiling plus the campaign
    // containers, the org's lists, screens and experiments. A reader who came
    // for one campaign's numbers must not pay for any of it — and
    // `emailDeliveries` must never appear at all, at any limit.
    const paths = mockListens.map((listen) => listen.path)
    expect(paths).not.toContain('hosts/site1/campaigns')
    expect(paths).not.toContain('hosts/site1/emailCampaigns')
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
