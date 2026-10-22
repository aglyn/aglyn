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

import { isPublishedLegalUrl } from '@aglyn/aglyn/app-utils/published-legal-pages'

/**
 * The one honest link target for a pinned acceptance document, on the staff
 * "Legal acceptances" card.
 *
 * A stored acceptance record's `url` is `LEGAL_URLS.TERMS`/`.PRIVACY` as of
 * the moment the `sha256` beside it was pinned (see
 * `apps/console/constants/legal-documents.ts`) — the byte-for-byte accepted
 * text itself lives only as an immutable Drive snapshot with no servable URL
 * of its own, so the published page is the closest honest thing there is to
 * link the hash to, and it is exactly what the clickwrap control itself
 * linked to at acceptance time.
 *
 * Gated by `isPublishedLegalUrl` rather than trusted outright: a record whose
 * pinned URL does not name a page this deployment actually publishes today —
 * a stale value, or a document key nobody wired a page up for — renders its
 * hash as plain text rather than a link to a 404 or a lookalike host.
 */
export function legalAcceptanceDocumentHref(
  url: string | null | undefined,
): string | undefined {
  return isPublishedLegalUrl(url) ? url ?? undefined : undefined
}
