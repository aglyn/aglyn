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
import {
  blockingRouteOwner,
  normalizeScreenSlug,
  SCREEN_ROOT_PATH,
  screenRoutePathToUrl,
} from '@aglyn/aglyn/app-utils/screen-route'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { sendGa4SitePublished } from '@aglyn/tenant-data-admin/server/ga4-measurement-protocol'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { AiJob, AiJobOutput, AiJobSitePublish } from '../model/ai-jobs.types'

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

/** Whether a finished job of this shape publishes what it built. */
export function aiJobPublishesSite(job: Pick<AiJob, 'kind' | 'inputs'>): boolean {
  return job.kind === 'site' && job.inputs?.['autoConfirm'] === true
}

/** Where a site answers, from its subdomain. */
export function aiSiteLiveUrl(subdomain: string | null | undefined): string | null {
  const name = String(subdomain ?? '').trim()
  return name ? `https://${name}.aglyn.app/` : null
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
 * The layout's nodes with its links to the retired starter home pointed at
 * the new home, and a link for each proposed entry the header does not
 * already carry, placed in the header's toolbar after its existing links.
 * `null` when nothing changes, or when the layout has no toolbar to hold an
 * entry and no link to repoint.
 */
export function aiLayoutWithNavigation(
  nodes: NodesMap,
  input: { entries: readonly NavEntry[]; retiredHomeId?: string | null; homeId?: string | null },
): NodesMap | null {
  const map: Record<string, MutableNode> = {}
  for (const [id, node] of Object.entries(nodes as unknown as Record<string, MutableNode>)) {
    map[id] = { ...node, ...(node.props ? { props: { ...node.props } } : {}), ...(node.nodes ? { nodes: [...node.nodes] } : {}) }
  }
  let changed = false
  const links = Object.values(map).filter((node) => node.componentId === 'muiScreenLink')
  if (input.retiredHomeId && input.homeId) {
    for (const link of links) {
      if (link.props?.['screenId'] === input.retiredHomeId) {
        link.props = { ...link.props, screenId: input.homeId }
        changed = true
      }
    }
  }
  const linked = new Set(links.map((link) => link.props?.['screenId']).filter(Boolean))
  const toolbar = Object.values(map).find((node) => node.componentId === 'muiToolbar')
  const missing = input.entries.filter((entry) => !linked.has(entry.screenId))
  if (toolbar && missing.length) {
    const children = toolbar.nodes ?? []
    // After the last link already in the toolbar (the brand), before the
    // search, the mode switch and the call to action.
    const lastLink = children.reduce(
      (at, id, index) => (map[id]?.componentId === 'muiScreenLink' ? index : at),
      -1,
    )
    const added = missing.map((entry) => {
      const id = `ai_nav_${createResourceUid()}`
      map[id] = {
        $id: id,
        componentId: 'muiScreenLink',
        pluginId: 'mui',
        parentId: toolbar.$id,
        props: { children: entry.label, screenId: entry.screenId, renderAs: 'link', color: 'inherit' },
        sx: { textDecoration: 'none', whiteSpace: 'nowrap' },
        nodes: [],
      }
      return id
    })
    toolbar.nodes = [...children.slice(0, lastLink + 1), ...added, ...children.slice(lastLink + 1)]
    changed = true
  }
  return changed ? (map as unknown as NodesMap) : null
}

/**
 * Publishes the pages a guided site start built. Never throws for a page; a
 * Firestore failure of the publish write itself reports every page as a
 * draft, for the same reason, and is logged.
 */
export async function aiPublishGuidedSite(
  firestore: Firestore,
  input: { job: Pick<AiJob, '$id' | 'orgId' | 'hostId'>; outputs: readonly AiJobOutput[]; now: Date },
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
    liveUrl: aiSiteLiveUrl(host.get('subdomain')),
    published: [],
    drafts: [],
  }
  if (!host.exists || !pages.length) return result

  const before = { ...((host.get('screens') ?? {}) as Record<string, string>) }
  const placeholder = (host.get('defaultHomeScreenId') as string | undefined) || null
  const routing = { ...before }
  const entries: Record<string, string> = {}
  const accepted: Array<{ id: string; label: string; path: string; slug: string }> = []
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
    accepted.push({ id: page.id, label, path: slug, slug })
  }
  if (!accepted.length) return result

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
    retiredHomeId: releases,
    homeId: home?.id ?? null,
    jobId: job.$id,
    now,
  }).catch((error: unknown) => {
    console.error('ai site publish: navigation not applied', { hostId, jobId: job.$id, error })
    return null
  })

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
  batch.update(hostRef, hostUpdates)
  for (const page of accepted) {
    batch.set(hostRef.collection('screens').doc(page.id), { slug: page.slug, publishedAt: now }, { merge: true })
  }
  if (layoutWrite) {
    batch.create(layoutWrite.versionRef, layoutWrite.version)
    batch.set(layoutWrite.layoutRef, { versionId: layoutWrite.versionRef.id, updatedAt: now }, { merge: true })
  }
  // The announce, written down in the publish's own batch (AGL-2575): a
  // layout change reaches every page, so it asks for the whole site.
  const outboxRef = firestore.collection('publishOutbox').doc()
  batch.set(outboxRef, {
    hostId,
    paths: paths.length ? paths : [SCREEN_ROOT_PATH],
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
    ...(layoutWrite ? { entireHost: true } : {}),
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
    ...(layoutWrite ? {} : { paths: { [hostId]: paths } }),
  })
  if (dropped.complete) await outboxRef.delete().catch(() => undefined)
  // A site that came alive with nobody's browser on the publish (AGL-1589).
  await sendSitePublished({ hostId, firstPublish: isFirstPublishedRoute(before, placeholder) })
  return result
}

interface LayoutWrite {
  layoutRef: FirebaseFirestore.DocumentReference
  versionRef: FirebaseFirestore.DocumentReference
  version: Record<string, unknown>
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
    retiredHomeId: string | null
    homeId: string | null
    jobId: string
    now: Date
  },
): Promise<LayoutWrite | null> {
  if (!input.entries.length && !input.retiredHomeId) return null
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const layoutIds = new Set<string>()
  for (const id of input.pageIds) {
    const screen = await hostRef.collection('screens').doc(id).get()
    const versionId = screen.get('versionId')
    const version =
      typeof versionId === 'string' && versionId
        ? await hostRef.collection('screens').doc(id).collection('versions').doc(versionId).get()
        : null
    const layoutId = version?.get('layoutId') ?? screen.get('layoutId')
    if (typeof layoutId === 'string' && layoutId) layoutIds.add(layoutId)
  }
  if (layoutIds.size !== 1) return null
  const [layoutId] = [...layoutIds]
  const layoutRef = hostRef.collection('layouts').doc(layoutId)
  const layout = await layoutRef.get()
  const currentVersionId = layout.get('versionId')
  if (!layout.exists || layout.get('deletedAt') != null || typeof currentVersionId !== 'string') return null
  const current = await layoutRef.collection('versions').doc(currentVersionId).get()
  const nodes = current.exists ? decodeStoredNodes<NodesMap>(current.get('nodes')) : null
  if (!nodes) return null
  const next = aiLayoutWithNavigation(nodes, input)
  const packed = next ? encodeStoredNodes(next) : null
  if (!next || !packed) return null
  const versionRef = layoutRef.collection('versions').doc(createResourceUid())
  return {
    layoutRef,
    versionRef,
    version: {
      layoutId,
      hostId: input.hostId,
      displayName: 'Navigation for the new pages',
      nodes: Buffer.from(packed),
      createdAt: input.now,
      updatedAt: input.now,
      aiJobId: input.jobId,
    },
  }
}
