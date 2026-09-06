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
 * A view's place in a section's address (AGL-2617).
 *
 * `?view=<id>` is what makes a view linkable: a rep pastes the address of
 * "my open leads" into a chat and a colleague opens the same list. The key
 * COMPOSES with the other keys a section reads — the Contacts list's
 * `formId` and `email` seeds — rather than replacing them, so a form's page
 * can link to "the people this form captured, in my usual view" and the
 * list answers both. Pure, so the seed parser and the views controller read
 * one spelling of the key.
 */

export const CRM_VIEW_PARAM = 'view'

/** The view id a section's address names, or none. */
export function crmViewIdFromParams(
  params: { get(name: string): string | null } | null | undefined,
): string | null {
  const raw = params?.get(CRM_VIEW_PARAM) ?? ''
  const trimmed = raw.trim()
  return trimmed ? trimmed : null
}

/**
 * The same address with the view set or, with `null`, cleared — every
 * other key kept exactly as it was.
 *
 * Built from the section path and the current query rather than from
 * `location`, so a list mounted anywhere the shell mounts it links to
 * itself; `pathname` carries no query of its own.
 */
export function crmViewHref(
  pathname: string,
  params: { toString(): string } | null | undefined,
  viewId: string | null,
): string {
  const next = new URLSearchParams(params?.toString() ?? '')
  if (viewId) next.set(CRM_VIEW_PARAM, viewId)
  else next.delete(CRM_VIEW_PARAM)
  const query = next.toString()
  return query ? `${pathname}?${query}` : pathname
}
