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

import { isFirstPublishedRoute } from '@aglyn/aglyn/app-utils/analytics-events'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import {
  blockingRouteOwner,
  normalizeScreenSlug,
  SCREEN_ROOT_PATH,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/app-utils/screen-route'
import { resolvePageLocale, siteLanguageCode } from '@aglyn/aglyn/app-utils/seo-locale'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { sendGa4SitePublished } from '@aglyn/tenant-data-admin/server/ga4-measurement-protocol'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import {
  aiLayoutFrameHollows,
  aiLayoutFrameHollowsSaid,
  aiLayoutFrameIsHollow,
  aiLayoutRepairFrameHollows,
  aiLayoutWithoutFrameHollows,
} from '../layout-language/ai-layout-frame-hollows'
import type { AiJob, AiJobOutput, AiJobSitePublish } from '../model/ai-jobs.types'
import { AI_SITE_BLOG_SLUGS } from '../model/ai-site-job'
import { aiSiteEntityUpdates, aiSiteEntityValues, aiSiteListingUpdates } from '../model/ai-site-entity'
import { aiSiteSeoProposalForInputs } from '../model/ai-site-start-seo'
import { aiLayoutWithStoreLinks, type AiStoreLayoutLinks } from '../model/ai-layout-store-links'
import { aiLayoutWithMenuChanges, aiNoMenuChanges } from '../model/ai-layout-menus'
import { AI_STORE_LINKS_SOURCE_FIELD as STORE_LINKS_SOURCE_FIELD } from './ai-job-store-links-layout'
import { readAiDraftNodes, updateAiDraftNodes } from './ai-job-drafts'
import { aiSiteIsStarterSrc } from '../model/ai-site-photos'
import type { AiLayoutPicturePhoto } from '../layout-language/ai-layout-pictures'

/**
 * A store's links a build drafted into the site's own layout (AGL-3676): the
 * draft version, the links in it, and the site's page addresses they were
 * checked against. Its publish makes that version the live one, or — where
 * the layout changed since the draft was made — adds the same links to the
 * version that is live now.
 */
export interface AiSitePublishStoreLinks {
  layoutId: string
  versionId: string
  links: AiStoreLayoutLinks
  screenPaths?: Readonly<Record<string, string>>
}

/**
 * A guided site start publishes what it built (AGL-3596).
 *
 * A person who asked for "a website" in the guided start and watched it build
 * was then handed drafts: a site whose address still answered with the
 * starter, or with nothing. A `site` job started from the guided start (its
 * plan confirmed on the person's behalf, `inputs.autoConfirm`) therefore ends
 * by putting every page it built on the site, through the same writes a
 * person's Publish makes:
 *
 *  - each page's address in the host's routing map, `publishedAt` on the page,
 *    in ONE batch with the publish outbox entry that drops the live site's
 *    cached pages (AGL-2575), the drop itself attempted at once;
 *  - the home page takes `/` from the starter home page the site was created
 *    with (AGL-3408), and an untouched starter goes to the trash rather than
 *    staying beside it as a second "Home";
 *  - the navigation entries the pages proposed are added to the header of
 *    the layout they render inside, as a new live version of that layout;
 *  - `site_published` once, server-side, as the scheduled publish sends it.
 *
 * A page that cannot be published — deleted meanwhile, no address, an address
 * another page holds — stays a draft and is reported with the plain sentence
 * for why. It never fails the job: the site is still built, and the person
 * fixes that one page in Pages. Every other job kind keeps producing drafts.
 *
 * The allowance is respected by construction: a draft is counted against the
 * plan's pages when it is written (`aiDraftBandRefusal`), so publishing
 * drafts adds none, and retiring the starter frees the one it held.
 */

export interface AiSitePublishDeps {
  sendSitePublished?: typeof sendGa4SitePublished
  dropCache?: typeof dropPluginSiteCache
}

/**
 * Whether a build puts its pages live (AGL-3616): only where its request
 * asked to (`publish`, set by Assist's proposal) AND the member ticked the
 * plan card's box when confirming (`publishConfirmed`, set by the resume
 * door). Every other build leaves drafts.
 */
export function aiJobPublishesBuild(job: Pick<AiJob, 'kind' | 'inputs'>): boolean {
  return job.kind === 'build' && job.inputs?.['publish'] === true && job.inputs?.['publishConfirmed'] === true
}

/**
 * The host fields a guided start writes for its plan's language (AGL-3750),
 * as the Languages card saves one language: `locales` of that one and
 * `defaultLocale` the same. `null` — nothing written — where the plan said no
 * valid language, where it is the language the site already publishes in
 * (English for a new site), and on a site with more than one language, whose
 * languages are the owner's decision. Nothing is translated: the pages were
 * written in the brief's language, and this says so to the reader.
 */
export function aiSiteLanguageUpdates(
  host: { locales?: unknown; defaultLocale?: unknown },
  language: string | null | undefined,
): { locales: string[]; defaultLocale: string } | null {
  const code = siteLanguageCode(language)
  if (!code) return null
  const locales = Array.isArray(host.locales)
    ? host.locales.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    : []
  if (locales.length > 1) return null
  const current = resolvePageLocale({
    host: {
      ...(typeof host.defaultLocale === 'string' ? { defaultLocale: host.defaultLocale } : {}),
      locales,
    },
  })
  if (current === code) return null
  return { locales: [code], defaultLocale: code }
}

/** Whether a finished job of this shape publishes what it built. */
export function aiJobPublishesSite(job: Pick<AiJob, 'kind' | 'inputs'>): boolean {
  return job.kind === 'site' && job.inputs?.['autoConfirm'] === true
}

/**
 * Where a site answers: its custom domain, else its subdomain under the
 * deployment's tenant apex — never a hard-coded platform host, so a
 * self-hosted deployment links to its own sites.
 */
export function aiSiteLiveUrl(host: { cname?: unknown; subdomain?: unknown }): string | null {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const origin = hostPublicOrigin({ cname: text(host.cname) || null, subdomain: text(host.subdomain) || null })
  return origin ? `${origin}/` : null
}

/** The sentences a page that stayed a draft is reported with. */
export const AI_SITE_PUBLISH_DELETED = 'It was deleted before it could be published.'
export const AI_SITE_PUBLISH_NO_ADDRESS = 'It has no address yet. Give it one in Pages and publish it.'
export const aiSitePublishTakenCopy = (path: string): string =>
  `Another page is already published at ${screenRoutePathToUrl(path)}. Give this one another address in Pages and publish it.`
export const AI_SITE_PUBLISH_FAILED = 'It could not be published just now. Publish it from Pages.'

/** A navigation entry a page proposed, as the page step reports it. */
interface NavEntry {
  screenId: string
  label: string
}

function navEntriesOf(outputs: readonly AiJobOutput[]): NavEntry[] {
  const entries: NavEntry[] = []
  for (const output of outputs) {
    if (output.resource !== 'screen') continue
    const navigation = output.proposal?.['navigation'] as { label?: unknown } | undefined
    const label = typeof navigation?.label === 'string' ? navigation.label.trim() : ''
    if (label && !entries.some((entry) => entry.screenId === output.id)) {
      entries.push({ screenId: output.id, label })
    }
  }
  return entries
}

type MutableNode = {
  $id: string
  componentId?: string
  parentId?: string
  props?: Record<string, unknown>
  nodes?: string[]
  [key: string]: unknown
}

/**
 * The blog paths a start's layout links and must not publish (AGL-3660): its
 * header, phone menu and footer link the blog by path while the posts part is
 * still owed, so a start whose posts part then failed or was skipped drops
 * every address the blog could have taken. None while the blog was written.
 */
export function aiSiteUnwrittenBlogHrefs(blogUnwritten: boolean | undefined): string[] {
  return blogUnwritten ? AI_SITE_BLOG_SLUGS.map((slug) => `/${slug}`) : []
}

/**
 * The layout's nodes with its links to the retired starter home pointed at
 * the new home, its links to pages the start did not write taken out, and a
 * link for each proposed entry the header does not already carry, added by
 * the navigation op's `aiLayoutWithMenuChanges` (AGL-3747): to the header's
 * menu and its phone menu, after their items, or after the brand in a
 * starter's Toolbar. `null` when nothing changes, or when the layout has no
 * header to hold an entry and no link to repoint or take out.
 */
export function aiLayoutWithNavigation(
  nodes: NodesMap,
  input: {
    entries: readonly NavEntry[]
    retiredHomeId?: string | null
    homeId?: string | null
    /** Paths whose links come out: a blog the start linked and never wrote (AGL-3660). */
    droppedHrefs?: readonly string[]
    /** Pages whose links come out: a page the start planned and did not put live (AGL-3988). */
    droppedScreenIds?: readonly string[]
  },
): NodesMap | null {
  const map: Record<string, MutableNode> = {}
  for (const [id, node] of Object.entries(nodes as unknown as Record<string, MutableNode>)) {
    map[id] = { ...node, ...(node.props ? { props: { ...node.props } } : {}), ...(node.nodes ? { nodes: [...node.nodes] } : {}) }
  }
  let changed = false
  // The header, the phone menu and the footer link a blog by its path before
  // its posts are written (AGL-3660); a start whose posts were not written
  // publishes none of those links to a page that does not exist. Nor does a
  // start link a page it planned and did not put live (AGL-3988): the
  // beta.270 Sugar Hollow header linked its refused Galleries page.
  const dropped = new Set(input.droppedHrefs ?? [])
  const unbuilt = new Set(input.droppedScreenIds ?? [])
  if (dropped.size || unbuilt.size) {
    const gone = new Set(
      Object.entries(map)
        .filter(
          ([, node]) =>
            node.componentId === 'muiScreenLink' &&
            (dropped.has(String(node.props?.['href'] ?? '')) || unbuilt.has(String(node.props?.['screenId'] ?? ''))),
        )
        .map(([id]) => id),
    )
    if (gone.size) {
      for (const id of gone) delete map[id]
      for (const node of Object.values(map)) {
        if (node.nodes?.some((child) => gone.has(child))) node.nodes = node.nodes.filter((child) => !gone.has(child))
      }
      // A footer heading whose links all went goes with them, and its column
      // when that leaves it only the heading (AGL-3735).
      aiLayoutRepairFrameHollows(map as unknown as Record<string, unknown>)
      changed = true
    }
  }
  const links = Object.values(map).filter((node) => node.componentId === 'muiScreenLink')
  if (input.retiredHomeId && input.homeId) {
    for (const link of links) {
      if (link.props?.['screenId'] === input.retiredHomeId) {
        link.props = { ...link.props, screenId: input.homeId }
        changed = true
      }
    }
  }
  // The entries go into the header through the navigation op's own code
  // (AGL-3747): the bar's menu and the phone menu's, after the items already
  // there, each looking like its neighbours. A page some link already opens,
  // or an item of the same name, is not added again.
  const linked = new Set(links.map((link) => link.props?.['screenId']).filter(Boolean))
  const missing = input.entries.filter((entry) => !linked.has(entry.screenId))
  if (missing.length) {
    const added = aiLayoutWithMenuChanges(
      map,
      ['header'],
      { ...aiNoMenuChanges(), add: missing.map((entry) => ({ parent: null, label: entry.label, to: { screenId: entry.screenId } })) },
      { newId: () => `ai_nav_${createResourceUid()}` },
    )
    if (added.nodes) return added.nodes as unknown as NodesMap
  }
  return changed ? (map as unknown as NodesMap) : null
}

/** Elements that only frame what they hold, which go once a link taken out leaves them nothing. */
const LINK_FRAMES = new Set(['muiStack', 'muiBox', 'muiGrid', 'muiButtonGroup', 'muiCardActions'])

/**
 * A page's nodes with every link to a page the start did not put live taken
 * out (AGL-3988), and every frame that held only such links with them, up to
 * its section: a published site never links to a 404. The beta.270 Sugar
 * Hollow home page linked its refused Galleries page from "See the
 * galleries" and the dataset band's "View all galleries". A link is a Page
 * Link to one of `screenIds`; anything else that opens one (a picture) keeps
 * its place and loses the link. `null` when nothing links one. Pure.
 */
export function aiPageWithoutLinksTo(
  nodes: NodesMap,
  screenIds: readonly string[],
  /**
   * A page brought in from its owner's site keeps every word (AGL-4107): its
   * Page Links to such a page keep their places and their words, going nowhere.
   */
  options: { keepWords?: boolean } = {},
): NodesMap | null {
  const missing = new Set(screenIds.filter(Boolean))
  if (!missing.size) return null
  const map: Record<string, MutableNode> = {}
  for (const [id, node] of Object.entries(nodes as unknown as Record<string, MutableNode>)) {
    map[id] = { ...node, ...(node.props ? { props: { ...node.props } } : {}), ...(node.nodes ? { nodes: [...node.nodes] } : {}) }
  }
  const opensMissing = (node: MutableNode | undefined) => missing.has(String(node?.props?.['screenId'] ?? ''))
  const ids = Object.keys(map).filter((id) => opensMissing(map[id]))
  if (!ids.length) return null
  const parentOf = (id: string) => Object.keys(map).find((key) => map[key]?.nodes?.includes(id)) ?? null
  const removeTree = (id: string) => {
    for (const child of [...(map[id]?.nodes ?? [])]) removeTree(child)
    delete map[id]
  }
  for (const id of ids) {
    const node = map[id]
    if (!node) continue
    if (node.componentId !== 'muiScreenLink' || options.keepWords) {
      const props = { ...(node.props ?? {}) }
      delete props['screenId']
      node.props = props
      continue
    }
    let parent = parentOf(id)
    if (parent) map[parent] = { ...(map[parent] as MutableNode), nodes: (map[parent]?.nodes ?? []).filter((child) => child !== id) }
    removeTree(id)
    // The frames it leaves empty, never a section nor the page's root.
    while (parent && map[parent] && !(map[parent]?.nodes ?? []).length && LINK_FRAMES.has(String(map[parent]?.componentId))) {
      const above = parentOf(parent)
      if (!above) break
      map[above] = { ...(map[above] as MutableNode), nodes: (map[above]?.nodes ?? []).filter((child) => child !== parent) }
      delete map[parent]
      parent = above
    }
  }
  return map as unknown as NodesMap
}

/** The blog a start writes, as its header entry links it (`aiSiteBlogNavPage`). */
export interface AiSiteBlogEntry {
  label: string
  href: string
}

/**
 * The layout's nodes with the blog's header entry put back (AGL-3747): a
 * start whose posts part failed published with every link to the blog taken
 * out (AGL-3660), and Try again's posts went live with none to reach them.
 * Added by the navigation op's `aiLayoutWithMenuChanges`, as the start's
 * other entries are — the bar's menu and the phone menu — second after the
 * home page's item, as the start first linked it (AGL-3676), else last.
 * `null` where some link already opens the blog, or the layout has no header
 * menu to hold it.
 */
export function aiLayoutWithBlogEntry(
  nodes: NodesMap,
  input: { blog: AiSiteBlogEntry; homeId?: string | null },
): NodesMap | null {
  const blogHrefs = new Set([input.blog.href, ...AI_SITE_BLOG_SLUGS.map((slug) => `/${slug}`)])
  const linked = Object.values(nodes as unknown as Record<string, MutableNode>).some(
    (node) => node?.componentId === 'muiScreenLink' && blogHrefs.has(String(node.props?.['href'] ?? '')),
  )
  if (linked) return null
  const home = [...(input.homeId ? [{ screenId: input.homeId }] : []), { href: '/' }]
  const added = aiLayoutWithMenuChanges(
    nodes as unknown as Record<string, unknown>,
    ['header'],
    { ...aiNoMenuChanges(), add: [{ parent: null, label: input.blog.label, to: { href: input.blog.href }, after: home }] },
    { newId: () => `ai_nav_${createResourceUid()}` },
  )
  return (added.nodes as unknown as NodesMap | null) ?? null
}

/**
 * Puts the blog's header entry back on a live start whose posts Try again
 * wrote (AGL-3747), as a new live version of the layout its published pages
 * render inside, in one batch with the publish outbox entry that drops the
 * live site's cached pages, the drop itself attempted at once. Returns
 * whether the entry went live; never throws for a layout it cannot change.
 */
export async function aiRestoreGuidedBlogEntry(
  firestore: Firestore,
  input: {
    job: Pick<AiJob, '$id' | 'hostId'>
    /** The start's published pages: the layout they share is the one changed. */
    pageIds: readonly string[]
    /** The published home page, which the blog's entry follows. */
    homeId?: string | null
    blog: AiSiteBlogEntry
    now: Date
  },
  deps: Pick<AiSitePublishDeps, 'dropCache'> = {},
): Promise<boolean> {
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  const hostId = input.job.hostId ?? ''
  if (!hostId || !input.pageIds.length) return false
  const layoutId = await aiPagesLayoutId(firestore, hostId, input.pageIds)
  if (!layoutId) return false
  const write = await aiLayoutVersionWrite(firestore, {
    hostId,
    layoutId,
    transform: (nodes) => aiLayoutWithBlogEntry(nodes, { blog: input.blog, homeId: input.homeId ?? null }),
    storeLinks: null,
    jobId: input.job.$id,
    now: input.now,
    displayName: 'Navigation for the blog',
  })
  if (!write?.version) return false
  const batch = firestore.batch()
  batch.create(write.versionRef, write.version)
  batch.set(write.layoutRef, { versionId: write.versionRef.id, updatedAt: input.now }, { merge: true })
  // A layout change reaches every page, so the announce asks for the whole site.
  const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
  batch.set(outboxRef, {
    hostId,
    paths: [SCREEN_ROOT_PATH],
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
    entireHost: true,
  })
  await batch.commit()
  const dropped = await dropCache({ hostIds: [hostId], reason: 'guided AI site start linked its blog' })
  if (dropped.complete) await outboxRef.delete().catch(() => undefined)
  return true
}

/**
 * Whether a site's share image is the publish's to set (AGL-3988): it has
 * none, or still the starter photo every new site is created with. An image
 * its owner picked is theirs, whatever it is.
 */
export function aiSiteShareImageOpen(seo: unknown): boolean {
  const image = (seo as { image?: unknown } | null | undefined)?.image
  if (image === undefined || image === null) return true
  return typeof image === 'string' && (!image.trim() || aiSiteIsStarterSrc(image))
}

/** The library photos a stored page shows, in document order, each once, with whether it sits in the page's first section. */
function libraryPhotosOf(nodes: NodesMap | null): Array<AiLayoutPicturePhoto & { lead: boolean }> {
  if (!nodes) return []
  const map = nodes as unknown as Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>
  const firstSection = map[CANVAS_ROOT_ELEMENT_ID]?.nodes?.[0] ?? null
  const out: Array<AiLayoutPicturePhoto & { lead: boolean }> = []
  const seen = new Set<string>()
  const visit = (id: string, lead: boolean) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = map[id]
    if (!node) return
    if (node.componentId === 'image') {
      const src = node.props?.['src']
      const width = Number(node.props?.['intrinsicWidth'])
      const height = Number(node.props?.['intrinsicHeight'])
      if (typeof src === 'string' && src.startsWith('media:') && width > 0 && height > 0) {
        const alt = typeof node.props?.['alt'] === 'string' ? (node.props['alt'] as string).trim() : ''
        out.push({ src, width, height, ...(alt ? { alt } : {}), lead })
      }
    }
    for (const child of node.nodes ?? []) visit(child, lead || child === firstSection)
  }
  visit(CANVAS_ROOT_ELEMENT_ID, false)
  return out
}

/**
 * The photo a published site's share image is set from (AGL-3988): its home
 * page's hero — the first library photo of its first section — else the
 * widest photo its pages show, a wide one first. `null` where they show no
 * library photo. The beta.271 Laurel Fork start shared an office team on a
 * wedding photographer's every link: nothing set the share image from what
 * the start built, so it kept the starter the site was created with. Pure.
 */
export function aiSiteSharePhoto(home: NodesMap | null, pages: ReadonlyArray<NodesMap | null>): AiLayoutPicturePhoto | null {
  const hero = libraryPhotosOf(home).find((photo) => photo.lead)
  const pick = (photo: AiLayoutPicturePhoto & { lead?: boolean }): AiLayoutPicturePhoto => ({
    src: photo.src,
    width: photo.width,
    height: photo.height,
    ...(photo.alt ? { alt: photo.alt } : {}),
  })
  if (hero) return pick(hero)
  const all = [home, ...pages].flatMap(libraryPhotosOf)
  const wide = (photo: AiLayoutPicturePhoto) => photo.width / photo.height >= 1.3
  const [best] = [...all].sort((a, b) => Number(wide(b)) - Number(wide(a)) || b.width - a.width)
  return best ? pick(best) : null
}

/** The host fields the share image is written in, as the Social image card writes them (AGL-3988). */
export function aiSiteShareImageUpdates(photo: AiLayoutPicturePhoto): Record<string, unknown> {
  return {
    'seo.image': photo.src,
    'seo.imageWidth': photo.width,
    'seo.imageHeight': photo.height,
    'seo.imageAlt': photo.alt?.trim() ?? '',
  }
}

/**
 * A retry's publish merged into the start's first (AGL-3730): the pages it
 * put live join the published list, a page it published leaves the drafts,
 * and a page it left a draft is reported with its newest reason.
 */
export function aiMergeSitePublish(previous: AiJobSitePublish, retried: AiJobSitePublish): AiJobSitePublish {
  const now = new Set([...retried.published, ...retried.drafts].map((page) => page.id))
  return {
    liveUrl: retried.liveUrl ?? previous.liveUrl,
    published: [...previous.published.filter((page) => !now.has(page.id)), ...retried.published],
    drafts: [...previous.drafts.filter((page) => !now.has(page.id)), ...retried.drafts],
  }
}

/**
 * Publishes the pages a guided site start built. Never throws for a page; a
 * Firestore failure of the publish write itself reports every page as a
 * draft, for the same reason, and is logged.
 */
export async function aiPublishGuidedSite(
  firestore: Firestore,
  input: {
    job: Pick<AiJob, '$id' | 'orgId' | 'hostId'> & Partial<Pick<AiJob, 'inputs'>>
    outputs: readonly AiJobOutput[]
    now: Date
    /** The start owed its blog's posts and wrote none (AGL-3660): its links to the blog come out. */
    blogUnwritten?: boolean
    /** Paths the layout links that the start did not write, such as a store page (AGL-3676): their links come out. */
    unwrittenHrefs?: readonly string[]
    /**
     * The pages the start planned and did not build (AGL-3988): a page its
     * checks refused. Every link to one — the header's, the footer's, a
     * button's on a page going live — comes out, and so does every link to
     * a page this publish leaves a draft.
     */
    unbuiltScreenIds?: readonly string[]
    /** A link to a page not live keeps its words, going nowhere, rather than coming out (AGL-4107). */
    keepLinkWords?: boolean
    /**
     * The start's pages in the order the site lists them (AGL-3988): a page
     * going live with no place of its own in Pages takes its place there, so
     * the 404 page's links follow the site's order, never the alphabet.
     */
    siteOrder?: readonly string[]
    /** A store's links a build drafted into the site's own layout (AGL-3676), which go live with its pages. */
    storeLinks?: AiSitePublishStoreLinks | null
    /**
     * The start published once already, and Try again rebuilt what failed
     * (AGL-3730): only `outputs` go live, beside what is. The home address is
     * never taken from the starter here, the starter is never retired, and
     * `site_published` is not sent again; a retried page at `/` that the
     * starter still holds stays a draft and says so.
     */
    retry?: boolean
    /**
     * The language the plan says the brief and copy are in (AGL-3750): the
     * site publishes in it, where `aiSiteLanguageUpdates` says so.
     */
    language?: string | null
  },
  deps: AiSitePublishDeps = {},
): Promise<AiJobSitePublish> {
  const sendSitePublished = deps.sendSitePublished ?? sendGa4SitePublished
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  const { job, now } = input
  const hostId = job.hostId ?? ''
  const pages = input.outputs.filter(
    (output, index, all) =>
      output.resource === 'screen' &&
      (output.hostId ?? hostId) === hostId &&
      all.findIndex((other) => other.resource === 'screen' && other.id === output.id) === index,
  )
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = await hostRef.get()
  const result: AiJobSitePublish = {
    liveUrl: aiSiteLiveUrl({ cname: host.get('cname'), subdomain: host.get('subdomain') }),
    published: [],
    drafts: [],
  }
  if (!host.exists || !pages.length) return result

  const before = { ...((host.get('screens') ?? {}) as Record<string, string>) }
  const starter = (host.get('defaultHomeScreenId') as string | undefined) || null
  // A retry never takes `/` from the starter (AGL-3730): it holds it like any page.
  const placeholder = input.retry ? null : starter
  const routing = { ...before }
  const entries: Record<string, string> = {}
  const accepted: Array<{ id: string; label: string; path: string; slug: string; order?: number }> = []
  const siteOrder = input.siteOrder ?? []
  for (const page of pages) {
    const snapshot = await hostRef.collection('screens').doc(page.id).get()
    const label = String(snapshot.get('displayName') ?? page.label ?? '') || page.label
    if (!snapshot.exists || snapshot.get('deletedAt') != null) {
      result.drafts.push({ id: page.id, label, reason: AI_SITE_PUBLISH_DELETED })
      continue
    }
    const slug = normalizeScreenSlug(String(snapshot.get('slug') ?? ''))
    if (!slug) {
      result.drafts.push({ id: page.id, label, reason: AI_SITE_PUBLISH_NO_ADDRESS })
      continue
    }
    const owner = blockingRouteOwner(routing, slug, placeholder)
    if (owner && owner !== page.id) {
      result.drafts.push({ id: page.id, label, reason: aiSitePublishTakenCopy(slug) })
      continue
    }
    routing[page.id] = slug
    entries[page.id] = slug
    // Its place in Pages, where the owner has not given it one (AGL-3988).
    const place = siteOrder.indexOf(page.id)
    const placed = typeof snapshot.get('order') === 'number'
    accepted.push({ id: page.id, label, path: slug, slug, ...(place >= 0 && !placed ? { order: place } : {}) })
  }
  if (!accepted.length) return result

  // A page that is not live once this publish is done — planned and never
  // built, or left a draft just now — is linked from nowhere (AGL-3988).
  const live = new Set([...accepted.map((page) => page.id), ...Object.keys(before)])
  const notLive = [...new Set([...(input.unbuiltScreenIds ?? []), ...result.drafts.map((page) => page.id)])].filter(
    (id) => id && !live.has(id),
  )
  if (notLive.length) {
    for (const page of accepted) {
      await updateAiDraftNodes(firestore, {
        kind: 'screen',
        hostId,
        id: page.id,
        now,
        update: (nodes) => aiPageWithoutLinksTo(nodes, notLive, { keepWords: input.keepLinkWords === true }),
      }).catch((error: unknown) => {
        console.error('ai site publish: links to an unbuilt page not taken out', { hostId, jobId: job.$id, pageId: page.id, error })
      })
    }
  }

  // The first real home page replaces the placeholder in the same write.
  const home = accepted.find((page) => page.path === SCREEN_ROOT_PATH) ?? null
  const releases =
    home && placeholder && placeholder !== home.id && before[placeholder] === SCREEN_ROOT_PATH
      ? placeholder
      : null
  // An untouched starter home (still its one first version) is retired to the
  // trash; one its owner edited stays in Pages as their draft.
  const retire = releases
    ? (await hostRef.collection('screens').doc(releases).collection('versions').limit(2).get()).size <= 1
    : false

  // The header of the layout the pages render inside learns their entries.
  const layoutWrite = await aiNavigationLayoutWrite(firestore, {
    hostId,
    pageIds: accepted.map((page) => page.id),
    entries: navEntriesOf(pages).filter((entry) => entries[entry.screenId]),
    droppedHrefs: [...aiSiteUnwrittenBlogHrefs(input.blogUnwritten), ...(input.unwrittenHrefs ?? [])],
    droppedScreenIds: notLive,
    retiredHomeId: releases,
    homeId: home?.id ?? null,
    jobId: job.$id,
    now,
    storeLinks: input.storeLinks ?? null,
  }).catch((error: unknown) => {
    console.error('ai site publish: navigation not applied', { hostId, jobId: job.$id, error })
    return null
  })
  // A store's links drafted into a layout the pages' navigation did not touch go live on their own.
  const storeLinks = input.storeLinks ?? null
  const storeLinksWrite =
    storeLinks && layoutWrite?.layoutRef.id !== storeLinks.layoutId
      ? await aiLayoutVersionWrite(firestore, {
          hostId,
          layoutId: storeLinks.layoutId,
          transform: () => null,
          storeLinks,
          jobId: job.$id,
          now,
        }).catch((error: unknown) => {
          console.error('ai site publish: store links not applied', { hostId, jobId: job.$id, error })
          return null
        })
      : null
  const layoutWrites = [layoutWrite, storeLinksWrite].filter((write): write is LayoutWrite => Boolean(write))

  const paths = [
    ...new Set(
      [
        ...Object.values(entries),
        ...(releases ? [SCREEN_ROOT_PATH] : []),
      ].map((path) => screenRoutePathToUrl(path)),
    ),
  ]
  const batch = firestore.batch()
  const hostUpdates: Record<string, unknown> = { updatedAt: now }
  for (const [id, path] of Object.entries(entries)) hostUpdates[`screens.${id}`] = path
  if (releases) {
    hostUpdates[`screens.${releases}`] = FieldValue.delete()
    hostUpdates['defaultHomeScreenId'] = FieldValue.delete()
    batch.set(
      hostRef.collection('screens').doc(releases),
      { publishedAt: FieldValue.delete(), ...(retire ? { deletedAt: now } : {}) },
      { merge: true },
    )
  } else if (placeholder && entries[placeholder]) {
    hostUpdates['defaultHomeScreenId'] = FieldValue.delete()
  }
  // The site's language, from its plan (AGL-3750): every page's `<html lang>`
  // reads it, so the announce below asks for the whole site.
  const language = aiSiteLanguageUpdates(
    { locales: host.get('locales'), defaultLocale: host.get('defaultLocale') },
    input.language,
  )
  if (language) Object.assign(hostUpdates, language)
  // Who publishes the site, from the start's answers (AGL-3979): its Setup ->
  // SEO -> Entity and AI agents fields and its Business details, each only
  // where empty, so every page's structured data and the site's /llms.txt
  // name its business type, phone, email, address, hours, areas, profiles and
  // logo. Every page carries the entity, so the announce asks for the whole
  // site when any of it changes.
  const siteName = typeof host.get('displayName') === 'string' ? (host.get('displayName') as string) : null
  const entity = aiSiteEntityUpdates(
    host.get('seo'),
    aiSiteEntityValues(job.inputs, { language: input.language ?? null, siteName }),
    { logoUrl: host.get('logoUrl'), business: host.get('business') },
  )
  Object.assign(hostUpdates, entity)
  // The site's own listing (AGL-3979): the start's, with the site's name,
  // over the title and description its creation seeded and nowhere else. A
  // listing the owner changed keeps their words, and the SEO section still
  // offers the start's beside them. Every page falls back to it, and
  // `og:site_name` and /llms.txt read it, so it asks for the whole site too.
  const listing = aiSiteListingUpdates(
    host.get('seo'),
    siteName,
    aiSiteSeoProposalForInputs(job.inputs, input.language ?? null, siteName),
  )
  Object.assign(hostUpdates, listing)
  // The site's share image (AGL-3988), where it has none or the starter it
  // was created with: its home hero's photo, else its widest. Every page's
  // `og:image` falls back to it, so it asks for the whole site too.
  // A retry's home page is the one already live at the site's address.
  const homeId = home?.id ?? Object.entries(before).find(([id, path]) => path === SCREEN_ROOT_PATH && id !== starter)?.[0] ?? null
  const share = aiSiteShareImageOpen(host.get('seo'))
    ? await aiSiteSharePhotoOf(firestore, hostId, accepted, homeId).catch((error: unknown) => {
        console.error('ai site publish: the share image could not be read', { hostId, jobId: job.$id, error })
        return null
      })
    : null
  const shareImage = share ? aiSiteShareImageUpdates(share) : {}
  Object.assign(hostUpdates, shareImage)
  const entireHost =
    layoutWrites.length > 0 ||
    language !== null ||
    Object.keys(entity).length > 0 ||
    Object.keys(listing).length > 0 ||
    Object.keys(shareImage).length > 0
  batch.update(hostRef, hostUpdates)
  for (const page of accepted) {
    batch.set(
      hostRef.collection('screens').doc(page.id),
      { slug: page.slug, publishedAt: now, ...(page.order !== undefined ? { order: page.order } : {}) },
      { merge: true },
    )
  }
  for (const write of layoutWrites) {
    if (write.version) batch.create(write.versionRef, write.version)
    batch.set(write.layoutRef, { versionId: write.versionRef.id, updatedAt: now }, { merge: true })
  }
  // The announce, written down in the publish's own batch (AGL-2575): a
  // layout change reaches every page, so it asks for the whole site.
  const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
  batch.set(outboxRef, {
    hostId,
    paths: paths.length ? paths : [SCREEN_ROOT_PATH],
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
    ...(entireHost ? { entireHost: true } : {}),
  })
  try {
    await batch.commit()
  } catch (error) {
    console.error('ai site publish failed', { hostId, jobId: job.$id, error })
    for (const page of accepted) result.drafts.push({ id: page.id, label: page.label, reason: AI_SITE_PUBLISH_FAILED })
    return result
  }
  result.published = accepted.map(({ id, label, path }) => ({ id, label, path: screenRoutePathToUrl(path) }))

  // The live site's cached pages go now; the outbox entry stays for the
  // drain unless the drop certainly happened.
  const dropped = await dropCache({
    hostIds: [hostId],
    reason: 'guided AI site start published',
    ...(entireHost ? {} : { paths: { [hostId]: paths } }),
  })
  if (dropped.complete) await outboxRef.delete().catch(() => undefined)
  // A site that came alive with nobody's browser on the publish (AGL-1589),
  // announced once: a retry's pages join a site already announced (AGL-3730).
  if (!input.retry) await sendSitePublished({ hostId, firstPublish: isFirstPublishedRoute(before, placeholder) })
  return result
}

/** The share image's photo, read off the pages going live (AGL-3988). */
async function aiSiteSharePhotoOf(
  firestore: Firestore,
  hostId: string,
  pages: ReadonlyArray<{ id: string }>,
  homeId: string | null,
): Promise<AiLayoutPicturePhoto | null> {
  const read = async (id: string) => (await readAiDraftNodes(firestore, { kind: 'screen', hostId, id }))?.nodes ?? null
  const [home, ...others] = await Promise.all([
    homeId ? read(homeId) : Promise.resolve(null),
    ...pages.filter((page) => page.id !== homeId).map((page) => read(page.id)),
  ])
  return aiSiteSharePhoto(home ?? null, others)
}

interface LayoutWrite {
  layoutRef: FirebaseFirestore.DocumentReference
  versionRef: FirebaseFirestore.DocumentReference
  /** The new version to create; `null` where the live version becomes one already written (a store's links draft). */
  version: Record<string, unknown> | null
}

/**
 * The new live version of the layout the published pages render inside, with
 * their navigation entries and the home link moved off a retired starter;
 * `null` when there is nothing to change or no one layout to change.
 */
async function aiNavigationLayoutWrite(
  firestore: Firestore,
  input: {
    hostId: string
    pageIds: readonly string[]
    entries: readonly NavEntry[]
    droppedHrefs: readonly string[]
    droppedScreenIds: readonly string[]
    retiredHomeId: string | null
    homeId: string | null
    jobId: string
    now: Date
    storeLinks?: AiSitePublishStoreLinks | null
  },
): Promise<LayoutWrite | null> {
  if (!input.entries.length && !input.retiredHomeId && !input.droppedHrefs.length && !input.droppedScreenIds.length && !input.storeLinks) return null
  const layoutId = await aiPagesLayoutId(firestore, input.hostId, input.pageIds)
  if (!layoutId) return null
  return aiLayoutVersionWrite(firestore, {
    hostId: input.hostId,
    layoutId,
    transform: (nodes) => aiLayoutWithNavigation(nodes, input),
    storeLinks: input.storeLinks ?? null,
    jobId: input.jobId,
    now: input.now,
  })
}

/** The one layout the pages render inside, by their current versions; `null` where they do not share one. */
async function aiPagesLayoutId(firestore: Firestore, hostId: string, pageIds: readonly string[]): Promise<string | null> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const layoutIds = new Set<string>()
  for (const id of pageIds) {
    const screen = await hostRef.collection('screens').doc(id).get()
    const versionId = screen.get('versionId')
    const version =
      typeof versionId === 'string' && versionId
        ? await hostRef.collection('screens').doc(id).collection('versions').doc(versionId).get()
        : null
    const layoutId = version?.get('layoutId') ?? screen.get('layoutId')
    if (typeof layoutId === 'string' && layoutId) layoutIds.add(layoutId)
  }
  return layoutIds.size === 1 ? [...layoutIds][0] : null
}

/**
 * The new live version of one layout: `transform` applied to the version
 * live now. A store's links drafted into this layout (AGL-3676) start it from
 * that draft while the draft was made from the live version, and are added
 * to the live version otherwise; a draft with nothing more to add becomes
 * the live version as it is. `null` when nothing changes.
 */
async function aiLayoutVersionWrite(
  firestore: Firestore,
  input: {
    hostId: string
    layoutId: string
    transform: (nodes: NodesMap) => NodesMap | null
    storeLinks: AiSitePublishStoreLinks | null
    jobId: string
    now: Date
    /** The new version's name in the layout's versions. */
    displayName?: string
  },
): Promise<LayoutWrite | null> {
  const { layoutId } = input
  const layoutRef = firestore.collection('hosts').doc(input.hostId).collection('layouts').doc(layoutId)
  const layout = await layoutRef.get()
  const currentVersionId = layout.get('versionId')
  if (!layout.exists || layout.get('deletedAt') != null || typeof currentVersionId !== 'string') return null
  const current = await layoutRef.collection('versions').doc(currentVersionId).get()
  const links = input.storeLinks?.layoutId === layoutId ? input.storeLinks : null
  const draftRef = links ? layoutRef.collection('versions').doc(links.versionId) : null
  const draft = draftRef ? await draftRef.get() : null
  const fromDraft = Boolean(draft?.exists && draft.get(STORE_LINKS_SOURCE_FIELD) === currentVersionId)
  const base = fromDraft && draft ? draft : current
  const nodes = base.exists ? decodeStoredNodes<NodesMap>(base.get('nodes')) : null
  if (!nodes) return null
  let next = input.transform(nodes)
  if (links && !fromDraft) {
    const added = aiLayoutWithStoreLinks((next ?? nodes) as never, links.links, links.screenPaths)
    next = (added.nodes as NodesMap | null) ?? next
  }
  // What a publish puts live has no hollow heading, column or menu (AGL-3735).
  next = (aiLayoutWithoutFrameHollows((next ?? nodes) as unknown as Record<string, unknown>) as NodesMap | null) ?? next
  const hollow = aiLayoutFrameHollows((next ?? nodes) as unknown as Record<string, unknown>)
  if (aiLayoutFrameIsHollow(hollow)) {
    console.error('ai site publish: a layout is still hollow after its repair', { layoutId, hollow: aiLayoutFrameHollowsSaid(hollow) })
  }
  if (!next) return fromDraft && draftRef ? { layoutRef, versionRef: draftRef, version: null } : null
  const packed = encodeStoredNodes(next)
  if (!packed) return null
  const versionRef = layoutRef.collection('versions').doc(createResourceUid())
  return {
    layoutRef,
    versionRef,
    version: {
      layoutId,
      hostId: input.hostId,
      displayName: input.displayName ?? 'Navigation for the new pages',
      nodes: Buffer.from(packed),
      createdAt: input.now,
      updatedAt: input.now,
      aiJobId: input.jobId,
    },
  }
}
