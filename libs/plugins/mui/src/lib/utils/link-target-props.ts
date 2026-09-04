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
 * Where a link opens, as authored. Persisted in screen documents; never
 * rename a value.
 *
 * - `'_self'` (or unset) — stays in the current tab, the browser default.
 * - `'_blank'` — a new tab.
 * - `'custom'` — a NAMED window, read from the companion `targetName` prop.
 *   Not an anchor value itself; it is the sentinel that reveals the name
 *   field, and never reaches the DOM.
 */
export type LinkTargetChoice = '_self' | '_blank' | 'custom'

/** The anchor attributes a {@link LinkTargetChoice} resolves to. */
export interface LinkTargetProps {
  target?: string
  rel?: string
}

/**
 * Resolves the authored target pair to the attributes an anchor should carry.
 *
 * Returns NOTHING for the default choice rather than an explicit
 * `target="_self"`: the two behave identically, and an absent attribute is
 * what every link authored before this existed already renders — so adding
 * the control moves no published markup.
 *
 * `rel` rides along because a target that opens elsewhere hands the new
 * context a live `window.opener` handle back into this page. `noreferrer` is
 * added only when the destination leaves the site: stripping the referrer
 * from a link to one of the site's own screens would make the landing page
 * read as direct traffic in its own analytics, which is a reporting defect,
 * not a safety win.
 *
 * A cleared attribute persists as `null` or `''`, and a custom choice with
 * an empty name is an author mid-edit — both fall back to the default rather
 * than stamping an empty `target` on the anchor.
 */
export function linkTargetProps(
  target: LinkTargetChoice | string | null | undefined,
  targetName: string | null | undefined,
  leavesSite: boolean,
): LinkTargetProps {
  const resolved =
    target === 'custom'
      ? typeof targetName === 'string'
        ? targetName.trim()
        : ''
      : target === '_blank'
        ? '_blank'
        : ''
  if (!resolved || resolved === '_self') return {}
  return {
    target: resolved,
    rel: leavesSite ? 'noopener noreferrer' : 'noopener',
  }
}

export default linkTargetProps
