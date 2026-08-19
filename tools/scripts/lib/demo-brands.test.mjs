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
 */

/**
 * Pins AGL-1734: the demo org is several businesses, not one site cloned.
 *
 *   node --test tools/scripts/lib/demo-brands.test.mjs
 *
 * The founding demo (`Design-Partner-Outreach.md` §4) spends minutes 3–10 —
 * its largest block, and the one the GTM doc calls *"the wedge, proven
 * visually"* — switching between several sites in one org. The seeder used to
 * stamp a single hard-coded bakery, so N hosts produced N identical bakeries
 * and the demo argued the OPPOSITE of the pitch: one site cloned, not a
 * portfolio consolidated.
 *
 * So "the seeder ran" is worth nothing here. The defect was never a crash —
 * the old seeder ran perfectly and produced the wrong demo. What has to be
 * asserted is DISTINCTNESS, and at two different altitudes, because there are
 * two independent ways to regress back to one bakery:
 *
 *   1. **The packs stop being different businesses.** Someone adds a fifth
 *      pack by copying the fourth, or flattens the table back toward one
 *      shape. Guarded below by comparing the packs to each other — vocabulary,
 *      palette, layout, and which modules exist at all.
 *   2. **The engine stops honouring the pack.** The table stays rich and
 *      `seedBrand` quietly ignores half of it — a dropped `theme` write, a
 *      home screen built from a constant, commerce seeded regardless of the
 *      pack. A test that only reads `BRANDS` cannot see this, and it is the
 *      failure that reaches a live demo, so the engine is actually RUN here
 *      against a recording Firestore and the resulting documents are compared.
 *
 * The vocabulary assertions derive their expectations from the packs
 * themselves rather than from a hard-coded list of expected strings. A second
 * copy of the fixture text in this file would be a second source of truth that
 * goes stale the first time someone rewrites a headline — and, worse, would
 * still pass if the engine wrote nothing at all.
 *
 * Firestore is a double rather than the emulator deliberately. What is under
 * test is which documents the engine derives from a pack, and that is decided
 * before anything reaches the wire; the emulator would add a service
 * dependency to a guard that needs to run on every push in `tools-guards.yml`.
 * The double models the four behaviours the engine actually depends on —
 * `set(merge)` deep-merging nested maps, the `FieldValue.delete()` sentinel
 * removing a key, `listDocuments()` seeing a parent that owns children, and
 * `recursiveDelete` taking the subtree — because a double that gets those
 * wrong fabricates both false greens and false reds. Residue that only the
 * real service can show (rules, indexes) is not claimed here.
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { FieldValue } from 'firebase-admin/firestore'

import {
  AGENCY_DEMO_BRANDS,
  BRANDS,
  BRAND_IDS,
  DEFAULT_BRAND,
  resolveBrand,
} from './demo-brands.mjs'
import { seedBrand } from './seed-demo.mjs'

// ── A recording Firestore ───────────────────────────────────────────────────

const DELETE_SENTINEL = FieldValue.delete()
const isPlainObject = (value) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (value.constructor === Object || value.constructor === undefined)

/**
 * `set(…, { merge: true })` merges nested maps RECURSIVELY, and a
 * `FieldValue.delete()` anywhere in the tree removes that key.
 *
 * Both matter to what is asserted. The engine writes the host document three
 * times in one run — identity, then the home routing map, then the email one —
 * so a shallow merge would drop `displayName` and `theme` and this file would
 * report the brands as identical when they are not. And the prune clears the
 * routing map with `FieldValue.delete()`; a double that stored the sentinel as
 * a value would leave a map entry standing and call the residue check green.
 */
function mergeInto(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE_SENTINEL) {
      delete target[key]
    } else if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {}
      mergeInto(target[key], value)
    } else {
      target[key] = value
    }
  }
}

class FakeDocRef {
  constructor(store, path) {
    this.store = store
    this.path = path
  }
  get id() {
    return this.path.slice(this.path.lastIndexOf('/') + 1)
  }
  collection(name) {
    return new FakeCollectionRef(this.store, `${this.path}/${name}`)
  }
  async set(data, options) {
    const existing = options?.merge
      ? (this.store.docs.get(this.path) ?? {})
      : {}
    mergeInto(existing, data)
    this.store.docs.set(this.path, existing)
    this.store.writes.push(this.path)
  }
  async get() {
    const data = this.store.docs.get(this.path)
    return {
      exists: data !== undefined,
      id: this.id,
      ref: this,
      data: () => data,
      get: (field) => data?.[field],
    }
  }
}

class FakeCollectionRef {
  constructor(store, path, filters = []) {
    this.store = store
    this.path = path
    this.filters = filters
  }
  doc(id) {
    return new FakeDocRef(this.store, `${this.path}/${id}`)
  }
  where(field, op, value) {
    assert.equal(op, '==', `FakeFirestore models only '==' (got '${op}')`)
    return new FakeCollectionRef(this.store, this.path, [
      ...this.filters,
      [field, value],
    ])
  }
  /**
   * Firestore lists a document that has never been written but OWNS
   * children — the case the engine's prune comment calls out, because such a
   * parent is invisible to `get()` while its children very much are not. So
   * implicit parents are synthesized from the stored paths rather than read
   * off the map of written documents.
   */
  async listDocuments() {
    const prefix = `${this.path}/`
    const ids = new Set()
    for (const path of this.store.docs.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const id = rest.split('/')[0]
      if (id) ids.add(id)
    }
    return [...ids].map((id) => this.doc(id))
  }
  async get() {
    const prefix = `${this.path}/`
    const docs = []
    for (const [path, data] of this.store.docs) {
      if (!path.startsWith(prefix)) continue
      if (path.slice(prefix.length).includes('/')) continue
      if (this.filters.every(([field, value]) => data[field] === value)) {
        docs.push({
          id: path.slice(path.lastIndexOf('/') + 1),
          ref: new FakeDocRef(this.store, path),
          data: () => data,
          get: (field) => data[field],
        })
      }
    }
    return { docs, empty: docs.length === 0 }
  }
}

class FakeFirestore {
  constructor() {
    this.docs = new Map()
    this.writes = []
  }
  collection(name) {
    return new FakeCollectionRef(this, name)
  }
  /** Takes the document AND its subtree — the whole point of the prune. */
  async recursiveDelete(ref) {
    const prefix = `${ref.path}/`
    for (const path of [...this.docs.keys()]) {
      if (path === ref.path || path.startsWith(prefix)) this.docs.delete(path)
    }
  }
}

// ── Harness ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-demo'

/** A host doc has to exist before `seedBrand` will touch it. */
function withHost(store, hostId) {
  store.docs.set(`hosts/${hostId}`, { orgId: ORG_ID, subdomain: hostId })
  store.docs.set(`orgs/${ORG_ID}`, { name: 'Demo Agency' })
  return new FakeDocRef(store, `hosts/${hostId}`)
}

async function seed(brandId, { store = new FakeFirestore(), hostId } = {}) {
  const host = hostId ?? `host-${brandId}`
  const hostRef = withHost(store, host)
  await seedBrand({ firestore: store, hostRef, brand: resolveBrand(brandId) })
  return { store, hostRef }
}

/** Every path written for one host, plus that host's rows in the shared org. */
function corpusFor(store, hostId) {
  const entries = []
  for (const [path, data] of store.docs) {
    if (path === `orgs/${ORG_ID}`) continue
    if (path.startsWith(`hosts/${hostId}`) || data.seedHostId === hostId) {
      entries.push([path, data])
    }
  }
  return entries
}

/** Human-visible prose, which is what a prospect actually reads on the call. */
function prose(value, into = new Set()) {
  if (typeof value === 'string') {
    if (value.length >= 12 && !value.startsWith('http') && /\s/.test(value)) {
      into.add(value)
    }
  } else if (Array.isArray(value)) {
    for (const item of value) prose(item, into)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) prose(item, into)
  }
  return into
}

const seededProse = (store, hostId) =>
  prose(corpusFor(store, hostId).map(([, data]) => data))

/** Which of the engine's host subcollections a pack actually populates. */
function surfaceOf(store, hostId) {
  const surface = new Set()
  const prefix = `hosts/${hostId}/`
  for (const path of store.docs.keys()) {
    if (path.startsWith(prefix))
      surface.add(path.slice(prefix.length).split('/')[0])
  }
  return surface
}

const intersect = (a, b) => [...a].filter((item) => b.has(item))

/**
 * Prose the ENGINE hard-codes, which every site therefore carries.
 *
 * These are product nouns, not brand copy: `Welcome email` names the fixture's
 * role in the console's screen list exactly as `Home` does, and the email's
 * subject, preheader, heading and button all come from the pack. Two sites
 * sharing them is correct.
 *
 * It is an allowlist rather than a lower similarity threshold on purpose. A
 * threshold silently absorbs the next hard-coded headline; this list makes
 * adding one an edit to this file that a reviewer sees. And the entries are
 * verified below to be literals of the engine, so the list cannot be used to
 * launder pack copy through the exemption.
 */
const ENGINE_CHROME = new Set(['Welcome email'])

// ── 1. The packs are several businesses ─────────────────────────────────────

test('the demo org can hold more than one business', () => {
  assert.ok(
    BRAND_IDS.length >= 4,
    `A multi-site demo needs several packs; found ${BRAND_IDS.length}: ${BRAND_IDS}`,
  )
  assert.ok(
    AGENCY_DEMO_BRANDS.length >= 3,
    'The agency demo switches between at least three clients',
  )
  for (const id of AGENCY_DEMO_BRANDS) resolveBrand(id)
  assert.equal(
    BRANDS[DEFAULT_BRAND]?.id,
    DEFAULT_BRAND,
    'An unflagged run must still seed the historical default',
  )
})

test('no two packs share a name, a subdomain or a palette', () => {
  for (const field of ['displayName', 'subdomain']) {
    const seen = new Map()
    for (const id of BRAND_IDS) {
      const value = BRANDS[id][field]
      assert.ok(value, `Brand "${id}" has no ${field}`)
      assert.ok(
        !seen.has(value),
        `Brands "${seen.get(value)}" and "${id}" share ${field} "${value}" — ` +
          'the console list would read as the same site twice',
      )
      seen.set(value, id)
    }
  }
  // The palette is what makes four names read as four businesses rather than
  // four labels on one look, so it is checked as strictly as the name.
  const palettes = new Map()
  for (const id of BRAND_IDS) {
    const scheme = BRANDS[id].theme?.colorSchemes?.light
    assert.ok(scheme?.primary?.main, `Brand "${id}" carries no primary colour`)
    const key = JSON.stringify(scheme)
    assert.ok(
      !palettes.has(key),
      `Brands "${palettes.get(key)}" and "${id}" share a palette`,
    )
    palettes.set(key, id)
  }
})

test('packs differ in LAYOUT, not only in words', () => {
  const layouts = new Map()
  for (const id of BRAND_IDS) {
    const sections = BRANDS[id].home?.sections
    assert.ok(sections?.length, `Brand "${id}" has no home screen`)
    const key = sections.map((section) => section.type).join('>')
    assert.ok(
      !layouts.has(key),
      `Brands "${layouts.get(key)}" and "${id}" compose the home screen from ` +
        `the same section builders (${key}) — the switch shows one page recoloured`,
    )
    layouts.set(key, id)
  }
})

test('packs differ in WHICH MODULES EXIST, so the console does different work', () => {
  // Three sites that differ only in colour still read as one template. The
  // point of the demo is the console doing different work per client — a
  // storefront, a bookings-led site, a content-led one — so no two of the
  // agency's clients may present the same module surface.
  const surfaces = new Map()
  for (const id of AGENCY_DEMO_BRANDS) {
    const brand = BRANDS[id]
    const key = [
      brand.commerce ? 'commerce' : '',
      brand.services?.length ? 'services' : '',
      brand.reservations ? 'reservations' : '',
      brand.siteMembers?.length ? 'members' : '',
      brand.experiments?.length ? 'experiments' : '',
      `locations:${brand.commerce?.locations?.length ?? 0}`,
    ].join('|')
    assert.ok(
      !surfaces.has(key),
      `Agency clients "${surfaces.get(key)}" and "${id}" use an identical ` +
        `module surface (${key}) — switching between them shows the same site twice`,
    )
    surfaces.set(key, id)
  }
  const withCommerce = AGENCY_DEMO_BRANDS.filter((id) => BRANDS[id].commerce)
  assert.ok(
    withCommerce.length >= 1 && withCommerce.length < AGENCY_DEMO_BRANDS.length,
    'The agency demo needs a storefront AND a site with no storefront at all — ' +
      `found commerce on ${withCommerce.length}/${AGENCY_DEMO_BRANDS.length}`,
  )
})

test('packs do not share prose', () => {
  const vocab = new Map(BRAND_IDS.map((id) => [id, prose(BRANDS[id])]))
  for (const a of BRAND_IDS) {
    for (const b of BRAND_IDS) {
      if (a >= b) continue
      const shared = intersect(vocab.get(a), vocab.get(b))
      assert.equal(
        shared.length,
        0,
        `Packs "${a}" and "${b}" share copy, so the two sites read as one ` +
          `business: ${JSON.stringify(shared.slice(0, 3))}`,
      )
    }
  }
})

// ── 2. The engine honours the pack ──────────────────────────────────────────

test('seeding two brands produces two demonstrably different sites', async () => {
  const store = new FakeFirestore()
  const [a, b] = [AGENCY_DEMO_BRANDS[0], AGENCY_DEMO_BRANDS[2]]
  await seed(a, { store })
  await seed(b, { store })
  const hostA = `host-${a}`
  const hostB = `host-${b}`

  // Identity: what the console's site list shows at a glance.
  const docA = store.docs.get(`hosts/${hostA}`)
  const docB = store.docs.get(`hosts/${hostB}`)
  assert.notEqual(docA.displayName, docB.displayName)
  assert.equal(docA.displayName, BRANDS[a].displayName)
  assert.notDeepEqual(
    docA.theme?.colorSchemes,
    docB.theme?.colorSchemes,
    'Both sites were seeded with the same palette — the theme write ignores the pack',
  )
  assert.notEqual(
    docA.seo?.favicon,
    docB.seo?.favicon,
    'One favicon for both sites: the switcher shows the same mark twice',
  )

  // The home screen, which is the first thing opened on the call.
  const nodesA = store.docs.get(
    `hosts/${hostA}/screens/seed-home/versions/seed-home-v1`,
  )
  const nodesB = store.docs.get(
    `hosts/${hostB}/screens/seed-home/versions/seed-home-v1`,
  )
  assert.ok(nodesA?.nodes && nodesB?.nodes, 'A seeded site with no home screen')
  assert.notDeepEqual(
    nodesA.nodes,
    nodesB.nodes,
    'Both home screens are the same canvas',
  )
  assert.equal(
    store.docs.get(`hosts/${hostA}`).screens?.['seed-home'],
    '/',
    'The home screen is unreachable without its routing-map entry',
  )

  // The console doing different work: a different set of collections exists.
  const surfaceA = surfaceOf(store, hostA)
  const surfaceB = surfaceOf(store, hostB)
  assert.notDeepEqual(
    [...surfaceA].sort(),
    [...surfaceB].sort(),
    `Both sites populate the same collections (${[...surfaceA].sort()}) — ` +
      'the switch shows the console doing identical work',
  )

  // And no shared prose beyond the engine's own labels: not one page recoloured.
  const shared = intersect(
    seededProse(store, hostA),
    seededProse(store, hostB),
  ).filter((line) => !ENGINE_CHROME.has(line))
  assert.equal(
    shared.length,
    0,
    `The two seeded sites share copy: ${JSON.stringify(shared.slice(0, 3))}`,
  )
})

test('the engine hard-codes almost no prose of its own', async () => {
  // Guards the exemption above. Every entry must be a literal of the engine —
  // so the list cannot be widened to smuggle a pack's copy past the
  // shared-prose check — and the list must stay small, because engine prose is
  // by definition the same on every site.
  const source = await readFile(
    new URL('./seed-demo.mjs', import.meta.url),
    'utf8',
  )
  for (const line of ENGINE_CHROME) {
    assert.ok(
      source.includes(`'${line}'`) || source.includes(`"${line}"`),
      `"${line}" is exempted as engine prose but is not a literal in ` +
        "seed-demo.mjs — it is a pack's copy taking the exemption",
    )
  }
  assert.ok(
    ENGINE_CHROME.size <= 3,
    `${ENGINE_CHROME.size} strings are exempted as engine prose; past a handful ` +
      'the sites are sharing a script rather than a scaffold',
  )
})

test('every pack actually reaches Firestore', async () => {
  // The table being rich proves nothing if the engine drops most of it. Each
  // pack is seeded on its own and its own words are looked for in what was
  // written — expectations derived from the pack, so a rewritten headline
  // does not need this file edited, and an engine that wrote nothing fails.
  for (const id of BRAND_IDS) {
    const { store } = await seed(id)
    const written = seededProse(store, `host-${id}`)
    const packVocab = prose(BRANDS[id])
    const landed = intersect(packVocab, written)
    assert.ok(
      landed.length >= Math.ceil(packVocab.size * 0.5),
      `Only ${landed.length}/${packVocab.size} of the "${id}" pack's copy was ` +
        'written — the engine is ignoring most of the pack',
    )
    // Nobody else's business showed up on this site.
    for (const other of BRAND_IDS) {
      if (other === id) continue
      const bleed = intersect(prose(BRANDS[other]), written)
      assert.equal(
        bleed.length,
        0,
        `Seeding "${id}" wrote "${other}" copy: ${JSON.stringify(bleed.slice(0, 3))}`,
      )
    }
  }
})

test('org-scoped rows are namespaced per site, so siblings do not collide', async () => {
  // The org collections are SHARED between the org's sites, and every pack
  // uses the same fixture ids (`seed-contact-1` and friends). So the namespace
  // is the only thing standing between two sites and one of them silently
  // overwriting the other's contacts — a demo where the second site's CRM is
  // the first site's, or empty.
  //
  // Counted per site rather than merely asserting both sites appear somewhere:
  // the per-brand invite row is keyed by brand id and survives a collision on
  // its own, so "both hosts are represented" stays true while every namespaced
  // row has in fact been overwritten.
  const [a, b] = AGENCY_DEMO_BRANDS
  const orgRows = (store, hostId) =>
    [...store.docs]
      .filter(
        ([path, data]) =>
          path.startsWith(`orgs/${ORG_ID}/`) && data.seedHostId === hostId,
      )
      .map(([path]) => path)
      .sort()

  const alone = new FakeFirestore()
  await seed(a, { store: alone })
  const solo = orgRows(alone, `host-${a}`)
  assert.ok(solo.length > 0, 'No org-scoped fixtures were written at all')

  const together = new FakeFirestore()
  await seed(a, { store: together })
  await seed(b, { store: together })

  assert.deepEqual(
    orgRows(together, `host-${a}`),
    solo,
    `Seeding "${b}" into the same org took rows away from "${a}" — the shared ` +
      "org collections are colliding on the packs' identical fixture ids",
  )
  const rowsB = orgRows(together, `host-${b}`)
  assert.ok(
    rowsB.length > 0,
    `Site "${b}" ended up with no org-scoped rows at all`,
  )
  assert.deepEqual(
    intersect(new Set(solo), new Set(rowsB)),
    [],
    'Two sites share an org-row document id, so one is overwriting the other',
  )
  for (const [path, data] of together.docs) {
    if (!path.startsWith(`orgs/${ORG_ID}/`)) continue
    assert.ok(
      data.seedHostId,
      `${path} carries no seedHostId — the prune would take a sibling site's rows`,
    )
  }
})

// ── 3. A re-seed converges ──────────────────────────────────────────────────

test('re-seeding a host with a DIFFERENT brand leaves no trace of the old one', async () => {
  // The failure this catches is specific to a live demo: seed run two must
  // look like seed run one. A merge alone leaves the previous brand's products
  // and posts sitting beside the new ones, so the site reads as two businesses
  // wearing one name — which is the original defect, inverted.
  const store = new FakeFirestore()
  const [a, b] = [AGENCY_DEMO_BRANDS[1], AGENCY_DEMO_BRANDS[2]]
  await seed(a, { store, hostId: 'host-shared' })
  await seed(b, { store, hostId: 'host-shared' })

  const written = seededProse(store, 'host-shared')
  const residue = intersect(prose(BRANDS[a]), written)
  assert.equal(
    residue.length,
    0,
    `Re-seeding as "${b}" left "${a}" content standing: ` +
      JSON.stringify(residue.slice(0, 3)),
  )
  assert.equal(
    store.docs.get('hosts/host-shared').displayName,
    BRANDS[b].displayName,
  )
})

test('a real document beside the fixtures survives a re-seed', async () => {
  // The prune is prefix-scoped on purpose: the demo org may end up holding a
  // hand-built site, and a re-seed that ate it would be discovered on a call.
  const store = new FakeFirestore()
  await seed(AGENCY_DEMO_BRANDS[0], { store, hostId: 'host-shared' })
  store.docs.set('hosts/host-shared/products/real-product', {
    name: 'Hand built',
  })
  await seed(AGENCY_DEMO_BRANDS[1], { store, hostId: 'host-shared' })
  assert.deepEqual(
    store.docs.get('hosts/host-shared/products/real-product'),
    { name: 'Hand built' },
    'The re-seed deleted a document it did not create',
  )
})

test('re-seeding the same brand is idempotent', async () => {
  const store = new FakeFirestore()
  await seed(DEFAULT_BRAND, { store, hostId: 'host-shared' })
  const first = [...store.docs.keys()].sort()
  await seed(DEFAULT_BRAND, { store, hostId: 'host-shared' })
  assert.deepEqual(
    [...store.docs.keys()].sort(),
    first,
    'A second run of the same brand changed the document set',
  )
})
