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

/*==========================================
 * THE LEAVING NOTICE'S PAGE (AGL-3452).
 *
 * Plain HTML with inline CSS and no script, like the abuse form and the
 * lockdown notice: every control on it is an ordinary link, so Continue and
 * Go back work in a browser with scripting off, and nothing here can be
 * broken by a bundle, a CDN or a site's own theme. Neutral rather than the
 * site's theme on purpose — a page that says "this is not us" should not be
 * dressed as the site whose link brought the visitor here.
 *
 * Pure: the route resolves every fact and this module only renders them.
 *=========================================*/

// The shared escaper, by subpath — see the note in the library's index.
import { escapeHtml } from '@aglyn/shared-util-tools/escape-html'

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #f6f7f9; color: #16181d; line-height: 1.55; }
  main { max-width: 600px; margin: 0 auto; padding: 48px 20px 64px; }
  h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 12px; }
  p { margin: 0 0 16px; }
  .destination { background: #fff; border: 1px solid #d0d4d9; border-radius: 10px;
                 padding: 16px 18px; margin: 0 0 20px; }
  .destination .host { font-size: 1.125rem; font-weight: 700; margin: 0 0 6px;
                       overflow-wrap: anywhere; }
  .destination code { display: block; font: .875rem/1.5 ui-monospace, SFMono-Regular,
                      Menlo, Consolas, monospace; color: #3b4148; overflow-wrap: anywhere; }
  .warning { background: #fff8e6; border: 1px solid #e6cf8f; border-radius: 8px;
             padding: 12px 14px; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0 32px; }
  .button { display: inline-block; padding: 11px 20px; border-radius: 6px;
            font-weight: 600; text-decoration: none; border: 1px solid #1b1f24;
            color: #1b1f24; background: #fff; }
  .button.primary { background: #1b1f24; color: #fff; }
  a { color: #0b57c2; }
  a:focus-visible { outline: 3px solid #0b57c2; outline-offset: 2px; }
  footer { color: #4f565e; font-size: .875rem; border-top: 1px solid #d0d4d9;
           padding-top: 16px; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181d; color: #e6e8ea; }
    .destination { background: #1e2127; border-color: #3a4048; }
    .destination code { color: #c3c8ce; }
    .warning { background: #2a2415; border-color: #5c4f22; }
    .button { background: #16181d; color: #e6e8ea; border-color: #e6e8ea; }
    .button.primary { background: #e6e8ea; color: #16181d; }
    a { color: #8ab8ff; }
    a:focus-visible { outline-color: #8ab8ff; }
    footer { color: #a5abb3; border-color: #3a4048; }
  }
`

function documentHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`
}

/** The facts both pages print. */
export interface LeavingNoticePageSite {
  /** The site's own host name, as the visitor sees it. */
  siteHost: string
  /** Where Go back goes: the page the visitor came from on this site, or its home. */
  backHref: string
  /** The site's abuse report link, pre-filled with this site. */
  reportHref: string
}

function reportFooter(site: LeavingNoticePageSite): string {
  return `<footer>
  <p>Something wrong with ${escapeHtml(site.siteHost)}?
  <a href="${escapeHtml(site.reportHref)}" rel="nofollow">Report abuse</a></p>
</footer>`
}

/**
 * The notice itself, for a destination whose signature checked out.
 *
 * The destination's HOST is what the page leads with — the part of an
 * address that says whose site it is, and the part a lookalike is built to
 * hide inside a long path. The full address follows it in plain text, never
 * as the link's label alone.
 */
export function leavingNoticeHtml(
  input: LeavingNoticePageSite & {
    /** The verified, normalized destination. */
    destination: string
    /** The platform's product name, as the free tier already shows it. */
    brandName: string
  },
): string {
  const host = new URL(input.destination).hostname
  const site = escapeHtml(input.siteHost)
  const brand = escapeHtml(input.brandName)
  return documentHtml(
    `You’re leaving ${input.siteHost}`,
    `<h1>You’re leaving ${site}</h1>
<p>This link goes to a different website:</p>
<div class="destination">
  <p class="host">${escapeHtml(host)}</p>
  <code>${escapeHtml(input.destination)}</code>
</div>
<p>${brand} doesn’t operate or control that website and can’t vouch for
anything it shows or asks for.</p>
<p class="warning"><strong>Neither ${brand} nor ${site} will ever ask for your
password there.</strong> If that website asks you to sign in to see a
document, a payment or an account, don’t.</p>
<div class="actions">
  <a class="button primary" href="${escapeHtml(input.destination)}" rel="noopener">Continue to ${escapeHtml(host)}</a>
  <a class="button" href="${escapeHtml(input.backHref)}">Go back</a>
</div>
${reportFooter(input)}`,
  )
}

/**
 * What a destination that was NOT signed for this site gets: no Continue, and
 * no address. Printing it would make this page the very hop the signature
 * exists to refuse.
 */
export function leavingRefusedHtml(input: LeavingNoticePageSite): string {
  const site = escapeHtml(input.siteHost)
  return documentHtml(
    'This link can’t be opened',
    `<h1>This link can’t be opened</h1>
<p>We couldn’t confirm that this link belongs to ${site}, so this page won’t
send you anywhere.</p>
<p>If someone sent you this link, be careful with whatever it was meant to
open.</p>
<div class="actions">
  <a class="button primary" href="${escapeHtml(input.backHref)}">Go back</a>
</div>
${reportFooter(input)}`,
  )
}

/**
 * The response headers, the same on every answer this route gives.
 *
 * - `no-store`: a notice is per destination and per visitor's referrer, and a
 *   cached refusal outliving a fixed link is the worse failure.
 * - `noindex`, header and meta both: a page whose text is another site's
 *   address is nothing a search engine should hold.
 * - `frame-ancestors 'none'` and `DENY`: a notice that can be framed can be
 *   overlaid, and its Continue button clicked through the overlay.
 * - The referrer policy is the browser default, stated: the destination
 *   learns the site's origin — what a direct link already told it — and
 *   never this page's query.
 */
export const LEAVING_NOTICE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; " +
    "form-action 'none'; frame-ancestors 'none'",
}

export const leavingNoticeResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { ...LEAVING_NOTICE_HEADERS } })

/**
 * Where Go back goes: the `Referer` when it is a page of this same site that
 * is not the notice itself, else the site's home.
 *
 * Never another origin — a Go back that could leave would be a second
 * Continue — and a path rather than a full URL, so it cannot.
 */
export function leavingBackHref(
  referer: string | null | undefined,
  siteHosts: readonly string[],
  noticePath: string,
): string {
  if (!referer) return '/'
  let url: URL
  try {
    url = new URL(referer)
  } catch {
    return '/'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '/'
  if (!siteHosts.includes(url.hostname.toLowerCase())) return '/'
  if (url.pathname === noticePath) return '/'
  // A path that starts `//` would be read as another origin by the browser.
  const path = `/${url.pathname.replace(/^[/\\]+/, '')}`
  return `${path}${url.search}`
}
