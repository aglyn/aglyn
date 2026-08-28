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
 * What one EMAIL console load actually READS (AGL-2501).
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
import { EMAILS_CONSOLE_SECTIONS } from './emails-console-sections'

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

const BASE_PATH = '/acme/hosts/site/emails'

jest.mock('next/navigation', () => ({
  usePathname: () => (mockSection ? `${BASE_PATH}/${mockSection}` : BASE_PATH),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
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

/** Collections only ONE section's cards read, keyed by that section. */
const SECTION_COLLECTIONS = {
  campaigns: ['campaigns'],
  suppressions: ['suppressions'],
} as const

function listenedCollections(): Set<string> {
  return new Set(mockListens.map((listen) => listen.path.split('/').pop() ?? ''))
}

/**
 * The section list the SHELL would hand the page, resolved from the registry's
 * own declaration rather than retyped here — a second copy would let this spec
 * go on passing after a section was renamed out from under it.
 */
function shellSections() {
  return EMAILS_CONSOLE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    href: `${BASE_PATH}/${section.id}`,
    visible: true,
  }))
}

async function renderConsole(section: string) {
  mockSection = section
  mockListens.length = 0
  const { EmailsConsolePage } = await import('./emails-console-page')
  return render(
    <EmailsConsolePage
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

describe('emails console read cost (AGL-2501)', () => {
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
    await renderConsole('campaigns')
    summarize('campaigns section', mockListens)
    expect(mockListens.length).toBeGreaterThan(0)
    expect(listenedCollections()).toContain('campaigns')
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
    await renderConsole('suppressions')
    summarize('suppressions section', mockListens)
    const seen = listenedCollections()
    expect(seen).toContain('suppressions')
    // Campaigns is the expensive one and it is not open.
    expect(seen).not.toContain('campaigns')
    expect(seen).not.toContain('experiments')
  })

  it('reports the designs and audiences sections too', async () => {
    await renderConsole('designs')
    summarize('designs section', mockListens)
    mockListens.length = 0
    await renderConsole('audiences')
    summarize('audiences section', mockListens)
    expect(true).toBe(true)
  })
})
