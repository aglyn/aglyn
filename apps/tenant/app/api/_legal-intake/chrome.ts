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
 * SHARED CHROME FOR THE PUBLIC LEGAL INTAKES (AGL-1983).
 *
 * `/api/report-abuse` (AGL-1964) and `/api/counter-notice` are the two sides
 * of the same §512 conversation, and a subscriber who has just read the first
 * one's receipt should recognise the second. They also share every constraint
 * that shaped the first: no JavaScript, no App Check, no bundle, inline CSS,
 * and honest status codes — because the people who need these forms are on
 * hardened corporate and law-enforcement browsers, and a form we cannot
 * receive from exactly those people is the failure both issues exist to
 * prevent.
 *
 * Lives in a `_`-prefixed folder, which the App Router treats as private and
 * never routes, so this is a module the two route handlers import rather than
 * a third endpoint.
 *
 * The folder is deliberately NOT a lib: everything here is HTML and Response
 * plumbing for two sibling routes in one app, and hoisting it into
 * `@aglyn/aglyn` would put presentation in a package whose consumers are
 * mostly not rendering pages. `/api/report-abuse` still carries its own copy
 * of this chrome — it shipped first and is being actively worked on
 * elsewhere; adopting this module is a follow-up rather than a change made
 * underneath another agent's open work.
 */

import {
  OPERATOR_CONTACT_UNSET,
  operatorContactLine,
  operatorIdentity,
} from '@aglyn/aglyn/server'

/** Escape a string for interpolation into HTML text or an attribute value. */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** First hop of `x-forwarded-for`, or `unknown`. Rate-limit key material only. */
export const clientIp = (request: Request): string =>
  String(request.headers.get('x-forwarded-for') ?? 'unknown')
    .split(',')[0]
    .trim() || 'unknown'

/** Does the caller want JSON back, or is this a browser form post? */
export const wantsJson = (request: Request): boolean => {
  const accept = request.headers.get('accept') ?? ''
  const type = request.headers.get('content-type') ?? ''
  return accept.includes('application/json') || type.includes('application/json')
}

/**
 * Read a body that may be JSON or a urlencoded form.
 *
 * Both spellings have to work: the no-JS form posts urlencoded, and a law
 * firm's automated pipeline posts JSON. A parse failure returns `{}` rather
 * than throwing, so the caller answers with a field-level validation message
 * instead of a 500 that tells the subscriber nothing.
 */
export async function readPayload(
  request: Request,
): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? ''
  try {
    if (type.includes('application/json')) {
      const parsed = await request.json()
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {}
    }
    const form = await request.formData()
    const payload: Record<string, unknown> = {}
    for (const [key, value] of form.entries()) {
      payload[key] = typeof value === 'string' ? value : ''
    }
    return payload
  } catch {
    return {}
  }
}

/** The inline stylesheet. Identical to the abuse form's, so the pair matches. */
export const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #f6f7f9; color: #16181d; line-height: 1.55; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 8px; }
  .lede { color: #495057; margin: 0 0 24px; }
  form { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px;
         padding: 20px; }
  fieldset { border: 0; margin: 0 0 20px; padding: 0; }
  legend { font-weight: 600; padding: 0; margin-bottom: 8px; }
  label { display: block; font-weight: 600; margin: 0 0 4px; }
  .hint { font-weight: 400; color: #5c636a; font-size: .875rem; margin: 0 0 6px; }
  input[type=text], input[type=email], input[type=url], input[type=tel],
  textarea, select {
    width: 100%; box-sizing: border-box; padding: 9px 10px; font: inherit;
    border: 1px solid #ccd0d5; border-radius: 6px; background: #fff;
    color: inherit; }
  textarea { min-height: 120px; resize: vertical; }
  .choice { display: flex; gap: 8px; align-items: flex-start; margin: 0 0 10px;
            font-weight: 400; }
  .choice input { margin-top: 5px; }
  .field { margin: 0 0 18px; }
  button { background: #1b1f24; color: #fff; border: 0; border-radius: 6px;
           padding: 11px 20px; font: inherit; font-weight: 600;
           cursor: pointer; }
  .note { background: #fff8e6; border: 1px solid #f0dcaa; border-radius: 8px;
          padding: 12px 14px; margin: 0 0 20px; font-size: .9375rem; }
  .error { background: #fdecec; border: 1px solid #f2b8b8; border-radius: 8px;
           padding: 12px 14px; margin: 0 0 20px; }
  .ok { background: #eaf7ee; border: 1px solid #b7e0c4; border-radius: 8px;
        padding: 16px 18px; }
  footer { color: #5c636a; font-size: .875rem; margin-top: 24px; }
  a { color: #0b5ed7; }
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px;
        overflow: hidden; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181d; color: #e6e8ea; }
    form { background: #1e2127; border-color: #2f343c; }
    input[type=text], input[type=email], input[type=url], input[type=tel],
    textarea, select {
      background: #16181d; border-color: #3a4048; color: inherit; }
    button { background: #e6e8ea; color: #16181d; }
    .lede, .hint, footer { color: #a5abb3; }
    .note { background: #2a2415; border-color: #4d431f; }
    .error { background: #2d1a1a; border-color: #5a2b2b; }
    .ok { background: #16281c; border-color: #2c5237; }
    a { color: #7db1ff; }
  }
`

/**
 * Wrap body HTML in the shared document shell.
 *
 * `noindex` on both the meta and the header: these pages carry sworn
 * statements and legal correspondence, and a search engine that indexed a
 * receipt would publish a dispute neither party asked to have published.
 *
 * The title suffix is the OPERATOR of this deployment, not `Aglyn` (AGL-2016).
 * Both §512 intakes share this shell, so the hardcoded suffix put our name in
 * the browser tab, the bookmark and the print header of a self-hoster's
 * counter-notice — the document a subscriber keeps as their record of what
 * they swore to and who they sent it to. Unconfigured drops the suffix
 * entirely rather than substituting a placeholder: a legal document with no
 * publisher named is at least not a legal document naming the wrong one.
 */
export function operatorTitleSuffix(): string {
  const operator = operatorIdentity().name
  return operator ? ` — ${escapeHtml(operator)}` : ''
}

export function documentHtml(title: string, body: string): string {
  const suffix = operatorTitleSuffix()
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}${suffix}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`
}

/**
 * The operator's contact address, as HTML — a `mailto:` when configured, and
 * an honest sentence when not (AGL-2016).
 *
 * Both intakes offer "if you would rather email us" as the fallback channel,
 * and both used to hardcode `support@aglyn.com` into it. On a self-host
 * install that turned the fallback into a misroute: the reporter who did not
 * trust the form emailed a company with no access to the content.
 *
 * Returns prose rather than an empty anchor when unconfigured, because an
 * `<a href="mailto:">` with nothing behind it is a link a reporter will click,
 * and a mail client that opens with a blank To: line reads as our bug rather
 * than as a deployment that never published an address.
 */
export function contactHtml(kind: 'support' | 'legal' = 'support'): string {
  const { address } = operatorContactLine(kind)
  if (!address) return escapeHtml(OPERATOR_CONTACT_UNSET)
  const safe = escapeHtml(address)
  return `<a href="mailto:${safe}">${safe}</a>`
}

/** Plain-text counterpart of {@link contactHtml}, for JSON and prose bodies. */
export const contactText = (kind: 'support' | 'legal' = 'support'): string | null =>
  operatorContactLine(kind).address

/**
 * What a refusal offers instead of "email us" when no address is configured.
 *
 * Both intakes refuse in two places — rate-limited, and write-failed — and
 * both refusals hand the reporter another route so the wall is not the last
 * thing a real reporter sees. With no address to hand them, the next best
 * thing is telling them the thing they wrote still exists and is worth
 * keeping, which is the part they lose if they close the tab.
 */
export const NO_CHANNEL_ADVICE =
  'This deployment has published no contact address, so keep a copy of what ' +
  'you wrote and try again shortly.'

/**
 * The URL placeholder in both intakes' address field.
 *
 * Was `https://example.aglyn.app/page` — our apex, shown to someone reporting
 * a page on somebody else's install. `example.com` is the RFC 2606 reserved
 * name and belongs to nobody, which is exactly the property a placeholder
 * needs.
 */
export const EXAMPLE_URL = 'https://example.com/page'

/** An HTML response with the no-store/noindex headers both intakes need. */
export const html = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  })
