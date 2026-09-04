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
 * Scheme allowlists for a URL this codebase writes into markup, in the one
 * shared-scope home a `scope:shared` lib can reach.
 *
 * ## Why here rather than reusing one of the three that already exist
 *
 * The repo has a protocol allowlist in `markdown-lite`'s `safeLinkUrl` /
 * `safeImageUrl`, another in `author-html`'s `isAllowedUrl`, and a third on
 * the published marketplace node. All three live in `libs/aglyn` or in a
 * plugin, and the nx boundary rule `scope:shared → only scope:shared` puts
 * every one of them out of reach of a `scope:shared` consumer — the same wall
 * `host-email-tokens.ts` documents for the host-token registry. So a shared
 * consumer had the choice of a fourth private copy or a shared home; this is
 * the shared home, next to `safe-redirect.ts`, which already answers the
 * neighboring question of whether a path stays on our own origin.
 *
 * ## What these do and, more importantly, what they do not
 *
 * They answer ONE question: does this string name a scheme we are willing to
 * emit? They say nothing about the host, the path, or whether the target
 * exists, and they are not a substitute for escaping the value into the
 * attribute afterwards — see {@link hasSafeLinkScheme} for why the ordering
 * of those two steps is load-bearing.
 */

/**
 * The scheme grammar a browser accepts: an ASCII letter followed by letters,
 * digits, `+`, `-` or `.`, up to the first colon.
 */
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/

/**
 * Schemes allowed on a link the reader chooses to follow.
 *
 * `data:` is deliberately absent. A `data:` href is a document the reader
 * navigates INTO, carrying whatever markup and script the author put in it,
 * which is the whole vector rather than a corner of it; and no authoring
 * surface in this product has a reason to mint one, because a link that
 * cannot be visited, shared, or resolved by a mail client is not a link.
 *
 * `javascript:` and `vbscript:` are absent for the obvious reason and are
 * refused by construction rather than by name — anything not on this list is
 * refused, so a scheme nobody has thought of yet is refused too.
 */
const LINK_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'mailto',
  'tel',
  'sms',
])

/**
 * Schemes allowed on a source the client fetches on its own, with no reader
 * action: an image, a logo, a thumbnail.
 *
 * Narrower than {@link LINK_SCHEMES} because the trust is different. A link
 * is followed deliberately; a media source is fetched the moment the document
 * renders, so it must name something ordinary over the network and nothing
 * else. `mailto:`/`tel:`/`sms:` are meaningless in the position, and `data:`
 * is excluded for the reason above plus a practical one: a media reference is
 * resolved against an origin precisely so it comes out as something fetchable.
 */
const MEDIA_SCHEMES: ReadonlySet<string> = new Set(['http', 'https'])

/**
 * The scheme a browser would read out of `value`, or `null` when the value
 * names none — a relative path, a query, a fragment, or an empty string.
 *
 * Compared on a copy with every C0 control and space removed and folded to
 * lower case, because that is what browsers strip while resolving a scheme:
 * `"java\tscript:alert(1)"` navigates, and a check that reads the raw
 * characters does not see it. This mirrors `author-html`'s `isAllowedUrl`,
 * which learned the same lesson on the tenant render path.
 */
function schemeOf(value: string): string | null {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase()
  const match = SCHEME_PATTERN.exec(stripped)
  return match ? match[1] : null
}

/**
 * True when `value` may be emitted as a link target.
 *
 * A value naming no scheme is allowed: a relative path, a `?query` or a
 * `#fragment` resolves against whatever base the document has and can name
 * no protocol at all.
 *
 * ### This runs BEFORE the value is escaped, and that order matters
 *
 * A caller must escape the approved value into the attribute afterwards, and
 * the two steps together are what closes the entity-encoded forms. This
 * function reads raw characters, so `&#106;avascript:alert(1)` reads to it as
 * a value with no scheme and is approved — and then the escape turns its `&`
 * into `&amp;`, so the parser sees the literal text `&#106;avascript:` in the
 * attribute rather than a character reference, and it names no scheme there
 * either. Drop the escape and that input becomes live; decode entities here
 * instead and the escape double-encodes every legitimate `&` in a query
 * string. Keep both, in this order.
 */
export function hasSafeLinkScheme(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  const scheme = schemeOf(value)
  return scheme === null || LINK_SCHEMES.has(scheme)
}

/**
 * True when `value` may be emitted as a media source — an `img`, a logo, a
 * poster. Same contract as {@link hasSafeLinkScheme}, against the narrower
 * {@link MEDIA_SCHEMES}.
 */
export function hasSafeMediaScheme(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  const scheme = schemeOf(value)
  return scheme === null || MEDIA_SCHEMES.has(scheme)
}
