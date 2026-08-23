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
 * Tab titles for the routes whose URL names ONE THING (AGL-2486).
 *
 * ## The bug
 *
 * Four Chrome tabs, open on four different screens of one site, all reading
 * `Screen besigner · aglyn-m…`. The id was in the URL and unused: the title
 * named the CONTAINER (the site) and the ACTIVITY (besigning a screen) and
 * never the screen. The same shape held on components, layouts, templates,
 * email templates, plugins, team members and every staff detail page — 21
 * routes, because it was copied, not reasoned about, each time.
 *
 * ## Why the subject comes FIRST
 *
 * A browser tab is ~20 characters wide and truncates from the RIGHT. The
 * reported screenshot proves it: `Screen besigner · aglyn-m…` cut off exactly
 * where the distinguishing part would have started. So the order is
 * `subject · noun · scope` — most specific first — and not the
 * `noun · scope` these routes shipped, nor `noun · subject`, which would
 * truncate to the same 20 characters the bug already has.
 *
 * ## Why the id is an acceptable subject
 *
 * {@link entityPageTitle} is called on the SERVER, from `generateMetadata`,
 * where the only thing known about the entity is the id from the URL. It does
 * not read the entity, and the decision not to is the substantive one — see
 * the docblock on `useDocumentSubject` in `document-subject.tsx` for why a
 * server-side name lookup is a disclosure problem in this app and not merely
 * a slow one.
 *
 * So the first paint says `4L_o499p_p · Screen besigner · demo.aglyn.app`,
 * which is ugly and completely sufficient: four tabs are four different
 * strings, the id is one the user's own URL bar is already showing, and
 * nothing is disclosed to an unauthenticated fetch of the route that the
 * requester did not have to know to make the request. The client then
 * upgrades the subject in place to the loaded name.
 */

/** The separator the console's titles have always used. */
export const TITLE_SEPARATOR = ' · '

export interface EntityTitleParts {
  /**
   * WHICH one: the entity's display name when it is known, otherwise its id.
   * Empty is tolerated and degrades to the old container-only title rather
   * than emitting a stray separator.
   */
  subject?: string
  /** WHAT KIND of page: `Screen besigner`, `Component`, `Staff user`. */
  noun: string
  /** WHERE: the site host, or nothing for a platform-level page. */
  scope?: string
}

/** Trimmed, or `''` for anything that is not a live string. */
function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * `subject · noun · scope`, skipping the parts that are absent.
 *
 * `strictNullChecks` is off repo-wide, so an absent field arrives here as
 * `undefined` rather than being caught at compile time — hence filtering on
 * the VALUE rather than trusting the type.
 */
export function entityPageTitle(parts: EntityTitleParts): string {
  return [clean(parts.subject), clean(parts.noun), clean(parts.scope)]
    .filter(Boolean)
    .join(TITLE_SEPARATOR)
}

/**
 * Swaps the SUBJECT of an already-rendered title from the id to the name.
 *
 * This is the whole client-side contract, and it is a prefix rewrite rather
 * than a re-render for one reason: `ConsoleBrandingEffects` defends the title
 * with a `MutationObserver`, because Next re-renders `<title>` on every client
 * navigation. A third such writer would fight it. So the client does not
 * BUILD a title; it transforms the one the server sent, inside that
 * component's existing apply pass.
 *
 * THIRD, not second: `notifications-menu.component.tsx` is already a second
 * writer, prepending an unread badge (`(3) `) under an observer of its own.
 * The two coexist because both are idempotent and act on opposite ends of the
 * string — and because the badge writer strips before it re-applies. This
 * function therefore takes a title that has ALREADY had the badge removed by
 * its caller; matching at position 0 against a badged title finds nothing,
 * which is exactly how this shipped broken to localhost before the strip went
 * in.
 *
 * Idempotent by construction: after the swap the title no longer begins with
 * the id, so a second pass — which the observer will certainly make, since
 * the write is itself a mutation of `<head>` — returns it unchanged. That is
 * the same property `ConsoleBrandingEffects` relies on for the brand rename,
 * and it is what keeps the two transforms composable in either order.
 *
 * Anchored at the START, not a substring replace: an id that happened to
 * occur inside a screen's name would otherwise be rewritten mid-title.
 */
export function renameTitleSubject(
  title: string,
  from: string,
  to: string,
): string {
  const current = clean(title)
  const id = clean(from)
  const name = clean(to)
  // Renaming a thing to the name it already has is not a rename, and an empty
  // name must never blank the tab — the id is a worse subject than the name
  // and a far better one than nothing.
  if (!current || !id || !name || id === name) return current
  const prefix = `${id}${TITLE_SEPARATOR}`
  if (current === id) return name
  if (!current.startsWith(prefix)) return current
  return `${name}${current.slice(id.length)}`
}
