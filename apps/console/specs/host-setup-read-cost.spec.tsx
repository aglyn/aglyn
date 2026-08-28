/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 */

/**
 * What one Host Setup load actually READS, per section.
 *
 * Written BEFORE the tabs became routes, which is the only way it can do its
 * job. Setup is the case where a conversion could quietly cost MORE: MUI's
 * `TabPanel` unmounts an inactive panel, so the tabbed page already mounted
 * one section's cards and no others, and all five sections share ONE host-doc
 * subscription held by the page. Routed sections have to preserve both of
 * those, and "preserve" is a claim about numbers.
 *
 * Metered at the Firestore boundary rather than the DOM: a spec asserting on
 * rendered output passes identically whether the other sections' cards are
 * mounted or not, which is the entire cost in question. Every listen is
 * recorded with the `limit()` it carries, because that limit is the billable
 * ceiling.
 */

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * Every query built during a render, as `path` + the `limit()` on it.
 *
 * Module-scoped and `mock`-prefixed so the `jest.mock` factories may close
 * over it — jest's out-of-scope guard admits that one prefix.
 */
const mockListens: Array<{ path: string; limit: number }> = []

/** A query with no `limit()` still reads the whole collection. */
const UNBOUNDED_ESTIMATE = 100

jest.mock('firebase/firestore', () => {
  const marker = (kind: string) => (...args: unknown[]) => ({
    __constraint: kind,
    args,
  })
  return {
    __esModule: true,
    /*
     * `withConverter` returns the same handle. `useHost` attaches a converter
     * to the host doc, so a bare object throws before a single listen is
     * recorded — and a meter that records nothing satisfies every "did not
     * read" assertion in the file.
     */
    collection: (_db: unknown, ...segments: string[]) => {
      const ref: Record<string, unknown> = { __path: segments.join('/') }
      ref.withConverter = () => ref
      return ref
    },
    doc: (_db: unknown, ...segments: string[]) => {
      const ref: Record<string, unknown> = {
        __path: segments.join('/'),
        __doc: true,
      }
      ref.withConverter = () => ref
      return ref
    },
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
    startAfter: marker('startAfter'),
    documentId: () => '__name__',
    onSnapshot: (
      ref: { __path?: string; __limit?: number; __doc?: boolean },
      ..._rest: unknown[]
    ) => {
      mockListens.push({
        path: ref?.__path ?? '(unknown)',
        limit: ref?.__doc ? 1 : (ref?.__limit ?? 0),
      })
      return () => undefined
    },
    getDocs: async () => ({ docs: [], empty: true, size: 0 }),
    getDoc: async () => ({ exists: () => false, data: () => undefined, get: () => undefined }),
    getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
    getAggregateFromServer: async () => ({ data: () => ({}) }),
    addDoc: async () => ({ id: 'x' }),
    setDoc: async () => undefined,
    updateDoc: async () => undefined,
    deleteDoc: async () => undefined,
    deleteField: () => ({ __delete: true }),
    runTransaction: async () => undefined,
    Timestamp: { now: () => ({ toMillis: () => 0, toDate: () => new Date(0) }) },
    serverTimestamp: () => ({ __serverTimestamp: true }),
  }
})

const mockFirestore = { __firestore: true }
const mockServices = {
  app: {},
  firestore: mockFirestore,
  auth: { currentUser: { uid: 'u1' } },
  storage: {},
}
const mockUser = { data: { uid: 'u1', getIdToken: async () => 'tok' }, status: 'success' }

/*
 * The services module, mocked at its OWN path rather than through a barrel.
 * Library-internal callers resolve `useFirestore` through the module binding,
 * which a barrel mock cannot reach.
 */
jest.mock(
  '../../../libs/tenant/feature/instance/src/lib/hooks/firebase/firebase-services',
  () => ({
    __esModule: true,
    useFirestore: () => mockFirestore,
    useFirebaseServices: () => mockServices,
    useUser: () => mockUser,
    useAnalytics: () => undefined,
    useAuth: () => mockServices.auth,
    useDatabase: () => ({}),
    useStorage: () => ({}),
    FirebaseServicesProvider: ({ children }: { children?: ReactNode }) => children,
  }),
)

/** The section the URL names, moved between renders to stand for a link. */
let mockSection = 'details'

jest.mock('next/navigation', () => ({
  usePathname: () => `/acme/hosts/shop/setup/${mockSection}`,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({
    enqueueSnackbar: () => undefined,
    closeSnackbar: () => undefined,
  }),
}))

/*
 * The provider's whole surface, with only the site identity pinned.
 *
 * Spread from the real module rather than listed by hand: this page reaches
 * for a different subset of it every few hundred lines, and a hand-written
 * mock answers `undefined` for whatever was not thought of — which surfaces as
 * "x is not a function" rather than as a wrong measurement, but only after the
 * next hook is added.
 *
 * Every plugin enabled: a disabled one would hide a card and undercount the
 * very section being measured.
 */
jest.mock('../components/host-id-provider', () => ({
  ...jest.requireActual('../components/host-id-provider'),
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
  useHostEnabledPlugins: () => [],
  useHostDisabledPlugins: () => [],
  useIsHostAdmin: () => true,
  useHostReady: () => true,
  useHostError: () => undefined,
}))
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => ({ currentOrg: { $id: 'org-1' }, loading: false }),
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({ currentOrg: { $id: 'org-1' }, loading: false }),
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/host-display-name.component', () => ({
  __esModule: true,
  default: () => null,
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const SETUP = '../app/(app)/[orgSlug]/hosts/[host]/setup/(sections)'
const HostSetupLayout = require(`${SETUP}/layout`).default
/**
 * The five section pages, each mounted INSIDE the layout — which is how Next
 * mounts them, and the whole reason the measurement is meaningful: only the
 * section being read exists in the tree.
 */
const SECTION_PAGES: Record<string, () => JSX.Element> = {
  details: require(`${SETUP}/details/page`).default,
  seo: require(`${SETUP}/seo/page`).default,
  tracking: require(`${SETUP}/tracking/page`).default,
  theme: require(`${SETUP}/theme/page`).default,
  emails: require(`${SETUP}/emails/page`).default,
}
/* eslint-enable @typescript-eslint/no-var-requires */

function documentCeiling(listens: Array<{ path: string; limit: number }>) {
  return listens.reduce(
    (total, listen) => total + (listen.limit || UNBOUNDED_ESTIMATE),
    0,
  )
}

function summarize(label: string, listens: Array<{ path: string; limit: number }>) {
  console.log(
    `\n[${label}] listens=${listens.length} ` +
      `documents<=${documentCeiling(listens)}\n` +
      listens
        .map((l) => `    ${String(l.limit || `~${UNBOUNDED_ESTIMATE}`).padStart(4)}  ${l.path}`)
        .join('\n'),
  )
}

function listenedPaths(): string[] {
  return mockListens.map((listen) => listen.path)
}

function renderSetup(section: string) {
  mockSection = section
  mockListens.length = 0
  const SectionPage = SECTION_PAGES[section]
  return render(
    <HostSetupLayout>
      <SectionPage />
    </HostSetupLayout>,
  )
}

/** Collections only ONE section's cards read, keyed by that section. */
const SECTION_ONLY = {
  details: 'hosts/host-1/screens',
  emails: 'hosts/host-1/emailTemplates',
} as const

describe('host Setup read cost, per section (AGL-2501)', () => {
  afterEach(() => {
    mockSection = 'details'
    mockListens.length = 0
  })

  /**
   * The CONTROL for every "did not read" assertion below.
   *
   * They are all of the form "collection X was NOT listened to", and a meter
   * that recorded nothing would satisfy every one of them. This is the reading
   * that proves the meter is live: the page subscribes the host document every
   * section is seeded from, and the open section subscribes its OWN collection.
   */
  it('CONTROL: the open section listens, and for its own collection', () => {
    renderSetup('details')
    summarize('details', mockListens)
    expect(mockListens.length).toBeGreaterThan(0)
    expect(listenedPaths()).toContain('hosts/host-1')
    expect(listenedPaths()).toContain(SECTION_ONLY.details)
  })

  /*
   * The two collection reads on this page, each confined to the one section
   * that shows it. `screens` is a `limit(200)`; `emailTemplates` is unbounded.
   * Everything else here is a single-document read.
   */
  it('a section does not pay for another section collection', () => {
    for (const tab of ['seo', 'tracking', 'theme', 'emails'] as const) {
      renderSetup(tab)
      summarize(tab, mockListens)
      expect(listenedPaths()).not.toContain(SECTION_ONLY.details)
    }

    for (const tab of ['details', 'seo', 'tracking', 'theme'] as const) {
      renderSetup(tab)
      expect(listenedPaths()).not.toContain(SECTION_ONLY.emails)
    }
  })

  it('the emails section is the only reader of the template list', () => {
    renderSetup('emails')
    summarize('emails', mockListens)
    expect(listenedPaths()).toContain(SECTION_ONLY.emails)
  })

  /**
   * The ceiling one load may reach, as a number rather than a description.
   *
   * A budget, not a snapshot: a card added to a section nobody opened shows up
   * as a failure rather than as a slightly larger Firestore bill. Details is
   * the worst section because of its `limit(200)` over `screens`.
   *
   * The `emailTemplates` listen is unbounded and so is counted at the estimate
   * — worth knowing, but measured separately it is a pointer document per
   * CUSTOMIZED template, about 142 bytes each, and the busiest site has one.
   * It is a classification to write down, not an egress problem to chase.
   */
  it('holds each section under its document budget', () => {
    renderSetup('details')
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(260)
    renderSetup('theme')
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(20)
  })
})
