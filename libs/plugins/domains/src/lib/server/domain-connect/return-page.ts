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

import { randomBytes } from 'node:crypto'
import {
  DOMAIN_CONNECT_RETURN_CHANNEL,
  type DomainConnectReturnMessage,
} from '../../model/domain-connect'

/*
 * THE PAGE A DNS PROVIDER SENDS THE OWNER BACK TO (AGL-3963).
 *
 * Usually it opens in the popup the widget opened, so its job is to tell
 * that window the provider is done and close itself. It tells it twice:
 *
 * - `window.opener.postMessage`, to this origin only, while the opener
 *   reference survives;
 * - a `BroadcastChannel`, which reaches the console tab even when it does
 *   not — a provider page that sends `Cross-Origin-Opener-Policy: same-origin`
 *   moves the popup to a new browsing context group and nulls `opener` for
 *   good, and this page coming back to our origin does not restore it.
 *
 * The message names only the outcome. The console window then asks
 * `domain-connect/finish` with its own session and state, so nothing here
 * is trusted to say what happened to the records.
 *
 * Opened in the same tab (a blocked popup), there is no opener to tell, and
 * the page sends the owner on to the site's Custom Domain page, where the
 * widget picks the session back up.
 *
 * The response carries its own CSP: the one inline script is allowed by a
 * nonce minted for this response, and nothing else may load.
 */

export interface ReturnPageInput {
  outcome: DomainConnectReturnMessage['outcome'] | null
  /** The site's Custom Domain page, relative to this origin; null when unknown. */
  backPath: string | null
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** JSON safe inside a `<script>`: no `<` can end the element early. */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

function headline(outcome: ReturnPageInput['outcome']): string {
  if (outcome === 'applied') return 'Your DNS provider is done'
  if (outcome === 'cancelled') return 'No changes were made'
  if (outcome === 'failed') return 'Your DNS provider could not make the change'
  return 'This link has expired'
}

/** The return page's HTML and headers. */
export function domainConnectReturnPage(input: ReturnPageInput): Response {
  const nonce = randomBytes(16).toString('base64')
  const message: DomainConnectReturnMessage | null = input.outcome
    ? { source: DOMAIN_CONNECT_RETURN_CHANNEL, outcome: input.outcome }
    : null
  const title = headline(input.outcome)
  const back = input.backPath
    ? `<p><a href="${escapeHtml(input.backPath)}">Back to your domain settings</a></p>`
    : ''
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(title)}</title>` +
    // No palette of its own: `color-scheme` lets the browser draw its own
    // light or dark page, which is all a window open for a second needs.
    '<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;' +
    'margin:0;display:grid;place-items:center;min-height:100vh}' +
    'main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}</style>' +
    '</head><body><main>' +
    `<h1>${escapeHtml(title)}</h1>` +
    '<p>You can close this window.</p>' +
    back +
    '</main>' +
    `<script nonce="${nonce}">(function(){` +
    `var message=${scriptJson(message)};var back=${scriptJson(input.backPath)};` +
    'var told=false;' +
    'if(message){' +
    'try{if(window.opener&&!window.opener.closed){window.opener.postMessage(message,window.location.origin);told=true}}catch(e){}' +
    `try{var channel=new BroadcastChannel(${scriptJson(DOMAIN_CONNECT_RETURN_CHANNEL)});channel.postMessage(message);channel.close()}catch(e){}` +
    '}' +
    'if(told){setTimeout(function(){window.close()},300);return}' +
    'if(!window.opener&&back&&window.history.length>1){window.location.replace(back)}' +
    '})()</script>' +
    '</body></html>'
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      // The opener must survive this page, so it isolates nothing.
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Content-Security-Policy':
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; ` +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
