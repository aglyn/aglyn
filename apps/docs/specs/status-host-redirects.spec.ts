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
 * `status.aglyn.com` SERVED A SECOND COPY OF THE ENTIRE DOCS SITE.
 *
 * The domain is an alias of the `aglyn-docs` Vercel project, not a redirect, so
 * every route in the build answered `200` on BOTH hosts: measured on the live
 * site 2026-09-01, `status.aglyn.com/enterprise/uptime-and-status`,
 * `/getting-started` and `/sitemap.xml` all served the docs page at that URL.
 * One vanity hostname therefore duplicated several hundred indexable pages.
 *
 * Docusaurus emits an ABSOLUTE `<link rel="canonical">` built from `url`, so
 * every one of those copies already pointed at `docs.aglyn.com`. A canonical is
 * a hint a search engine may discard, and it does nothing about the crawl
 * budget spent on the duplicate host in the first place.
 *
 * ## What the rules do
 *
 * `/status` stays served on `status.aglyn.com` — that is the whole point of the
 * hostname, and it is the one page whose duplicate the canonical is left to
 * resolve. Everything else on that host is a permanent redirect to the same
 * path on `docs.aglyn.com`, which is the signal search engines act on rather
 * than weigh.
 *
 * ⛔ Deliberately NOT `X-Robots-Tag: noindex` on the status host. `noindex`
 * alongside `rel=canonical` is a contradiction — one says drop this URL, the
 * other says fold it into `docs.aglyn.com/status` — and the documented risk is
 * that the `noindex` follows the canonical and deindexes the real page.
 *
 * ## Why three prefixes are excluded from the redirect
 *
 * `/assets/` and `/img/` are the JS, CSS and images the status page itself
 * loads, and `/search-index.json` is fetched by
 * `@easyops-cn/docusaurus-search-local` from the page's own origin. Redirecting
 * those to another origin breaks a `fetch` that carries no CORS headers on the
 * far side, i.e. it would take out search on the page being preserved. None of
 * the three is an indexable page, so leaving them served costs nothing here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface RedirectRule {
  source: string
  destination: string
  permanent?: boolean
  has?: Array<{ type: string; value: string }>
}

const config = JSON.parse(
  readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8'),
) as { redirects?: RedirectRule[] }

const redirects = config.redirects ?? []

const forStatusHost = (rule: RedirectRule) =>
  (rule.has ?? []).some(
    (condition) =>
      condition.type === 'host' && condition.value === 'status.aglyn.com',
  )

/** The rule that sends everything except the status page off to the docs host. */
const catchAll = redirects.find(
  (rule) =>
    forStatusHost(rule) && rule.destination.startsWith('https://docs.aglyn.com'),
)

/**
 * The decision inside `/:path(<pattern>)`, tested on its own.
 *
 * Vercel compiles the source with path-to-regexp v6 and this repo has only the
 * Express-era 0.1.x on disk, so compiling the whole source here would test the
 * wrong grammar. The lookahead is the part that decides what gets redirected,
 * and it is a plain regex either way.
 */
const inclusion = () => {
  const pattern = /^\/:path\((.+)\)$/.exec(catchAll?.source ?? '')?.[1]
  if (!pattern) throw new Error(`no :path() pattern in ${catchAll?.source}`)
  return new RegExp(`^${pattern}$`)
}

describe('status.aglyn.com redirects', () => {
  it('sends non-status paths to the same path on the docs host', () => {
    expect(catchAll).toBeDefined()
    expect(catchAll?.destination).toBe('https://docs.aglyn.com/:path')
  })

  it('redirects permanently, so the duplicate is consolidated and not merely hinted at', () => {
    expect(catchAll?.permanent).toBe(true)
  })

  it('scopes every redirect to the status host, leaving docs.aglyn.com untouched', () => {
    expect(redirects.every(forStatusHost)).toBe(true)
  })

  it.each([
    'getting-started',
    'enterprise/uptime-and-status',
    'developers/self-hosting',
    'sitemap.xml',
    'search',
  ])('redirects /%s off the status host', (path) => {
    expect(inclusion().test(path)).toBe(true)
  })

  it('keeps the status page itself served on the status host', () => {
    expect(inclusion().test('status')).toBe(false)
  })

  it.each(['assets/js/main.js', 'img/favicon.ico', 'search-index.json'])(
    'keeps /%s served, because the status page loads it same-origin',
    (path) => {
      expect(inclusion().test(path)).toBe(false)
    },
  )

  it('lands the bare host on the status page without leaving it', () => {
    const root = redirects.find((rule) => rule.source === '/')
    expect(root?.destination).toBe('/status')
    // Ahead of the catch-all, or "/" matches the catch-all's `.*` first and the
    // hostname stops resolving to a status page at all.
    expect(redirects.indexOf(root as RedirectRule)).toBeLessThan(
      redirects.indexOf(catchAll as RedirectRule),
    )
  })
})
