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

/** What Next hands a server page as `searchParams`. */
export type SearchParams = Record<string, string | string[] | undefined>

/**
 * A hub index's redirect target, with the incoming query carried across
 * (AGL-2501).
 *
 * ## Why the query has to survive
 *
 * A section index is a redirect, and a redirect that drops the query silently
 * deletes information somebody else put in the URL. Stripe bakes `?connect=`
 * into account-onboarding links and `?purchase=` into checkout sessions, so a
 * seller part-way through onboarding is carrying one right now — held by a
 * third party, not by us, and unfixable from this side once it lands on a bare
 * section. The marketplace index has always carried the whole query for that
 * reason; this is the same care, in the one place every index can share.
 *
 * Carried WHOLE rather than by an allow-list: a marker nothing routes on today
 * still survives the hop, which is what makes it safe for anyone to add one.
 *
 * ## Why this is a server-side concern
 *
 * These indexes were client components that returned `null`, waited for
 * hydration, read the org slug from a hook and then navigated. Every one of
 * those steps was empty space in front of the reader. The slug is in `params`,
 * so a server component can answer with a real HTTP redirect before any
 * JavaScript ships — and the query is in `searchParams` on the same call.
 */
export function sectionIndexTarget(
  href: string,
  searchParams: SearchParams | undefined,
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue
    // A repeated key arrives as an array, and both halves have to survive:
    // dropping one is the same silent edit as dropping the parameter.
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, item)
    } else {
      query.append(key, value)
    }
  }
  const search = query.toString()
  return search ? `${href}?${search}` : href
}
