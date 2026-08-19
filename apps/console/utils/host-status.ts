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

export interface HostStatus {
  /** `Live`, `Draft`, `Maintenance`, `Suspended`. */
  label: string
  color: 'success' | 'default' | 'warning' | 'error'
  /** Why, in one sentence — the pill's tooltip. */
  detail: string
}

/**
 * The `Live` / `Draft` pill the console Sites mockup puts on every card
 * (AGL-2166).
 *
 * Read off `host.screens` — the map publishing writes into the host
 * document (`hosts/{hostId}.screens[screenId] = slug`, see
 * `template-screens.ts`) and the tenant reads to route a request. So a site
 * with an entry has at least one page a visitor can reach, and one without
 * has none. That makes this a fact already sitting in the document the list
 * loads: **no extra read**, on a page that can list a hundred sites.
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
        label: 'Suspended',
        color: 'error',
        detail: 'This site is serving a lockdown notice instead of content.',
      }
    }
  }
  if (host?.maintenance) {
    return {
      label: 'Maintenance',
      color: 'warning',
      detail: 'Every path serves the maintenance screen.',
    }
  }
  const published = Object.keys(host?.screens ?? {}).length
  if (published > 0) {
    return {
      label: 'Live',
      color: 'success',
      detail: `${published} published page${published === 1 ? '' : 's'}.`,
    }
  }
  return {
    label: 'Draft',
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
  const cap =
    limit === undefined || limit === null
      ? undefined
      : limit < 0
        ? 'Unlimited'
        : String(limit)
  const sites =
    cap === undefined
      ? `${used} site${used === 1 ? '' : 's'}`
      : `${used} of ${cap} site${cap === '1' ? '' : 's'}`
  return `${sites} · ${planLabel} plan`
}
