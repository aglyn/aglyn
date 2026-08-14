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
 * Which legal documents actually have a page (AGL-1660).
 *
 * The apps link legal documents by absolute URL, because the canonical text
 * lives on the marketing site rather than in the repo. That works right up
 * until a constant names a document nobody published: `PUBLISHER_AGREEMENT_URL`
 * pointed at `/legal/marketplace-publisher-agreement` for two and a half weeks
 * while the console asked publishers to accept it, and the URL 404ed the whole
 * time. Nothing in the build could see that, and a legal audit found it.
 *
 * So the repo keeps its own record of what the site serves. It is a *list*, not
 * a fetch: a test that hit the network would be offline-flaky and would pass
 * against a stale ISR cache anyway (a cached 200 for a page since removed).
 * A list is checkable in CI, and wrong in exactly one direction — it can only
 * go stale by claiming a page exists, which is the mistake the reviewer of the
 * edit that adds a path is looking straight at.
 *
 * VERIFIED 2026-08-14 against the live `/legal` index, which links these eight
 * documents and no others. `/legal/marketplace-publisher-agreement` is
 * deliberately ABSENT — publishing it is a besigner action on the live site and
 * the source text is still an unreviewed draft (`DRAFT — ATTORNEY REVIEW
 * REQUIRED`, `[EFFECTIVE DATE]`). Add it here when, and only when, the page is
 * live: `publisherAgreementIsPublished()` reads this list, so that one edit is
 * what re-opens the acceptance control in the console.
 */

/** The origin the canonical legal documents are served from. */
export const LEGAL_ORIGIN = 'https://aglyn.com'

/** Paths under {@link LEGAL_ORIGIN} that have a published page. */
export const PUBLISHED_LEGAL_PATHS: readonly string[] = [
  '/legal',
  '/legal/acceptable-use',
  '/legal/cookies',
  '/legal/dmca',
  '/legal/dpa',
  '/legal/eula',
  '/legal/privacy',
  '/legal/subprocessors',
  '/legal/terms',
]

/**
 * Whether `url` names a legal document that is actually published.
 *
 * Accepts an absolute URL or a site-relative path. Anything on another origin
 * is false — a lookalike host is not our published text, and this is used to
 * decide whether a user may be asked to agree to something.
 */
export function isPublishedLegalUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(url, LEGAL_ORIGIN)
  } catch {
    return false
  }
  if (parsed.origin !== LEGAL_ORIGIN) return false
  const path = parsed.pathname.replace(/\/+$/, '') || '/'
  return PUBLISHED_LEGAL_PATHS.includes(path)
}
