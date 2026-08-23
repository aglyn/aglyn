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

import { safeSameOriginPath } from '@aglyn/shared-util-http/safe-redirect'

/**
 * Post-auth redirect target (AGL-553): the sign-in/up blocks honor a
 * `continue` query parameter so gated pages can send visitors back where
 * they came from. Open-redirect hardened — only same-origin RELATIVE paths
 * pass.
 *
 * Delegates to {@link safeSameOriginPath} rather than testing the string's
 * shape (AGL-1881). The character checks this used to carry — `//`, then `\`
 * — were each correct and each incomplete: the URL parser strips tab, LF and
 * CR before parsing, so `/<TAB>/evil.com` contains neither and still resolves
 * off-site. The shared predicate resolves and compares origins, so it catches
 * the forms nobody has enumerated yet.
 */
export function safeContinuePath(
  raw: string | null | undefined,
  fallback = '/',
): string {
  return safeSameOriginPath(raw, fallback)
}

/** Reads + validates the `continue` param from the current location. */
export function continuePathFromLocation(fallback = '/'): string {
  if (typeof window === 'undefined') return fallback
  return safeContinuePath(
    new URLSearchParams(window.location.search).get('continue'),
    fallback,
  )
}
