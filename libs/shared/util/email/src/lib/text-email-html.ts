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

import { escapeEmailHtml } from './email-render'

/**
 * THE HTML PART EVERY MESSAGE GETS.
 *
 * ## What was wrong
 *
 * `sendEmail` forwarded exactly what it was handed, and almost nothing hands
 * it `html`. Twelve senders have no HTML path at all; the other twenty-seven
 * write `...(designed?.html ? { html: designed.html } : {})`, which produces
 * an HTML part only when a staff-designed template is published for that key.
 * With none published, every message on the domain went out as `"html": ""` —
 * a `text/plain` part and nothing else.
 *
 * Two consequences, and the second is the one that hid the first:
 *
 * 1. A URL in a plain-text part is not a link. It renders as the characters
 *    of the URL; whether it is clickable at all is the mail client's guess,
 *    and a long one wraps mid-string and stops being followable.
 * 2. **Click tracking cannot work.** Resend measures clicks by rewriting
 *    `<a href>` in the HTML part. No HTML part means no anchors, which means
 *    no rewriting, which means the click rate is structurally 0% and would
 *    have stayed there however long anyone waited on it.
 *
 * ## Why it lives here rather than at the call sites
 *
 * The same reasoning `contextTag` records one file over: threading an HTML
 * body through thirty-nine call sites asks thirty-nine places to remember,
 * which is the shape that produces the fortieth that does not. A sender that
 * builds real HTML still wins — this is a fallback, consulted only when
 * `html` is absent — so no existing caller changes and no designed template
 * is overridden.
 *
 * ## What it is not
 *
 * Not a template. It carries no logo, no brand color and no footer, because
 * it stands in for copy that was written to be read as plain text and it must
 * not imply a design decision nobody made. It is the plain-text body, in a
 * readable column, with its links actually linked.
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
 * Balanced closing parens are kept, because a URL can genuinely end in one
 * and a wrapping "(see https://…/a_(b))" is the rarer case. Anything the
 * paren count says is unbalanced belongs to the prose.
 */
function linkifyEscaped(escaped: string): string {
  return escaped.replace(BARE_URL, (match) => {
    let url = match.replace(URL_TRAILING_PUNCTUATION, '')
    while (
      url.endsWith(')') &&
      url.split(')').length > url.split('(').length
    ) {
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

/**
 * Renders a plain-text body as the HTML part of the same message.
 *
 * Blank-line-separated blocks become paragraphs and single newlines become
 * `<br />`, which is what the senders' template literals already mean by
 * them. Returns an empty string for empty input so a caller can treat "no
 * text" and "no html" the same way.
 *
 * @param text The plain-text body being sent alongside this.
 * @param subject Used only for the document `<title>`.
 */
export function renderTextEmailHtml(text: string, subject = ''): string {
  const body = String(text ?? '').trim()
  if (!body) return ''

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;">` +
        linkifyEscaped(escapeEmailHtml(block)).replace(/\n/g, '<br />') +
        `</p>`,
    )
    .join('')

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<title>${escapeEmailHtml(String(subject ?? ''))}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f4f4;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background-color:#f4f4f4;"><tr><td style="padding:24px 8px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" ` +
    `align="center" style="max-width:600px;width:100%;margin:0 auto;">` +
    `<tr><td style="padding:24px;background-color:#ffffff;border-radius:8px;` +
    `font-family:Helvetica, Arial, sans-serif;font-size:15px;line-height:1.6;` +
    `color:#1a1a1a;">` +
    paragraphs +
    `</td></tr></table></td></tr></table></body></html>`
  )
}

export default renderTextEmailHtml
