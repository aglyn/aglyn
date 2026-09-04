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
 * What one INBOX console load actually READS (AGL-2501).
 *
 * This is the surface where routing the sections is a read saving rather than
 * only an addressing one, and this file is what says so. The page carried
 * `HubTabs lazy`, which defers a panel until it is first opened and then keeps
 * it mounted — so a reader who glanced at Members & leads and went back to
 * Submissions held BOTH sections' listeners open for the rest of the visit.
 * With one section per URL, the closed sections do not exist to subscribe.
 *
 * It is answered in listens and documents rather than in rendered output: a
 * spec that asserts on what is on screen passes identically whether the other
 * sections are mounted or not, which is the entire cost in question. Every
 * query is recorded with the `limit()` it carries, because that limit IS the
 * billable ceiling — Firestore charges per document returned, and a card that
 * listens with `limit(201)` to render ten rows is buying two hundred and one.
 */

import { render } from '@testing-library/react'
import { FORMS_MAX_PER_HOST } from '@aglyn/aglyn'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import type { ReactNode } from 'react'
import { INBOX_CONSOLE_SECTIONS } from './inbox-console-sections'

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
 * inverts the measurement.
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
      ..._rest: unknown[]
    ) => {
      mockListens.push({
        path: ref?.__path ?? '(unknown)',
        // A single-document listen reads exactly one document.
        limit: ref?.__doc ? 1 : (ref?.__limit ?? 0),
      })
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
const mockHostRoute = {
  orgSlug: 'acme',
  subdomain: 'site',
  base: '/acme/hosts/site',
}
const mockPlan = { org: { plan: 'business', features: {} }, ready: true }
const mockResourceApi = { data: undefined, loading: false }
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
    useConsoleHostRoute: () => mockHostRoute,
    useOrgPlan: () => mockPlan,
    useHostResourceApi: () => mockResourceApi,
    useFirebaseServices: () => mockServices,
  }
})

/*
 * The services module, mocked at its OWN path rather than through the barrel.
 *
 * Overriding `useFirestore` on the barrel only rebinds what the CARDS import.
 * Hooks inside the library call it through the module-internal binding, which
 * a barrel mock cannot reach.
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

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: () => undefined,
    closeSnackbar: () => undefined,
  }),
}))

/** The section the URL names, moved between renders to stand for a link. */
let mockSection = ''

const BASE_PATH = '/acme/hosts/site/inbox'

jest.mock('next/navigation', () => ({
  usePathname: () => (mockSection ? `${BASE_PATH}/${mockSection}` : BASE_PATH),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

/**
 * The four counter documents the page reads WHATEVER section is open.
 *
 * They are the ceiling notices, which sit above the rail on purpose: a site
 * whose forms have stopped accepting submissions has to say so to a reader who
 * followed a link into any section, not only to one who happened to land on
 * Submissions. Four single-document listens, named here so the per-section
 * assertions below can be about the section.
 */
const NOTICE_LISTENS = [
  'hosts/site1/counters/formSubmissionsRefused#1',
  'hosts/site1/counters/formSubmissionsSpam#1',
  'hosts/site1/counters/leadsRefused#1',
  'hosts/site1/counters/siteMembersRefused#1',
]

/** Documents the recorded listens would return at their limits. */
function documentCeiling(listens: Array<{ path: string; limit: number }>) {
  return listens.reduce(
    (total, listen) => total + (listen.limit || UNBOUNDED_ESTIMATE),
    0,
  )
}

function summarize(
  label: string,
  listens: Array<{ path: string; limit: number }>,
) {
  const bounded = listens.filter((l) => l.limit > 0)
  console.log(
    `\n[${label}] listens=${listens.length} ` +
      `(bounded=${bounded.length}, unbounded=${listens.length - bounded.length}) ` +
      `documents<=${documentCeiling(listens)}\n` +
      listens
        .map(
          (l) =>
            `    ${String(l.limit || `~${UNBOUNDED_ESTIMATE}`).padStart(4)}  ${l.path}`,
        )
        .join('\n'),
  )
}

/** Collections only ONE section's cards read, keyed by that section. */
const SECTION_COLLECTIONS = {
  submissions: ['formSubmissions', 'forms'],
  contacts: ['siteMembers', 'leads'],
  campaigns: ['campaigns'],
} as const

function listenedCollections(): Set<string> {
  return new Set(mockListens.map((listen) => listen.path.split('/').pop() ?? ''))
}

function listenKeys(): string[] {
  return mockListens.map((listen) => `${listen.path}#${listen.limit}`).sort()
}

/**
 * The section list the SHELL would hand the page, resolved from the registry's
 * own declaration rather than retyped here — a second copy would let this spec
 * go on passing after a section was renamed out from under it.
 */
function shellSections() {
  return INBOX_CONSOLE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    href: `${BASE_PATH}/${section.id}`,
    visible: true,
  }))
}

async function renderConsole(section: string) {
  mockSection = section
  mockListens.length = 0
  const { InboxConsolePage } = await import('./inbox-console-page')
  return render(
    <InboxConsolePage
      hostId="site1"
      entitled
      org={{ plan: 'business' } as never}
      permissions={{} as never}
      basePath={BASE_PATH}
      sections={shellSections()}
      section={section || undefined}
      segments={section ? [section] : []}
    /> as ReactNode as never,
  )
}

describe('inbox console read cost (AGL-2501)', () => {
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
    await renderConsole('submissions')
    summarize('submissions section', mockListens)
    expect(mockListens.length).toBeGreaterThan(0)
    expect(listenedCollections()).toContain('formSubmissions')
  })

  /*
   * The surface's own URL, which names no section (AGL-2501).
   *
   * The page renders nothing and reads nothing beyond the four ceiling
   * counters. The REDIRECT itself is the shell's — it lives above the `lazy()`
   * boundary so a bare hub URL never downloads this chunk at all.
   */
  it('the sectionless URL reads only the ceiling counters', async () => {
    await renderConsole('')
    summarize('no section', mockListens)
    expect(listenKeys()).toEqual(NOTICE_LISTENS)
  })

  /*
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * Under `HubTabs`, all three panels were constructed and — once visited —
   * kept mounted, so opening one section subscribed the others' listeners too.
   * Every row of this matrix is a section that was being paid for by a reader
   * looking at a different one.
   */
  it.each([
    ['submissions', ['siteMembers', 'leads', 'campaigns']],
    ['contacts', ['formSubmissions', 'forms', 'campaigns']],
    ['campaigns', ['formSubmissions', 'forms', 'siteMembers', 'leads']],
  ])('the %s section issues no query for the others', async (open, closed) => {
    await renderConsole(open)
    summarize(`${open} section`, mockListens)
    const seen = listenedCollections()
    for (const collection of SECTION_COLLECTIONS[
      open as keyof typeof SECTION_COLLECTIONS
    ]) {
      expect({ open, collection, listened: seen.has(collection) }).toEqual({
        open,
        collection,
        listened: true,
      })
    }
    for (const collection of closed) {
      expect({ open, collection, listened: seen.has(collection) }).toEqual({
        open,
        collection,
        listened: false,
      })
    }
  })

  /*
   * ## What a section costs
   *
   * The two assertions below pin the WHOLE listen set, path and ceiling
   * together, rather than checking that some collection is absent. The
   * ceilings are part of the value because a listen widened from 201 to 501 is
   * invisible to a check that only knows the path.
   */
  it('the submissions section buys one page, plus the form filter’s window', async () => {
    await renderConsole('submissions')
    summarize('submissions section', mockListens)
    expect(listenKeys()).toEqual(
      [
        ...NOTICE_LISTENS,
        // One page plus the probe row that makes "there are more" a fact.
        `hosts/site1/formSubmissions#${TABLE_PAGE_SIZE_DEFAULT + 1}`,
        // The filter's window, likewise probed one past its ceiling so it can
        // say it ran short instead of quietly listing the first N.
        `hosts/site1/forms#${FORMS_MAX_PER_HOST + 1}`,
      ].sort(),
    )
  })

  it('the contacts section buys two whole windows, and nothing else', async () => {
    await renderConsole('contacts')
    summarize('contacts section', mockListens)
    // Ceilinged rather than paged, because the dedupe between the two lists is
    // only correct while both windows are whole — see the card.
    expect(listenKeys()).toEqual(
      [
        ...NOTICE_LISTENS,
        'hosts/site1/leads#201',
        'hosts/site1/siteMembers#201',
      ].sort(),
    )
  })

  /*
   * ORDERS ARE NOT AN INBOX SECTION, and this is the assertion that keeps it
   * that way. A sale is not something that arrived in an inbox; commerce owns
   * the surface that lists them, and a section here would give one record two
   * addresses. The rail is checked as well as the meter, because a section
   * whose card happened to read nothing would pass a listen-only check.
   */
  it('declares no orders section, and reads no orders', async () => {
    expect(INBOX_CONSOLE_SECTIONS.map((section) => section.id)).toEqual([
      'submissions',
      'contacts',
      'campaigns',
    ])
    for (const section of ['submissions', 'contacts', 'campaigns']) {
      await renderConsole(section)
      expect(listenedCollections()).not.toContain('orders')
    }
  })
})
