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
 * Preview and view links open in a NEW TAB (AGL-3660).
 *
 * A "Preview", "View live", "Visit site" or eye-icon action shows the reader
 * something ELSE — a rendered artifact, a published page, a buyer's view —
 * while they are in the middle of working on a list or an editor. Sending the
 * console tab there threw away their place (filters, scroll, an open drawer)
 * for a glance they meant to take beside it. So every such action opens a tab
 * of its own, and says so to assistive tech.
 *
 * This module is the one place that spelling lives:
 *
 * - {@link newTabLinkProps} for an anchor / `AppLink` / MUI `href` control;
 * - {@link openInNewTab} for a click handler that has the URL in hand;
 * - {@link openPendingTab} for one that must `await` the URL first — a tab
 *   opened after the await is a popup the browser blocks;
 * - {@link withNewTabHint} for the accessible name.
 *
 * `apps/console/specs/preview-links-open-in-new-tab.spec.ts` sweeps the
 * console and plugin sources and fails when a preview/view action is wired
 * without one of these (or an equivalent `target="_blank"`).
 */

/** The suffix every new-tab control's accessible name ends with. */
export const NEW_TAB_HINT = '(opens in a new tab)'

/**
 * `noopener` so the opened page cannot script this console through
 * `window.opener`; `noreferrer` so a published site does not learn the
 * console URL (org slug, site id) it was opened from.
 */
export const NEW_TAB_REL = 'noopener noreferrer'

/** Spread onto an anchor-rendering control: `<AppLink {...newTabLinkProps}>`. */
export const newTabLinkProps = Object.freeze({
  target: '_blank',
  rel: NEW_TAB_REL,
} as const)

/**
 * `rel` for a new-tab link that already carries tokens of its own
 * (`nofollow`, say): theirs, plus `noopener noreferrer`, each once.
 */
export function mergeNewTabRel(rel?: string | null): string {
  const tokens = new Set(
    `${rel ?? ''} ${NEW_TAB_REL}`.split(/\s+/).filter(Boolean),
  )
  return [...tokens].join(' ')
}

/** `label` with {@link NEW_TAB_HINT} appended, exactly once. */
export function withNewTabHint(label: string): string {
  const trimmed = label.trim()
  return trimmed.endsWith(NEW_TAB_HINT) ? trimmed : `${trimmed} ${NEW_TAB_HINT}`
}

/**
 * Open `url` in a new tab from a click handler. Use this rather than
 * `router.push` / `location.assign` for a preview or view action.
 */
export function openInNewTab(url: string): void {
  if (typeof window === 'undefined' || !url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** A tab opened during the click, navigated once its URL is known. */
export interface PendingTab {
  /** Send the tab to `url`; falls back to {@link openInNewTab} if the browser
   *  refused the blank tab. Never navigates the console tab itself. */
  navigate(url: string): void
  /** Close the blank tab, for when the URL could not be produced. */
  close(): void
}

/**
 * Open a blank tab NOW, inside the click's user activation, and point it at a
 * URL that is only known after an `await`.
 *
 * NOT `window.open('', '_blank', 'noopener')`: with `noopener` the browser
 * returns `null`, so there is no handle to navigate — the pattern that left
 * "Preview on site" opening an empty tab AND moving the console tab. Instead
 * the tab is opened with a handle and its `opener` is cut by hand before it
 * goes anywhere, which is what `noopener` would have done.
 */
export function openPendingTab(): PendingTab {
  const tab =
    typeof window === 'undefined' ? null : window.open('about:blank', '_blank')
  if (tab) {
    try {
      tab.opener = null
    } catch {
      // Cross-origin by now is impossible for about:blank; nothing to cut.
    }
  }
  return {
    navigate(url: string) {
      if (!url) return
      if (tab && !tab.closed) tab.location.replace(url)
      else openInNewTab(url)
    },
    close() {
      if (tab && !tab.closed) tab.close()
    },
  }
}
