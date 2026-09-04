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
 * One path segment of a public URL, derived from something a human typed.
 *
 * Lowercase, runs of non-alphanumerics collapsed to a single `-`, no leading
 * or trailing dash. Deliberately LOSSY and IDEMPOTENT: the same subject
 * addresses the same URL whether the caller passes a stored id, a display
 * name, or the segment itself. `Open source` → `open-source` → `open-source`.
 *
 * ## Why this is one function and not two
 *
 * The category route (AGL-1321) and the author route (AGL-2518) both have to
 * answer the same question twice, in two directions: BUILD a link from a
 * record, and MATCH an incoming segment back to that record. Four call sites
 * for one rule — and they only work because all four normalize identically.
 * Two implementations that agree today are a bug waiting for whichever one is
 * edited first, and the failure is silent: the archive simply comes back
 * empty, which is also what an author with no posts looks like.
 *
 * Not to be confused with `slugifyDatasetFieldId` or `slugifyHeading`, which
 * are not URL segments and have their own rules (an identifier may not start
 * with a digit; a heading anchor keeps its own collision suffixes).
 */
export function urlSlugSegment(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default urlSlugSegment
