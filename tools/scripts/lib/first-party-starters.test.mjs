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
import { describe, it } from 'node:test'
import {
  FIRST_PARTY_STARTER_MODULE_PATHS,
  FIRST_PARTY_STARTER_SEED_SOURCE,
  FIRST_PARTY_STARTER_STAFF_OWNED_FIELDS,
  SITE_NAME_TOKEN,
  buildFirstPartyStarterPlan,
  firstPartyStarterListingId,
  firstPartyStarterOwnedFields,
  hasStarterLinksModule,
  loadFirstPartyStarterSources,
  reconcileFirstPartyStarter,
} from './first-party-starters.mjs'
import { listingQueryFields } from './listing-query-fields.mjs'
import { importWorkspaceModule } from './workspace-module.mjs'

/**
 * The publish side of `site-starter-links.ts` as its contract states it
 * (AGL-4049 phase 2, §1.4), used only while that module has not reached this
 * checkout: every `screenId` prop naming a routed page becomes `screenSlug`.
 * Once it lands, the real one is loaded and this is never called.
 */
function contractStarterLinksBySlug(nodes, routing) {
  const out = {}
  for (const [id, node] of Object.entries(nodes)) {
    const props = { ...(node.props ?? {}) }
    if (typeof props.screenId === 'string' && props.screenId in routing) {
      props.screenSlug = routing[props.screenId]
      delete props.screenId
    }
    out[id] = { ...node, ...(node.props ? { props } : {}) }
  }
  return out
}

const realLinks = hasStarterLinksModule()
const sources = await loadFirstPartyStarterSources((path) =>
  path === FIRST_PARTY_STARTER_MODULE_PATHS.links && !realLinks
    ? Promise.resolve({ starterLinksBySlug: contractStarterLinksBySlug })
    : importWorkspaceModule(path),
)
const ORG = 'org-platform'
const plan = buildFirstPartyStarterPlan({ orgId: ORG, ...sources })
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
    const def = sources.core.buildDefaultHomeScreen(SITE_NAME_TOKEN)
    assert.deepEqual(home.nodes, JSON.parse(JSON.stringify(def.nodes)))

    const links = Object.values(starter.layout.nodes).filter((node) => node.props?.screenSlug !== undefined)
    assert.ok(links.length >= 2, 'the brand and the footer link to Home')
    for (const node of links) {
      assert.equal(node.props.screenSlug, '/')
      assert.equal(node.props.screenId, undefined)
    }
    assert.ok(Object.values(starter.layout.nodes).some((node) => node.componentId === 'layoutSlot'))
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

  it('is the same plan on every run', () => {
    const again = buildFirstPartyStarterPlan({ orgId: ORG, ...sources })
    assert.deepEqual(again, plan)
  })

  it('fails the run on a payload a starter refuses, naming the listing', () => {
    const bases = sources.bases.filter((name) => name !== 'starter')
    assert.throws(
      () => buildFirstPartyStarterPlan({ orgId: ORG, ...sources, bases }),
      /fp-starter-default: Unknown base theme "starter"/,
    )
    const core = { ...sources.core, buildDefaultHomeScreen: (name) => ({ ...sources.core.buildDefaultHomeScreen(name), slug: '/home' }) }
    assert.throws(
      () => buildFirstPartyStarterPlan({ orgId: ORG, ...sources, core }),
      /fp-starter-default: A starter needs a published Home page at \//,
    )
    assert.throws(() => buildFirstPartyStarterPlan({ ...sources, orgId: '' }), /An org id is required/)
  })

  it('refuses a links rewrite that leaves the layout linking to Home by id', () => {
    const core = { ...sources.core, starterLinksBySlug: (nodes) => nodes }
    assert.throws(() => buildFirstPartyStarterPlan({ orgId: ORG, ...sources, core }), /linking to Home by id/)
  })
})

describe('who owns which field', () => {
  it('splits a listing into seed-owned and staff-owned fields', () => {
    const { seed, staff } = firstPartyStarterOwnedFields(plan[1].listing)
    assert.deepEqual(Object.keys(staff).sort(), ['category', 'description', 'displayName', 'priceUsd', 'reviewStatus'])
    assert.deepEqual(
      Object.keys(seed).sort(),
      ['artifactType', 'official', 'profileId', 'screenCount', 'seedSource', 'starterBase', 'starterFonts', 'starterKind', 'starterMode', 'starterPages'],
    )
    assert.deepEqual([...FIRST_PARTY_STARTER_STAFF_OWNED_FIELDS].sort(), [
      'category',
      'description',
      'displayName',
      'previewImageUrl',
      'priceUsd',
      'reviewStatus',
    ])
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

if (!realLinks) {
  describe('site-starter-links.ts', () => {
    it('is not in this checkout yet: the layout links were rewritten by its contract', (t) => {
      t.diagnostic(`${FIRST_PARTY_STARTER_MODULE_PATHS.links} is missing; the seed CLI refuses to run until it lands`)
    })
  })
}
