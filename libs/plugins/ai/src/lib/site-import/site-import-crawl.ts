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
 * THE SITE-IMPORT CRAWLER (AGL-3974, parent AGL-3973).
 *
 * Reads a website a workspace has PROVED it owns (domain-ownership.ts in
 * tenant-data-admin; the doors check the proof before calling this) into a
 * typed inventory: each page's title, description, headings and text in
 * order, images and menu links. It writes nothing; the import job decides
 * what becomes a page.
 *
 * Every request goes through `fetchPublicTextDetailed`, the theme job's
 * SSRF-guarded fetch: https on the default port only, public addresses only,
 * the socket pinned to the address checked. On top of that:
 *
 * - **One site.** The site is `https://<domain>` and `https://www.<domain>`,
 *   one site to its owner. Every redirect hop and every discovered link must
 *   stay on it; a page that redirects anywhere else is refused, not followed.
 * - **AglynBot.** Every request says `AglynBot/1.0 (+<the operator's bot page>)`,
 *   and robots.txt is read first and honored for every page: the AglynBot
 *   group, else `*`. A robots.txt that answers 404 allows everything; one
 *   that cannot be read at all (5xx, no answer) stops the crawl, because
 *   "could not ask" is not "allowed".
 * - **Our own edge.** A site this platform serves gets the edge secret
 *   (`site-import-edge.ts`, AGL-4085), which lifts our bot challenge for
 *   AglynBot; it is asked per request and per redirect hop, and a request
 *   that leaves the site's two origins never carries it.
 * - **Sitemap first.** The sitemaps robots.txt names, else /sitemap.xml (an
 *   index's children included), then same-site links found on the pages read,
 *   for whatever the sitemap missed.
 * - **Budgets.** Pages (the caller's, from the plan), bytes per page (a page
 *   over it is refused, not cut), bytes in total, and wall-clock time. A
 *   whole site's worth fits (AGL-4083): aglyn.com's 123 pages average 440 KB,
 *   54 MB in all, so the total is 160 MB; a page is parsed and dropped as it
 *   is read, so what is held is its blocks, never its bytes.
 * - **Four at a time.** robots.txt, the sitemaps and the home page are read
 *   one after another; the rest four at a time, and the inventory keeps the
 *   order they were asked in, which is the sitemap's.
 * - **Nothing vanishes.** An address a stop (the clock, the bytes, the page
 *   budget) left unread is listed as `not-reached`, so the inventory's
 *   counts add up to the site. A wave's own read leaves its unread pages for
 *   its next pass instead.
 * - **No lookalikes.** A domain that wears a brand it is not
 *   (`lookalikeBrandForHost`) is refused before any request.
 * - **No sign-in pages.** A page with a password field is refused and
 *   reported; forms with payment fields, scripts, iframes and embeds never
 *   reach the inventory (site-import-html.ts).
 *=========================================*/

import { lookalikeBrandForHost } from '@aglyn/shared-util-email/outbound-phishing-screen'
import { fenceUntrustedText } from '@aglyn/shared-util-tools/untrusted-text'
import {
  AI_THEME_REFERENCE_STYLESHEETS,
  AI_THEME_STYLESHEET_MAX_BYTES,
  fetchPublicTextDetailed,
  type PublicFetchEdge,
  type PublicFetchOptions,
  type PublicFetchResult,
} from '../jobs/ai-theme-brand-inputs'
import type { SiteImportFooter, SiteImportLayout, SiteImportLookFacts, SiteImportNavTree } from '../model/ai-site-import'
import {
  extractSiteImportPage,
  readMetaValues,
  type SiteImportBlock,
  type SiteImportBrandMark,
  type SiteImportForm,
  type SiteImportIcon,
  type SiteImportImage,
  type SiteImportNavLink,
  type SiteImportOrganization,
} from './site-import-html'
import {
  AGLYN_BOT_TOKEN,
  parseRobotsTxt,
  parseSitemap,
  robotsAllows,
  robotsRulesFor,
  type RobotsRule,
} from './site-import-robots'
import { NO_SITE_IMPORT_HEADERS, siteImportEdgeHeadersFor, type SiteImportHeadersFor } from './site-import-edge'
import { siteImportLayout, siteImportLookOf } from './site-import-layout'
import { siteImportFooterColumns, siteImportNavTree } from './site-import-nav'

/**
 * Where the bot's user agent points a site owner who wants to know what it is
 * (AGL-3983): the operator's own page about it. `SITE_IMPORT_BOT_INFO_URL` on
 * a self-hosted deployment, so its crawler never names Aglyn's address; the
 * literal is only that variable's default.
 *
 * Aglyn's is the Bring my site guide, which says what AglynBot reads and how
 * robots.txt keeps it out. There is no page of its own (Zach, 10/20: "we don't
 * need a bot page at all"), and the site it reads is the reader's own: an
 * import starts only once its owner has proved the site is theirs.
 */
export const AGLYN_BOT_INFO_URL =
  process.env['SITE_IMPORT_BOT_INFO_URL'] ?? 'https://docs.aglyn.com/ai/bring-my-site'

/** What every crawler request says it is. */
export const AGLYN_BOT_USER_AGENT = `AglynBot/1.0 (+${AGLYN_BOT_INFO_URL})`

export const SITE_IMPORT_DEFAULTS = {
  maxPageBytes: 2 * 1024 * 1024,
  /**
   * A whole site's worth (AGL-4083): 54 MB for aglyn.com's 123 pages, with
   * room; 400 pages at its 440 KB average are 176 MB (AGL-4106).
   */
  maxTotalBytes: 320 * 1024 * 1024,
  timeBudgetMs: 60_000,
  /** One request's own clock, inside the whole crawl's. */
  requestTimeoutMs: 8_000,
  robotsMaxBytes: 256 * 1024,
  sitemapMaxBytes: 4 * 1024 * 1024,
  /** Sitemap documents read, an index's children included: an index of six children is seven. */
  maxSitemaps: 24,
  /** URLs a sitemap may contribute to the queue. */
  maxSitemapUrls: 2_000,
  /** Reasons kept in `skipped` before the list stops growing: every address a sitemap may name. */
  maxSkipped: 2_000,
  /** Pages read at once, after robots.txt, the sitemaps and the home page. */
  concurrency: 4,
} as const

/** Never a page: files a link may point at that are not HTML. */
const NON_PAGE_EXTENSION =
  /\.(?:pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|gz|tgz|rar|7z|mp4|m4v|mov|webm|mp3|wav|ogg|m4a|docx?|xlsx?|pptx?|csv|txt|css|js|mjs|json|xml|rss|atom|woff2?|ttf|otf|eot|exe|dmg|apk)$/i

const TRACKING_PARAM = /^(?:utm_[a-z]+|fbclid|gclid|msclkid|mc_cid|mc_eid|_ga|ref)$/i

/**
 * Never a page, whatever its extension (AGL-4106): an API's or a CDN's path
 * (aglyn.com's press kit links 136 `/api/media/cdn/…?download=1` files) and
 * any address that asks for a download.
 */
const NON_PAGE_PATH = /^\/(?:api|cdn-cgi|wp-json|_next\/static|_next\/image)(?:\/|$)/i
const DOWNLOAD_PARAM = /^(?:download|dl|attachment)$/i

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/

export type SiteImportSkipReason =
  /** The page has a password field: a sign-in page, refused outright. */
  | 'login-form'
  /** robots.txt keeps AglynBot off this path. */
  | 'robots'
  /** A redirect left the site. */
  | 'off-origin-redirect'
  /** Over the per-page byte cap. */
  | 'too-large'
  /** Answered with something that is not HTML. */
  | 'not-html'
  /** Answered 4xx or 5xx. */
  | 'http-error'
  /** No answer, a private address, or a refused address. */
  | 'unreachable'
  /** Never asked for: a stop (time, bytes, the page budget) came first (AGL-4083). */
  | 'not-reached'

export interface SiteImportSkipped {
  url: string
  reason: SiteImportSkipReason
  status?: number
  /** Where an off-origin redirect pointed. */
  location?: string
  /** Whose edge turned an error answer away, when it said (AGL-4083). */
  edge?: PublicFetchEdge
}

export interface SiteImportPage {
  /** The address the page was read from, after any same-site redirect. */
  url: string
  path: string
  /** Where the crawler learned of the page. */
  foundBy: 'home' | 'sitemap' | 'link'
  title: string
  description: string
  lang: string | null
  canonical: string | null
  /** The share card (AGL-4083). */
  ogImage: string | null
  /** The site's own name, as its head gives it. */
  siteName: string
  icons: SiteImportIcon[]
  /** The header's link home: the brand's logo and words. */
  brand: SiteImportBrandMark | null
  organization: SiteImportOrganization | null
  blocks: SiteImportBlock[]
  images: SiteImportImage[]
  navLinks: SiteImportNavLink[]
  /** Same-site page addresses this page links to. */
  links: string[]
  forms: { kept: SiteImportForm[]; removed: number }
  bytes: number
  /** How the source lays the page out (AGL-4106), on a read asked for it (`layout`): a wave's. */
  layout?: SiteImportLayout | null
  /** The home page's menu, footer and look, as its source builds them (AGL-4106). */
  nav?: SiteImportNavTree | null
  footer?: SiteImportFooter | null
  look?: SiteImportLookFacts | null
}

export type SiteImportStop =
  | 'page-budget'
  | 'total-bytes'
  | 'time'
  /** robots.txt could not be read, so nothing was asked of the site. */
  | 'robots-unreachable'

export interface SiteImportInventory {
  domain: string
  /** The site's origins: the bare name and its `www.` twin. */
  origins: string[]
  /** Set when nothing was fetched at all. */
  refused: 'invalid-domain' | 'lookalike' | null
  pages: SiteImportPage[]
  skipped: SiteImportSkipped[]
  /** Skips past {@link SITE_IMPORT_DEFAULTS.maxSkipped}, counted only. */
  skippedOverflow: number
  robots: { found: boolean; sitemaps: string[] }
  /** Page addresses the sitemaps listed (same-site, before robots and budget). */
  sitemapUrls: number
  stoppedBy: SiteImportStop | null
  bytesRead: number
  startedAt: number
  finishedAt: number
}

export interface SiteImportCrawlOptions {
  /** The proved domain; `www.` is folded in. */
  domain: string
  /** The most pages the inventory may hold: the plan's page count. */
  maxPages: number
  maxPageBytes?: number
  maxTotalBytes?: number
  timeBudgetMs?: number
  signal?: AbortSignal
  /**
   * Read the sitemap's shallow addresses before its deep ones (AGL-3976), so a
   * crawl the page budget stops reads a site's main pages before the tail of
   * its blog. A sitemap's own order is kept among addresses of one depth.
   */
  shallowFirst?: boolean
  /**
   * Read exactly these addresses of the site, in order, and nothing else
   * (AGL-3976): an import's wave reads its own pages again when it starts. No
   * sitemap is read and no link is followed; robots.txt is read and honored
   * as for any crawl, and every other rule holds.
   */
  only?: readonly string[]
  /**
   * Read how each page is laid out (AGL-4106): its structure, through its own
   * stylesheets (the first two it links, each asked once a crawl). On by
   * default for a wave's read (`only`), whose pages are built; the home page's
   * menu, footer and look are read on every crawl.
   */
  layout?: boolean
}

export interface SiteImportCrawlSeams {
  fetch?: (url: string, options: PublicFetchOptions) => Promise<PublicFetchResult>
  now?: () => number
  /**
   * Request headers for the site being read, asked once per crawl with its
   * domain (AGL-4083, AGL-4085). Absent, the crawl asks the edge
   * (`siteImportEdgeHeadersFor`): Aglyn's edge secret for each of the site's
   * two origins this platform serves, decided origin by origin, and nothing
   * anywhere else. Either way the headers go only to the site's two origins,
   * and the fetch asks again on every redirect hop, so a hop anywhere else
   * carries nothing. Always under the crawler's own `Accept` and `User-Agent`.
   */
  headersFor?: (domain: string) => Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>
}

/**
 * The per-request headers of a crawl of `domain`: the seam's, else the edge's,
 * and none for any address off the site's two origins. Never throws.
 */
async function siteRequestHeaders(
  seams: SiteImportCrawlSeams,
  domain: string,
  origins: readonly string[],
): Promise<SiteImportHeadersFor> {
  let inner: SiteImportHeadersFor = NO_SITE_IMPORT_HEADERS
  try {
    if (seams.headersFor) {
      const headers = await seams.headersFor(domain)
      if (headers && Object.keys(headers).length) inner = () => headers
    } else {
      inner = await siteImportEdgeHeadersFor(origins)
    }
  } catch (error) {
    console.warn('[site-import] the edge headers could not be read; reading without them', { domain, error })
  }
  return (url: URL) => (origins.includes(url.origin) ? inner(url) : {})
}

/** The site's two origins for a domain. */
export function siteImportOrigins(domain: string): string[] {
  const bare = domain.replace(/^www\./, '')
  return [`https://${bare}`, `https://www.${bare}`]
}

/** A crawlable page address on the site, normalized for de-duplication; else null. */
export function siteImportPageKey(url: URL, origins: readonly string[]): string | null {
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.port && url.port !== '443') return null
  if (!origins.includes(url.origin)) return null
  if (NON_PAGE_EXTENSION.test(url.pathname) || NON_PAGE_PATH.test(url.pathname)) return null
  if ([...url.searchParams.keys()].some((key) => DOWNLOAD_PARAM.test(key))) return null
  const clean = new URL(url.toString())
  clean.hash = ''
  for (const key of [...clean.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) clean.searchParams.delete(key)
  }
  clean.search = clean.searchParams.toString() ? `?${clean.searchParams.toString()}` : ''
  return clean.toString()
}

function skipReasonFor(result: PublicFetchResult): SiteImportSkipReason {
  switch (result.refusal) {
    case 'redirect-refused':
      return 'off-origin-redirect'
    case 'content-type':
      return 'not-html'
    case 'too-large':
      return 'too-large'
    case 'http-status':
      return 'http-error'
    default:
      return 'unreachable'
  }
}

/** Read a proved site into an inventory. Never throws for anything the site does. */
export async function crawlSiteForImport(
  options: SiteImportCrawlOptions,
  seams: SiteImportCrawlSeams = {},
): Promise<SiteImportInventory> {
  const now = seams.now ?? Date.now
  const fetchText = seams.fetch ?? fetchPublicTextDetailed
  const domain = String(options.domain ?? '').trim().toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  const origins = DOMAIN_PATTERN.test(domain) ? siteImportOrigins(domain) : []
  const startedAt = now()
  const inventory: SiteImportInventory = {
    domain,
    origins,
    refused: null,
    pages: [],
    skipped: [],
    skippedOverflow: 0,
    robots: { found: false, sitemaps: [] },
    sitemapUrls: 0,
    stoppedBy: null,
    bytesRead: 0,
    startedAt,
    finishedAt: startedAt,
  }
  const finish = () => {
    inventory.finishedAt = now()
    return inventory
  }
  if (!origins.length) {
    inventory.refused = 'invalid-domain'
    return finish()
  }
  if (lookalikeBrandForHost(domain)) {
    inventory.refused = 'lookalike'
    return finish()
  }

  // Asked once, before anything else, and held to the site's two origins.
  const headersFor = await siteRequestHeaders(seams, domain, origins)
  const maxPages = Math.max(0, Math.floor(options.maxPages))
  const maxPageBytes = options.maxPageBytes ?? SITE_IMPORT_DEFAULTS.maxPageBytes
  const maxTotalBytes = options.maxTotalBytes ?? SITE_IMPORT_DEFAULTS.maxTotalBytes
  const deadlineAt = startedAt + (options.timeBudgetMs ?? SITE_IMPORT_DEFAULTS.timeBudgetMs)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)
  if (options.signal?.aborted) controller.abort()
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - startedAt))

  const sameSite = (url: URL) => origins.includes(url.origin) && url.protocol === 'https:'
  const remainingBytes = () => maxTotalBytes - inventory.bytesRead
  const outOfTime = () => controller.signal.aborted || now() >= deadlineAt
  const request = (url: string, accept: RegExp, acceptHeader: string, maxBytes: number) =>
    fetchText(url, {
      maxBytes,
      accept,
      acceptHeader,
      userAgent: AGLYN_BOT_USER_AGENT,
      headersFor,
      signal: controller.signal,
      timeoutMs: Math.max(1, Math.min(SITE_IMPORT_DEFAULTS.requestTimeoutMs, deadlineAt - now())),
      redirectAllowed: (_from, to) => sameSite(to),
      refuseOver: true,
    })
  const skip = (entry: SiteImportSkipped) => {
    if (inventory.skipped.length < SITE_IMPORT_DEFAULTS.maxSkipped) inventory.skipped.push(entry)
    else inventory.skippedOverflow += 1
  }

  try {
    // robots.txt, before anything else is asked of the site.
    const home = `${origins[0]}/`
    let rules: RobotsRule[] = []
    const robots = await request(
      `${origins[0]}/robots.txt`,
      /text\/plain|text\/html|^$/i,
      'text/plain',
      Math.min(SITE_IMPORT_DEFAULTS.robotsMaxBytes, remainingBytes()),
    )
    if (robots.ok) {
      inventory.bytesRead += robots.bytes
      const parsed = parseRobotsTxt(robots.text)
      rules = robotsRulesFor(parsed, AGLYN_BOT_TOKEN)
      inventory.robots = { found: true, sitemaps: parsed.sitemaps }
    } else if (
      !(robots.refusal === 'http-status' && (robots.status ?? 0) >= 400 && (robots.status ?? 0) < 500)
    ) {
      inventory.stoppedBy = outOfTime() ? 'time' : 'robots-unreachable'
      return finish()
    }
    const allowed = (key: string) => {
      const url = new URL(key)
      return robotsAllows(rules, `${url.pathname}${url.search}`)
    }

    // A wave's own pages (AGL-3976): exactly those, after robots.txt.
    const only = options.only
      ? options.only
          .map((raw) => {
            try {
              return siteImportPageKey(new URL(raw), origins)
            } catch {
              return null
            }
          })
          .filter((key): key is string => !!key)
      : null

    // Sitemaps: the ones robots.txt names on this site, else /sitemap.xml.
    const sitemapQueue: string[] = []
    for (const raw of inventory.robots.sitemaps) {
      try {
        const url = new URL(raw)
        if (sameSite(url)) sitemapQueue.push(url.toString())
      } catch {
        // A malformed Sitemap line names nothing.
      }
    }
    if (!sitemapQueue.length && !only) sitemapQueue.push(`${origins[0]}/sitemap.xml`)
    if (only) sitemapQueue.length = 0
    const sitemapSeen = new Set<string>()
    const fromSitemap: string[] = []
    let sitemapsRead = 0
    while (sitemapQueue.length && sitemapsRead < SITE_IMPORT_DEFAULTS.maxSitemaps && !outOfTime()) {
      const next = sitemapQueue.shift() as string
      if (sitemapSeen.has(next)) continue
      sitemapSeen.add(next)
      if (/\.gz$/i.test(new URL(next).pathname)) continue
      if (!allowed(next)) continue
      const room = Math.min(SITE_IMPORT_DEFAULTS.sitemapMaxBytes, remainingBytes())
      if (room <= 0) break
      sitemapsRead += 1
      const sitemap = await request(next, /xml|text\/plain/i, 'application/xml, text/xml;q=0.9', room)
      if (!sitemap.ok) continue
      inventory.bytesRead += sitemap.bytes
      const entries = parseSitemap(sitemap.text)
      for (const location of entries.locations) {
        let url: URL
        try {
          url = new URL(location)
        } catch {
          continue
        }
        if (entries.index) {
          if (sameSite(url)) sitemapQueue.push(url.toString())
          continue
        }
        const key = siteImportPageKey(url, origins)
        if (key && fromSitemap.length < SITE_IMPORT_DEFAULTS.maxSitemapUrls) fromSitemap.push(key)
      }
    }
    inventory.sitemapUrls = fromSitemap.length
    if (options.shallowFirst) {
      const depth = (key: string) => new URL(key).pathname.split('/').filter(Boolean).length
      const ranked = fromSitemap.map((key, order) => ({ key, order, depth: depth(key) }))
      ranked.sort((a, b) => a.depth - b.depth || a.order - b.order)
      fromSitemap.splice(0, fromSitemap.length, ...ranked.map((entry) => entry.key))
    }

    // Pages: home, then the sitemap's, then links the pages themselves name.
    // A wave's read is its own pages alone.
    const queue: { key: string; foundBy: SiteImportPage['foundBy'] }[] = only
      ? only.map((key) => ({ key, foundBy: (new URL(key).pathname === '/' ? 'home' : 'link') as SiteImportPage['foundBy'] }))
      : [{ key: home, foundBy: 'home' }]
    const queued = new Set<string>(only ?? [home])
    for (const key of fromSitemap) {
      if (queued.has(key)) continue
      queued.add(key)
      queue.push({ key, foundBy: 'sitemap' })
    }
    const read = new Set<string>()
    // The site's two names are one site: once the home page says which one
    // it answers on, every address is read on that one, so /about is not
    // read twice as example.com/about and www.example.com/about.
    // A wave's read starts on the name its pages were read on the first time.
    let preferred = only?.length ? new URL(only[0]).origin : origins[0]
    const canon = (raw: string) => {
      const url = new URL(raw)
      return origins.includes(url.origin) && url.origin !== preferred
        ? `${preferred}${url.pathname}${url.search}`
        : raw
    }
    const maxAttempts = maxPages * 3 + 10
    let attempts = 0
    type Asked = { next: (typeof queue)[number]; key: string; cap: number; page: PublicFetchResult }
    /** The pages asked for and not yet taken in, in the order they were asked. */
    const window: Array<Promise<Asked>> = []
    /** The bytes the asked pages may still read: what is left is shared, never promised twice. */
    let reserved = 0
    let stop: SiteImportStop | null = null
    /** Asked for and never read, because a stop came first: listed as not reached. */
    const cutOff: string[] = []
    /** Home alone first, so its answer settles which of the site's two names the rest are read on. */
    let homeIn = !!only
    /** Why no more may be asked now: a stop, `wait` for an asked page to come in first, or nothing. */
    const held = (): SiteImportStop | 'wait' | null => {
      if (inventory.pages.length >= maxPages) return 'page-budget'
      if (outOfTime()) return 'time'
      if (remainingBytes() <= 0) return 'total-bytes'
      if (attempts >= maxAttempts) return 'page-budget'
      if (inventory.pages.length + window.length >= maxPages) return 'wait'
      if (remainingBytes() - reserved <= 0) return 'wait'
      return null
    }
    const readLayout = options.layout ?? !!only
    /** Linked stylesheets, each asked once a crawl. */
    const sheets = new Map<string, Promise<string | null>>()
    const stylesheet = (url: string): Promise<string | null> => {
      const held = sheets.get(url)
      if (held) return held
      const room = Math.min(AI_THEME_STYLESHEET_MAX_BYTES, remainingBytes() - reserved)
      const asked: Promise<string | null> =
        room <= 0 || outOfTime()
          ? Promise.resolve(null)
          : request(url, /text\/css|text\/plain/i, 'text/css,*/*;q=0.1', room).then(
              (answer) => {
                if (!answer.ok) return null
                inventory.bytesRead += answer.bytes
                return answer.text
              },
              () => null,
            )
      sheets.set(url, asked)
      return asked
    }
    /** Takes one asked page in: the inventory's next page, a skip, or the reason the read must stop. */
    const takeIn = async ({ next, key, cap, page }: Asked): Promise<SiteImportStop | null> => {
      const foundBy = next.foundBy
      if (foundBy === 'home') homeIn = true
      if (!page.ok) {
        if (page.refusal === 'too-large' && cap < maxPageBytes) {
          cutOff.push(key)
          return 'total-bytes'
        }
        if (page.refusal === 'network' && outOfTime()) {
          cutOff.push(key)
          return 'time'
        }
        // A file is not a page: it takes nothing from the page budget's attempts (AGL-4106).
        if (page.refusal === 'content-type') attempts = Math.max(0, attempts - 1)
        skip({
          url: key,
          reason: skipReasonFor(page),
          ...(page.status ? { status: page.status } : {}),
          ...(page.location ? { location: page.location } : {}),
          ...(page.edge ? { edge: page.edge } : {}),
        })
        return null
      }
      inventory.bytesRead += page.bytes
      if (foundBy === 'home') preferred = new URL(page.url).origin
      const finalKey = canon(siteImportPageKey(new URL(page.url), origins) ?? page.url)
      if (finalKey !== key) {
        if (read.has(finalKey)) return null
        read.add(finalKey)
        if (!allowed(finalKey)) {
          skip({ url: finalKey, reason: 'robots' })
          return null
        }
      }
      const isHome = foundBy === 'home'
      const structured = readLayout || isHome
      const extract = extractSiteImportPage(page.text, page.url, sameSite, { structure: structured })
      if (extract.loginForm) {
        skip({ url: finalKey, reason: 'login-form' })
        return null
      }
      const links: string[] = []
      for (const link of extract.links) {
        const linkKey = siteImportPageKey(new URL(link), origins)
        if (!linkKey) continue
        links.push(linkKey)
        if (!only && !queued.has(linkKey)) {
          queued.add(linkKey)
          queue.push({ key: linkKey, foundBy: 'link' })
        }
      }
      // How the page is built (AGL-4106), through its own stylesheets.
      let built: Pick<SiteImportPage, 'layout' | 'nav' | 'footer' | 'look'> = {}
      if (extract.structure) {
        const linked = await Promise.all(extract.structure.stylesheets.filter((url) => !/fonts\.googleapis\.com/i.test(url)).slice(0, AI_THEME_REFERENCE_STYLESHEETS).map(stylesheet))
        const css = linked.filter((text): text is string => typeof text === 'string')
        const source = { blocks: extract.blocks, organization: extract.organization, structure: extract.structure }
        try {
          built = {
            ...(readLayout ? { layout: siteImportLayout(source, css) } : {}),
            ...(isHome ? { nav: siteImportNavTree(source, css), footer: siteImportFooterColumns(source, css), look: siteImportLookOf(source, css) } : {}),
          }
        } catch (error) {
          // A page the reader cannot lay out is still its words.
          console.warn('[site-import] the layout could not be read', { url: page.url, error })
        }
      }
      inventory.pages.push({
        ...built,
        url: finalKey,
        path: new URL(finalKey).pathname,
        foundBy,
        title: extract.title,
        description: extract.description,
        lang: extract.lang,
        canonical: extract.canonical,
        ogImage: extract.ogImage,
        siteName: extract.siteName,
        icons: extract.icons,
        brand: extract.brand,
        organization: extract.organization,
        blocks: extract.blocks,
        images: extract.images,
        navLinks: extract.navLinks,
        links: [...new Set(links.map(canon))],
        forms: extract.forms,
        bytes: page.bytes,
      })
      return null
    }
    for (;;) {
      const width = homeIn ? SITE_IMPORT_DEFAULTS.concurrency : 1
      while (!stop && queue.length && window.length < width) {
        const why = held()
        if (why === 'wait') break
        if (why) {
          stop = why
          break
        }
        const next = queue.shift() as (typeof queue)[number]
        const key = canon(next.key)
        if (read.has(key)) continue
        if (!allowed(key)) {
          skip({ url: key, reason: 'robots' })
          if (next.foundBy === 'home') homeIn = true
          continue
        }
        attempts += 1
        read.add(key)
        const cap = Math.min(maxPageBytes, remainingBytes() - reserved)
        reserved += cap
        window.push(
          request(key, /text\/html|application\/xhtml\+xml/i, 'text/html, application/xhtml+xml;q=0.9', cap).then((page) => ({ next, key, cap, page })),
        )
      }
      if (!window.length) break
      const asked = await (window.shift() as Promise<Asked>)
      reserved -= asked.cap
      stop = (await takeIn(asked)) ?? stop
    }
    inventory.stoppedBy = stop
    // Whatever a stop left unread is said, never dropped; a wave's own read
    // leaves its unread pages for its next pass instead.
    if (stop && !only) {
      const unread = [...cutOff]
      for (const next of queue) {
        const key = canon(next.key)
        if (!read.has(key) && !unread.includes(key)) unread.push(key)
      }
      for (const url of unread) skip({ url, reason: 'not-reached' })
    }
    return finish()
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * The home page's `aglyn-site-verification` values, for the meta-tag proof:
 * the same fetch, user agent and same-site redirects as the crawl, but no
 * robots.txt, because the person asked for this one page to be read.
 * `answered: false` when the page could not be read at all.
 */
export async function readSiteVerificationMeta(
  domain: string,
  metaName: string,
  seams: SiteImportCrawlSeams = {},
): Promise<{ answered: boolean; values: string[]; url?: string }> {
  const fetchText = seams.fetch ?? fetchPublicTextDetailed
  const bare = String(domain ?? '').trim().toLowerCase().replace(/^www\./, '')
  if (!DOMAIN_PATTERN.test(bare) || lookalikeBrandForHost(bare)) return { answered: false, values: [] }
  const origins = siteImportOrigins(bare)
  const result = await fetchText(`${origins[0]}/`, {
    maxBytes: SITE_IMPORT_DEFAULTS.maxPageBytes,
    accept: /text\/html|application\/xhtml\+xml/i,
    acceptHeader: 'text/html, application/xhtml+xml;q=0.9',
    userAgent: AGLYN_BOT_USER_AGENT,
    headersFor: await siteRequestHeaders(seams, bare, origins),
    timeoutMs: SITE_IMPORT_DEFAULTS.requestTimeoutMs,
    redirectAllowed: (_from, to) => to.protocol === 'https:' && origins.includes(to.origin),
  })
  if (!result.ok) {
    // An answer that is not the page (a 404, a redirect off the site) is
    // still an answer: the tag is not where it must be.
    const answered = result.refusal === 'http-status' || result.refusal === 'redirect-refused' || result.refusal === 'content-type'
    return { answered, values: [], url: result.url }
  }
  const head = result.text.split(/<body\b/i)[0] ?? ''
  return { answered: true, values: readMetaValues(head, metaName), url: result.url }
}

/**
 * One page as text for a prompt: its title, description and blocks in order,
 * fenced as untrusted data. The importer's prompt carries `UNTRUSTED_TEXT_RULE`.
 */
export function siteImportPagePromptText(page: SiteImportPage, maxChars = 12_000): string {
  const lines: string[] = []
  if (page.title) lines.push(`Title: ${page.title}`)
  if (page.description) lines.push(`Description: ${page.description}`)
  for (const block of page.blocks) {
    if (block.kind === 'heading') lines.push(`${'#'.repeat(block.level)} ${block.text}`)
    else if (block.kind === 'image') lines.push(`[image: ${block.alt || 'no description'}]`)
    else if (block.kind === 'list-item') lines.push(`- ${block.text}`)
    else if (block.kind === 'quote') lines.push(`> ${block.text}`)
    else if (block.kind === 'link') {
      // A link inside a sentence is in its block's words already.
      if (!block.inline) lines.push(block.text)
    } else lines.push(block.text)
  }
  return fenceUntrustedText(`Page ${page.path} of the site being imported`, lines.join('\n'), { maxChars })
}
