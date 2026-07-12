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

import type {
  HostAnnouncementBar,
  HostPopup,
} from '@aglyn/aglyn'

/**
 * Marketing hub overlays (AGL-251): multiple announcement bars and
 * promotional popups per host at `hosts/{hostId}/overlays/{overlayId}`,
 * each with its own schedule window and page targeting. The legacy single
 * `host.announcementBar` / `host.popup` fields keep working as fallbacks
 * when no overlay doc matches. Pure types + resolution helpers here; the
 * tenant render picks the first active match per kind.
 */
export interface HostOverlay {
  kind: 'bar' | 'popup'
  /** Display name in the console list (e.g. "Black Friday bar"). */
  name?: string
  /** Disabled overlays never render; new overlays default enabled. */
  enabled?: boolean
  /** Bar payload when `kind: 'bar'` (the legacy shape, minus enabled). */
  bar?: Omit<HostAnnouncementBar, 'enabled'>
  /** Popup payload when `kind: 'popup'` (the legacy shape, minus enabled). */
  popup?: Omit<HostPopup, 'enabled' | 'startAtMs' | 'endAtMs'>
  /** Showing window (epoch millis; simple to serialize). */
  startAtMs?: number
  endAtMs?: number
  /**
   * Path patterns the overlay shows on; empty/absent = every page.
   * Patterns are exact paths or prefix globs (`/pricing`, `/blog/*`).
   */
  pathPatterns?: string[]
  /** Path patterns the overlay never shows on; wins over includes. */
  excludePathPatterns?: string[]
  /** List order; lower renders first when several match. */
  order?: number
  /**
   * Aggregate engagement counters (AGL-271), incremented server-side by
   * the tenant beacon — never written from the console.
   */
  stats?: {
    impressions?: number
    clicks?: number
    dismissals?: number
  }
}

/** Exact-or-prefix-glob path match: `/blog/*` matches `/blog/anything`. */
export function overlayPatternMatches(pattern: string, path: string): boolean {
  const cleaned = pattern.trim()
  if (!cleaned) return false
  const normalizedPath = path === '' ? '/' : path
  if (cleaned.endsWith('/*')) {
    const prefix = cleaned.slice(0, -2)
    if (!prefix || prefix === '/') return normalizedPath.startsWith('/')
    return (
      normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
    )
  }
  return normalizedPath === cleaned
}

/** True when the overlay targets the given path (include/exclude rules). */
export function overlayMatchesPath(
  overlay: Pick<HostOverlay, 'pathPatterns' | 'excludePathPatterns'>,
  path: string,
): boolean {
  const excludes = overlay.excludePathPatterns ?? []
  if (excludes.some((pattern) => overlayPatternMatches(pattern, path))) {
    return false
  }
  const includes = (overlay.pathPatterns ?? []).filter((pattern) =>
    pattern.trim(),
  )
  if (!includes.length) return true
  return includes.some((pattern) => overlayPatternMatches(pattern, path))
}

/** True when `nowMs` falls inside the overlay's schedule window. */
export function overlayActiveAt(
  overlay: Pick<HostOverlay, 'startAtMs' | 'endAtMs'>,
  nowMs: number,
): boolean {
  if (overlay.startAtMs && nowMs < overlay.startAtMs) return false
  if (overlay.endAtMs && nowMs > overlay.endAtMs) return false
  return true
}

/**
 * Picks the overlays to render for a page: enabled, inside their window,
 * targeting the path — sorted by `order` then name, first of each kind
 * wins (one bar + one popup per page render).
 */
export function resolveActiveOverlays(
  overlays: Array<HostOverlay & { $id?: string }>,
  context: { path: string; nowMs?: number },
): {
  bar: (HostOverlay & { $id?: string }) | null
  popup: (HostOverlay & { $id?: string }) | null
} {
  const nowMs = context.nowMs ?? Date.now()
  const active = overlays
    .filter(
      (overlay) =>
        overlay.enabled !== false &&
        overlayActiveAt(overlay, nowMs) &&
        overlayMatchesPath(overlay, context.path),
    )
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  return {
    bar: active.find((overlay) => overlay.kind === 'bar' && overlay.bar) ?? null,
    popup:
      active.find((overlay) => overlay.kind === 'popup' && overlay.popup) ??
      null,
  }
}
