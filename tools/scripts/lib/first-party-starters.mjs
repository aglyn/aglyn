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
 * The platform's own site starter listings (AGL-4049), as a plan: which
 * listings exist, what each one holds, and what a run must write to bring a
 * stored listing up to date. `seed-first-party-starters.mjs` is the CLI that
 * reads and writes; nothing here touches Firestore.
 *
 * The platform's starters are real marketplace listings owned by its own org,
 * published the way any publisher's are, so staff can edit and price them
 * later. Every one is free when first created. There are three shapes:
 *
 *   - `fp-starter-default`: the starter site every new site is born with
 *     (`default-site.ts`), listed first.
 *   - `fp-starter-{kind}-base`: the same pages in a look made for one of the
 *     AI start's kinds of site (`ai-site-kinds.ts`): its first base theme, its
 *     first font pairing, and a brand color from its first hue range.
 *   - `fp-starter-{kind}-ai`: the same, plus the answers the AI start asks,
 *     so the pages are written for the business. Answers and a look, never a
 *     copy of a site.
 *
 * The content comes from the TypeScript that owns it, loaded through `jiti`
 * (`workspace-module.mjs`), so a change to the default site reaches these
 * listings on the next run as a new version, and never by copying it here.
 * Its pages and layout pass through `sanitizeSiteStarterNodes`, the rule the
 * starter publish door holds every publisher's pages to, so a seeded starter
 * stores what a published one would.
 *
 * ## Who owns which field
 *
 * SEED-OWNED fields are rewritten on every run, because they follow from the
 * code: the artifact type, the publisher, `official`, the starter facets, the
 * page count, the seed marker, the version content, and the query fields
 * derived from the stored listing. STAFF-OWNED fields are written only when a
 * listing is first created: its name, description, category, price, preview
 * image and review verdict. A run never undoes a staff edit, a price or a
 * takedown; `--verify` reports where they differ from the plan.
 */

import { listingQueryFieldsPatch } from './listing-query-fields.mjs'
import { importWorkspaceModule } from './workspace-module.mjs'

/** The marker on every listing this seed writes, so a run never takes over a listing it did not write. */
export const FIRST_PARTY_STARTER_SEED_SOURCE = 'first-party-starters'

/** The artifact type, restated from `SITE_STARTER_ARTIFACT_TYPE` and checked against it when the modules load. */
const SITE_STARTER = 'siteStarter'

/** The token a page and the layout render as the site's own name (`{{host.businessName}}`). */
export const SITE_NAME_TOKEN = '{{host.businessName}}'

/**
 * A stand-in screen id for the default layout's links to Home. The layout
 * links to Home by id, and a starter's pages have no ids until a site is
 * created from it, so the published layout links by slug instead.
 */
const HOME_LINK_PLACEHOLDER = 'first-party-starter-home'

/** The category a first-party starter is created under (`LISTING_CATEGORIES`). */
const STARTER_CATEGORY = 'design'

/** Fields a run writes only when it creates the listing; staff edit them after. */
export const FIRST_PARTY_STARTER_STAFF_OWNED_FIELDS = Object.freeze([
  'displayName',
  'description',
  'category',
  'priceUsd',
  'previewImageUrl',
  'reviewStatus',
])

/** Fields every run rewrites, besides the derived query fields and the version. */
export const FIRST_PARTY_STARTER_SEED_OWNED_FIELDS = Object.freeze([
  'artifactType',
  'profileId',
  'official',
  'starterKind',
  'starterBase',
  'starterFonts',
  'starterPages',
  'starterMode',
  'screenCount',
  'seedSource',
])

/** Where each module the plan reads lives, relative to the repository root. */
export const FIRST_PARTY_STARTER_MODULE_PATHS = Object.freeze({
  defaultSite: 'libs/aglyn/src/lib/app-utils/default-site.ts',
  siteStarter: 'libs/aglyn/src/lib/app-utils/site-starter.ts',
  links: 'libs/aglyn/src/lib/app-utils/site-starter-links.ts',
  starterNodes: 'libs/aglyn/src/lib/app-utils/site-starter-nodes.ts',
  canvas: 'libs/aglyn/src/lib/foundation/constants/canvas.ts',
  fontPairings: 'libs/aglyn/src/lib/app-utils/site-font-pairings.ts',
  kinds: 'libs/plugins/ai/src/lib/model/ai-site-kinds.ts',
  look: 'libs/plugins/ai/src/lib/model/ai-site-look.ts',
  presets: 'libs/plugins/themes/src/lib/presets/index.ts',
  agreement: 'libs/plugins/marketplace/src/lib/model/publisher-agreement.ts',
})

/**
 * The id of a first-party starter listing: `fp-starter-default` for the
 * starter site, `fp-starter-{kind}-base` and `fp-starter-{kind}-ai` for a
 * kind. A key function rather than an inline template, so the scheme is
 * written once and every reader of the id calls it (`check:id-minting`).
 */
export function firstPartyStarterListingId(kind, mode = 'base') {
  if (!kind) return 'fp-starter-default'
  return `fp-starter-${kind}-${mode === 'ai' ? 'ai' : 'base'}`
}

/**
 * Loads what the plan is built from, through `jiti`. `importModule` is the
 * workspace importer, injectable so a test can stand in for one module.
 */
export async function loadFirstPartyStarterSources(importModule = importWorkspaceModule) {
  const paths = FIRST_PARTY_STARTER_MODULE_PATHS
  const [defaultSite, siteStarter, links, starterNodes, canvas, fontPairings, kinds, look, presets, agreement] = await Promise.all(
    [
      paths.defaultSite,
      paths.siteStarter,
      paths.links,
      paths.starterNodes,
      paths.canvas,
      paths.fontPairings,
      paths.kinds,
      paths.look,
      paths.presets,
      paths.agreement,
    ].map((path) => importModule(path)),
  )
  if (siteStarter.SITE_STARTER_ARTIFACT_TYPE !== SITE_STARTER) {
    throw new Error(`site-starter.ts lists starters as "${siteStarter.SITE_STARTER_ARTIFACT_TYPE}", not "${SITE_STARTER}"`)
  }
  if (typeof links.starterLinksBySlug !== 'function') {
    throw new Error(`${paths.links} does not export starterLinksBySlug`)
  }
  if (typeof look.aiSiteKindDefaultLook !== 'function') {
    throw new Error(`${paths.look} does not export aiSiteKindDefaultLook`)
  }
  if (typeof starterNodes.sanitizeSiteStarterNodes !== 'function') {
    throw new Error(`${paths.starterNodes} does not export sanitizeSiteStarterNodes`)
  }
  return {
    core: {
      buildDefaultHomeScreen: defaultSite.buildDefaultHomeScreen,
      buildDefaultSiteLayout: defaultSite.buildDefaultSiteLayout,
      defaultHomeDescription: defaultSite.defaultHomeDescription,
      siteStarterFacetFields: siteStarter.siteStarterFacetFields,
      siteStarterRefusal: siteStarter.siteStarterRefusal,
      starterLinksBySlug: links.starterLinksBySlug,
      sanitizeSiteStarterNodes: starterNodes.sanitizeSiteStarterNodes,
      layoutSlotId: starterNodes.SITE_STARTER_LAYOUT_SLOT_ID,
      canvasRootId: canvas.CANVAS_ROOT_ELEMENT_ID,
      aiSiteKindDefaultLook: look.aiSiteKindDefaultLook,
    },
    kinds: kinds.AI_SITE_KINDS,
    pairings: fontPairings.SITE_FONT_PAIRINGS,
    presets: presets.THEME_PRESETS,
    bases: siteStarter.SITE_THEME_BASES,
    agreement: {
      version: agreement.PUBLISHER_AGREEMENT_VERSION,
      isCurrent: agreement.hasCurrentPublisherAgreement,
    },
  }
}

/** A value as Firestore stores it: no `undefined`, plain arrays and maps. */
const asStored = (value) => JSON.parse(JSON.stringify(value))

/** Every string prop in a node map that still holds `needle`, as `node.prop`. */
function propsHolding(nodes, needle) {
  const found = []
  for (const [id, node] of Object.entries(nodes ?? {})) {
    for (const [key, value] of Object.entries(node?.props ?? {})) {
      if (value === needle) found.push(`${id}.${key}`)
    }
  }
  return found
}

/**
 * The starter site's Home page and its layout, as a starter carries them:
 * the site's name as the token every site renders as its own, the page's
 * search title and description in words that suit any site, and the layout's
 * links to Home by slug.
 *
 * Both pass through `sanitizeSiteStarterNodes` in the order the publish door
 * runs it (the starter rule, then the links by slug), so they are stored as a
 * published starter's are. The starter site must come through it whole: a
 * refusal, a node dropped or a layout without its content slot fails the
 * plan, because the listing would no longer be the site a new site starts as.
 */
function starterSitePages(core) {
  const home = core.buildDefaultHomeScreen(SITE_NAME_TOKEN)
  const layout = core.buildDefaultSiteLayout(HOME_LINK_PLACEHOLDER)
  const page = starterNodesWhole(core, "The starter site's Home page", home.nodes, {})
  const chrome = starterNodesWhole(core, "The starter site's layout", layout.nodes, { layout: true })
  if (!Object.values(chrome).some((node) => node?.componentId === core.layoutSlotId)) {
    throw new Error("The starter site's layout has no content slot after the starter rule")
  }
  const nodes = core.starterLinksBySlug(chrome, { [HOME_LINK_PLACEHOLDER]: home.slug })
  const unlinked = propsHolding(nodes, HOME_LINK_PLACEHOLDER)
  if (unlinked.length) {
    throw new Error(`starterLinksBySlug left the layout linking to Home by id (${unlinked.join(', ')})`)
  }
  return {
    screens: [
      {
        displayName: home.displayName,
        slug: home.slug,
        // The token is for text on the page; whether a page's SEO fields
        // fill it in is not established, so they say nothing site-specific.
        seo: { title: home.displayName, description: core.defaultHomeDescription('') },
        nodes: page,
      },
    ],
    layout: { displayName: layout.displayName, description: layout.description, nodes },
  }
}

/**
 * A page's or layout's nodes through the starter rule, rooted where the
 * publish door roots them, with every node kept; throws otherwise.
 */
function starterNodesWhole(core, what, nodes, options) {
  const rootId = nodes?.[core.canvasRootId]
    ? core.canvasRootId
    : (Object.keys(nodes ?? {}).find((id) => !nodes[id]?.parentId) ?? '')
  const sanitized = core.sanitizeSiteStarterNodes({ rootId, nodes }, options)
  if (sanitized.ok === false) throw new Error(`${what}: ${sanitized.error}`)
  const dropped = Object.keys(nodes).filter((id) => !(id in sanitized.nodes))
  if (dropped.length) throw new Error(`${what}: the starter rule dropped ${dropped.join(', ')}`)
  return sanitized.nodes
}

/**
 * A kind's look as a starter names it: its first base theme the platform has
 * (`starter`, or a built-in preset), its first font pairing, and a brand
 * primary from its first hue range. One derivation, the AI plugin's
 * `aiSiteKindDefaultLook`, which is also the look a site created in that
 * style starts with (AGL-4049), so the two never drift apart.
 */
function kindLook(kind, { core, presetIds, pairingIds }) {
  const look = core.aiSiteKindDefaultLook(kind, { presetIds, pairingIds })
  return { base: look.theme.base, fonts: look.theme.fonts, brand: look.theme.brand, answerStyle: look.answerStyle }
}

/**
 * Every first-party starter listing, in the order they are listed: the
 * starter site first, then each kind's base starter and AI starter.
 *
 * Each entry is `{ listingId, order, listing, version: { starter } }`, where
 * `listing` holds every field a new listing is created with, and `order` is
 * its place in the list. Throws, naming the listing, when a payload is one
 * `siteStarterRefusal` refuses: a starter that cannot start a site is never
 * planned.
 */
export function buildFirstPartyStarterPlan({ orgId, kinds, pairings, presets, bases, core }) {
  if (typeof orgId !== 'string' || !orgId.trim()) throw new Error('An org id is required')
  const pairingIds = new Set(pairings.map((pairing) => pairing.id))
  const presetIds = new Set(presets.map((preset) => preset.id))
  const known = {
    kinds: new Set(kinds.map((kind) => kind.id)),
    bases: new Set(bases),
    fonts: pairingIds,
  }
  const pages = starterSitePages(core)

  const rows = [
    {
      listingId: firstPartyStarterListingId(null),
      displayName: 'Starter site',
      description:
        "The site every new site starts as: a Home page with the sections most sites need, a header and " +
        "footer every page shares, and your site's name filled in.",
      facets: { kind: null, base: 'starter', fonts: null, pages: pages.screens.length, mode: 'base' },
      theme: { kind: 'builtin', base: 'starter', brand: { light: {} }, fonts: null },
    },
  ]
  for (const kind of kinds) {
    const look = kindLook(kind, { core, presetIds, pairingIds })
    const theme = { kind: 'builtin', base: look.base, brand: look.brand, fonts: look.fonts }
    const facets = { kind: kind.id, base: look.base, fonts: look.fonts, pages: pages.screens.length }
    rows.push({
      listingId: firstPartyStarterListingId(kind.id, 'base'),
      displayName: kind.label,
      description: `${kind.blurb}. Starts with the starter site's pages, in a theme, colors and fonts that suit this kind of site.`,
      facets: { ...facets, mode: 'base' },
      theme,
    })
    rows.push({
      listingId: firstPartyStarterListingId(kind.id, 'ai'),
      displayName: `${kind.label} with AI`,
      description: `${kind.blurb}. The AI start asks about your business and writes the pages for it, in a theme, colors and fonts that suit this kind of site.`,
      facets: { ...facets, mode: 'ai' },
      theme,
      answers: {
        kind: kind.id,
        style: look.answerStyle,
        fonts: look.fonts,
        brandColors: look.brand.light,
        pages: kind.pages,
        brief: '',
      },
    })
  }

  return rows.map((row, order) => {
    const starter = asStored({
      mode: row.facets.mode,
      facets: row.facets,
      theme: row.theme,
      screens: pages.screens,
      layout: pages.layout,
      ...(row.answers ? { answers: row.answers } : {}),
    })
    const refusal = core.siteStarterRefusal(starter, known)
    if (refusal) throw new Error(`${row.listingId}: ${refusal}`)
    return {
      listingId: row.listingId,
      order,
      listing: {
        artifactType: SITE_STARTER,
        profileId: orgId,
        official: true,
        ...core.siteStarterFacetFields(row.facets),
        screenCount: starter.screens.length,
        seedSource: FIRST_PARTY_STARTER_SEED_SOURCE,
        displayName: row.displayName,
        description: row.description,
        category: STARTER_CATEGORY,
        priceUsd: 0,
        reviewStatus: 'listed',
      },
      version: { starter },
    }
  })
}

/** A listing's fields by owner: `seed` every run rewrites, `staff` only a create writes. */
export function firstPartyStarterOwnedFields(listing) {
  const pick = (keys) => Object.fromEntries(keys.filter((key) => listing[key] !== undefined).map((key) => [key, listing[key]]))
  return { seed: pick(FIRST_PARTY_STARTER_SEED_OWNED_FIELDS), staff: pick(FIRST_PARTY_STARTER_STAFF_OWNED_FIELDS) }
}

/** A stable text form of a stored value, map keys sorted, so two reads of one value compare equal. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** Whether two stored values are the same. */
export function sameStoredValue(left, right) {
  return canonical(left) === canonical(right)
}

/**
 * What a run writes for one planned listing, given what is stored.
 *
 * `stored.listing` is the listing's data or `null`; `stored.version` is the
 * data of `versions/{latestVersion}` or `null`. `values` makes the
 * Firestore-only values (`now()` a server timestamp, `createdAt(order)` the
 * listing's creation time, `appendHistory(entry)` an array union, `publishedAt()`
 * a timestamp an array may hold), so this stays pure.
 *
 * Returns `{ action: 'create' | 'update' | 'unchanged', listingWrite,
 * versionWrite, version, seedChanges, staffDrift }`: `listingWrite` a
 * merge-set patch or `null`, `versionWrite` `{ version, data }` or `null`,
 * `version` the latest version once written. `staffDrift` lists the staff-owned
 * fields the stored listing holds differently from the plan, never written.
 * Throws when the stored listing is not this seed's, or not this org's.
 */
export function reconcileFirstPartyStarter(entry, stored, values) {
  const existing = stored?.listing ?? null
  const planned = firstPartyStarterOwnedFields(entry.listing)

  if (!existing) {
    const listing = { ...planned.seed, ...planned.staff, deletedAt: null }
    return {
      action: 'create',
      listingWrite: {
        ...listing,
        ...listingQueryFieldsPatch(listing),
        latestVersion: 1,
        versionHistory: values.appendHistory({ version: 1, publishedAt: values.publishedAt() }),
        createdAt: values.createdAt(entry.order),
        updatedAt: values.now(),
      },
      versionWrite: { version: 1, data: { ...entry.version, publishedAt: values.now() } },
      version: 1,
      seedChanges: Object.keys(planned.seed),
      staffDrift: [],
    }
  }

  if (existing.seedSource !== FIRST_PARTY_STARTER_SEED_SOURCE) {
    throw new Error(`${entry.listingId} exists and was not written by this seed; refusing to change it`)
  }
  if (existing.profileId !== entry.listing.profileId) {
    throw new Error(`${entry.listingId} belongs to org ${existing.profileId}, not ${entry.listing.profileId}; refusing to move it`)
  }

  const seedChanges = Object.keys(planned.seed).filter((key) => !sameStoredValue(existing[key], planned.seed[key]))
  const staffDrift = Object.keys(planned.staff)
    .filter((key) => !sameStoredValue(existing[key], planned.staff[key]))
    .map((field) => ({ field, stored: existing[field] ?? null, planned: planned.staff[field] }))

  const latest = Number(existing.latestVersion ?? 0)
  const sameVersion = latest > 0 && sameStoredValue(stored.version?.starter, entry.version.starter)
  const version = sameVersion ? latest : latest + 1

  const patch = Object.fromEntries(seedChanges.map((key) => [key, planned.seed[key]]))
  Object.assign(patch, listingQueryFieldsPatch({ ...existing, ...patch }) ?? {})
  if (!sameVersion) {
    patch.latestVersion = version
    patch.versionHistory = values.appendHistory({ version, publishedAt: values.publishedAt() })
  }
  if (!Object.keys(patch).length) {
    return { action: 'unchanged', listingWrite: null, versionWrite: null, version, seedChanges, staffDrift }
  }
  return {
    action: 'update',
    listingWrite: { ...patch, updatedAt: values.now() },
    versionWrite: sameVersion ? null : { version, data: { ...entry.version, publishedAt: values.now() } },
    version,
    seedChanges,
    staffDrift,
  }
}
