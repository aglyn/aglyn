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
 * A HELD OR FLAGGED PAGE, NAMED (AGL-3374).
 *
 * The page phishing screen (`hosted-page-review.ts`) reviews a page where it
 * is composed, and knows only a screen id. A screen id is not what anybody
 * calls a page, and the routing map that turns one into an address does not
 * hold every kind of page: a collection's entry template renders
 * `/videos/{entry}` for every entry and has no address of its own, so a row
 * built from the map alone named the site's home page for it.
 *
 * So the review describes the page ONCE, as a {@link HeldPageSubject} —
 * what kind of page, its name, its route, the entry that triggered it, the
 * layout or component the flagged content lives in, and what visitors see
 * meanwhile — and stores that on the review row and on the owners' notice.
 * Every reader names the page from it through the functions here: the owner
 * notice's `item.label`, the staff row, the console's chips and banners, and
 * Settings → Holds & reviews. One description, so the owner's email and the
 * banner in the editor cannot name two different pages.
 *
 * Pure and client-safe: the console imports it.
 *=========================================*/

/** The two notice kinds that are about a page (the risk notice catalog's). */
export const PAGE_HOLD_NOTICE_KINDS = ['page-held', 'page-flagged'] as const
export type PageHoldNoticeKind = (typeof PAGE_HOLD_NOTICE_KINDS)[number]

export function isPageHoldNoticeKind(value: unknown): value is PageHoldNoticeKind {
  return (PAGE_HOLD_NOTICE_KINDS as readonly unknown[]).includes(value)
}

/**
 * What kind of page was reviewed.
 *
 * - `screen`: a page at an address of its own.
 * - `list-template`: a collection's listing template, served at `/{slug}`.
 * - `entry-template`: a template that renders every entry of a collection
 *   (or every product) at `/{slug}/:slug`, with no address of its own.
 * - `error-screen`: a screen bound to one of the site's error slots.
 * - `variant`: an experiment variant's version of a page.
 */
export type HeldPageKind =
  | 'screen'
  | 'list-template'
  | 'entry-template'
  | 'error-screen'
  | 'variant'

/**
 * What visitors receive while the page is under review.
 *
 * - `previous-version`: the last version the page served clean.
 * - `not-found`: nothing — the page had never served clean.
 * - `built-in-design`: a template with no clean version: the collection's
 *   routes fall back to the site's built-in design for them.
 * - `published-version`: a held variant: its visitors get the published page.
 * - `live`: a flagged page that was already live keeps serving.
 */
export type HeldPageVisitorView =
  | 'previous-version'
  | 'not-found'
  | 'built-in-design'
  | 'published-version'
  | 'live'

/** A layout or component the flagged content came from, when not the page's own. */
export interface HeldPageSource {
  type: 'layout' | 'component'
  id: string
  name: string | null
  /** How many live pages render it, when that could be counted. */
  pagesUsing: number | null
}

/** One held or flagged page, described once at review time. */
export interface HeldPageSubject {
  kind: HeldPageKind
  screenId: string
  versionId: string
  /** The screen's (or template's) own name. */
  name: string | null
  /** The route it serves: `/about`, `/videos`, `/videos/:slug`. */
  route: string | null
  /** The page's public address, when it has one of its own. */
  url: string | null
  /** An entry template: the address of the entry that was being composed. */
  entryUrl: string | null
  /** A template: the collection (or `Products`) it renders. */
  collectionName: string | null
  /** A variant: its name in the experiment. */
  variantName: string | null
  source: HeldPageSource | null
  visitorView: HeldPageVisitorView
}

/** A console document a hold can be shown on. */
export interface HeldPageTarget {
  type: 'screen' | 'layout' | 'component'
  id: string
}

const NAME_MAX = 80

function quoted(value: string | null | undefined): string | null {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
  return text ? `"${text.replace(/"/g, '”')}"` : null
}

function withRoute(text: string, route: string | null): string {
  return route ? `${text} (${route})` : text
}

/**
 * The page in the owner's words, as the notice's `item.label` and every
 * console surface render it: `the "About" page (/about)`,
 * `the "Video detail" template (/videos/:slug)`,
 * `variant "B" of the "Pricing" page (/pricing)`.
 */
export function heldPageLabel(subject: HeldPageSubject): string {
  const name = quoted(subject.name)
  switch (subject.kind) {
    case 'list-template':
      return withRoute(
        name
          ? `the ${name} list template`
          : subject.collectionName
            ? `the ${quoted(subject.collectionName)} list template`
            : 'a collection list template',
        subject.route,
      )
    case 'entry-template':
      return withRoute(
        name
          ? `the ${name} template`
          : subject.collectionName
            ? `the ${quoted(subject.collectionName)} entry template`
            : 'a collection entry template',
        subject.route,
      )
    case 'error-screen':
      return name ? `the ${name} error page` : 'an error page'
    case 'variant': {
      const page = withRoute(name ? `the ${name} page` : 'a page', subject.route)
      const variant = quoted(subject.variantName)
      return variant ? `variant ${variant} of ${page}` : `an experiment variant of ${page}`
    }
    default:
      return name
        ? withRoute(`the ${name} page`, subject.route)
        : subject.route
          ? `the page ${subject.route}`
          : 'a page on your site'
  }
}

/** The layout or component, in words: `the layout "Main", used on 12 pages`. */
export function heldPageSourceLabel(source: HeldPageSource): string {
  const name = quoted(source.name)
  const noun = source.type === 'layout' ? 'layout' : 'component'
  const base = name ? `the ${noun} ${name}` : `a ${noun}`
  if (source.pagesUsing === null) return base
  return `${base}, used on ${source.pagesUsing} ${source.pagesUsing === 1 ? 'page' : 'pages'}`
}

/**
 * The facts beside the name, one sentence each: where the entry template was
 * seen and which layout or component the flagged content lives in. The owner
 * surfaces and the staff row both render these.
 */
export function heldPageDetails(subject: HeldPageSubject): string[] {
  const lines: string[] = []
  if (subject.kind === 'entry-template' && subject.entryUrl) {
    lines.push(`Found while showing ${subject.entryUrl}.`)
  } else if (subject.url && subject.kind !== 'entry-template') {
    lines.push(`Address: ${subject.url}.`)
  }
  if (subject.source) {
    lines.push(
      `The flagged content is in ${heldPageSourceLabel(subject.source)}, not on the page itself.`,
    )
  }
  return lines
}

/** What visitors receive meanwhile, as one sentence. */
export function heldPageVisitorSentence(subject: Pick<HeldPageSubject, 'visitorView'>): string {
  switch (subject.visitorView) {
    case 'live':
      return 'Visitors still see this page while it is reviewed.'
    case 'previous-version':
      return 'Visitors see the previous version of this page until the review is done.'
    case 'built-in-design':
      return 'Visitors see the site’s built-in design for these pages until the review is done.'
    case 'published-version':
      return 'Visitors in this variant see the page’s published version until the review is done.'
    default:
      return 'Visitors see a not-found page until the review is done.'
  }
}

/**
 * Where the owner fixes it, in the stored-notification shape
 * (`/{hostId}/…`): the layout or component the flagged content lives in, or
 * the held version of the page itself.
 */
export function heldPageConsolePath(subject: HeldPageSubject, hostId: string): string {
  if (subject.source?.type === 'layout') {
    return `/${hostId}/layouts/${encodeURIComponent(subject.source.id)}`
  }
  if (subject.source?.type === 'component') {
    return `/${hostId}/components/${encodeURIComponent(subject.source.id)}`
  }
  return (
    `/${hostId}/screens/${encodeURIComponent(subject.screenId)}` +
    `/versions/${encodeURIComponent(subject.versionId)}/view`
  )
}

/** Every console document the hold is shown on: the page, and its source. */
export function heldPageTargets(subject: HeldPageSubject): HeldPageTarget[] {
  const targets: HeldPageTarget[] = [{ type: 'screen', id: subject.screenId }]
  if (subject.source) targets.push({ type: subject.source.type, id: subject.source.id })
  return targets
}

/**
 * The screen and version a page notice's stored `itemPath` names, for a
 * notice written before it carried a subject. Null for any other path.
 */
export function parseHeldPageItemPath(
  path: string | null | undefined,
): { screenId: string; versionId: string } | null {
  const match = /^\/[^/]+\/screens\/([^/]+)\/versions\/([^/]+)\/view$/.exec(String(path ?? ''))
  if (!match) return null
  try {
    return { screenId: decodeURIComponent(match[1]), versionId: decodeURIComponent(match[2]) }
  } catch {
    return null
  }
}

/** A hold's review state, as the owner surfaces receive it. */
export type PageHoldStatus = 'held' | 'in-review' | 'released' | 'rejected' | 'closed' | null

/** Whether a hold is still something the owner has to see. */
export function isOpenPageHoldStatus(status: PageHoldStatus): boolean {
  return status === 'held' || status === 'in-review' || status === 'rejected'
}

/** The status chip on a held or flagged page. There is never a release control beside it. */
export function pageHoldChip(
  kind: PageHoldNoticeKind,
  status: PageHoldStatus,
): { label: string; color: 'warning' | 'error' | 'info' } {
  if (status === 'rejected') return { label: 'Not approved', color: 'error' }
  if (kind === 'page-flagged') return { label: 'Flagged — live, under review', color: 'info' }
  return { label: 'Held for review', color: 'warning' }
}
