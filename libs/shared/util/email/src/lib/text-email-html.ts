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

import { linkifyEscapedText } from './email-linkify'
import {
  escapeEmailHtml,
  renderEmailHtml,
  type EmailChrome,
  type EmailTheme,
  type RenderedEmail,
} from './email-render'

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
 * Renders a plain-text body as the HTML part of the same message.
 *
 * Blank-line-separated blocks become paragraphs and single newlines become
 * `<br />`, which is what the senders' template literals already mean by
 * them. Returns an empty string for empty input so a caller can treat "no
 * text" and "no html" the same way.
 *
 * @param text The plain-text body being sent alongside this.
 * @param subject Used only for the document `<title>`.
 * @param preheader The hidden line inboxes show after the subject. Same
 *        markup `renderEmailHtml` emits for a designed email, so a campaign
 *        gets the same treatment whichever body it carries.
 */
export function renderTextEmailHtml(
  text: string,
  subject = '',
  preheader = '',
): string {
  const body = String(text ?? '').trim()
  if (!body) return ''

  const preview = String(preheader ?? '').trim()
  const preheaderHtml = preview
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">` +
      escapeEmailHtml(preview) +
      `</div>`
    : ''

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;">` +
        linkifyEscapedText(escapeEmailHtml(block)).replace(/\n/g, '<br />') +
        `</p>`,
    )
    .join('')

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<title>${escapeEmailHtml(String(subject ?? ''))}</title></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f4f4;">` +
    preheaderHtml +
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

/**
 * A plain-text message in a sender's header and footer (AGL-3370).
 *
 * For mail whose body is text somebody typed or a sender composed, sent
 * under a brand: a workflow's email step, a typed campaign, a member post a
 * site has not designed. {@link renderTextEmailHtml} is the unbranded card
 * for text nobody made a brand decision about; this is the same words, one
 * paragraph per blank-line-separated block and their links live, drawn
 * inside the chrome the caller chose. The plain-text part carries the
 * footer's lines too.
 *
 * Merge tokens are not substituted: the text arrives resolved, no merge map
 * is passed, and a `{{…}}` left in it is the author's own and stays as typed.
 */
export function renderFramedTextEmail(input: {
  text: string
  subject?: string
  preheader?: string
  chrome: EmailChrome
  /** The sender's theme: the links take its accent. */
  theme?: EmailTheme
  /** The sender's origin and host, which a logo stored as a media reference resolves against. */
  mediaOrigin?: string
  mediaHostId?: string
}): RenderedEmail {
  const blocks = String(input.text ?? '')
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
  const nodes: Record<string, unknown> = {
    root: { componentId: 'div', nodes: ['section'] },
    section: {
      componentId: 'emailSection',
      props: { padding: 24 },
      nodes: blocks.map((_, index) => `p${index}`),
    },
  }
  blocks.forEach((block, index) => {
    nodes[`p${index}`] = {
      componentId: 'emailText',
      props: { children: block, variant: 'body' },
    }
  })
  const rendered = renderEmailHtml({
    nodes: nodes as never,
    subject: input.subject ?? '',
    preheader: input.preheader ?? '',
    // No author markup reaches a text block, so no policy is exercised.
    sanitize: (html: string) => html,
    chrome: input.chrome,
    ...input.theme,
    ...(input.mediaOrigin ? { mediaOrigin: input.mediaOrigin } : {}),
    ...(input.mediaHostId ? { mediaHostId: input.mediaHostId } : {}),
  })
  return rendered
}

export default renderTextEmailHtml
