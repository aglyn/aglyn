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

// The plan of the platform's own site starter listings (AGL-4049), built from
// the real default site, kinds, font pairings and theme presets.
//
//   node --test tools/scripts/lib/first-party-starters.test.mjs

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  FIRST_PARTY_STARTER_MODULE_PATHS,
  FIRST_PARTY_STARTER_SEED_SOURCE,
  FIRST_PARTY_STARTER_STAFF_OWNED_FIELDS,
  SITE_NAME_TOKEN,
  buildFirstPartyStarterPlan,
  firstPartyStarterConsoleOrigin,
  firstPartyStarterListingId,
  firstPartyStarterOwnedFields,
  loadFirstPartyStarterSources,
  reconcileFirstPartyStarter,
} from './first-party-starters.mjs'
import { listingQueryFields } from './listing-query-fields.mjs'
import { WORKSPACE_ROOT, importWorkspaceModule } from './workspace-module.mjs'

const sources = await loadFirstPartyStarterSources()
const ORG = 'org-platform'
const ORIGIN = 'https://console.example.com'
/** The plan for the platform org on {@link ORIGIN}, with any input replaced. */
const planOf = (overrides = {}) => buildFirstPartyStarterPlan({ orgId: ORG, consoleOrigin: ORIGIN, ...sources, ...overrides })
const plan = planOf()
const byId = new Map(plan.map((entry) => [entry.listingId, entry]))
const known = {
  kinds: new Set(sources.kinds.map((kind) => kind.id)),
  bases: new Set(sources.bases),
  fonts: new Set(sources.pairings.map((pairing) => pairing.id)),
}

/** Firestore stand-ins the reconcile writes through. */
const values = {
  now: () => '<now>',
  publishedAt: () => '<published>',
  createdAt: (order) => `<created ${order}>`,
  appendHistory: (entry) => ({ arrayUnion: entry }),
}

/** What a stored listing reads as after a create: the write, with the Firestore values resolved. */
function storedAfter(write, previous = {}) {
  const listing = { ...previous, ...write }
  if (write.versionHistory) listing.versionHistory = [...(previous.versionHistory ?? []), write.versionHistory.arrayUnion]
  return listing
}

describe('first-party starter ids', () => {
  it('names the starter site and each kind by a key function', () => {
    assert.equal(firstPartyStarterListingId(null), 'fp-starter-default')
    assert.equal(firstPartyStarterListingId('trades', 'base'), 'fp-starter-trades-base')
    assert.equal(firstPartyStarterListingId('trades', 'ai'), 'fp-starter-trades-ai')
    assert.equal(firstPartyStarterListingId('trades'), 'fp-starter-trades-base')
  })
})

describe('the plan', () => {
  it('lists the starter site first, then a base and an AI starter for every kind', () => {
    assert.equal(plan.length, 1 + 2 * sources.kinds.length)
    assert.equal(plan[0].listingId, 'fp-starter-default')
    assert.deepEqual(
      plan.slice(1).map((entry) => entry.listingId),
      sources.kinds.flatMap((kind) => [`fp-starter-${kind.id}-base`, `fp-starter-${kind.id}-ai`]),
    )
    assert.equal(new Set(plan.map((entry) => entry.listingId)).size, plan.length)
    assert.deepEqual(
      plan.map((entry) => entry.order),
      plan.map((_, index) => index),
    )
  })

  it('creates every listing free, listed, official and marked as this seed’s', () => {
    for (const { listingId, listing } of plan) {
      assert.equal(listing.artifactType, 'siteStarter', listingId)
      assert.equal(listing.profileId, ORG, listingId)
      assert.equal(listing.official, true, listingId)
      assert.equal(listing.priceUsd, 0, listingId)
      assert.equal(listing.reviewStatus, 'listed', listingId)
      assert.equal(listing.seedSource, FIRST_PARTY_STARTER_SEED_SOURCE, listingId)
      assert.equal(listing.screenCount, 1, listingId)
      assert.equal(listing.starterPages, 1, listingId)
      assert.ok(listing.displayName && listing.description, listingId)
    }
  })

  it('puts every listing on the public shelf (the restatement reviews starters and these are listed)', () => {
    for (const { listingId, listing } of plan) {
      assert.deepEqual(listingQueryFields(listing).browseAudience, ['*', `*|${ORG}`], listingId)
    }
    const submitted = { ...plan[0].listing, reviewStatus: 'submitted' }
    assert.deepEqual(listingQueryFields(submitted).browseAudience, [ORG, `${ORG}|${ORG}`])
  })

  it('plans only payloads that can start a site', () => {
    for (const { listingId, version } of plan) {
      assert.equal(sources.core.siteStarterRefusal(version.starter, known), null, listingId)
    }
  })

  it('makes the starter site the default site, the name a token and the Home link a slug', () => {
    const { starter } = byId.get('fp-starter-default').version
    assert.deepEqual(starter.facets, { kind: null, base: 'starter', fonts: null, pages: 1, mode: 'base' })
    assert.deepEqual(starter.theme, { kind: 'builtin', base: 'starter', brand: { light: {} }, fonts: null })
    assert.equal(starter.mode, 'base')
    assert.equal(starter.answers, undefined)
    const [home] = starter.screens
    assert.equal(home.slug, '/')
    assert.equal(home.displayName, 'Home')
    assert.deepEqual(home.seo, { title: 'Home', description: sources.core.defaultHomeDescription('') })
    assert.equal(home.key, undefined)
    assert.ok(Object.values(home.nodes).some((node) => node.props?.children === SITE_NAME_TOKEN))

    const links = Object.values(starter.layout.nodes).filter((node) => node.props?.screenSlug !== undefined)
    assert.ok(links.length >= 2, 'the brand and the footer link to Home')
    for (const node of links) {
      assert.equal(node.props.screenSlug, '/')
      assert.equal(node.props.screenId, undefined)
    }
    assert.ok(Object.values(starter.layout.nodes).some((node) => node.componentId === 'layoutSlot'))
  })

  it('stores the starter site through the starter rule with every node kept', () => {
    const { starter } = byId.get('fp-starter-default').version
    const asStored = (value) => JSON.parse(JSON.stringify(value))
    const root = sources.core.canvasRootId
    /** The source node as the starter rule stores it: the same, the root's parent filled in as none. */
    const kept = (node) => ({ ...node, parentId: node.parentId ?? null })

    const home = asStored(sources.core.buildDefaultHomeScreen(SITE_NAME_TOKEN).nodes)
    const stored = starter.screens[0].nodes
    assert.deepEqual(Object.keys(stored).sort(), Object.keys(home).sort())
    for (const [id, node] of Object.entries(home)) assert.deepEqual(stored[id], kept(node), id)
    const rule = sources.core.sanitizeSiteStarterNodes({ rootId: root, nodes: home })
    assert.equal(rule.ok, true)
    assert.deepEqual(stored, asStored(rule.nodes))

    const layout = asStored(sources.core.buildDefaultSiteLayout('home-id').nodes)
    const chrome = starter.layout.nodes
    assert.deepEqual(Object.keys(chrome).sort(), Object.keys(layout).sort())
    for (const [id, node] of Object.entries(layout)) {
      const { screenId, ...props } = node.props ?? {}
      const expected = screenId === 'home-id' ? { ...kept(node), props: { ...props, screenSlug: '/' } } : kept(node)
      assert.deepEqual(chrome[id], expected, id)
    }

    // The styles and interactions the portable rule would have stripped are all there.
    const count = (nodes, key) => Object.values(nodes).filter((node) => node[key] !== undefined).length
    assert.ok(count(home, 'sx') > 0 && count(home, 'interactions') > 0)
    assert.equal(count(stored, 'sx'), count(home, 'sx'))
    assert.equal(count(stored, 'interactions'), count(home, 'interactions'))
    assert.equal(count(chrome, 'sx'), count(layout, 'sx'))
  })

  it('fails the plan when the starter rule refuses, drops a node or loses the slot', () => {
    const withRule = (sanitizeSiteStarterNodes) => ({ ...sources.core, sanitizeSiteStarterNodes })
    const refuse = withRule(() => ({ ok: false, error: 'Component "x" cannot be in a starter' }))
    assert.throws(
      () => planOf({ core: refuse }),
      /The starter site's Home page: Component "x" cannot be in a starter/,
    )
    const drop = withRule((definition, options) => {
      const result = sources.core.sanitizeSiteStarterNodes(definition, options)
      const [first, ...rest] = Object.keys(result.nodes).filter((id) => id !== definition.rootId)
      return rest.length ? { ...result, nodes: Object.fromEntries(Object.entries(result.nodes).filter(([id]) => id !== first)) } : result
    })
    assert.throws(() => planOf({ core: drop }), /the starter rule dropped /)
    const noSlot = { ...sources.core, layoutSlotId: 'no-such-slot' }
    assert.throws(() => planOf({ core: noSlot }), /no content slot/)
  })

  it('gives each kind its first base the platform has, its first pairing and a brand from its first hue', () => {
    const presetIds = new Set(sources.presets.map((preset) => preset.id))
    for (const kind of sources.kinds) {
      const { starter } = byId.get(`fp-starter-${kind.id}-base`).version
      const expectedBase =
        kind.look.bases.find((name) => name === 'starter' || presetIds.has(`theme-presets.${name}`)) ?? 'starter'
      assert.equal(starter.theme.kind, 'builtin', kind.id)
      assert.equal(starter.theme.base, expectedBase, kind.id)
      assert.equal(starter.theme.fonts, kind.look.fonts[0], kind.id)
      assert.deepEqual(starter.facets, { kind: kind.id, base: expectedBase, fonts: kind.look.fonts[0], pages: 1, mode: 'base' })
      const [from, to] = kind.look.hues[0]
      if (to - from >= 360) {
        assert.deepEqual(starter.theme.brand, { light: {} }, `${kind.id} suits any hue, so the base keeps its own`)
      } else {
        assert.match(starter.theme.brand.light.primary, /^#[0-9a-f]{6}$/, kind.id)
        assert.match(starter.theme.brand.dark.primary, /^#[0-9a-f]{6}$/, kind.id)
      }
      assert.equal(byId.get(`fp-starter-${kind.id}-base`).listing.displayName, kind.label)
    }
    assert.equal(byId.get('fp-starter-trades-base').version.starter.theme.base, 'bootstrap')
    assert.equal(byId.get('fp-starter-business-base').version.starter.theme.base, 'starter')
  })

  it('hands an AI starter the answers and the look, never a copy of a site', () => {
    for (const kind of sources.kinds) {
      const base = byId.get(`fp-starter-${kind.id}-base`)
      const ai = byId.get(`fp-starter-${kind.id}-ai`)
      assert.equal(ai.version.starter.mode, 'ai')
      assert.equal(ai.listing.starterMode, 'ai')
      assert.equal(base.listing.starterMode, 'base')
      assert.equal(ai.listing.starterKind, kind.id)
      assert.deepEqual(ai.version.starter.theme, base.version.starter.theme)
      const { answers } = ai.version.starter
      assert.equal(answers.kind, kind.id)
      assert.equal(answers.fonts, kind.look.fonts[0])
      assert.equal(answers.pages, kind.pages)
      assert.equal(answers.brief, '')
      assert.deepEqual(answers.brandColors, base.version.starter.theme.brand.light)
      assert.equal(answers.style.base, base.version.starter.theme.base)
      assert.equal(base.version.starter.answers, undefined)
    }
  })

  it("pictures and names each kind's two starters as its style, on the console's origin", () => {
    const styles = new Map(sources.styles.map((style) => [style.id, style]))
    for (const kind of sources.kinds) {
      const style = styles.get(kind.id)
      assert.ok(style, kind.id)
      for (const mode of ['base', 'ai']) {
        const { listing } = byId.get(`fp-starter-${kind.id}-${mode}`)
        assert.equal(listing.previewImageUrl, `${ORIGIN}/_static/starter/styles/${kind.id}.webp`, `${kind.id} ${mode}`)
        assert.equal(listing.previewImageUrl, `${ORIGIN}${style.preview}`, `${kind.id} ${mode}`)
        assert.equal(listing.category, style.name, `${kind.id} ${mode}`)
        assert.equal(listing.category, kind.label, `${kind.id} ${mode}: the kind's card calls it this too`)
      }
      // The console serves the file the URL names.
      assert.ok(existsSync(join(WORKSPACE_ROOT, 'apps/console/public', style.preview)), style.preview)
    }
    assert.equal(byId.get('fp-starter-trades-ai').listing.category, 'Home services & trades')
  })

  it('keeps the starter site listed and official, with no picture and its own category', () => {
    const { listing } = byId.get('fp-starter-default')
    assert.equal(listing.official, true)
    assert.equal(listing.reviewStatus, 'listed')
    assert.equal(listing.previewImageUrl, undefined)
    assert.equal(listing.category, 'design')
  })

  it('takes the pictures from whatever console origin it is handed', () => {
    const local = planOf({ consoleOrigin: 'http://localhost:4290' })
    assert.equal(
      local.find((entry) => entry.listingId === 'fp-starter-yoga-base').listing.previewImageUrl,
      'http://localhost:4290/_static/starter/styles/yoga.webp',
    )
  })

  it('refuses a plan without a console origin, or with more than an origin', () => {
    for (const consoleOrigin of [undefined, '', 'console.example.com', `${ORIGIN}/`, `${ORIGIN}/app`, 'ftp://console.example.com']) {
      assert.throws(() => planOf({ consoleOrigin }), /A console origin is required/, String(consoleOrigin))
    }
  })

  it('refuses a kind with no style to picture it, naming the listing', () => {
    const styles = sources.styles.filter((style) => style.id !== 'music')
    assert.throws(() => planOf({ styles }), /fp-starter-music-base: no style "music" in site-styles.ts/)
  })

  it('is the same plan on every run', () => {
    const again = planOf()
    assert.deepEqual(again, plan)
  })

  it('fails the run on a payload a starter refuses, naming the listing', () => {
    const bases = sources.bases.filter((name) => name !== 'starter')
    assert.throws(
      () => planOf({ bases }),
      /fp-starter-default: Unknown base theme "starter"/,
    )
    const core = { ...sources.core, buildDefaultHomeScreen: (name) => ({ ...sources.core.buildDefaultHomeScreen(name), slug: '/home' }) }
    assert.throws(
      () => planOf({ core }),
      /fp-starter-default: A starter needs a published Home page at \//,
    )
    assert.throws(() => planOf({ orgId: '' }), /An org id is required/)
  })

  it('refuses a links rewrite that leaves the layout linking to Home by id', () => {
    const core = { ...sources.core, starterLinksBySlug: (nodes) => nodes }
    assert.throws(() => planOf({ core }), /linking to Home by id/)
  })
})

describe('the console origin the pictures are on', () => {
  const site = { servePort: 4200, platformOrigin: () => 'https://app.example.com/' }

  it('is the local console against the emulator: the e2e harness’s, else the serve port', () => {
    const emulator = { FIRESTORE_EMULATOR_HOST: 'localhost:8082' }
    assert.equal(firstPartyStarterConsoleOrigin(emulator, site), 'http://localhost:4200')
    assert.equal(firstPartyStarterConsoleOrigin({ ...emulator, E2E_BASE_URL: 'http://localhost:4290/signin' }, site), 'http://localhost:4290')
    // An env file's production console is not where the emulated stack serves its pictures.
    assert.equal(
      firstPartyStarterConsoleOrigin({ ...emulator, NEXT_PUBLIC_CONSOLE_URL: 'https://app.example.com' }, site),
      'http://localhost:4200',
    )
  })

  it("is the platform's console anywhere else, and only over https", () => {
    assert.equal(firstPartyStarterConsoleOrigin({}, site), 'https://app.example.com')
    assert.throws(
      () => firstPartyStarterConsoleOrigin({}, { ...site, platformOrigin: () => 'http://app.example.com' }),
      /is not https/,
    )
    assert.throws(() => firstPartyStarterConsoleOrigin({}, { ...site, platformOrigin: () => 'not a url' }), /is not a URL/)
  })

  it("reads core's console origin and the console's serve port", () => {
    assert.equal(typeof sources.console.platformOrigin, 'function')
    assert.ok(Number.isInteger(sources.console.servePort) && sources.console.servePort > 0)
  })

  it('refuses a console project that names no serve port', async () => {
    const importModule = async (path) =>
      path === FIRST_PARTY_STARTER_MODULE_PATHS.consoleProject ? { targets: {} } : importWorkspaceModule(path)
    await assert.rejects(loadFirstPartyStarterSources(importModule), /apps\/console\/project.json names no serve port/)
  })
})

describe('who owns which field', () => {
  it('splits a listing into seed-owned and staff-owned fields', () => {
    const { seed, staff } = firstPartyStarterOwnedFields(plan[1].listing)
    assert.deepEqual(Object.keys(staff).sort(), ['category', 'description', 'displayName', 'priceUsd', 'reviewStatus'])
    assert.deepEqual(
      Object.keys(seed).sort(),
      [
        'artifactType',
        'official',
        'previewImageUrl',
        'profileId',
        'screenCount',
        'seedSource',
        'starterBase',
        'starterFonts',
        'starterKind',
        'starterMode',
        'starterPages',
      ],
    )
    assert.deepEqual([...FIRST_PARTY_STARTER_STAFF_OWNED_FIELDS].sort(), [
      'category',
      'description',
      'displayName',
      'priceUsd',
      'reviewStatus',
    ])
  })

  it('leaves the starter site without a picture, so no run writes one over a staff choice', () => {
    const { seed } = firstPartyStarterOwnedFields(plan[0].listing)
    assert.equal('previewImageUrl' in seed, false)
  })
})

describe('reconcile', () => {
  const entry = byId.get('fp-starter-trades-base')
  const created = reconcileFirstPartyStarter(entry, { listing: null, version: null }, values)
  const storedListing = storedAfter(created.listingWrite)
  const storedVersion = JSON.parse(JSON.stringify(created.versionWrite.data))

  it('creates a missing listing with every field and its first version', () => {
    assert.equal(created.action, 'create')
    assert.equal(created.version, 1)
    assert.equal(created.listingWrite.displayName, entry.listing.displayName)
    assert.equal(created.listingWrite.priceUsd, 0)
    assert.equal(created.listingWrite.reviewStatus, 'listed')
    assert.equal(created.listingWrite.deletedAt, null)
    assert.equal(created.listingWrite.latestVersion, 1)
    assert.equal(created.listingWrite.createdAt, `<created ${entry.order}>`)
    assert.equal(created.listingWrite.installCount, 0)
    assert.deepEqual(created.listingWrite.browseAudience, ['*', `*|${ORG}`])
    assert.deepEqual(created.listingWrite.versionHistory, { arrayUnion: { version: 1, publishedAt: '<published>' } })
    assert.deepEqual(created.versionWrite, { version: 1, data: { starter: entry.version.starter, publishedAt: '<now>' } })
  })

  it('writes nothing on a second run', () => {
    const again = reconcileFirstPartyStarter(entry, { listing: storedListing, version: storedVersion }, values)
    assert.equal(again.action, 'unchanged')
    assert.equal(again.listingWrite, null)
    assert.equal(again.versionWrite, null)
    assert.equal(again.version, 1)
    assert.deepEqual(again.staffDrift, [])
  })

  it('reads a stored version as the same however its map keys come back ordered', () => {
    const reverseKeys = (value) =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)]))
          : value
    const shuffled = reverseKeys(storedVersion)
    assert.notEqual(JSON.stringify(shuffled), JSON.stringify(storedVersion))
    const again = reconcileFirstPartyStarter(entry, { listing: storedListing, version: shuffled }, values)
    assert.equal(again.action, 'unchanged')
  })

  it('leaves a staff edit and a price alone, and reports them', () => {
    const edited = {
      ...storedListing,
      displayName: 'Trades, by hand',
      priceUsd: 19,
      ...listingQueryFields({ ...storedListing, displayName: 'Trades, by hand' }),
    }
    const again = reconcileFirstPartyStarter(entry, { listing: edited, version: storedVersion }, values)
    assert.equal(again.action, 'unchanged')
    assert.equal(again.listingWrite, null)
    assert.deepEqual(
      again.staffDrift.map((drift) => drift.field).sort(),
      ['displayName', 'priceUsd'],
    )
  })

  it('keeps a staff takedown and its audience', () => {
    const unlisted = { ...storedListing, reviewStatus: 'submitted', ...listingQueryFields({ ...storedListing, reviewStatus: 'submitted' }) }
    const again = reconcileFirstPartyStarter(entry, { listing: unlisted, version: storedVersion }, values)
    assert.equal(again.action, 'unchanged')
    assert.deepEqual(again.staffDrift.map((drift) => drift.field), ['reviewStatus'])
  })

  it('rewrites a stale seed-owned field and the query fields that follow from it', () => {
    const stale = { ...storedListing, official: false, starterFonts: 'inter' }
    const again = reconcileFirstPartyStarter(entry, { listing: stale, version: storedVersion }, values)
    assert.equal(again.action, 'update')
    assert.deepEqual(again.seedChanges.sort(), ['official', 'starterFonts'])
    assert.deepEqual(again.listingWrite, { official: true, starterFonts: entry.listing.starterFonts, updatedAt: '<now>' })
    assert.equal(again.versionWrite, null)
  })

  it('creates a kind’s starter with its picture and its style’s name', () => {
    assert.equal(created.listingWrite.previewImageUrl, `${ORIGIN}/_static/starter/styles/trades.webp`)
    assert.equal(created.listingWrite.category, 'Home services & trades')
    assert.ok(created.seedChanges.includes('previewImageUrl'))
  })

  it('puts back a picture that is missing or on another origin, as seed-owned drift', () => {
    const elsewhere = { ...storedListing, previewImageUrl: 'http://localhost:4200/_static/starter/styles/trades.webp' }
    const moved = reconcileFirstPartyStarter(entry, { listing: elsewhere, version: storedVersion }, values)
    assert.equal(moved.action, 'update')
    assert.deepEqual(moved.seedChanges, ['previewImageUrl'])
    assert.deepEqual(moved.staffDrift, [])
    assert.deepEqual(moved.listingWrite, { previewImageUrl: entry.listing.previewImageUrl, updatedAt: '<now>' })
    assert.equal(moved.versionWrite, null)

    const { previewImageUrl: _dropped, ...bare } = storedListing
    const missing = reconcileFirstPartyStarter(entry, { listing: bare, version: storedVersion }, values)
    assert.deepEqual(missing.seedChanges, ['previewImageUrl'])
    assert.equal(missing.listingWrite.previewImageUrl, entry.listing.previewImageUrl)
  })

  it('leaves a category staff changed alone, and reports it', () => {
    const recategorized = { ...storedListing, category: 'Roofing' }
    const again = reconcileFirstPartyStarter(entry, { listing: recategorized, version: storedVersion }, values)
    assert.equal(again.action, 'unchanged')
    assert.equal(again.listingWrite, null)
    assert.deepEqual(again.staffDrift, [{ field: 'category', stored: 'Roofing', planned: 'Home services & trades' }])
  })

  it('writes the next version when the content changes, and only then', () => {
    const older = { starter: { ...storedVersion.starter, screens: [{ ...storedVersion.starter.screens[0], displayName: 'Old home' }] } }
    const again = reconcileFirstPartyStarter(entry, { listing: storedListing, version: older }, values)
    assert.equal(again.action, 'update')
    assert.equal(again.version, 2)
    assert.equal(again.listingWrite.latestVersion, 2)
    assert.deepEqual(again.listingWrite.versionHistory, { arrayUnion: { version: 2, publishedAt: '<published>' } })
    assert.deepEqual(again.versionWrite, { version: 2, data: { starter: entry.version.starter, publishedAt: '<now>' } })
    const missing = reconcileFirstPartyStarter(entry, { listing: storedListing, version: null }, values)
    assert.equal(missing.version, 2)
  })

  it('refuses a listing this seed did not write, or another org’s', () => {
    assert.throws(
      () => reconcileFirstPartyStarter(entry, { listing: { ...storedListing, seedSource: undefined }, version: null }, values),
      /was not written by this seed/,
    )
    assert.throws(
      () => reconcileFirstPartyStarter(entry, { listing: { ...storedListing, profileId: 'someone-else' }, version: null }, values),
      /belongs to org someone-else/,
    )
  })
})
