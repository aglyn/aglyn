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
 * WHERE A PAYMENT SENDS THE SHOPPER BACK TO (AGL-3363).
 *
 * Every visitor payment door — buy-now, cart, reservation, booking deposit,
 * the subscription portal — hands Stripe the URL the shopper returns to
 * after paying or backing out. They built it from the request's `Referer`
 * (or `Origin`), falling back to its `Host`. All three are headers the
 * caller writes: a script that posts to a real shop's checkout with
 * `Referer: https://paypal-verify.top/` got back a GENUINE Stripe Checkout
 * link, for a real merchant, that lands the payer on the phishing page. And
 * the webhook later reads that same `success_url` as the site's origin for
 * the receipt's download links, so the lure reached the owed receipt too.
 *
 * So a return URL is accepted only when its host is the SITE'S OWN: its
 * subdomain on the tenant apex, its custom domain, or `www.` of that domain.
 * Anything else — another tenant's site, an arbitrary domain, a lookalike —
 * is replaced by the site's public origin. A host that is shaped like a
 * brand it is not (`lookalikeBrandForHost`, the phishing screen's rule) is
 * never accepted, even as the site's own custom domain: the lookalike tier
 * holds for everyone, and the site's apex subdomain still works.
 *
 * `localhost` is accepted for development; a stranger who sends a shopper
 * to their own machine has sent them nowhere.
 *
 * Pure: every door calls it with the host document it already read.
 *=========================================*/

import { lookalikeBrandForHost } from '@aglyn/shared-util-email/outbound-phishing-screen'
import { hostPublicOrigin, TENANT_APEX } from './host-naming'

/** The site fields a return URL is judged against. */
export interface SiteReturnHost {
  subdomain?: string | null
  cname?: string | null
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase().replace(/\.+$/, '') : ''

/** The hosts a site answers on: apex subdomain, custom domain, `www.` of it. */
export function siteOwnHosts(site: SiteReturnHost | null | undefined): string[] {
  const subdomain = clean(site?.subdomain)
  const cname = clean(site?.cname)
  const hosts = new Set<string>()
  if (subdomain) hosts.add(`${subdomain}.${TENANT_APEX}`)
  if (cname) {
    hosts.add(cname)
    hosts.add(cname.startsWith('www.') ? cname.slice(4) : `www.${cname}`)
  }
  return [...hosts].filter((host) => !lookalikeBrandForHost(host))
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost')
}

/**
 * Is `candidate` a URL on one of the site's own hosts? https only, except
 * on localhost; no credentials in the authority (`https://shop@evil.top`).
 */
export function isSiteOwnUrl(
  candidate: unknown,
  site: SiteReturnHost | null | undefined,
): boolean {
  if (typeof candidate !== 'string' || !candidate) return false
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  const hostname = url.hostname.toLowerCase()
  if (isLocalHost(hostname)) {
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  if (url.protocol !== 'https:') return false
  return siteOwnHosts(site).includes(hostname)
}

/**
 * The URL a payment returns the shopper to: the first candidate on the
 * site's own hosts (fragment dropped), else the site's public origin, else
 * — for a site document with neither a subdomain nor a domain, which no live
 * site has — the request's own host, as before.
 *
 * `candidates` in preference order: the `Referer` (the page the shopper was
 * on), then `https://<Host>`.
 */
export function siteReturnUrl(input: {
  candidates: readonly (string | null | undefined)[]
  site: SiteReturnHost | null | undefined
  /** The request's `Host` header, the last resort. */
  requestHost?: string | null
}): string {
  for (const candidate of input.candidates) {
    if (isSiteOwnUrl(candidate, input.site)) {
      const url = new URL(String(candidate))
      url.hash = ''
      return url.toString()
    }
  }
  const own = siteOwnHosts(input.site)
  const publicOrigin = hostPublicOrigin(input.site)
  if (publicOrigin && own.includes(new URL(publicOrigin).hostname)) {
    return `${publicOrigin}/`
  }
  const subdomain = clean(input.site?.subdomain)
  if (subdomain) return `https://${subdomain}.${TENANT_APEX}/`
  const requestHost = clean(input.requestHost)
  return requestHost ? `https://${requestHost}/` : '/'
}

/** {@link siteReturnUrl}'s origin, for a door that returns to the site root. */
export function siteReturnOrigin(input: Parameters<typeof siteReturnUrl>[0]): string {
  const url = siteReturnUrl(input)
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * The site fields, read from a host document reference by a door that has
 * not read it yet. A failed or missing read answers null, which keeps the
 * request's own host as the only acceptable return — never a `Referer`.
 */
export async function readSiteReturnHost(
  ref:
    | { get(): Promise<{ data?: () => unknown } | null | undefined> }
    | null
    | undefined,
): Promise<SiteReturnHost | null> {
  try {
    const snapshot = await ref?.get()
    const data = snapshot?.data?.()
    return data && typeof data === 'object' ? (data as SiteReturnHost) : null
  } catch {
    return null
  }
}
