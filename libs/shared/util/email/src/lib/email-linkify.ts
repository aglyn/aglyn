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
 * Bare URLs in escaped text, made into links (AGL-3367).
 *
 * Shared by the two places a sender's plain words become HTML: the fallback
 * HTML part `sendEmail` synthesizes for a text-only message, and the
 * renderer's `emailText` block. The second is where a platform email's
 * composed body lands once it wears the system chrome, so without this a
 * digest that used to arrive with clickable links in its fallback part would
 * arrive branded and dead.
 */

/**
 * Trailing characters stripped from a matched URL.
 *
 * A sentence that ends "…see {@link https://example.com/billing}." puts the
 * period inside the match, because a period is a legal URL character and the
 * regex cannot tell prose from path. Closing brackets are handled separately
 * below, since a URL may legitimately end in one.
 *
 * `;` is deliberately absent: by the time this runs the text is already
 * escaped, so a query string reads `?a=1&amp;b=2` and trimming `;` would cut
 * an entity in half and corrupt the link.
 */
const URL_TRAILING_PUNCTUATION = /[.,!?'"]+$/

/**
 * Bare absolute URLs in already-escaped text.
 *
 * Matched AFTER escaping, not before, so the href and the visible label are
 * the same string and neither can reintroduce markup: `&` inside a query
 * string is `&amp;` by then, which is what an href attribute is supposed to
 * carry and parses back to `&` in the client.
 *
 * `http`/`https` only. Every URL our system copy emits is absolute — the
 * senders share one `consoleOrigin()` precisely because a mail client has no
 * page to resolve a relative path against — and matching bare `www.` or
 * addresses would turn ordinary prose into links nobody wrote.
 */
const BARE_URL = /https?:\/\/[^\s<>"]+/g

/**
 * Links the bare URLs in one escaped line.
 *
 * Balanced closing parens and brackets are kept, because a URL can genuinely
 * end in one and a wrapping "(see https://…/a_(b))" is the rarer case.
 * Anything the count says is unbalanced belongs to the prose.
 */
export function linkifyEscapedText(escaped: string): string {
  return escaped.replace(BARE_URL, (match) => {
    let url = match.replace(URL_TRAILING_PUNCTUATION, '')
    // `)` and `]` alike: a token's value dropped into "[{{brand.supportUrl}}]"
    // closes on a bracket the URL never opened.
    for (;;) {
      const close = url.slice(-1)
      const open = close === ')' ? '(' : close === ']' ? '[' : ''
      if (!open || url.split(close).length <= url.split(open).length) break
      url = url.slice(0, -1)
    }
    if (!url) return match
    const trailer = match.slice(url.length)
    return (
      `<a href="${url}" target="_blank" ` +
      `style="color:#1a73e8;text-decoration:underline;word-break:break-word;">` +
      `${url}</a>${trailer}`
    )
  })
}

