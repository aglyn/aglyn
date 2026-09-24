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

import type { HostOverlay } from '../model'

/**
 * How an overlay row reads, in the site's own list and in the
 * organization's list of every site's overlays — one spelling for both, so
 * the same overlay does not read two ways one click apart.
 */

/**
 * The overlay's name, or the opening of its copy when nobody named it — the
 * editor stores an empty name as `null` — or its id when it has neither.
 */
export function overlayDisplayName(
  overlay: HostOverlay & { $id?: string },
): string {
  if (overlay.name) return overlay.name
  const copy =
    overlay.kind === 'bar' ? overlay.bar?.text : overlay.popup?.headline
  return (copy ?? '').slice(0, 32) || overlay.$id || ''
}

/** The showing window, open ends as `…`, or `Always` with neither end set. */
export function overlayWindowLabel(
  overlay: Pick<HostOverlay, 'startAtMs' | 'endAtMs'>,
): string {
  if (!overlay.startAtMs && !overlay.endAtMs) return 'Always'
  const day = (ms?: number) => (ms ? new Date(ms).toLocaleDateString() : '…')
  return `${day(overlay.startAtMs)} → ${day(overlay.endAtMs)}`
}

/** The page patterns it shows on, or `All pages` with none. */
export function overlayPagesLabel(
  overlay: Pick<HostOverlay, 'pathPatterns'>,
): string {
  return overlay.pathPatterns?.length
    ? overlay.pathPatterns.join(', ')
    : 'All pages'
}

/**
 * Lifetime engagement (AGL-271) — the counters the beacon increments — or a
 * dash for an overlay nobody has seen yet.
 */
export function overlayEngagementLabel(
  stats: HostOverlay['stats'] | undefined,
): string {
  const impressions = stats?.impressions ?? 0
  const clicks = stats?.clicks ?? 0
  const dismissals = stats?.dismissals ?? 0
  if (!impressions && !clicks && !dismissals) return '—'
  const parts = [`${impressions.toLocaleString()} views`]
  if (clicks) parts.push(`${clicks.toLocaleString()} clicks`)
  if (dismissals) parts.push(`${dismissals.toLocaleString()} dismissed`)
  return parts.join(' · ')
}
