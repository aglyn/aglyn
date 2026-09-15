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
 * The text fields of a screen's `seo` map, as the editors present them.
 *
 * One list for every surface that edits or proposes them: the console's
 * `buildScreenSeoUpdate` carries exactly these forward and removes them when
 * emptied, the screen besigner offers them for staging under
 * {@link screenSeoStageKey}, and anything that proposes a title or a
 * description derives its field set from here rather than from a copy, so a
 * field added to the editor is a field every proposer learns about in the
 * same change.
 */
export const SCREEN_SEO_TEXT_FIELDS = ['title', 'description'] as const

export type ScreenSeoTextField = (typeof SCREEN_SEO_TEXT_FIELDS)[number]

/**
 * The length each field reads best at, in characters — the figure the
 * editors' helper text gives. Guidance, not a limit: the value is published
 * verbatim whatever its length.
 */
export const SCREEN_SEO_TEXT_GUIDANCE: Readonly<Record<ScreenSeoTextField, number>> = {
  title: 60,
  description: 160,
}

/** The key an editor offers a field for staging under (`seo.title`). */
export function screenSeoStageKey(field: ScreenSeoTextField): string {
  return `seo.${field}`
}
