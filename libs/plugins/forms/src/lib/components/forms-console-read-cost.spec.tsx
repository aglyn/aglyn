/**
 * @jest-environment jsdom
 */

/**
 * WHAT ONE FORMS CONSOLE LOAD ACTUALLY READS.
 *
 * The surface is a LIST and a DETAIL behind one nav item, and which of the two
 * mounts is decided by a URL segment rather than by a tab flag. That decision
 * is the whole reason this meter exists: a page that built both branches and
 * hid one would open the catalog's paged query AND one form's version history
 * on every load, and nothing on screen would say so. Rendered output is
 * identical either way, which is precisely why this is measured in listens.
 *
 * Every query is recorded with the `limit()` it carries, because that limit IS
 * the billable ceiling — Firestore charges per document returned, and a card
 * that listens with `limit(100)` to draw ten rows is buying a hundred.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * Every query opened during a render, as `path` + the `limit()` on it.
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
    updateDoc: async () => undefined,
    onSnapshot: (ref: { __path?: string; __limit?: number; __doc?: boolean }) => {
      mockListens.push({
        path: ref?.__path ?? '(unknown)',
        // A single-document listen reads exactly one document.
        limit: ref?.__doc ? 1 : (ref?.__limit ?? 0),
      })
      return () => undefined
    },
    getDocs: async () => ({ docs: [], empty: true, size: 0 }),
    /*
     * The catalog's head-count. Recorded like a listen because it is a read
     * that gets billed: two aggregates, one document each.
     */
    getCountFromServer: async (ref: { __path?: string }) => {
      mockListens.push({ path: `${ref?.__path ?? '(unknown)'}#count`, limit: 1 })
      return { data: () => ({ count: 0 }) }
    },
  }
})

const mockFirestore = { __db: true }
const mockUser = { data: { uid: 'u1', getIdToken: async () => 't' } }
const mockServices = {
  app: {},
  firestore: mockFirestore,
  auth: { currentUser: { uid: 'u1' } },
  storage: {},
}
const mockHostRoute = {
  base: '/acme/hosts/site',
  orgSlug: 'acme',
  subdomain: 'site',
}

jest.mock('@aglyn/tenant-feature-instance', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance')
  return {
    ...actual,
    useFirestore: () => mockFirestore,
    useUser: () => mockUser,
    useConsoleHostRoute: () => mockHostRoute,
    useHostResourceApi: () => async () => undefined,
    useHostVersionApi: () => async () => undefined,
    useFirebaseServices: () => mockServices,
  }
})

/*
 * The services module, mocked at its OWN path rather than through the barrel.
 *
 * Overriding `useFirestore` on the barrel only rebinds what the CARDS import.
 * Hooks inside the library call it through the module-internal binding, which
 * a barrel mock cannot reach, so they go on demanding a real
 * `FirebaseServicesProvider`.
 *
 * `useFirestoreCollection`, `useFirestoreDoc`, `usePagedCollection` and
 * `useLiveArtifactCount` are deliberately left REAL: they build their queries
 * against the mocked `firebase/firestore` above, which is what puts those
 * reads on the meter.
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

jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
  usePathname: () => BASE_PATH,
}))

const BASE_PATH = '/acme/hosts/site/forms'

function summarize(label: string) {
  const bounded = mockListens.filter((listen) => listen.limit > 0)
  console.log(
    `\n[${label}] listens=${mockListens.length} ` +
      `(bounded=${bounded.length}, unbounded=${mockListens.length - bounded.length}) ` +
      `documents<=${mockListens.reduce(
        (total, listen) => total + (listen.limit || UNBOUNDED_ESTIMATE),
        0,
      )}\n` +
      mockListens
        .map(
          (listen) =>
            `    ${String(listen.limit || `~${UNBOUNDED_ESTIMATE}`).padStart(4)}  ${listen.path}`,
        )
        .join('\n'),
  )
}

const paths = () => mockListens.map((listen) => listen.path)

const documentCeiling = () =>
  mockListens.reduce(
    (total, listen) => total + (listen.limit || UNBOUNDED_ESTIMATE),
    0,
  )

/**
 * The catalog's ceiling, in documents.
 *
 *   11  `forms`         one page of ten, plus the probe that says there
 *                       are more
 *    1  `forms#count`   the total, a server aggregate
 *    1  `forms#count`   the tombstones, subtracted from it
 *
 * A number rather than "no more than before": what is guarded is what
 * Firestore is asked to RETURN, and a list that walks the collection to draw
 * ten rows is buying the collection.
 */
const CATALOG_DOCUMENT_CEILING = 13

/**
 * One form's ceiling, in documents: its own document, and its version
 * history.
 *
 * The 100 is the version listen, which is unordered on purpose — the oldest
 * version documents predate `createdAt`, and `orderBy` DROPS documents missing
 * the ordered field, so ordering here would hide a form's earliest versions
 * rather than sort them. `FORM_VERSIONS` is therefore a flat cap, and it is
 * the largest single read on this surface.
 */
const ONE_FORM_DOCUMENT_CEILING = 101

async function renderConsole(segments: string[]) {
  mockListens.length = 0
  const { FormsConsolePage } = await import('./forms-console-page')
  return render(
    <FormsConsolePage
      hostId="site1"
      entitled
      org={{} as never}
      permissions={{} as never}
      basePath={BASE_PATH}
      segments={segments}
      hostRole={{ canPublish: true, loaded: true }}
    /> as ReactNode as never,
  )
}

describe('forms console read cost', () => {
  afterEach(() => {
    mockListens.length = 0
  })

  /*
   * The CONTROL for every "did not read" assertion below. A meter that
   * recorded nothing would satisfy all of them.
   */
  it('CONTROL: the catalog does listen, and for its own collection', async () => {
    await renderConsole([])
    summarize('catalog')
    expect(mockListens.length).toBeGreaterThan(0)
    expect(paths()).toContain('hosts/site1/forms')
  })

  it('the catalog takes the two aggregates its quota readout is built on', async () => {
    await renderConsole([])
    // Two, not one. A single count over the whole collection would quote a cap
    // usage the resources route does not enforce; the second subtracts the
    // tombstones. Their ABSENCE is the failure this catches — the readout then
    // falls back to the length of one page, which reads as room to spare on a
    // site that is already at the ceiling.
    expect(paths().filter((path) => path.endsWith('#count'))).toEqual([
      'hosts/site1/forms#count',
      'hosts/site1/forms#count',
    ])
  })

  it('the catalog does not open ONE form’s version history', async () => {
    await renderConsole([])
    // The detail branch is not built. If it were, every reader who opened the
    // list would pay for a hundred version documents of a form they have not
    // chosen yet.
    expect(paths().some((path) => path.includes('/versions'))).toBe(false)
  })

  it('the catalog’s paged query is BOUNDED, and the whole load has a ceiling', async () => {
    await renderConsole([])
    const listen = mockListens.find(
      (entry) => entry.path === 'hosts/site1/forms',
    )
    // A list that walks the collection unbounded bills the whole thing on
    // every load; `FORMS_MAX_PER_HOST` is 50, so an unbounded read here is
    // five pages of documents to draw one.
    expect(listen && listen.limit > 0).toBe(true)
    expect(documentCeiling()).toBeLessThanOrEqual(CATALOG_DOCUMENT_CEILING)
  })

  it('one form reads its own document and its versions, and nothing else', async () => {
    await renderConsole(['form-abc'])
    summarize('one form')
    expect(paths()).toContain('hosts/site1/forms/form-abc')
    expect(paths()).toContain('hosts/site1/forms/form-abc/versions')
    expect(documentCeiling()).toBeLessThanOrEqual(ONE_FORM_DOCUMENT_CEILING)
  })

  it('one form does NOT open the catalog’s query or its head-count', async () => {
    await renderConsole(['form-abc'])
    // The reason the detail is a route rather than an expanded row: a reader
    // who came for one form's numbers must not pay for the whole catalog, nor
    // for the two aggregates the quota readout takes.
    expect(paths()).not.toContain('hosts/site1/forms')
    expect(paths().some((path) => path.endsWith('#count'))).toBe(false)
  })

  /*
   * THE SUBMISSIONS TABLE IS AN ASK.
   *
   * `formSubmissions` is the collection that grows without bound and the one
   * the customer is billed on. A table that opened its own paged listener on
   * mount would read a page of it on every visit to this surface — including
   * every visit that came to rename the form, change where it routes, or
   * publish a version, none of which asked to read anybody's messages.
   */
  it('one form does NOT read its submissions until asked', async () => {
    await renderConsole(['form-abc'])
    summarize('one form, unasked')
    expect(
      paths().some((path) => path.includes('formSubmissions')),
    ).toBe(false)
    expect(documentCeiling()).toBeLessThanOrEqual(ONE_FORM_DOCUMENT_CEILING)
  })

  it('THE CONTROL: pressing the ask DOES open the submissions listen', async () => {
    // Otherwise the assertion above is satisfied by a page with no
    // submissions table at all, which is the state this work started from.
    await renderConsole(['form-abc'])
    fireEvent.click(screen.getByRole('button', { name: 'Show submissions' }))
    expect(paths()).toContain('hosts/site1/formSubmissions')
    // And BOUNDED when it does open: the reader is paged, not a walk of the
    // collection sliced small.
    const listen = mockListens.find(
      (entry) => entry.path === 'hosts/site1/formSubmissions',
    )
    expect(listen && listen.limit > 0).toBe(true)
  })

  it('the scoped table does NOT read the site’s form catalog', async () => {
    // The picker is the catalog read's only consumer, and a card narrowed to
    // one form renders no picker. Reading fifty form documents to draw a
    // control that is not on screen is the read this scope removes.
    await renderConsole(['form-abc'])
    fireEvent.click(screen.getByRole('button', { name: 'Show submissions' }))
    expect(paths()).not.toContain('hosts/site1/forms')
  })
})
