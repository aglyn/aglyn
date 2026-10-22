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

import { sanitizeEventParams } from '@aglyn/aglyn/app-utils/analytics-events'
import { stripUnreadBadge } from './notification-alerts'

/**
 * Build the console's SPA `page_view` params (AGL-1643).
 *
 * ## Why `page_location` must be a full URL
 *
 * It used to be `usePathname()` — `/org/hosts`. GA4 specifies `page_location`
 * as the full URL and DERIVES the Hostname dimension from it, and Hostname is
 * how one property tells `aglyn.com` from `app.aglyn.com` now that both report
 * into `G-YW5PG16YTM`. A host-less value did not merely look untidy: it
 * emptied the dimension the whole property consolidation rests on, and took
 * the landing-page and page-referrer dimensions with it.
 *
 * ## Why it goes through the sanitizer
 *
 * Every other console event reaches GA through `trackEvent`, which sanitizes;
 * this one call used `logEvent` directly and bypassed it. That matters more
 * here than anywhere else, because a console URL is the value most likely to
 * carry an address — prefilled invite and signup links put one in the query.
 * `sanitizeEventParams` reduces any `http(s)` value to origin + pathname, so
 * the query is gone before the hit is built and the upgrade from pathname to
 * full URL cannot leak more than the pathname already did.
 *
 * ## Why `page_title` is sent EXPLICITLY (AGL-2060)
 *
 * GA4 reads `page_title` from `document.title` at the instant the hit is
 * built, and the console writes a live unread-notification counter into that
 * title (`notifications-menu.component.tsx`, a real feature — "Unread count
 * in tab title", on by default). So a per-user, per-moment counter became a
 * reporting DIMENSION VALUE: one console page arrived in GA4 as three rows —
 * 6.2K, 2.2K `(4) …`, 1.7K `(5) …` — split by how many notifications the
 * viewer happened to have unread. Views for a page were divided across an
 * unbounded set of rows that correlates with engagement, so the most active
 * users fragmented the most and no page ever showed a true total.
 *
 * Passing the title as a param takes the value out of the SDK's hands, and
 * `stripUnreadBadge` — the exact inverse of the `unreadBadge` that writes it —
 * removes the counter. The badge itself is untouched; only its reflection in
 * analytics goes away.
 *
 * ## Why an empty title omits the key rather than sending `''`
 *
 * Next 16 STREAMS metadata for any route whose `generateMetadata` awaits I/O:
 * the shell ships with no `<title>` at all and the real one is inserted near
 * the end of the stream. Measured on `/{org}/marketplace/{listingId}`, whose
 * card does a Firestore read — `</head>` at byte 40934 with no title in it,
 * `Marketplace listing · Aglyn` at byte 80279 of 83383. Hydration, and so
 * this hit, can beat that. An explicit `''` would report those views as an
 * empty title; omitting the key lets GA4 fall back to its own reading, which
 * is no worse than the behaviour before this function existed.
 *
 * Extracted from the layout so the guarantee is testable without mounting the
 * console's whole provider tree.
 */
export function buildConsolePageViewParams(
  href: string,
  title?: string,
): Record<string, unknown> {
  const pageTitle = buildConsolePageTitle(title)
  return sanitizeEventParams({
    page_location: href,
    ...(pageTitle ? { page_title: pageTitle } : {}),
  })
}

/**
 * The reported form of a tab title: badge stripped, trimmed, `''` when there
 * is nothing worth reporting.
 *
 * Split out of the builder above for AGL-2087, which needs the same value for
 * a second destination — `setDefaultEventParameters`, so that the two raw
 * `screen_view` calls and the SDK's automatic `session_start` / `first_visit`
 * / `user_engagement` stop reading the badge off `document.title` too. The
 * `page_view` param keeps precedence over the default (an explicit param on
 * an event always wins), so the builder is unchanged in behaviour; this is
 * one rule with two readers rather than two rules that agree today.
 *
 * `''` is the "omit it" signal at BOTH destinations, for the same measured
 * reason: Next 16 streams metadata for a route whose `generateMetadata`
 * awaits I/O, so the title can arrive after hydration. On the event the key
 * is left out; on the default set the key is patched to `undefined`. Either
 * way GA4 falls back to its own reading, which is no worse than the behaviour
 * before any of this existed — and better than pinning an empty string as a
 * dimension value.
 */
export function buildConsolePageTitle(title?: string): string {
  return stripUnreadBadge(title ?? '').trim()
}
