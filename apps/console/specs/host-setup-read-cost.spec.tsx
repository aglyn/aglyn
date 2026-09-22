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
 * What one host settings load actually READS, per section — both hubs.
 *
 * Setup and Admin mount the SAME scope: one host-document subscription, the
 * guarded saves and the drafts. Two hubs mounting one provider is the point at
 * which "shared" could quietly mean "twice", so the Admin sections are metered
 * here beside the Setup ones rather than trusted to have inherited the number.
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
      ...rest: unknown[]
    ) => {
      mockListens.push({
        path: ref?.__path ?? '(unknown)',
        limit: ref?.__doc ? 1 : (ref?.__limit ?? 0),
      })
      /*
       * A DOCUMENT listener emits once, with an empty document that exists.
       *
       * A listener that never called back left every consumer of this page on
       * "I have never had data", and a section that draws nothing costs
       * nothing — so the meter read a page in a state no reader is ever in,
       * and the sections whose cards wait for their document were measured
       * empty. The `hostFirstRun` zone is the case that made it matter: it
       * waits for the host document before deciding whether the site is
       * blank (AGL-2918), so without an emission it never mounted and the
       * five listens it accounts for below stopped being metered at all —
       * green, and blind to the zone it was extended to watch.
       *
       * Empty rather than furnished on purpose: `{}` is the cheapest document
       * that can exist, so anything a section reads off it is absent and the
       * number stays a floor. Collections still never emit — a listener's
       * COST is its `limit()`, which is charged when it opens, and feeding
       * rows in would only invite assertions about rendered output on a spec
       * that deliberately measures at the Firestore boundary.
       */
      const onNext = rest.find(
        (arg): arg is (snapshot: unknown) => void => typeof arg === 'function',
      )
      if (ref?.__doc && onNext) {
        onNext({
          id: (ref.__path ?? '').split('/').pop(),
          exists: () => true,
          data: () => ({}),
          get: () => undefined,
          metadata: { fromCache: false, hasPendingWrites: false },
        })
      }
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
/** Which settings hub that section belongs to. */
let mockHub = 'setup'

jest.mock('next/navigation', () => ({
  usePathname: () => `/acme/hosts/shop/${mockHub}/${mockSection}`,
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
/**
 * The Admin sections the settings scope reaches — the hub it was lifted into.
 * `danger` rides along as the section that renders no form at all: the scope is
 * mounted by the LAYOUT, so what it costs has to be the same whether the open
 * section uses it or not.
 *
 * `error-pages` is the one that carries a COLLECTION (AGL-3178). It is metered
 * here for the reason the Setup sections are: the `limit(200)` over `screens`
 * did not disappear when the card moved, it moved with it, and a cost that is
 * only ever measured where it used to be is a cost nobody is watching.
 */
const ADMIN = '../app/(app)/[orgSlug]/hosts/[host]/admin/(sections)'
const HostAdminLayout = require(`${ADMIN}/layout`).default
const ADMIN_SECTION_PAGES: Record<string, () => JSX.Element> = {
  general: require(`${ADMIN}/general/page`).default,
  backup: require(`${ADMIN}/backup/page`).default,
  danger: require(`${ADMIN}/danger/page`).default,
  'error-pages': require(`${ADMIN}/error-pages/page`).default,
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
  mockHub = 'setup'
  mockListens.length = 0
  const SectionPage = SECTION_PAGES[section]
  return render(
    <HostSetupLayout>
      <SectionPage />
    </HostSetupLayout>,
  )
}

function renderAdmin(section: string) {
  mockSection = section
  mockHub = 'admin'
  mockListens.length = 0
  const SectionPage = ADMIN_SECTION_PAGES[section]
  return render(
    <HostAdminLayout>
      <SectionPage />
    </HostAdminLayout>,
  )
}

/** Collections only ONE section's cards read, keyed by that section. */
const SECTION_ONLY = {
  details: 'hosts/host-1/layouts',
  emails: 'hosts/host-1/emailTemplates',
} as const

/**
 * The `screens` list, which Setup no longer reads anywhere (AGL-3178).
 *
 * It was Details' collection and the reason that section was the most
 * expensive one in the hub. The card that opened it is a site-admin control
 * now, so the read belongs to a page an author never loads.
 */
const MOVED_TO_ADMIN = 'hosts/host-1/screens'

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

  /**
   * The CONTROL for the Details budget specifically: the `hostFirstRun` zone
   * is INSIDE the measurement (AGL-2918).
   *
   * The zone is conditional — only a site with nothing published draws it —
   * so "Details is under budget" can now be satisfied two ways: by the zone
   * costing what it always did, or by the zone not being there at all. The
   * second is how this meter goes quietly blind, and a budget stated with
   * `<=` cannot tell them apart, because the blind reading is the CHEAPER
   * one.
   *
   * `orgs/{orgId}` is where it shows: the page reads it once for the org id
   * it hands down, and the slot's own gates read it five more times. So more
   * than one listen on that document is the zone being mounted, and exactly
   * one is a measurement that has stopped including it.
   */
  it('CONTROL: the first-run zone is part of what Details is measured at', () => {
    renderSetup('details')
    const org = mockListens.filter((listen) => listen.path === 'orgs/org-1')
    expect(org.length).toBeGreaterThan(1)
  })

  /*
   * The two collection reads on this page, each confined to the one section
   * that shows it. `layouts` is a `limit(50)`; `emailTemplates` is unbounded.
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

  /**
   * No Setup section reads the screen list any more (AGL-3178).
   *
   * Stated over every section rather than over Details alone: the card could
   * be re-mounted on any of them, and the reason it is not on this hub at all
   * is a permission one, not a placement preference.
   */
  it('no section pays for the screen list the error pages card opened', () => {
    for (const tab of ['details', 'seo', 'tracking', 'theme', 'emails'] as const) {
      renderSetup(tab)
      expect([tab, listenedPaths()]).toEqual([
        tab,
        expect.not.arrayContaining([MOVED_TO_ADMIN]),
      ])
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
   * the worst section that is not Emails, and it is a quarter of what it was:
   * the `limit(200)` over `screens` left with the error pages card (AGL-3178),
   * leaving the `limit(50)` over `layouts` as its largest read. The budget is
   * re-cut to the new number rather than left at the old one, because a
   * ceiling nothing can reach measures nothing.
   *
   * The `emailTemplates` listen is unbounded and so is counted at the estimate
   * — worth knowing, but measured separately it is a pointer document per
   * CUSTOMIZED template, about 142 bytes each, and the busiest site has one.
   * It is a classification to write down, not an egress problem to chase.
   *
   * Details went 60 -> 65 with the `hostFirstRun` zone (AGL-2918), and the
   * five are stated rather than absorbed: they are five more listens on
   * `orgs/{orgId}`, the document this page already subscribes five times, put
   * there by the slot's own gates — the reader's org, their permissions and
   * the workspace's plugin set — plus the page reading the org id it hands
   * down, exactly as the SEO section reads it for `hostSeo`. No new
   * collection, no new document, and no read that scales with the site. A
   * sixth path appearing here is a real card to argue about.
   *
   * Those five are CONDITIONAL now (AGL-2918): the zone is drawn only for a
   * site with nothing published, so Details measures 65 because the document
   * this meter emits is empty, which is a blank site. That is the expensive
   * case and the right one to budget against — an established site draws no
   * zone and reads 60.
   *
   * Details went 65 -> 66 with the site time zone (AGL-3252). The sixth is a
   * SIXTH SUBSCRIPTION to `orgs/{orgId}`, not a sixth path: the settings
   * scope asks `useCurrentOrg` what zone this site would inherit, so the
   * control's empty option can name it rather than say "default". The
   * document was already being read five times over by the slot's gates, so
   * what this buys is one more listener on a document in hand — the same
   * classification the five above got, and the companion assertion below is
   * what proves no new PATH came with it.
   *
   * Theme measures 10 rather than the 6 it used to, and nothing on that
   * section changed: its editor blanks while the host document has never
   * emitted (AGL-1066), so a meter whose listeners never called back was
   * pricing a section that had drawn nothing. The 6 was an undercount of a
   * state no reader is in. The ceiling stays 20 — it was cut for the real
   * editor and the real editor now renders.
   */
  it('holds each section under its document budget', () => {
    renderSetup('details')
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(66)
    renderSetup('theme')
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(20)
  })

  /**
   * What the budget above stops being able to say once a number moves: WHICH
   * things are read. Details reads the site, the site's layouts and the
   * reader's workspace, and the `hostFirstRun` zone added no fourth
   * (AGL-2918) — so a card that opens a collection of its own fails here
   * whether or not it fits under the ceiling.
   */
  it('reads no collection Details did not already read', () => {
    renderSetup('details')
    expect([...new Set(listenedPaths())].sort()).toEqual([
      'hosts/host-1',
      'hosts/host-1/layouts',
      'orgs/org-1',
    ])
  })
})

describe('host Admin read cost, per section', () => {
  afterEach(() => {
    mockSection = 'details'
    mockHub = 'setup'
    mockListens.length = 0
  })

  /**
   * The CONTROL for the assertions below, which are all "did not read more".
   *
   * A meter that recorded nothing would satisfy every one of them. This is the
   * reading that proves it is live in this hub too: the Admin sections layout
   * mounts the shared scope, so the host document the General form is seeded
   * from is subscribed here exactly as it is under Setup.
   */
  it('CONTROL: the Admin hub subscribes the host document', () => {
    renderAdmin('general')
    summarize('admin/general', mockListens)
    expect(listenedPaths()).toContain('hosts/host-1')
  })

  /**
   * ONE host-document listen from the LAYOUT, whatever section is open.
   *
   * The lift put the same provider in both hubs' sections layouts, and a
   * provider is exactly the kind of thing that comes to be mounted twice — once
   * by the layout and once by a section that wanted the scope. Sections that
   * subscribe nothing of their own read 1, which is the layout's, so a second
   * copy shows up here as a number rather than as a slightly larger bill.
   *
   * `danger` reads 2 and that is not the scope: `DeleteSiteCard` holds its own
   * `useHost`, because what it confirms against is the site's own name. Pinned
   * rather than excluded — a section's own listen is a real cost, and stating
   * it is what makes the 1 above mean "the layout's, and only the layout's".
   */
  it('subscribes the host document once from the layout', () => {
    const counted: Record<string, number> = {}
    for (const section of [
      'general',
      'backup',
      'danger',
      'error-pages',
    ] as const) {
      renderAdmin(section)
      counted[section] = mockListens.filter(
        (listen) => listen.path === 'hosts/host-1',
      ).length
    }
    // `error-pages` reads 2 for the same reason `danger` does: the card holds
    // its own listen, because what it renders is that document's current
    // assignments and its maintenance flag.
    expect(counted).toEqual({
      general: 1,
      backup: 1,
      danger: 2,
      'error-pages': 2,
    })
  })

  /**
   * The forms and cards that moved here read no COLLECTION.
   *
   * Basic details is seeded from the host document the layout already holds,
   * and backup, restore and template publishing all go through API routes. So
   * the sections that gained them cost a document read and nothing else — the
   * budget is what says so as a number.
   */
  it('holds the moved sections to a document read', () => {
    for (const section of ['general', 'backup'] as const) {
      renderAdmin(section)
      summarize(`admin/${section}`, mockListens)
      expect({
        section,
        ceiling: documentCeiling(mockListens) <= 20,
      }).toEqual({ section, ceiling: true })
      // A collection listen is counted at the unbounded estimate, so anything
      // over the per-document cost would already have failed above. This names
      // the property directly rather than leaving it to arithmetic.
      expect(
        mockListens.filter((listen) => listen.path.split('/').length > 2),
      ).toEqual([])
    }
  })

  /**
   * Error pages is the one Admin section that opens a collection (AGL-3178).
   *
   * Its pickers list the site's screens, so the `limit(200)` that used to make
   * Setup → Details the most expensive section in that hub is now charged
   * here. The limit is the point: it is the billable ceiling, and an unbounded
   * version of this read would be the same card at a different price.
   */
  it('charges the screen list to Error pages, still bounded', () => {
    renderAdmin('error-pages')
    summarize('admin/error-pages', mockListens)
    const screens = mockListens.filter(
      (listen) => listen.path === 'hosts/host-1/screens',
    )
    expect(screens).toEqual([{ path: 'hosts/host-1/screens', limit: 200 }])
    expect(documentCeiling(mockListens)).toBeLessThanOrEqual(210)
  })
})
