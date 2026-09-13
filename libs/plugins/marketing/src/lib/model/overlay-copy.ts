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

import {
  type HostTokenSource,
  resolveHostTokens,
} from '@aglyn/aglyn/app-utils/host-tokens'
import {
  type HostVariable,
  resolveBindings,
} from '@aglyn/aglyn/app-utils/variables'

/**
 * The fields of a bar or popup that hold copy: a bar's `text`, a popup's
 * `headline` and `body`. Links, labels and colors are not copy and are never
 * resolved.
 */
export const OVERLAY_COPY_FIELDS = ['text', 'headline', 'body'] as const

/**
 * Overlay copy as a visitor reads it: an announcement bar's text, and a
 * popup's headline and body.
 *
 * Every path that puts overlay copy in front of a visitor goes through this
 * one function — the bar and popup a page shows on load, and a bar or popup an
 * automation shows later — so the same overlay cannot read one way when it
 * matches the page and another way when an automation opens it.
 *
 * The order is the one a page's own copy is resolved in: site variables
 * (`{{var:id}}`) first, then the site's details (`{{host.*}}`). A variable
 * whose document is gone renders as nothing, and so does a detail the site has
 * not set; neither ever reaches a visitor as the token.
 *
 * Deep imports rather than either `@aglyn/aglyn` barrel: the server enricher
 * and the console editors both import this module, and the client barrel
 * carries React contexts a server graph must not load.
 *
 * @param variables - the site's variables keyed by document id, as
 *   `getVariables` returns them.
 * @param host - the site document the copy is published on.
 */
export function resolveOverlayCopy(
  text: string,
  variables: Record<string, HostVariable>,
  host: HostTokenSource | null | undefined,
): string {
  if (typeof text !== 'string' || !text.includes('{{')) return text
  return resolveHostTokens(resolveBindings(text, variables), host)
}

/** Any `{{…}}` token, whatever it names. */
const ANY_TOKEN_PATTERN = /\{\{[^{}]*\}\}/g

/**
 * The tokens in stored overlay copy that a visitor would read exactly as
 * typed: every token {@link resolveOverlayCopy} leaves in place.
 *
 * A bare `{{name}}` is one — nothing on a published page resolves that form,
 * which is why an editor rewrites a name it recognizes to `{{var:id}}` before
 * saving — and so is any token overlay copy has no source for, such as a
 * function call or an entry field.
 *
 * Each token is put through the published page's own resolution rather than
 * matched against a list of forms, so what an editor warns about cannot drift
 * from what the page does. A variable whose document is gone and a detail the
 * site has not set both render as nothing, and neither is listed.
 */
export function overlayCopyTokensShownAsTyped(
  text: string | undefined,
  variables: Record<string, HostVariable>,
  host: HostTokenSource | null | undefined,
): string[] {
  if (typeof text !== 'string' || !text.includes('{{')) return []
  const shown = new Set<string>()
  for (const token of text.match(ANY_TOKEN_PATTERN) ?? []) {
    if (resolveOverlayCopy(token, variables, host) === token) shown.add(token)
  }
  return [...shown]
}
