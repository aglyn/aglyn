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

/*==========================================
 * WHICH PAGE WAS HELD, AND WHERE IT LIVES (AGL-3374).
 *
 * `describeHeldPage` turns the screen id the page review holds into a
 * {@link HeldPageSubject} (`@aglyn/shared-util-email/held-page`): the page's
 * kind, name and route, the entry it was showing, the layout or component
 * the flagged content came from, and what visitors see meanwhile.
 *
 * Run once per review row, never per render: the page review calls it only
 * when it files a row that does not describe its page yet, so the reads it
 * may make — the screen document, the collection that designates a
 * template, the site's usage corpus when a layout or component is the
 * source — are paid once for a page that was flagged, and never for a clean
 * one.
 *
 * The composer knows most of this already and hands it over as a
 * {@link HostedPageContext}; the reads here are the fallback for a caller
 * that does not, and for a page kind the caller cannot see (a layout's
 * content is only a layout's to the one who composed it).
 *=========================================*/

import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import type {
  HeldPageKind,
  HeldPageSource,
  HeldPageSubject,
  HeldPageVisitorView,
} from '@aglyn/shared-util-email/held-page'
import { screenHostedPage } from '@aglyn/shared-util-email/hosted-page-screen'
import type { PhishingScreenSignal } from '@aglyn/shared-util-email/outbound-phishing-screen'
import firebaseAdmin from './firebase-admin'
import {
  readUsageSources,
  screenIdsUsingComponentDeep,
  screenIdsUsingLayoutDeep,
} from './live-page-usage'
import { canonicalJson } from './outbound-send-review'

/** One document that composes into the page, for attributing a signal. */
export interface HostedPagePart {
  type: 'screen' | 'layout' | 'component'
  id: string
  name?: string | null
  nodes: unknown
}

/** What the composer knows about the page it is reviewing. */
export interface HostedPageContext {
  /** The screen document it composed (its name and `kind`). */
  screen?: { displayName?: unknown; name?: unknown; kind?: unknown } | null
  /**
   * A template composed against a routed listing or entry: its route pattern
   * (`/videos`, `/videos/:slug`), what it renders, the address being shown,
   * and what a visitor gets when the template has no clean version.
   */
  template?: {
    role: 'list' | 'entry'
    route: string
    collectionName?: string | null
    entryPath?: string | null
    fallback?: 'built-in-design' | 'not-found'
  } | null
  /** An experiment variant's version of the page. */
  variant?: { experimentId: string; variantId: string; name?: string | null } | null
  /** The page's own nodes and those of each layout and component composed into it. */
  parts?: () => Promise<HostedPagePart[]>
}

/** The site's public origin, or null when it has no address yet. */
export function hostOrigin(host: Record<string, unknown> | null | undefined): string | null {
  const subdomain = typeof host?.['subdomain'] === 'string' ? (host['subdomain'] as string) : ''
  const cname = typeof host?.['cname'] === 'string' ? (host['cname'] as string) : ''
  if (cname) return `https://${cname}`
  if (subdomain) return `https://${subdomain}.${TENANT_APEX}`
  return null
}

/**
 * A screen's route from the host routing map: `/about`, `/` for the index.
 * Null when the map does not route it — a template, an error screen, an
 * unpublished page. Never the site root for a page the map does not name:
 * that was the row that called a video template "https://aglyn.com/".
 */
export function routedScreenPath(
  host: Record<string, unknown> | null | undefined,
  screenId: string,
): string | null {
  const screens = (host?.['screens'] ?? {}) as Record<string, unknown>
  const raw = screens[screenId]
  if (typeof raw !== 'string') return null
  const clean = raw.replace(/^\/+|\/+$/g, '')
  return clean === 'index' || clean === '' ? '/' : `/${clean}`
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function hostRef(hostId: string) {
  return firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
}

/**
 * The collection route a template screen renders, by the three fields a
 * collection designates one with (the runtime's own resolution: list through
 * `listScreenId`, entry through `entryScreenId` then the legacy
 * `templateScreenId`). Null when no collection names it.
 */
async function collectionTemplateOf(
  hostId: string,
  screenId: string,
): Promise<{ role: 'list' | 'entry'; slug: string; name: string | null } | null> {
  const collections = hostRef(hostId).collection('collections')
  for (const [field, role] of [
    ['entryScreenId', 'entry'],
    ['templateScreenId', 'entry'],
    ['listScreenId', 'list'],
  ] as const) {
    const found = await collections.where(field, '==', screenId).limit(1).get()
    const doc = found.docs[0]
    const slug = text(doc?.get('slug'))
    if (doc && slug) return { role, slug, name: text(doc.get('displayName')) }
  }
  return null
}

function signalKeys(signals: readonly PhishingScreenSignal[]): Set<string> {
  return new Set(signals.map((signal) => canonicalJson(signal)))
}

/**
 * Which part of the page carries the flagged content. The page's own nodes
 * first — when they carry any of it, the page is the source and nothing else
 * is named; otherwise the first layout, then the first component, that does.
 */
export function attributeHeldSignals(
  parts: readonly HostedPagePart[],
  signals: readonly PhishingScreenSignal[],
  identity: { ownNames?: readonly (string | null | undefined)[]; ownDomains?: readonly (string | null | undefined)[] },
): HostedPagePart | null {
  const held = signalKeys(signals)
  const carries = (part: HostedPagePart) =>
    screenHostedPage({ nodes: part.nodes, ...identity }).signals.some((signal) =>
      held.has(canonicalJson(signal)),
    )
  const own = parts.filter((part) => part.type === 'screen')
  if (own.some(carries)) return null
  return (
    parts.find((part) => part.type === 'layout' && carries(part)) ??
    parts.find((part) => part.type === 'component' && carries(part)) ??
    null
  )
}

/** How many live pages render a layout or component, or null past the corpus bound. */
async function pagesUsing(hostId: string, part: HostedPagePart): Promise<number | null> {
  try {
    const { candidates, truncated } = await readUsageSources(hostRef(hostId), 500)
    if (truncated) return null
    const ids =
      part.type === 'layout'
        ? screenIdsUsingLayoutDeep(part.id, candidates.screens, candidates.layouts)
        : screenIdsUsingComponentDeep(part.id, candidates)
    return ids.length
  } catch {
    return null
  }
}

async function sourceOf(
  hostId: string,
  part: HostedPagePart,
): Promise<HeldPageSource> {
  let name = text(part.name)
  if (!name) {
    const doc = await hostRef(hostId)
      .collection(part.type === 'layout' ? 'layouts' : 'components')
      .doc(part.id)
      .get()
      .catch(() => null)
    name = text(doc?.get('displayName')) ?? text(doc?.get('name'))
  }
  return {
    type: part.type === 'layout' ? 'layout' : 'component',
    id: part.id,
    name,
    pagesUsing: await pagesUsing(hostId, part),
  }
}

/**
 * Describe the reviewed page. Best effort throughout: a read that fails
 * leaves its field empty, and the subject still names what it can — it is a
 * label on a decision already made, never a reason to change it.
 */
export async function describeHeldPage(input: {
  hostId: string
  screenId: string
  versionId: string
  host: Record<string, unknown> | null
  page?: HostedPageContext | null
  signals: readonly PhishingScreenSignal[]
  identity: { ownNames?: readonly (string | null | undefined)[]; ownDomains?: readonly (string | null | undefined)[] }
  /** The page was already live and keeps serving (the flag path). */
  live: boolean
  /** The last version the page served clean, if any. */
  previousVersionId: string | null
}): Promise<HeldPageSubject> {
  const page = input.page ?? {}
  let screen = page.screen ?? null
  if (!screen) {
    screen = await hostRef(input.hostId)
      .collection('screens')
      .doc(input.screenId)
      .get()
      .then((doc) => (doc.exists ? (doc.data() ?? null) : null))
      .catch(() => null)
  }
  const name = text(screen?.displayName) ?? text(screen?.name)
  const origin = hostOrigin(input.host)
  const routed = routedScreenPath(input.host, input.screenId)

  let kind: HeldPageKind = 'screen'
  let route: string | null = routed
  let collectionName: string | null = null
  let entryPath: string | null = null
  let fallback: 'built-in-design' | 'not-found' = 'not-found'

  if (page.template) {
    kind = page.template.role === 'list' ? 'list-template' : 'entry-template'
    route = page.template.route
    collectionName = text(page.template.collectionName)
    entryPath = text(page.template.entryPath)
    fallback = page.template.fallback ?? 'not-found'
  } else if (!page.variant && !routed) {
    // Not routed and not handed over: a template the caller did not
    // describe, or an error screen.
    const template = await collectionTemplateOf(input.hostId, input.screenId).catch(() => null)
    if (template) {
      kind = template.role === 'list' ? 'list-template' : 'entry-template'
      route = template.role === 'list' ? `/${template.slug}` : `/${template.slug}/:slug`
      collectionName = template.name
      fallback = 'built-in-design'
    } else if (screen?.kind === 'error') {
      kind = 'error-screen'
    }
  }
  if (page.variant) kind = 'variant'

  let source: HeldPageSource | null = null
  if (page.parts) {
    const parts = await page.parts().catch(() => [] as HostedPagePart[])
    const part = attributeHeldSignals(parts, input.signals, input.identity)
    if (part) source = await sourceOf(input.hostId, part)
  }

  const visitorView: HeldPageVisitorView = input.live
    ? 'live'
    : kind === 'variant'
      ? 'published-version'
      : input.previousVersionId && input.previousVersionId !== input.versionId
        ? 'previous-version'
        : kind === 'list-template' || kind === 'entry-template'
          ? fallback
          : 'not-found'

  const addressable = kind === 'screen' || kind === 'list-template' || kind === 'variant'
  return {
    kind,
    screenId: input.screenId,
    versionId: input.versionId,
    name,
    route,
    url: origin && route && addressable ? `${origin}${route === '/' ? '/' : route}` : null,
    entryUrl: origin && entryPath ? `${origin}${entryPath}` : null,
    collectionName,
    variantName: page.variant ? text(page.variant.name) : null,
    source,
    visitorView,
  }
}
