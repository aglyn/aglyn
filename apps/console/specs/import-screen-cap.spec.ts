/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * AGL-1398: `/api/hosts/import` is a second screen-create path, and it must
 * obey `screensPerHost` like the first one.
 *
 * Not a laundering loop (AGL-1390) and not a mis-count (AGL-1383/1387) — a
 * plain bypass. `importVersioned('screens')` wrote the bundle's screen
 * documents and `checkQuota` was never imported into the file. The arithmetic
 * was not theoretical either: `EXPORT_COLLECTION_LIMITS.screens` is 200 and
 * `PLAN_ENTITLEMENTS.pro.screensPerHost` is 100, so the bundle cap is twice the
 * cap of the cheapest plan that can use the feature.
 *
 * Both numbers are the REAL ones here rather than fixtures, because the shape
 * of this bug is that the two constants disagree.
 *
 * ## Why the assertions are about the STORE
 *
 * A bulk create has a failure mode a single create does not: refusing halfway
 * through. This suite therefore asserts on the writes the route left behind —
 * that a refused import wrote NOTHING, and that an accepted one restored
 * EVERYTHING — rather than on the status code alone. A route that refused the
 * 101st screen after writing 100 would pass a status-only test and leave a
 * customer with a half-restored site.
 *
 * ## Why "raise" and not "over"
 *
 * The rule is AGL-1390's, unchanged: refuse the write that RAISES the count
 * past the cap, never the state of being over it. A site can be over
 * legitimately — a downgrade, an earlier import — and a backup is the one file
 * you must never be locked out of on the day you need it. So restoring a site's
 * own backup into itself is allowed at, and above, the cap: the bundle keys by
 * id, so it replaces rather than adds.
 */

const mockVerifyIdToken = jest.fn()
const mockServerTimestamp = Symbol('serverTimestamp')

type Doc = Record<string, unknown>

/** The owning org, swapped per test — the plan IS the variable here. */
let mockOrg: Doc

/**
 * An in-memory Firestore keyed by collection PATH, the shape
 * `site-export-round-trip.spec.ts` uses: a write can then be asserted against
 * the exact path it landed on, and `hosts/host-1/screens` and
 * `orgs/org-1/datasets` are different collections here for the same reason
 * they are in production.
 */
const store = new Map<string, Map<string, Doc>>()
const writes: Array<{ path: string; data: Doc; merge: boolean }> = []

const seed = (collectionPath: string, id: string, data: Doc) => {
  if (!store.has(collectionPath)) store.set(collectionPath, new Map())
  store.get(collectionPath).set(id, data)
}

const snapshotOf = (path: string, id: string, data: Doc | undefined) => ({
  id,
  exists: data !== undefined,
  ref: docRef(path, id),
  data: () => data,
  get: (field: string) => (data ?? {})[field],
})

function collectionRef(path: string): any {
  const ref: any = {
    path,
    limit: () => ref,
    where: () => ref,
    select: () => ref,
    get: async () => ({
      docs: [...(store.get(path) ?? new Map()).entries()].map(([id, data]) =>
        snapshotOf(path, id, data),
      ),
    }),
    doc: (id: string) => docRef(path, id),
    add: async () => undefined,
  }
  return ref
}

function docRef(collectionPath: string, id: string): any {
  return {
    id,
    path: `${collectionPath}/${id}`,
    get: async () =>
      snapshotOf(
        collectionPath,
        id,
        (store.get(collectionPath) ?? new Map()).get(id),
      ),
    collection: (name: string) => collectionRef(`${collectionPath}/${id}/${name}`),
  }
}

const mockFirestore = {
  collection: (name: string) => collectionRef(name),
  batch: () => ({
    set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
      writes.push({ path: ref.path, data, merge: Boolean(options?.merge) })
    },
    commit: async () => undefined,
  }),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockFirestore,
    }),
    firestore: { FieldValue: { serverTimestamp: () => mockServerTimestamp } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockOrg }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan limits, the REAL page-claim rule, the REAL collection-kind
  // reader. A suite that stubbed the entitlements would pass against a route
  // enforcing nothing, which is the failure mode this issue IS.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/dataset-models'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/scope-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/name-search'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/binding-tokens'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { POST as IMPORT_POST } from '../app/api/hosts/import/route'
import {
  EXPORT_COLLECTION_LIMITS,
  SITE_EXPORT_FORMAT,
  SITE_EXPORT_VERSION,
} from '../app/api/_lib/site-export'
import {
  NON_PAGE_SCREEN_MAX_PER_HOST,
  PLAN_ENTITLEMENTS,
} from '@aglyn/aglyn/server'

/** The two constants whose disagreement is this bug. */
const BUNDLE_SCREEN_LIMIT = EXPORT_COLLECTION_LIMITS.screens
const PRO_SCREEN_CAP = PLAN_ENTITLEMENTS.pro.screensPerHost

const ids = (count: number, prefix: string) =>
  Array.from({ length: count }, (_unused, index) => `${prefix}-${index + 1}`)

/** A live, published screen document as the host already holds it. */
const liveScreen = (id: string): Doc => ({
  displayName: `Page ${id}`,
  kind: 'page',
  slug: `/${id}`,
})

/** The same screen as a bundle item. */
const screenItem = (id: string, extra: Doc = {}) => ({
  $id: id,
  displayName: `Page ${id}`,
  kind: 'page',
  slug: `/${id}`,
  ...extra,
})

interface SeedOptions {
  /** Screen ids the host already holds, all published. */
  screens?: string[]
  /** A subset of `screens` carrying a soft-delete tombstone. */
  softDeleted?: string[]
  /**
   * Non-page documents the host already holds — email documents and entry
   * templates. Seeded UNROUTED, which is what they are on a live site: an email
   * has no URL, and a routed one would count against the plan instead
   * (AGL-1383).
   */
  nonPage?: Array<{ id: string; kind: string }>
  collections?: Record<string, Doc>
}

const seedHost = (options: SeedOptions = {}) => {
  store.clear()
  writes.length = 0
  const existing = options.screens ?? []
  // Deleting a screen stamps `deletedAt` AND calls `unpublishScreenRoute`, so a
  // soft-deleted screen is unrouted — modelled here because a ROUTED screen
  // counts whatever its document claims (AGL-1383), and a tombstone left in the
  // map would make the seed billable for a reason the test is not about.
  const routed = existing.filter((id) => !options.softDeleted?.includes(id))
  seed('hosts', 'host-1', {
    memberRoles: { 'user-1': 'admin' },
    orgId: 'org-1',
    displayName: 'Acme',
    screens: Object.fromEntries(routed.map((id) => [id, `/${id}`])),
  })
  for (const id of existing) {
    seed('hosts/host-1/screens', id, {
      ...liveScreen(id),
      ...(options.softDeleted?.includes(id)
        ? { deletedAt: { _seconds: 1, _nanoseconds: 0 } }
        : {}),
    })
  }
  for (const screen of options.nonPage ?? []) {
    seed('hosts/host-1/screens', screen.id, {
      displayName: screen.id,
      kind: screen.kind,
    })
  }
  for (const [id, data] of Object.entries(options.collections ?? {})) {
    seed('hosts/host-1/collections', id, data)
  }
}

interface BundleOptions {
  screens?: string[]
  /** Bundle items verbatim, when the ids alone are not the point. */
  screenItems?: Array<Doc & { $id: string }>
  collections?: Array<Doc & { $id: string }>
  /** Routing map the bundle's host settings carry; defaults to its screens. */
  routed?: string[]
}

const bundleOf = (options: BundleOptions = {}) => {
  const items =
    options.screenItems ?? (options.screens ?? []).map((id) => screenItem(id))
  const routed = options.routed ?? items.map((item) => String(item.$id))
  return {
    format: SITE_EXPORT_FORMAT,
    version: SITE_EXPORT_VERSION,
    host: {
      displayName: 'Acme',
      screens: Object.fromEntries(routed.map((id) => [id, `/${id}`])),
    },
    screens: items,
    collections: options.collections ?? [],
  }
}

const runImport = async (bundle: unknown) => {
  writes.length = 0
  const response = await IMPORT_POST(
    new Request('https://app.aglyn.com/api/hosts/import', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', bundle }),
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** Screen documents the run actually stored, by id. */
const storedScreenIds = () =>
  writes
    .filter((entry) => entry.path.startsWith('hosts/host-1/screens/'))
    .map((entry) => entry.path.split('/').pop())

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  mockOrg = { plan: 'pro' }
  seedHost()
})

describe('the bundle cap is twice the plan cap (AGL-1398)', () => {
  it('is the premise: 200 screens may be exported, 100 may exist on Pro', () => {
    // Guard the premise. If either constant moves the arithmetic below stops
    // describing anything, and the suite would go green for the wrong reason.
    expect(BUNDLE_SCREEN_LIMIT).toBe(200)
    expect(PRO_SCREEN_CAP).toBe(100)
  })

  it('refuses a full bundle onto a Pro site, and writes NOTHING', async () => {
    seedHost({ screens: ids(8, 'have') })
    const response = await runImport(
      bundleOf({ screens: ids(BUNDLE_SCREEN_LIMIT, 'bundle') }),
    )

    expect(response.status).toBe(403)
    // Concrete, the way AGL-1390's refusal is: what the bundle holds, what the
    // site holds, and the cap. A bulk refusal that says only "too many screens"
    // leaves the owner of a 200-page backup nothing to act on.
    expect(response.body.error).toContain('200 screens')
    expect(response.body.error).toContain('8')
    expect(response.body.error).toContain(`208 of ${PRO_SCREEN_CAP}`)

    // The whole decision, and the reason it is taken before the first write:
    // an import that stops at the 101st screen leaves a site whose restored
    // routing map points at 200 screens, 100 of which do not exist.
    expect(writes).toEqual([])
  })

  it('restores an ordinary under-cap bundle completely', async () => {
    // The positive control. A refusal that also refused this would have closed
    // the bug by breaking the feature.
    seedHost({ screens: ids(5, 'have') })
    const wanted = ids(12, 'bundle')
    const response = await runImport(bundleOf({ screens: wanted }))

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toEqual(wanted)
    // Host settings travel too — a "restore" that stored only screens is not
    // one, and the routing map is what makes them reachable.
    expect(writes.some((entry) => entry.path === 'hosts/host-1')).toBe(true)
    // The host patch is batched but not tallied, so the reported count is the
    // subcollection writes: one per screen, none of them carrying a version.
    expect(response.body.written).toBe(wanted.length)
  })
})

describe('a backup is not a thing to be locked out of', () => {
  it('restores a site into itself at exactly the cap', async () => {
    // The case the naive check gets wrong: `existing + bundle > limit` refuses
    // every restore of a site that is anywhere near full, which is every
    // restore that matters. The bundle keys by id, so it REPLACES.
    const all = ids(PRO_SCREEN_CAP, 'page')
    seedHost({ screens: all })
    const response = await runImport(bundleOf({ screens: all }))

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toEqual(all)
  })

  it('restores a site that is already over its cap', async () => {
    // Over by legitimate means — a downgrade, or an import that predates this.
    // AGL-1390's rule unchanged: what is refused is the RAISE, never the state.
    const all = ids(PRO_SCREEN_CAP + 20, 'page')
    seedHost({ screens: all })
    const response = await runImport(bundleOf({ screens: all }))

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toHaveLength(all.length)
  })

  it('still refuses the one screen that raises an over-cap site', async () => {
    const all = ids(PRO_SCREEN_CAP + 20, 'page')
    seedHost({ screens: all })
    const response = await runImport(bundleOf({ screens: [...all, 'one-more'] }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`121 of ${PRO_SCREEN_CAP}`)
    expect(writes).toEqual([])
  })

  it('takes one bundle two ways: restore into its own site, refuse the copy', async () => {
    /**
     * The split the issue calls option 3 — allow the restore into the SOURCE
     * host, refuse the fresh copy into a different one — decided without ever
     * asking the file where it came from.
     *
     * The bundle does carry a `sourceHostId`, and it is exactly the wrong thing
     * to gate on: it is an unsigned string in a file the metered party uploads,
     * so trusting it is "a gated field is an entitlement input" one more time
     * (AGL-1354, AGL-1383). The document IDS answer the same question and
     * cannot be forged in the direction that pays: to take the allow path a
     * bundle's screens must already be on the host, which means they are
     * already bought. Renaming them to ids the target holds OVERWRITES those
     * screens instead of adding any.
     *
     * Same 200-screen backup, same Pro plan, opposite answers.
     */
    const backup = bundleOf({ screens: ids(BUNDLE_SCREEN_LIMIT, 'page') })

    // Into the site it came from — over the cap because the plan shrank
    // underneath it. Allowed: AGL-1390's rollup and usage-alerts cron record
    // an over-cap host, so the overage is reported rather than blocking the
    // one file nobody may be locked out of.
    seedHost({ screens: ids(BUNDLE_SCREEN_LIMIT, 'page') })
    const restored = await runImport(backup)
    expect(restored.status).toBe(200)
    expect(storedScreenIds()).toHaveLength(BUNDLE_SCREEN_LIMIT)

    // The same file into a different, empty Pro site. Nothing is being given
    // back here — a 200-page site is being provisioned onto a 100-page plan.
    seedHost()
    const copied = await runImport(backup)
    expect(copied.status).toBe(403)
    expect(copied.body.error).toContain(`200 of ${PRO_SCREEN_CAP}`)
    expect(writes).toEqual([])
  })

  it('does not let a bundle vouch for its own provenance', async () => {
    // The forgery the id test above rules out, stated directly: claiming to
    // have come from the target host buys nothing, because the screens are
    // still 200 screens the site does not have.
    seedHost()
    const response = await runImport({
      ...bundleOf({ screens: ids(BUNDLE_SCREEN_LIMIT, 'page') }),
      sourceHostId: 'host-1',
    })

    expect(response.status).toBe(403)
    expect(writes).toEqual([])
  })

  it('lets an unlimited plan restore a full bundle', async () => {
    mockOrg = { plan: 'enterprise' }
    const wanted = ids(BUNDLE_SCREEN_LIMIT, 'bundle')
    const response = await runImport(bundleOf({ screens: wanted }))

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toHaveLength(BUNDLE_SCREEN_LIMIT)
  })
})

describe('the count is the one the rest of the cap uses', () => {
  it('excludes a bundle screen that IS an entry template', async () => {
    // Nothing is re-priced here (AGL-1173/1383/1387/1390 each refused to):
    // `billableScreenIds` decides, so a bundle carrying its blog's entry
    // template gets that screen for free exactly as the live site does. A
    // check written as `bundle.screens.length` would refuse this.
    //
    // Since AGL-1400 the bundle says so on the SCREEN. The collection beside it
    // is carried too, exactly as a real export does, and asserts the other half:
    // a pointer excuses nothing now, so the exclusion survives only because the
    // screen itself is a template.
    const wanted = ids(PRO_SCREEN_CAP + 1, 'page')
    const response = await runImport(
      bundleOf({
        screenItems: wanted.map((id) =>
          id === 'page-1' ? screenItem(id, { kind: 'template' }) : screenItem(id),
        ),
        routed: wanted,
        collections: [
          {
            $id: 'blog',
            slug: 'blog',
            kind: 'content',
            displayName: 'Blog',
            entryScreenId: 'page-1',
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toHaveLength(wanted.length)
  })

  // The other side of the same change, and the reason the test above is not
  // just a rename: the pointer no longer buys anything. A bundle whose
  // collection designates an ordinary page screen as its entry template is a
  // bundle of 101 pages, and it is refused.
  it('counts a bundle screen a bundle collection merely points at', async () => {
    const wanted = ids(PRO_SCREEN_CAP + 1, 'page')
    const response = await runImport(
      bundleOf({
        screens: wanted,
        collections: [
          {
            $id: 'blog',
            slug: 'blog',
            kind: 'content',
            displayName: 'Blog',
            entryScreenId: 'page-1',
          },
        ],
      }),
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`101 of ${PRO_SCREEN_CAP}`)
  })

  it('counts a screen the bundle brings back from a soft delete', async () => {
    // `merge: false` and no `deletedAt` on the allow-list: an imported screen
    // REPLACES the tombstoned document, so a restore un-deletes it. The host
    // is at 97 of 100 with three buried and unrouted; the bundle revives all
    // three and adds one, which is 101. A model that carried the tombstone
    // through would make it 98 and let it in.
    const all = ids(PRO_SCREEN_CAP, 'page')
    const buried = ['page-1', 'page-2', 'page-3']
    seedHost({ screens: all, softDeleted: buried })
    const response = await runImport(
      // Nothing routed by the bundle either, so the revival is the ONLY thing
      // that can make these three count — an unpublished live screen counts.
      bundleOf({ screens: [...buried, 'one-more'], routed: [] }),
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`101 of ${PRO_SCREEN_CAP}`)
    expect(writes).toEqual([])
  })

  it('counts a bundle screen the bundle’s own routing map routes, whatever it claims', async () => {
    // AGL-1383's invariant, reaching the import: a ROUTED screen counts
    // whatever its document says about itself. `kind: 'email'` is importable
    // (dropping it would turn every restored email into a billable page), and
    // a bundle is a file someone hands you — so a hand-edited one that marks
    // 200 screens as emails and routes them all would otherwise restore a
    // 200-page site onto a 100-page plan for free.
    const wanted = ids(BUNDLE_SCREEN_LIMIT, 'bundle')
    const response = await runImport(
      bundleOf({
        screenItems: wanted.map((id) => screenItem(id, { kind: 'email' })),
        routed: wanted,
      }),
    )

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(`200 of ${PRO_SCREEN_CAP}`)
    expect(writes).toEqual([])
  })

  it('lets genuine email documents restore free, as they do on the live site', async () => {
    // The other half of the same rule, and the reason it is not simply "count
    // every screen document": emails live on the Emails page, have no route,
    // and have never spent the allowance.
    const wanted = ids(BUNDLE_SCREEN_LIMIT, 'mail')
    const response = await runImport(
      bundleOf({
        screenItems: wanted.map((id) => screenItem(id, { kind: 'email' })),
        routed: [],
      }),
    )

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toHaveLength(BUNDLE_SCREEN_LIMIT)
  })

  it('judges the bundle by what will be written, not by what the file claims', async () => {
    // The route truncates at `EXPORT_COLLECTION_LIMITS.screens`, so a longer
    // file stores 200 documents whatever it says. A check counting the raw
    // array would refuse an import that fits — the same class of drift the
    // export/import media limit had before AGL-1382 gave it one home.
    mockOrg = { plan: 'pro', entitlements: { screensPerHost: 210 } }
    const response = await runImport(
      bundleOf({ screens: ids(BUNDLE_SCREEN_LIMIT + 50, 'bundle') }),
    )

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toHaveLength(BUNDLE_SCREEN_LIMIT)
  })
})

/**
 * AGL-1439: the same bundle field, against the cap that has no price.
 *
 * `kind` is importable on purpose — dropping it would restore a site's emails
 * as live billable pages (AGL-1383). Since AGL-1400 `kind: 'template'` also
 * excludes a screen from `billableScreenIds`, so every assertion in the suite
 * above sees nothing when a hand-edited bundle declares it: the screens are
 * created, and no cap counts them. AGL-1399's flat platform cap is the answer,
 * and this leg is where the import meets it.
 *
 * What is NOT done here is refusing the kind. A site with a blog has entry
 * templates, and a restore that dropped or rejected them is the failure AGL-1382
 * exists to prevent. The count is capped; the kind is not.
 */
describe('the flat cap on documents no plan counts (AGL-1439)', () => {
  /** `n` non-page documents the host already holds. */
  const nonPage = (n: number, kind: string, prefix: string) =>
    Array.from({ length: n }, (_unused, index) => ({
      id: `${prefix}-${index + 1}`,
      kind,
    }))

  /** A bundle of non-page screens, unrouted the way the exporter writes them. */
  const nonPageBundle = (idList: string[], kind: string) =>
    bundleOf({
      screenItems: idList.map((id) => screenItem(id, { kind })),
      routed: [],
    })

  it('is the premise: no single bundle can cross the cap on its own', () => {
    // 200 screens per bundle against 5,000 — so the only way to meet this cap
    // is to already hold a library nobody plausibly authors, which is the
    // property the number was sized for.
    expect(NON_PAGE_SCREEN_MAX_PER_HOST).toBe(5000)
    expect(BUNDLE_SCREEN_LIMIT).toBeLessThan(NON_PAGE_SCREEN_MAX_PER_HOST)
  })

  it('restores a blog’s entry templates rather than refusing the kind', async () => {
    // The thing AGL-1439 says not to do. A bundle whose screens are entry
    // templates is an ordinary backup of a site with a blog.
    seedHost()
    const wanted = ids(BUNDLE_SCREEN_LIMIT, 'tpl')
    const response = await runImport(nonPageBundle(wanted, 'template'))

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toEqual(wanted)
  })

  it('refuses the bundle that would push a host past the cap, and writes NOTHING', async () => {
    seedHost({ nonPage: nonPage(NON_PAGE_SCREEN_MAX_PER_HOST, 'email', 'mail') })
    const response = await runImport(nonPageBundle(ids(50, 'more'), 'email'))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(
      `${NON_PAGE_SCREEN_MAX_PER_HOST + 50} of ${NON_PAGE_SCREEN_MAX_PER_HOST}`,
    )
    expect(writes).toEqual([])
  })

  it('counts BOTH kinds against the one cap', async () => {
    // The reason AGL-1399 and AGL-1439 are one change. Ninety-nine of the
    // host's documents are entry templates; a cap that only looked at
    // `kind: 'email'` would put this bundle at 4,902 and let it through.
    seedHost({
      nonPage: [
        ...nonPage(NON_PAGE_SCREEN_MAX_PER_HOST - 100, 'email', 'mail'),
        ...nonPage(99, 'template', 'tpl'),
      ],
    })
    const response = await runImport(nonPageBundle(ids(2, 'new-tpl'), 'template'))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain(
      `${NON_PAGE_SCREEN_MAX_PER_HOST + 1} of ${NON_PAGE_SCREEN_MAX_PER_HOST}`,
    )
    expect(writes).toEqual([])
  })

  it('restores a site into itself over the cap — the RAISE is what is refused', async () => {
    // AGL-1390's rule, which this leg inherits: a backup is the one file nobody
    // may be locked out of. The bundle keys by id, so restoring these documents
    // replaces them and the count does not move.
    const held = nonPage(NON_PAGE_SCREEN_MAX_PER_HOST + 50, 'email', 'mail')
    seedHost({ nonPage: held })
    const response = await runImport(
      nonPageBundle(held.slice(0, BUNDLE_SCREEN_LIMIT).map((s) => s.id), 'email'),
    )

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toHaveLength(BUNDLE_SCREEN_LIMIT)
  })

  it('applies to an unlimited plan too, because the cap has no plan dimension', async () => {
    // `screensPerHost` is skipped outright for these orgs. This cap is not a
    // plan entitlement — it bounds infrastructure, so Enterprise meets it at
    // exactly the same number.
    mockOrg = { plan: 'enterprise' }
    seedHost({ nonPage: nonPage(NON_PAGE_SCREEN_MAX_PER_HOST, 'email', 'mail') })
    const response = await runImport(nonPageBundle(ids(1, 'more'), 'email'))

    expect(response.status).toBe(403)
    expect(writes).toEqual([])
  })

  it('leaves an ordinary page restore alone on a host already over the cap', async () => {
    // The positive control, and the shape of the failure this cap must not
    // have: being over is never itself a refusal, and a bundle of pages cannot
    // raise the non-page count — an imported page OVERWRITES a template rather
    // than adding one.
    mockOrg = { plan: 'enterprise' }
    seedHost({ nonPage: nonPage(NON_PAGE_SCREEN_MAX_PER_HOST + 10, 'email', 'mail') })
    const wanted = ids(5, 'page')
    const response = await runImport(bundleOf({ screens: wanted }))

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toEqual(wanted)
  })

  it('charges nothing to the plan: a full email library still costs zero screens', async () => {
    // The re-pricing guard. AGL-1173 removed this charge and AGL-1400 kept the
    // exclusion; a host with 5,000 email documents is still using none of its
    // hundred Pro screens, and the bundle's own pages are all it pays for.
    seedHost({ nonPage: nonPage(NON_PAGE_SCREEN_MAX_PER_HOST - 1, 'email', 'mail') })
    const wanted = ids(PRO_SCREEN_CAP, 'page')
    const response = await runImport(bundleOf({ screens: wanted }))

    expect(response.status).toBe(200)
    expect(storedScreenIds()).toEqual(wanted)
  })
})

describe('the gates that were already there still answer first', () => {
  it('refuses a plan without siteExport before it counts anything', async () => {
    mockOrg = { plan: 'starter' }
    const response = await runImport(bundleOf({ screens: ids(3, 'bundle') }))

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('Pro plan')
    expect(writes).toEqual([])
  })

  it('refuses a member who is not a site admin', async () => {
    seedHost({ screens: ids(1, 'have') })
    store.get('hosts').get('host-1').memberRoles = { 'user-1': 'editor' }
    const response = await runImport(bundleOf({ screens: ids(3, 'bundle') }))

    expect(response.status).toBe(403)
    expect(writes).toEqual([])
  })
})
