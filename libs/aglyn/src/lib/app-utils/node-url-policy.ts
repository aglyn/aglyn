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
 * The addresses an element's `href` and `src` may hold (AGL-784, AGL-2933).
 *
 * `Leaf` spreads a node's props onto its component, and a component passes
 * what it does not consume to its root DOM element, so an `href` or `src`
 * that survives composition is a browser navigating or fetching. One rule
 * says which addresses may get that far, read by the two places a value is
 * handed to a page it was not written on: publishing a tree to another
 * workspace, and substituting a property's value into the tree that binds it.
 */

import { parseMediaRef } from './media-ref'
import { parseScreenLinkValue, SAFE_HREF_PATTERN } from './screen-link-value'

/**
 * An image address: `https:`, an inline image, a site path or a fragment.
 *
 * `https:` only, unlike {@link SAFE_HREF_PATTERN} (AGL-1701). An `http:` href is
 * a link a reader chooses to follow and their browser will warn about; an
 * `http:` image is fetched automatically, and on the authenticated console —
 * or on any tenant page served over TLS — it is mixed content, which every
 * current browser blocks outright. The permissive form bought nothing: the
 * image did not render either way, it just failed at the viewer.
 */
export const SAFE_SRC_PATTERN = /^(https:\/\/|data:image\/|\/|#)/i

/** The props that carry an address. */
export type NodeUrlProp = 'href' | 'src'

/** Every prop {@link isSafeNodeUrl} judges, in one place for a walker. */
export const NODE_URL_PROPS: readonly NodeUrlProp[] = ['href', 'src']

/**
 * Whether `value` is an address this prop may carry.
 *
 * `siteReferences` also admits what the site resolves on its own — a screen
 * or collection link (`screen:…`, `collection:…`) for `href`, a media-library
 * reference (`media:…`) for `src`. The linking elements route the first
 * through the routing map and the image element turns the second into a CDN
 * path, so neither reaches the DOM as written. A page on its own site renders
 * with them; a tree published to another workspace may not carry them, since
 * they name the publisher's screens and files.
 *
 * Judged on the value with its surrounding whitespace removed, which is how
 * the linking elements read a link too.
 */
export function isSafeNodeUrl(
  prop: NodeUrlProp,
  value: unknown,
  options?: { siteReferences?: boolean },
): boolean {
  if (typeof value !== 'string') return false
  const address = value.trim()
  const pattern = prop === 'href' ? SAFE_HREF_PATTERN : SAFE_SRC_PATTERN
  if (pattern.test(address)) return true
  if (!options?.siteReferences) return false
  return prop === 'href'
    ? parseScreenLinkValue(address) !== undefined
    : parseMediaRef(address) !== null
}

/**
 * Whether an address names a scheme, read the way a browser reads one: with
 * the controls and spaces it strips from a URL removed first, so
 * `java\tscript:` names `javascript`. An address with none is relative.
 */
export function hasUrlScheme(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const compact = value.replace(/[\u0000-\u0020\u007f]/g, '')
  return /^[a-z][a-z0-9+.-]*:/i.test(compact)
}
