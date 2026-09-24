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
 * Every status a site's pill can show, in the order the pill decides them,
 * keyed by the value a filter stores. The Sites list offers these as its
 * Status choices, so the pill and the filter cannot name different states.
 */
export const HOST_STATUS_LABELS = {
  suspended: 'Suspended',
  maintenance: 'Maintenance',
  live: 'Live',
  draft: 'Draft',
} as const

export type HostStatusKey = keyof typeof HOST_STATUS_LABELS

export interface HostStatus {
  /** Which of {@link HOST_STATUS_LABELS} this is. */
  key: HostStatusKey
  /** `Live`, `Draft`, `Maintenance`, `Suspended`. */
  label: string
  color: 'success' | 'default' | 'warning' | 'error'
  /** Why, in one sentence — the pill's tooltip. */
  detail: string
}

/**
 * How many pages this site publishes.
 *
 * Read off `host.screens` — the map publishing writes into the host document
 * (`hosts/{hostId}.screens[screenId] = slug`, see `template-screens.ts`) and
 * the tenant reads to route a request. So a site with an entry has at least
 * one page a visitor can reach, and one without has none. That makes this a
 * fact already sitting in a document its readers hold: **no extra read**, on
 * a page that can list a hundred sites.
 *
 * ⚠️ It counts PUBLISHED ROUTES, not authored work. A site with five
 * unpublished drafts counts 0 — the map is written by publishing and by
 * nothing else. Every caller is asking "what can a visitor reach?"; a caller
 * that means "has anyone worked on this?" is asking a different question and
 * this is the wrong number for it.
 *
 * One function rather than the same `Object.keys` in each caller: the two
 * that exist read the same map for two different decisions — the Live/Draft
 * pill and the first-run offer (AGL-2918) — and a map whose meaning is
 * spelled out twice is a map that comes to mean two things.
 */
export function publishedScreenCount(
  host: { screens?: Record<string, unknown> } | null | undefined,
): number {
  return Object.keys(host?.screens ?? {}).length
}

/**
 * The `Live` / `Draft` pill the console Sites mockup puts on every card
 * (AGL-2166).
 *
 * Derived from {@link publishedScreenCount}, so what the pill claims and what
 * the rest of the console calls a blank site are the same reading.
 *
 * The staff admin host page has rendered a `published` / `draft` chip since
 * AGL-390 off `host.published`, which is not a field on `AglynHost` and is
 * written by nothing — so that chip has always said `draft`. Deriving from
 * `screens` is what it should have done.
 *
 * Order matters. A suspended site is not "live" whatever it has published,
 * and a site in maintenance is serving the 503 screen rather than its
 * pages — reporting either as `Live` would be the console agreeing with a
 * customer who thinks their site is up.
 */
export function describeHostStatus(host: {
  screens?: Record<string, unknown>
  maintenance?: boolean
  suspendedAt?: number
  suspendedUntilMs?: number
}): HostStatus {
  if (host?.suspendedAt) {
    // A timed suspension that has elapsed is over, even though the fields
    // are still on the document — the tenant makes the same check.
    const until = host.suspendedUntilMs
    if (!until || until > Date.now()) {
      return {
        key: 'suspended',
        label: HOST_STATUS_LABELS.suspended,
        color: 'error',
        detail: 'This site is serving a lockdown notice instead of content.',
      }
    }
  }
  if (host?.maintenance) {
    return {
      key: 'maintenance',
      label: HOST_STATUS_LABELS.maintenance,
      color: 'warning',
      detail: 'Every path serves the maintenance screen.',
    }
  }
  const published = publishedScreenCount(host)
  if (published > 0) {
    return {
      key: 'live',
      label: HOST_STATUS_LABELS.live,
      color: 'success',
      detail: `${published} published page${published === 1 ? '' : 's'}.`,
    }
  }
  return {
    key: 'draft',
    label: HOST_STATUS_LABELS.draft,
    color: 'default',
    detail: 'Nothing published yet — visitors see the placeholder.',
  }
}

/**
 * `6 of 10 sites · Business plan` — the meta line the Sites mockup puts
 * opposite the section heading.
 *
 * Returns `undefined` rather than a partial line while the org or its plan
 * is still resolving. A count against the FREE limit is what an unresolved
 * org produces, and telling a Business customer they are at "1 of 1 sites"
 * is how a correct page delivers a false upgrade prompt.
 */
export function describeSiteAllowance(options: {
  used: number
  limit: number | undefined
  planLabel: string | undefined
  ready: boolean
}): string | undefined {
  const { used, limit, planLabel, ready } = options
  if (!ready || !planLabel) return undefined
  /*
   * `Number.isFinite`, not `limit < 0` (AGL-2223).
   *
   * `UNLIMITED` is `Number.POSITIVE_INFINITY`, and Enterprise's `hostLimit`
   * is exactly that — so the `< 0` test was never true for the one plan the
   * Unlimited branch existed for, and an Enterprise organization read
   * `4 of Infinity sites · Enterprise plan`. The negative case is kept: an
   * entitlement override can carry a negative sentinel, and reading that as a
   * cap of "-1 sites" would be the same class of nonsense.
   */
  const cap =
    limit === undefined || limit === null
      ? undefined
      : !Number.isFinite(limit) || limit < 0
        ? 'Unlimited'
        : String(limit)
  const sites =
    cap === undefined
      ? `${used} site${used === 1 ? '' : 's'}`
      : `${used} of ${cap} site${cap === '1' ? '' : 's'}`
  return `${sites} · ${planLabel} plan`
}
