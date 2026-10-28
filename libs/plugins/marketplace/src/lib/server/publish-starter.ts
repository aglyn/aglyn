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

import { displayNameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import {
  SITE_STARTER_ARTIFACT_TYPE,
  SITE_STARTER_MAX_SCREENS,
  siteStarterFacetFields,
  siteStarterRefusal,
  type SiteStarterFacets,
  type SiteStarterMode,
  type SiteStarterPayload,
  type SiteStarterTheme,
} from '@aglyn/aglyn/app-utils/site-starter'
import { starterLinksBySlug } from '@aglyn/aglyn/app-utils/site-starter-links'
import {
  sanitizeSiteStarterNodes,
  SITE_STARTER_LAYOUT_SLOT_ID,
} from '@aglyn/aglyn/app-utils/site-starter-nodes'
import {
  hostThemeSource,
  parseColor,
  resolveSiteTheme,
  themeArtifactContent,
  validateThemeForPublish,
  type ThemeHostDocument,
} from '@aglyn/aglyn/app-utils/site-theme'
import {
  CANVAS_ROOT_ELEMENT_ID,
  checkEntitlement,
  createResourceUid,
  decodeStoredNodes,
} from '@aglyn/aglyn/server'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { marketplacePriceRefusal } from '../model/marketplace'
import { sanitizeMarketplaceProps } from '../model/marketplace-props'
import { SITE_STARTER_KNOWN_IDS } from '../model/site-starter-listing'
import { resolvePublisherProfile } from './publisher-profile'
import { publishPreconditionRefusal } from './publish-preconditions'
import { listingSubmissionRefusal } from './listing-screen'
import { refreshListingQueryFields } from './listing-query-fields'

/** The accents a built-in starter theme's brand may name. */
const BRAND_KEYS = ['primary', 'secondary', 'tertiary'] as const

/** The most an AI starter's answers may hold, as JSON. */
const MAX_ANSWERS_BYTES = 16 * 1024

/**
 * The most a starter's stored version may hold, as JSON: every page and the
 * layout ride one version document, and Firestore refuses a document over
 * 1 MiB, so a site past this is refused here, in words, rather than failing
 * the write.
 */
const MAX_STARTER_BYTES = 900 * 1024

/** A facet as the body sends it: a trimmed id, or null for none. */
const facetId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

type BuiltinTheme = Extract<SiteStarterTheme, { kind: 'builtin' }>

/**
 * The body's built-in theme, or why it cannot be one. The brand names the
 * site's accents only, each a color the theme can use: status colors stay the
 * base theme's, since they mean the same thing on every site.
 */
function builtinTheme(raw: Record<string, unknown>): BuiltinTheme | string {
  const base = facetId(raw['base'])
  if (!base) return 'Choose the built-in theme the starter uses'
  const fonts = raw['fonts'] == null ? null : facetId(raw['fonts'])
  if (raw['fonts'] != null && !fonts) return 'The font pairing must be a pairing id, or none'
  const brandIn = isRecord(raw['brand']) ? raw['brand'] : {}
  const brand: BuiltinTheme['brand'] = { light: {} }
  for (const scheme of ['light', 'dark'] as const) {
    const colors = brandIn[scheme]
    if (colors === undefined || (scheme === 'dark' && colors === null)) continue
    if (!isRecord(colors)) return `The ${scheme} brand colors must be a set of colors`
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(colors)) {
      if (!(BRAND_KEYS as readonly string[]).includes(key)) {
        return `A brand color can be ${BRAND_KEYS.join(', ')}; "${key}" is not one`
      }
      if (typeof value !== 'string' || !parseColor(value)) {
        return `The ${scheme} ${key} color "${String(value)}" is not a color`
      }
      out[key] = value.trim()
    }
    brand[scheme] = out
  }
  return { kind: 'builtin', base, brand, fonts }
}

/**
 * Publishes a site as a site starter (AGL-4049): a whole site a person picks
 * in "Create site" before it exists. Captures every published page with its
 * published version, the shared layout the Home page sits in — both through
 * `sanitizeSiteStarterNodes`, the starter's own rule, which keeps what a real
 * site is made of (its grids, cards, styles and safe interactions) where the
 * portable rule the other doors use would refuse it — and the theme
 * in one of its two shapes — a built-in theme with brand colors and fonts
 * over it, named in the body, or the site's own full theme — into a
 * `siteStarter` listing that waits for review before anyone else sees it.
 *
 * Gates mirror the template door exactly: the price, org permission, site
 * role, `marketplaceSelling`, a publisher profile with payouts and the current
 * agreement, then the phishing screen before anything is listed. One listing
 * per source site, keyed on `sourceStarterHostId` (never `sourceHostId`, which
 * the template, layout and theme doors share); re-publishing bumps the
 * version and keeps the review verdict, as a plugin's does.
 */
export const publishStarterHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const body = isRecord(req.body) ? req.body : {}
  const hostId = String(body['hostId'] ?? '')
  const displayName = String(body['displayName'] ?? '').slice(0, 80)
  const description = String(body['description'] ?? '').slice(0, 500)
  const category = String(body['category'] ?? '').slice(0, 40)
  const priceUsd = Math.round(Number(body['priceUsd'] ?? 0)) || 0
  // The price floor and ceiling, from ONE validator (AGL-2343). Also enforced
  // in `publishPreconditionRefusal` below.
  const priceRefusal = marketplacePriceRefusal(priceUsd)
  if (priceRefusal) {
    return res.status(400).json({ error: priceRefusal })
  }
  if (!hostId || !displayName.trim()) {
    return res.status(400).json({ error: 'Missing hostId or displayName' })
  }
  const themeIn = isRecord(body['theme']) ? body['theme'] : {}
  if (themeIn['kind'] !== 'builtin' && themeIn['kind'] !== 'full') {
    return res.status(400).json({
      error: "Choose the starter's theme: a built-in theme, or this site's own",
    })
  }
  const mode: SiteStarterMode | null =
    body['mode'] === undefined || body['mode'] === 'base'
      ? 'base'
      : body['mode'] === 'ai'
        ? 'ai'
        : null
  if (!mode) {
    return res.status(400).json({ error: 'A starter is a base starter or an AI starter' })
  }
  const answers = body['answers']
  if (answers !== undefined && answers !== null) {
    if (!isRecord(answers)) {
      return res.status(400).json({ error: "An AI starter's answers must be a set of answers" })
    }
    if (JSON.stringify(answers).length > MAX_ANSWERS_BYTES) {
      return res.status(400).json({ error: "An AI starter's answers are too long" })
    }
  }
  const facetsIn = isRecord(body['facets']) ? body['facets'] : {}

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { hostId })
    if (!membership.permissions.publishToMarketplace) {
      return res.status(403).json({
        error: 'Your organization role does not allow publishing to the marketplace',
      })
    }
    const firestore = firebaseAdmin.app().firestore()

    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin' && memberRole !== 'editor') {
      return res.status(403).json({ error: 'Not a site admin or editor' })
    }

    // Plan gate rides the owning org's doc (AGL-238).
    const orgForHost = await getOrgForHost(hostId)
    const org = orgForHost?.org ?? {}
    if (!checkEntitlement(org as any, 'marketplaceSelling')) {
      return res.status(403).json({
        error: 'Publishing to the marketplace requires a Pro plan',
      })
    }
    if (!orgForHost?.orgId) {
      return res.status(409).json({ error: 'Site has no owning organization' })
    }

    // Publishing is ORG-ONLY (AGL-652).
    const publisher = await resolvePublisherProfile(firestore, orgForHost.orgId)
    // Profile, payouts AND the publisher agreement, in one gate (AGL-2282).
    const refusal = publishPreconditionRefusal(publisher, {
      priceUsd,
      sells: 'site starters',
    })
    if (refusal) return res.status(refusal.status).json(refusal.body)

    // Capture: every page in the routing map, with its published version,
    // under the starter rule (`site-starter-nodes.ts`). One past the most a starter
    // may have, so an oversized site is refused by the one validity check
    // below rather than silently cut short.
    const routingMap = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
    const screenIds = Object.keys(routingMap).slice(0, SITE_STARTER_MAX_SCREENS + 1)
    const captured: Array<{ id: string; layoutId: string | null; screen: Record<string, unknown> }> = []
    for (const screenId of screenIds) {
      const screenRef = hostRef.collection('screens').doc(screenId)
      const screen = (await screenRef.get()).data() as any
      if (!screen || screen.deletedAt || !screen.versionId) continue
      const versionSnapshot = await screenRef
        .collection('versions')
        .doc(String(screen.versionId))
        .get()
      // The besigner writes `nodes` COMPRESSED, which the Admin SDK hands back
      // as a Node `Buffer` (AGL-1395): decode before anything reads it.
      const nodes = decodeStoredNodes(versionSnapshot.get('nodes'))
      if (!nodes) continue
      const sanitized = sanitizeSiteStarterNodes({
        rootId: CANVAS_ROOT_ELEMENT_ID,
        nodes: nodes as Record<string, any>,
      })
      if (sanitized.ok === false) {
        return res.status(422).json({
          error: `Page "${screen.displayName ?? screenId}": ${sanitized.error}`,
        })
      }
      captured.push({
        id: screenId,
        layoutId: typeof screen.layoutId === 'string' && screen.layoutId ? screen.layoutId : null,
        screen: {
          displayName: screen.displayName ?? 'Page',
          slug: routingMap[screenId],
          ...(screen.description && { description: screen.description }),
          ...(screen.seo && { seo: screen.seo }),
          nodes: sanitized.nodes,
        },
      })
    }
    // A link to another page names it by slug in the starter: its pages have
    // no ids until a site is created from it (`site-starter-links.ts`).
    const routing: Record<string, string> = Object.fromEntries(
      captured.map(({ id }) => [id, routingMap[id]]),
    )
    const screens = captured.map(({ screen }) => ({
      ...screen,
      nodes: starterLinksBySlug(screen['nodes'] as Record<string, any>, routing),
    }))

    // The shared layout the Home page sits in: one per starter, since a new
    // site on the Free plan has room for one.
    const home = captured.find(({ id }) => routingMap[id] === '/')
    let layout: Record<string, unknown> | null = null
    if (home?.layoutId) {
      const layoutRef = hostRef.collection('layouts').doc(home.layoutId)
      const layoutSnapshot = await layoutRef.get()
      const versionId = layoutSnapshot.exists ? layoutSnapshot.get('versionId') : null
      const versionSnapshot = versionId
        ? await layoutRef.collection('versions').doc(String(versionId)).get()
        : null
      const nodes = versionSnapshot
        ? decodeStoredNodes<Record<string, any>>(versionSnapshot.get('nodes'))
        : null
      if (nodes && Object.keys(nodes).length) {
        // The layout properties its tree binds to (AGL-2933).
        const props = sanitizeMarketplaceProps(versionSnapshot?.get('props'))
        if (props.ok === false) {
          return res.status(422).json({ error: props.error })
        }
        const rootId: string =
          (nodes[CANVAS_ROOT_ELEMENT_ID] && CANVAS_ROOT_ELEMENT_ID) ||
          Object.keys(nodes).find((id) => !nodes[id]?.parentId) ||
          ''
        const sanitized = sanitizeSiteStarterNodes(
          { rootId, nodes },
          { layout: true, declaredProps: props.props },
        )
        if (sanitized.ok === false) {
          return res.status(422).json({ error: `The site's layout: ${sanitized.error}` })
        }
        // A layout whose slot did not survive renders every page as chrome
        // with the page missing.
        const hasSlot = Object.values(sanitized.nodes).some(
          (node: any) => node.componentId === SITE_STARTER_LAYOUT_SLOT_ID,
        )
        if (!hasSlot) {
          return res.status(422).json({
            error:
              "The site's layout has no content slot, so pages using it would " +
              'have nowhere to render',
          })
        }
        layout = {
          displayName: String(layoutSnapshot.get('displayName') ?? 'Site header and footer'),
          nodes: starterLinksBySlug(sanitized.nodes, routing),
          ...(props.props.length && { props: props.props }),
        }
      }
    }

    // The theme, in the shape the publisher chose.
    let theme: SiteStarterTheme
    if (themeIn['kind'] === 'full') {
      // What this site DESIGNED: on an installed theme, the theme as stored
      // (its edits are this site's private changes to someone else's
      // artifact); otherwise the resolved view, edits included (AGL-3404).
      const host = (hostSnapshot.data() ?? {}) as ThemeHostDocument
      const full = themeArtifactContent(
        hostThemeSource(host) === 'installed' ? (host.theme ?? {}) : (resolveSiteTheme(host) ?? {}),
      )
      const validation = validateThemeForPublish(full)
      if (!validation.ok) {
        return res.status(422).json({
          error: validation.errors[0]?.message ?? 'This theme is not publishable',
          errors: validation.errors,
          warnings: validation.warnings,
        })
      }
      theme = { kind: 'full', theme: full }
    } else {
      const builtin = builtinTheme(themeIn)
      if (typeof builtin === 'string') return res.status(422).json({ error: builtin })
      theme = builtin
    }

    // A built-in theme is what the starter's base and fonts facets describe;
    // a full theme is the publisher's to describe.
    const facets: SiteStarterFacets = {
      kind: facetId(facetsIn['kind']),
      base: theme.kind === 'builtin' ? theme.base : facetId(facetsIn['base']),
      fonts: theme.kind === 'builtin' ? theme.fonts : facetId(facetsIn['fonts']),
      pages: screens.length,
      mode,
    }
    const payload: SiteStarterPayload = {
      mode,
      facets,
      theme,
      screens,
      layout,
      ...(isRecord(answers) && { answers }),
    }
    // The one validity check, run here, at seed and again at resolve.
    const invalid = siteStarterRefusal(payload, SITE_STARTER_KNOWN_IDS)
    if (invalid) return res.status(422).json({ error: invalid })
    const bytes = JSON.stringify(payload).length
    if (bytes > MAX_STARTER_BYTES) {
      return res.status(422).json({
        error:
          `This site is too large to publish as one starter: its pages come to ` +
          `${Math.ceil(bytes / 1024)} KB, and a starter holds at most ` +
          `${MAX_STARTER_BYTES / 1024} KB. Publish fewer pages, or smaller ones.`,
      })
    }

    // One starter listing per source site; re-publish bumps the version.
    const existing = await firestore
      .collection('marketplaceListings')
      .where('profileId', '==', publisher.orgId)
      .where('sourceStarterHostId', '==', hostId)
      .limit(1)
      .get()
    const listingRef = existing.empty
      ? firestore.collection('marketplaceListings').doc(createResourceUid())
      : existing.docs[0].ref
    const version = existing.empty
      ? 1
      : Number(existing.docs[0].get('latestVersion') ?? 0) + 1
    const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()

    // The phishing screen, before anything is listed (AGL-3365): every page,
    // the layout every page sits in, and the answers an AI starter writes from.
    const screened = await listingSubmissionRefusal({
      publisherOrgId: publisher.orgId,
      content: {
        displayName,
        publisherName: publisher.displayName,
        description,
        ...(isRecord(answers) && { readme: JSON.stringify(answers) }),
        pageNodes: [...screens, ...(layout ? [layout] : [])],
      },
      official: decoded['staff'] === true,
      org: orgForHost.org ?? null,
    })
    if (screened) return res.status(screened.status).json(screened.body)

    // The version before the listing that names it, so a pick made between
    // the two writes never finds a `latestVersion` with nothing stored at it.
    await listingRef.collection('versions').doc(String(version)).set({
      starter: payload,
      publishedAt: now,
    })
    await listingRef.set(
      {
        artifactType: SITE_STARTER_ARTIFACT_TYPE,
        profileId: publisher.orgId,
        sourceStarterHostId: hostId,
        displayName: displayName.trim(),
        // The keys a listing is searched by (AGL-3321).
        ...displayNameSearchFields(displayName.trim()),
        ...(description.trim() && { description: description.trim() }),
        ...(category.trim() && { category: category.trim() }),
        priceUsd,
        screenCount: screens.length,
        latestVersion: version,
        deletedAt: null,
        // A starter creates a whole site the moment it is picked, so a new one
        // waits for review (AGL-4049); a re-publish keeps the verdict it has.
        // `official` is never written here: it is the platform's to set.
        ...(existing.empty && { reviewStatus: 'submitted', createdAt: now }),
        ...siteStarterFacetFields(facets),
        updatedAt: now,
        versionHistory: firebaseAdmin.firestore.FieldValue.arrayUnion({
          version,
          publishedAt: firebaseAdmin.firestore.Timestamp.now(),
        }),
      },
      { merge: true },
    )
    // The lists this listing appears in query by fields derived from it (AGL-3321).
    await refreshListingQueryFields(listingRef)

    return res.status(200).json({ listingId: listingRef.id, version })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Starter publish failed' })
  }
}

export default publishStarterHandler
