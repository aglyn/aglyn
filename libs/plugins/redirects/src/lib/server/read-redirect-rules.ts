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

import { FieldPath } from 'firebase-admin/firestore'

/**
 * How many rules one page of the walk reads (AGL-4247). Not a ceiling: the
 * walk keeps reading pages until one comes back short.
 */
export const REDIRECT_RULES_PAGE_SIZE = 500

/** The slice of a Firestore admin query the walk uses, so a spec can stand in for it. */
export interface RedirectRulesQuery<Doc> {
  where(field: string, op: '==', value: unknown): RedirectRulesQuery<Doc>
  orderBy(field: unknown): RedirectRulesQuery<Doc>
  startAfter(doc: Doc): RedirectRulesQuery<Doc>
  limit(count: number): RedirectRulesQuery<Doc>
  get(): Promise<{ docs: Doc[] }>
}

/**
 * EVERY rule of a site's `hosts/{id}/redirects`, read in pages (AGL-4247).
 *
 * The live resolver read `where('enabled', '==', true).limit(100)` with no
 * order, so a site past 100 rules lost the rest silently: Firestore answers
 * an unordered limit in document-id order, and the ids are generated, so it
 * was a pseudo-random hundred that fired and the others sent visitors to
 * "page not found". Pro and Custom are sold with no redirect limit, and a
 * Shopify or Wix move routinely brings hundreds of old addresses, so the
 * window was the bug: there is no count at which dropping a stored rule is
 * correct.
 *
 * Ordered by document id, which every document has (`source` is not
 * validated for presence, so ordering on it would drop a rule saved without
 * one, see AGL-2501), and paged with `startAfter` so no single read is
 * unbounded. The resolver caches the result per host, so the walk runs once
 * per cache entry, not per request.
 */
export async function readAllRedirectRules<Doc>(
  rules: RedirectRulesQuery<Doc>,
  options: { enabledOnly?: boolean } = {},
): Promise<Doc[]> {
  const base = options.enabledOnly ? rules.where('enabled', '==', true) : rules
  const ordered = base.orderBy(FieldPath.documentId())
  const docs: Doc[] = []
  let last: Doc | undefined
  for (;;) {
    const page = await (last === undefined ? ordered : ordered.startAfter(last))
      .limit(REDIRECT_RULES_PAGE_SIZE)
      .get()
    docs.push(...page.docs)
    if (page.docs.length < REDIRECT_RULES_PAGE_SIZE) return docs
    last = page.docs[page.docs.length - 1]
  }
}
