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

import { artifactCreateListKeys } from '@aglyn/aglyn/app-utils/artifact-list-keys'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-slug'
import type {
  SiteStarterChoice,
  SiteStarterPayload,
} from '@aglyn/aglyn/app-utils/site-starter'
import { starterLinksById } from '@aglyn/aglyn/app-utils/site-starter-links'
import { planSiteStarterTheme } from '@aglyn/aglyn/app-utils/site-starter-theme'
import { encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import {
  THEME_LIBRARY_COLLECTION,
  type ThemeLibraryEntryWrite,
} from '@aglyn/aglyn/app-utils/theme-library'
import { listServerThemePresets } from '@aglyn/aglyn/plugin-manager/plugin-theme-presets'
import {
  FieldValue,
  type DocumentReference,
  type Transaction,
} from 'firebase-admin/firestore'

/**
 * A site created from a site starter (AGL-4049): the starter twin of the
 * default site's writes (`defaultSiteWrites` and `queueStarterPages` in the
 * console's `provision-host.ts`), written by the same create transaction.
 *
 * Every page the starter carries becomes a page of the new site, its first
 * version holding the starter's nodes; the shared layout becomes the site's
 * header and footer, and every page sits in it; the theme is planned against
 * the empty host (`planSiteStarterTheme`). A page routed in the starter is
 * routed and published on the new site, and the Home page at `/` is named
 * `defaultHomeScreenId`: the platform-made page the owner's own home page
 * replaces (AGL-3478). A page with no address, or one the starter marks
 * unpublished, is a draft.
 *
 * Nodes are copied as published. A link to another page travels by slug in
 * the starter (`site-starter-links.ts`) and becomes the new page's id here;
 * a token such as `{{host.businessName}}` renders per site on its own, so
 * nothing is substituted.
 */

/** A starter resolved for a create: its payload, and the listing it came from. */
export interface SiteStarterInstall {
  payload: SiteStarterPayload
  /**
   * The listing it came from. `kind` is the kind of site the listing names
   * (AGL-4049), which the site records over the one its stored pages carry:
   * a listing's kind is kept current by its publisher and by staff.
   */
  listing: { listingId: string; version: string | number; displayName: string; kind?: string | null }
}

/** Every document a starter's site is born with, ids minted, ready to queue. */
export interface SiteStarterWrites {
  /** The Home page at `/`; `null` only for a payload that failed its check. */
  homeScreenId: string | null
  /** Every published page: screen id → slug, the host's `screens` map. */
  routing: Record<string, string>
  screens: Array<{
    id: string
    versionId: string
    screen: Record<string, unknown>
    version: Record<string, unknown>
  }>
  layout: {
    id: string
    versionId: string
    layout: Record<string, unknown>
    version: Record<string, unknown>
  }
  /** Theme fields for the host's create, from `planSiteStarterTheme`. */
  host: Record<string, unknown>
  /** Theme library entries to create under the host. */
  themeEntries: ThemeLibraryEntryWrite[]
}

const isRecord = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/** Nodes as a version stores them: msgpack at rest, as `/api/hosts/versions` writes them. */
function storedNodes(nodes: Record<string, unknown>): unknown {
  const packed = encodeStoredNodes(nodes)
  return packed ? Buffer.from(packed) : nodes
}

/**
 * The documents a site created from `install` starts with, every id minted:
 * the pages' ids first, so each page's links and the layout's can name them.
 */
export function siteStarterWrites(install: SiteStarterInstall): SiteStarterWrites {
  const now = () => FieldValue.serverTimestamp()
  const payload = install.payload
  const pages = (Array.isArray(payload.screens) ? payload.screens : [])
    .filter(isRecord)
    .map((screen) => ({ screen, id: createResourceUid(), versionId: createResourceUid() }))
  const layoutId = createResourceUid()
  const layoutVersionId = createResourceUid()

  // Routed: a page with an address that is not marked unpublished, the
  // first to claim an address keeping it. Links resolve to routed pages
  // first, then to a draft that names an address nobody routes.
  const routing: Record<string, string> = {}
  const slugToId: Record<string, string> = {}
  const routed = new Set<string>()
  for (const page of pages) {
    const slug = text(page.screen['slug'])
    if (!slug || page.screen['published'] === false || slug in slugToId) continue
    routing[page.id] = slug
    slugToId[slug] = page.id
    routed.add(page.id)
  }
  for (const page of pages) {
    const slug = text(page.screen['slug'])
    if (slug && !(slug in slugToId)) slugToId[slug] = page.id
  }
  const homeScreenId =
    Object.keys(routing).find((id) => routing[id] === SCREEN_ROOT_PATH) ?? null

  const screens = pages.map(({ screen, id, versionId }) => {
    const isRouted = routed.has(id)
    const fields = {
      displayName: text(screen['displayName']) || 'Page',
      ...(isRouted ? { slug: routing[id] } : {}),
      versionId,
    }
    const description = text(screen['description'])
    const nodes = starterLinksById(isRecord(screen['nodes']) ? screen['nodes'] : {}, slugToId)
    return {
      id,
      versionId,
      screen: {
        ...fields,
        ...artifactCreateListKeys('screens', fields),
        layoutId,
        ...(isRecord(screen['seo']) ? { seo: screen['seo'] } : {}),
        ...(description ? { description } : {}),
        // What `publishScreenRoute` stamps, so the console lists a routed
        // page as Published rather than as a draft that happens to be served.
        ...(isRouted ? { publishedAt: now() } : {}),
        createdAt: now(),
        updatedAt: now(),
      },
      version: {
        screenId: id,
        displayName: 'Initial version',
        nodes: storedNodes(nodes),
        createdAt: now(),
        updatedAt: now(),
      },
    }
  })

  const source = isRecord(payload.layout) ? payload.layout : {}
  const layoutFields = {
    displayName: text(source['displayName']) || 'Site header and footer',
    versionId: layoutVersionId,
  }
  const layoutDescription = text(source['description'])
  const layoutNodes = starterLinksById(isRecord(source['nodes']) ? source['nodes'] : {}, slugToId)
  const props = Array.isArray(source['props']) && source['props'].length ? source['props'] : null

  const theme = planSiteStarterTheme({
    theme: payload.theme,
    presets: listServerThemePresets(),
    listing: install.listing,
    newId: createResourceUid,
  })

  return {
    homeScreenId,
    routing,
    screens,
    layout: {
      id: layoutId,
      versionId: layoutVersionId,
      layout: {
        ...layoutFields,
        ...artifactCreateListKeys('layouts', layoutFields),
        ...(layoutDescription ? { description: layoutDescription } : {}),
        createdAt: now(),
        updatedAt: now(),
      },
      version: {
        layoutId,
        displayName: 'Initial version',
        nodes: storedNodes(layoutNodes),
        // The properties the layout's tree binds to (AGL-2932), on the
        // version it is served from, as Use template writes them.
        ...(props ? { props } : {}),
        createdAt: now(),
        updatedAt: now(),
      },
    },
    host: theme.host,
    themeEntries: theme.entries,
  }
}

/**
 * Queues a starter's documents in the create transaction: every page and its
 * first version, the layout and its first version (which carries the host
 * id, as the default layout's does), and the theme library entries. An empty
 * host's theme plan creates entries and nothing else, so a create is all a
 * new site's library takes.
 */
export function queueSiteStarterWrites(
  tx: Transaction,
  hostRef: DocumentReference,
  hostId: string,
  writes: SiteStarterWrites,
): void {
  for (const page of writes.screens) {
    const pageRef = hostRef.collection('screens').doc(page.id)
    tx.set(pageRef, page.screen)
    tx.set(pageRef.collection('versions').doc(page.versionId), page.version)
  }
  const layoutRef = hostRef.collection('layouts').doc(writes.layout.id)
  tx.set(layoutRef, writes.layout.layout)
  tx.set(layoutRef.collection('versions').doc(writes.layout.versionId), {
    ...writes.layout.version,
    hostId,
  })
  const library = hostRef.collection(THEME_LIBRARY_COLLECTION)
  for (const entry of writes.themeEntries) {
    if (entry.op !== 'create') continue
    tx.set(library.doc(entry.id), {
      ...(entry.data as unknown as Record<string, unknown>),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
}

/** A listing id as a document id may be one: no path separator, nothing reserved. */
const LISTING_ID = /^[A-Za-z0-9_-]{1,128}$/
/** A pinned version: the number of one of the listing's versions. */
const LISTING_VERSION = /^[1-9][0-9]{0,8}$/

/**
 * A create request's starter pick (`body.starter`), or `null` when it is not
 * one: an object naming a listing id, and optionally the version it pins.
 * The id becomes a document path on the way to the listing, so anything that
 * could name another document is not a pick.
 */
export function readSiteStarterChoice(value: unknown): SiteStarterChoice | null {
  if (!isRecord(value)) return null
  const listingId = text(value['listingId'])
  if (!LISTING_ID.test(listingId) || /^__.*__$/.test(listingId)) return null
  const pinned = value['version']
  if (pinned === undefined || pinned === null) return { listingId }
  const version = typeof pinned === 'number' ? String(pinned) : text(pinned)
  return LISTING_VERSION.test(version) ? { listingId, version } : null
}

/** The answer a create gives a starter pick it refuses: a status and its JSON body. */
export interface SiteStarterPickRefusal {
  status: number
  body: Record<string, unknown>
}

/**
 * Why a create refuses the starter it was asked for, or `null` when the
 * site can be created from it (AGL-4049). Every refusal is decided before the
 * site exists, so a refused pick creates nothing, and a 402 is answered with
 * what the person needs to buy it: the listing and its price. Once bought,
 * the same request again creates the site. Every refusal names the listing
 * it refused, so Create site can tell a refused pick from a refused name.
 *
 * `resolved` is what the starter source answered; `pagesAllowed` is the
 * plan's `screensPerHost`. `aiStart` is whether the person creating the site
 * is offered the AI start (AGL-4049 phase 4): an AI starter fills in its
 * questions, so without it there is nothing to create one from, and with it
 * the site is created empty for the start, whose own page band applies.
 */
export function siteStarterPickRefusal(
  resolved: SiteStarterPayload | { error: string; status: 402 | 403 | 404; priceUsd?: number },
  input: { listingId: string; pagesAllowed: number; aiStart?: boolean },
): SiteStarterPickRefusal | null {
  if (!isRecord(resolved)) {
    return { status: 404, body: { error: 'That starter is no longer available', listingId: input.listingId } }
  }
  if ('error' in resolved) {
    const status = [402, 403, 404].includes(resolved.status) ? resolved.status : 404
    return {
      status,
      body: {
        error: resolved.error,
        ...(status === 402 ? { code: 'purchase_required' } : {}),
        listingId: input.listingId,
        ...(typeof resolved.priceUsd === 'number' ? { priceUsd: resolved.priceUsd } : {}),
      },
    }
  }
  if (resolved.mode === 'ai') {
    if (input.aiStart === true) return null
    return {
      status: 409,
      body: {
        error: 'This starter needs the AI start, which is not available to you in this workspace',
        listingId: input.listingId,
      },
    }
  }
  const pages = Array.isArray(resolved.screens) ? resolved.screens.length : 0
  if (pages > input.pagesAllowed) {
    return {
      status: 403,
      body: {
        error:
          `This starter has ${pages} pages; your plan includes ${input.pagesAllowed}. ` +
          'Pick a smaller starter or upgrade in Billing.',
        listingId: input.listingId,
      },
    }
  }
  return null
}
