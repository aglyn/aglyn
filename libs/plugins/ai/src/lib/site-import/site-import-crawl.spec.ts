/**
 * @jest-environment node
 *
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
 * The site-import crawler over recorded crawls (AGL-3974). Every address is
 * answered from `fixtures/site-import-crawl-recordings.ts` through a stubbed
 * `fetch`, UNDER the real `fetchPublicTextDetailed`, so the SSRF guard, the
 * same-site redirect check, the user agent and the byte cap are the shipped
 * ones. Only the address check is stubbed, to call every recorded host public.
 */

const mockResolvePublicIp = jest.fn(async (_host: string) => '93.184.216.34')

jest.mock('@aglyn/tenant-data-admin/server/serve-plugin-fetch', () => ({
  __esModule: true,
  resolvePublicIp: (host: string) => mockResolvePublicIp(host),
  createPinnedDispatcher: () => ({ close: async () => undefined }),
}))

import { UNTRUSTED_TEXT_TAG } from '@aglyn/shared-util-tools/untrusted-text'
import {
  AGLYN_BOT_USER_AGENT,
  crawlSiteForImport,
  readSiteVerificationMeta,
  siteImportPageKey,
  siteImportPagePromptText,
  type SiteImportInventory,
} from './site-import-crawl'
import { siteImportLeftOutReason, siteImportListedPage } from './site-import-page'
import { SITE_LAYOUT_PAGES, siteLayoutRecording } from './fixtures/site-layout-recordings'
import { SITE_IMPORT_RECORDINGS } from './fixtures/site-import-crawl-recordings'
import {
  AI_SITE_IMPORT_LEFT_OUT_COPY,
  AI_SITE_IMPORT_MAX_PAGES,
  aiSiteImportCreditRange,
  aiSiteImportInventory,
  aiSiteImportReadVerdict,
  aiSiteImportWaveCreditRange,
} from '../model/ai-site-import'
import {
  AGLYN_DOMAIN,
  AGLYN_ORIGIN,
  aglynAnswer,
  aglynSitemapUrls,
  type AglynSiteOptions,
} from './fixtures/aglyn-com-recordings'

type FetchCall = { url: string; headers: Record<string, string> }
let calls: FetchCall[] = []
let fetchSpy: jest.SpyInstance

beforeEach(() => {
  calls = []
  mockResolvePublicIp.mockClear()
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push({ url, headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string> })
    const recorded = SITE_IMPORT_RECORDINGS[url]
    if (!recorded) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })
    return new Response(recorded.body ?? null, { status: recorded.status, headers: recorded.headers })
  })
})

afterEach(() => fetchSpy.mockRestore())

const PAGE_CAP = 64 * 1024

async function crawlRosies(maxPages = 20): Promise<SiteImportInventory> {
  return crawlSiteForImport({ domain: 'rosies-bakery.com', maxPages, maxPageBytes: PAGE_CAP })
}

describe('a Wix-style small-business site', () => {
  it('reads robots.txt before anything else, and says it is AglynBot on every request', async () => {
    await crawlRosies()
    expect(calls[0].url).toBe('https://rosies-bakery.com/robots.txt')
    expect(calls.length).toBeGreaterThan(5)
    for (const call of calls) expect(call.headers['User-Agent']).toBe(AGLYN_BOT_USER_AGENT)
  })

  it('reads the sitemap index the robots file names, and only its same-site children', async () => {
    const inventory = await crawlRosies()
    const urls = calls.map((call) => call.url)
    expect(urls).toContain('https://www.rosies-bakery.com/sitemap.xml')
    expect(urls).toContain('https://www.rosies-bakery.com/pages-sitemap.xml')
    expect(urls).not.toContain('https://cdn.elsewhere.com/sitemap.xml')
    expect(urls).not.toContain('https://tracker.example/sitemap.xml')
    expect(urls.some((url) => url.startsWith('https://another-site.com'))).toBe(false)
    expect(inventory.robots.found).toBe(true)
    // Home, about, menu, cart, order, archive; tracking parameters folded away.
    expect(inventory.sitemapUrls).toBe(7)
  })

  it('reads home first, then the sitemap, then pages only a link reached; www and bare are one site', async () => {
    const inventory = await crawlRosies()
    expect(inventory.origins).toEqual(['https://rosies-bakery.com', 'https://www.rosies-bakery.com'])
    expect(inventory.pages.map((page) => [page.path, page.foundBy])).toEqual([
      ['/', 'home'],
      ['/about', 'sitemap'],
      ['/menu', 'sitemap'],
      ['/gallery', 'link'],
    ])
    expect(inventory.pages.every((page) => page.url.startsWith('https://www.rosies-bakery.com/'))).toBe(true)
    expect(inventory.stoppedBy).toBeNull()
    // `/menu?utm_source=nav` and the sitemap's `/menu?ref=…` are /menu, read once.
    expect(calls.filter((call) => call.url.startsWith('https://www.rosies-bakery.com/menu')).length).toBe(1)
  })

  it('honors robots.txt: /cart is never requested and is reported', async () => {
    const inventory = await crawlRosies()
    expect(calls.some((call) => call.url.includes('/cart'))).toBe(false)
    expect(inventory.skipped).toContainEqual({ url: 'https://www.rosies-bakery.com/cart', reason: 'robots' })
  })

  it('refuses a sign-in page outright and reports it', async () => {
    const inventory = await crawlRosies()
    expect(inventory.skipped).toContainEqual({
      url: 'https://www.rosies-bakery.com/members/login',
      reason: 'login-form',
    })
    expect(inventory.pages.some((page) => page.path.startsWith('/members'))).toBe(false)
  })

  it('refuses a redirect to another origin without following it', async () => {
    const inventory = await crawlRosies()
    expect(calls.some((call) => call.url.includes('othershop.com'))).toBe(false)
    expect(mockResolvePublicIp).not.toHaveBeenCalledWith('checkout.othershop.com')
    expect(inventory.skipped).toContainEqual({
      url: 'https://www.rosies-bakery.com/order',
      reason: 'off-origin-redirect',
      location: 'https://checkout.othershop.com/rosies',
    })
  })

  it('refuses a page past the per-page byte cap rather than cutting it', async () => {
    const inventory = await crawlRosies()
    expect(inventory.skipped).toContainEqual(
      expect.objectContaining({ url: 'https://www.rosies-bakery.com/archive', reason: 'too-large' }),
    )
    expect(inventory.pages.some((page) => page.path === '/archive')).toBe(false)
  })

  it('never follows a link off the site, nor one to a file that is not a page', async () => {
    await crawlRosies()
    const urls = calls.map((call) => call.url)
    expect(urls.some((url) => url.includes('instagram.com'))).toBe(false)
    expect(urls.some((url) => url.endsWith('.pdf'))).toBe(false)
    expect(urls.some((url) => url.startsWith('mailto:'))).toBe(false)
  })

  it('extracts the home page: title, description, structure in order, images, menu', async () => {
    const [home] = (await crawlRosies()).pages
    expect(home.title).toBe("Rosie's Bakery | Fresh bread daily")
    expect(home.description).toBe('Family bakery in Springfield since 1984 & still baking.')
    expect(home.lang).toBe('en')
    expect(home.blocks.filter((block) => block.kind !== 'image').map((block) => [block.kind, block.text])).toEqual([
      ['heading', 'Fresh bread, every morning'],
      ['paragraph', 'We bake sourdough, rye and seasonal pies by hand.'],
      ['heading', 'Our breads'],
      ['list-item', 'Country sourdough'],
      ['list-item', 'Dark rye'],
      ['quote', 'The best rye in the county. — Springfield Gazette'],
      ['heading', 'Say hello'],
      ['paragraph', 'See the gallery or email us. Follow us on Instagram.'],
      // A link inside a sentence follows its block, its address kept (AGL-4083).
      ['link', 'See the gallery'],
      ['link', 'email us'],
      ['link', 'Instagram'],
      ['paragraph', 'Your cart · Printable menu'],
      ['link', 'Your cart'],
      ['link', 'Printable menu'],
      ['paragraph', 'Rosie’s Bakery · 12 Main St, Springfield'],
      ['paragraph', 'Open Tue–Sun, 7am – 3pm'],
    ])
    expect(home.blocks.filter((block) => block.kind === 'link').map((block) => (block.kind === 'link' ? [block.href, block.inline] : []))).toEqual([
      ['https://www.rosies-bakery.com/gallery', true],
      ['mailto:hi@rosies-bakery.com', true],
      ['https://instagram.com/rosiesbakery', true],
      ['https://www.rosies-bakery.com/cart', true],
      ['https://www.rosies-bakery.com/files/menu.pdf', true],
    ])
    expect(home.blocks.find((block) => block.kind === 'heading')).toMatchObject({ level: 1, region: 'main' })
    expect(home.blocks[home.blocks.length - 1].region).toBe('footer')
    expect(home.images).toEqual([
      {
        url: 'https://static.wixstatic.com/media/loaf.jpg/v1/fill/w_980,h_600/loaf.jpg',
        alt: 'A sourdough loaf on a board',
        sameSite: false,
        region: 'main',
      },
      { url: 'https://www.rosies-bakery.com/images/storefront.webp', alt: 'Our storefront', sameSite: true, region: 'main' },
    ])
    expect(home.navLinks).toEqual([
      { text: 'Home', url: 'https://www.rosies-bakery.com/' },
      { text: 'About Us', url: 'https://www.rosies-bakery.com/about' },
      { text: 'Menu', url: 'https://www.rosies-bakery.com/menu?utm_source=nav' },
      { text: 'Order Online', url: 'https://www.rosies-bakery.com/order' },
      { text: 'Members', url: 'https://www.rosies-bakery.com/members/login' },
    ])
  })

  it('keeps no script, iframe, embed, object, SVG, noscript or comment, and no card form', async () => {
    const [home] = (await crawlRosies()).pages
    const everything = JSON.stringify(home)
    for (const gone of [
      'IGNORE ALL PREVIOUS INSTRUCTIONS',
      'viewerModel',
      'tracking',
      'Iframe fallback text',
      'youtube.com',
      'promo.swf',
      'Object fallback text',
      'Decorative wheat',
      'Please enable JavaScript',
      'Commented-out special',
      'Buy a gift card',
      'cardnumber',
      'Card number',
    ]) {
      expect(everything).not.toContain(gone)
    }
    expect(home.forms.removed).toBe(1)
    expect(home.forms.kept).toEqual([
      {
        fields: [
          { type: 'text', name: 'name', label: 'Name' },
          { type: 'email', name: 'email', label: 'Email' },
          { type: 'textarea', name: 'message', label: 'Message' },
        ],
        submit: 'Send',
      },
    ])
  })

  it('stops at the page budget, and says so', async () => {
    const inventory = await crawlRosies(2)
    expect(inventory.pages.map((page) => page.path)).toEqual(['/', '/about'])
    expect(inventory.stoppedBy).toBe('page-budget')
  })

  it('stops at the total byte budget, and says so', async () => {
    const inventory = await crawlSiteForImport({
      domain: 'rosies-bakery.com',
      maxPages: 20,
      maxPageBytes: PAGE_CAP,
      maxTotalBytes: 12_000,
    })
    expect(inventory.stoppedBy).toBe('total-bytes')
    expect(inventory.bytesRead).toBeLessThanOrEqual(12_000)
  })

  it('stops at the time budget, and says so', async () => {
    let clock = 0
    const inventory = await crawlSiteForImport(
      { domain: 'rosies-bakery.com', maxPages: 20, maxPageBytes: PAGE_CAP, timeBudgetMs: 10_000 },
      { now: () => (clock += 1_500) },
    )
    expect(inventory.stoppedBy).toBe('time')
    expect(inventory.pages.length).toBeLessThan(4)
  })

  it('fences a page as untrusted data for a prompt', async () => {
    const [home] = (await crawlRosies()).pages
    const text = siteImportPagePromptText(home)
    expect(text.startsWith(`<${UNTRUSTED_TEXT_TAG} source="Page / of the site being imported">`)).toBe(true)
    expect(text).toContain('# Fresh bread, every morning')
    expect(text).toContain('- Country sourdough')
    expect(text).toContain('[image: A sourdough loaf on a board]')
    expect(text.trimEnd().endsWith(`</${UNTRUSTED_TEXT_TAG}>`)).toBe(true)
  })
})

describe('robots.txt', () => {
  it('keeps AglynBot off a site whose AglynBot group disallows everything, though * is allowed', async () => {
    const inventory = await crawlSiteForImport({ domain: 'northside-yoga.com', maxPages: 10 })
    expect(inventory.pages).toEqual([])
    expect(inventory.skipped).toContainEqual({ url: 'https://northside-yoga.com/', reason: 'robots' })
    expect(calls.map((call) => call.url)).toEqual(['https://northside-yoga.com/robots.txt'])
  })

  it('stops before any page when robots.txt cannot be read', async () => {
    const inventory = await crawlSiteForImport({ domain: 'down-robots.com', maxPages: 10 })
    expect(inventory.stoppedBy).toBe('robots-unreachable')
    expect(inventory.pages).toEqual([])
    expect(calls.map((call) => call.url)).toEqual(['https://down-robots.com/robots.txt'])
  })

  it('reads on past a robots.txt bot protection refuses, and keeps the status the home page was refused with', async () => {
    const inventory = await crawlSiteForImport({ domain: 'guarded-garden.com', maxPages: 10 })
    expect(inventory.stoppedBy).toBeNull()
    expect(inventory.pages).toEqual([])
    expect(inventory.skipped).toEqual([{ url: 'https://guarded-garden.com/', reason: 'http-error', status: 403 }])
  })

  it('treats a 404 robots.txt as allowing everything, and finds pages by links when there is no sitemap', async () => {
    const inventory = await crawlSiteForImport({ domain: 'plain-plumbing.com', maxPages: 10 })
    expect(inventory.robots.found).toBe(false)
    expect(inventory.sitemapUrls).toBe(0)
    expect(inventory.pages.map((page) => [page.path, page.foundBy])).toEqual([
      ['/', 'home'],
      ['/services', 'link'],
      ['/contact', 'link'],
    ])
    expect(calls.some((call) => call.url.includes('evil.example'))).toBe(false)
  })
})

describe('what is refused before any request', () => {
  it('a domain that wears another company’s brand', async () => {
    const inventory = await crawlSiteForImport({ domain: 'paypal-account-verify.com', maxPages: 5 })
    expect(inventory.refused).toBe('lookalike')
    expect(calls).toEqual([])
  })

  it('something that is not a domain', async () => {
    const inventory = await crawlSiteForImport({ domain: 'localhost', maxPages: 5 })
    expect(inventory.refused).toBe('invalid-domain')
    expect(calls).toEqual([])
  })

  it('a host that resolves to a private address is never connected to', async () => {
    mockResolvePublicIp.mockImplementation(async () => null as unknown as string)
    const inventory = await crawlSiteForImport({ domain: 'plain-plumbing.com', maxPages: 5 })
    expect(calls).toEqual([])
    expect(inventory.stoppedBy).toBe('robots-unreachable')
    mockResolvePublicIp.mockImplementation(async () => '93.184.216.34')
  })
})

describe('readSiteVerificationMeta', () => {
  it('reads the tag from the home page, following the same-site redirect', async () => {
    const home = SITE_IMPORT_RECORDINGS['https://www.rosies-bakery.com/']
    SITE_IMPORT_RECORDINGS['https://www.rosies-bakery.com/'] = {
      ...home,
      body: (home.body ?? '').replace(
        '<meta charset="utf-8">',
        '<meta charset="utf-8"><meta name="aglyn-site-verification" content="tok-123">',
      ),
    }
    try {
      expect(await readSiteVerificationMeta('rosies-bakery.com', 'aglyn-site-verification')).toEqual({
        answered: true,
        values: ['tok-123'],
        url: 'https://www.rosies-bakery.com/',
      })
    } finally {
      SITE_IMPORT_RECORDINGS['https://www.rosies-bakery.com/'] = home
    }
  })

  it('answers "no tag" for a page that has none, and "no answer" when nothing answered', async () => {
    expect(await readSiteVerificationMeta('plain-plumbing.com', 'aglyn-site-verification')).toEqual({
      answered: true,
      values: [],
      url: 'https://plain-plumbing.com/',
    })
    fetchSpy.mockImplementationOnce(async () => {
      throw new Error('socket hang up')
    })
    expect(await readSiteVerificationMeta('plain-plumbing.com', 'aglyn-site-verification')).toMatchObject({
      answered: false,
      values: [],
    })
  })
})

/*------------------------------------------
 * aglyn.com, as recorded on 10/28 (AGL-4083)
 *-----------------------------------------*/

describe('aglyn.com, the whole site', () => {
  /** Serves aglyn.com's recordings under the real fetch, one request at a time or `delayMs` apart. */
  function serveAglyn(options: AglynSiteOptions & { delayMs?: number } = {}) {
    let inFlight = 0
    let most = 0
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push({ url, headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string> })
      inFlight += 1
      most = Math.max(most, inFlight)
      try {
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
        const answer = aglynAnswer(url, options)
        return new Response(answer.body || null, { status: answer.status, headers: answer.headers })
      } finally {
        inFlight -= 1
      }
    })
    return { most: () => most }
  }

  const SITEMAP = aglynSitemapUrls()

  it('lists 123 pages across the index and all six of its children', async () => {
    serveAglyn({ pageBytes: 2_000 })
    const inventory = await crawlSiteForImport({ domain: AGLYN_DOMAIN, maxPages: 200 })
    expect(new Set(SITEMAP).size).toBe(123)
    // The index and its six children: a seventh document past the old cap of six.
    expect(calls.some((call) => call.url === `${AGLYN_ORIGIN}/sitemaps/authors/1.xml`)).toBe(true)
    expect(inventory.sitemapUrls).toBe(123)
  })

  it('reads 123 pages of their measured sizes, 54 MB, without stopping', async () => {
    serveAglyn()
    const inventory = await crawlSiteForImport({ domain: AGLYN_DOMAIN, maxPages: 200, timeBudgetMs: 120_000 })
    expect(inventory.stoppedBy).toBeNull()
    expect(inventory.pages).toHaveLength(123)
    expect(inventory.bytesRead).toBeGreaterThan(50 * 1024 * 1024)
    expect(inventory.skipped).toEqual([])
  })

  it('reads four pages at a time, and lists them in the order the sitemap does', async () => {
    const served = serveAglyn({ pageBytes: 2_000, delayMs: 5 })
    const inventory = await crawlSiteForImport({ domain: AGLYN_DOMAIN, maxPages: 200, timeBudgetMs: 60_000 })
    expect(served.most()).toBe(4)
    expect(inventory.pages.map((page) => page.url)).toEqual(SITEMAP)
    // robots.txt, then the index and its children one at a time, then home alone.
    expect(calls.slice(0, 9).map((call) => new URL(call.url).pathname)).toEqual([
      '/robots.txt',
      '/sitemap.xml',
      '/sitemaps/pages/1.xml',
      '/sitemaps/content-blog/1.xml',
      '/sitemaps/content-changelog/1.xml',
      '/sitemaps/content-videos/1.xml',
      '/sitemaps/content-newsroom/1.xml',
      '/sitemaps/authors/1.xml',
      '/',
    ])
  })

  it('lists every address a stop left unread as not reached, so the count adds up', async () => {
    serveAglyn()
    const inventory = await crawlSiteForImport({ domain: AGLYN_DOMAIN, maxPages: 200, maxTotalBytes: 8 * 1024 * 1024 })
    expect(inventory.stoppedBy).toBe('total-bytes')
    expect(inventory.pages.length).toBeGreaterThan(5)
    expect(inventory.pages.length).toBeLessThan(123)
    const notReached = inventory.skipped.filter((entry) => entry.reason === 'not-reached').map((entry) => entry.url)
    expect(inventory.pages.length + notReached.length).toBe(123)
    expect(inventory.skipped.length).toBe(notReached.length)
    expect(notReached).toContain(SITEMAP[SITEMAP.length - 1])
    expect(notReached.some((url) => inventory.pages.some((page) => page.url === url))).toBe(false)
  })

  it('leaves a wave’s unread pages for its next pass, never as not reached', async () => {
    serveAglyn()
    const only = aglynSitemapUrls().slice(1, 30)
    const inventory = await crawlSiteForImport({ domain: AGLYN_DOMAIN, maxPages: only.length, only, maxTotalBytes: 4 * 1024 * 1024 })
    expect(inventory.stoppedBy).toBe('total-bytes')
    expect(inventory.skipped.some((entry) => entry.reason === 'not-reached')).toBe(false)
  })

  it('sends the headers its seam names for the site on every request, under its own Accept and user agent', async () => {
    serveAglyn({ pageBytes: 2_000 })
    const asked: string[] = []
    await crawlSiteForImport(
      { domain: AGLYN_DOMAIN, maxPages: 3 },
      {
        headersFor: async (domain) => {
          asked.push(domain)
          return { 'x-aglyn-import': 'secret', 'User-Agent': 'NotAglynBot', Accept: '*/*' }
        },
      },
    )
    expect(asked).toEqual([AGLYN_DOMAIN])
    expect(calls.length).toBeGreaterThan(3)
    for (const call of calls) {
      expect(call.headers['x-aglyn-import']).toBe('secret')
      expect(call.headers['User-Agent']).toBe(AGLYN_BOT_USER_AGENT)
      expect(call.headers['Accept']).not.toBe('*/*')
    }
  })

  it('sends no extra header at all without the seam', async () => {
    serveAglyn({ pageBytes: 2_000 })
    await crawlSiteForImport({ domain: AGLYN_DOMAIN, maxPages: 3 })
    for (const call of calls) expect(Object.keys(call.headers).sort()).toEqual(['Accept', 'User-Agent'])
  })

  it('the 10/20 shape: Home turned away by bot protection, so the read says stop before a credit is spent', async () => {
    serveAglyn({ challenged: true, pageBytes: 2_000 })
    const inventory = await crawlSiteForImport({ domain: AGLYN_DOMAIN, maxPages: 200, shallowFirst: true })
    expect(inventory.pages.map((page) => page.path).sort()).toEqual([
      '/contact',
      '/legal/acceptable-use',
      '/legal/cookies',
      '/legal/dmca',
      '/legal/dpa',
      '/legal/eula',
      '/legal/marketplace-publisher-agreement',
      '/legal/privacy',
      '/legal/subprocessors',
      '/legal/terms',
    ])
    expect(inventory.skipped[0]).toEqual({ url: `${AGLYN_ORIGIN}/`, reason: 'http-error', status: 429, edge: 'vercel' })
    const verdict = aiSiteImportReadVerdict(inventory)
    expect(verdict).toMatchObject({ kind: 'home-blocked', blocked: 113, total: 123, homeStatus: 429, edge: 'vercel' })
  })
})

/*------------------------------------------
 * The 10/29 read: files are not pages (AGL-4106)
 *-----------------------------------------*/

describe('a page address, never a file', () => {
  const origins = ['https://aglyn.com', 'https://www.aglyn.com']
  const key = (raw: string) => siteImportPageKey(new URL(raw), origins)

  it('refuses an API’s, a CDN’s or a download’s address, whatever its extension', () => {
    expect(key('https://aglyn.com/api/media/cdn/org:FixtureOrg:FixtureHst/AbC123?download=1')).toBeNull()
    expect(key('https://aglyn.com/api/health')).toBeNull()
    expect(key('https://aglyn.com/cdn-cgi/l/email-protection')).toBeNull()
    expect(key('https://aglyn.com/wp-json/wp/v2/pages')).toBeNull()
    expect(key('https://aglyn.com/press/kit?download=true')).toBeNull()
  })

  it('keeps a page whose name only starts like one, and drops its tracking', () => {
    expect(key('https://aglyn.com/apiary')).toBe('https://aglyn.com/apiary')
    expect(key('https://aglyn.com/api-docs')).toBe('https://aglyn.com/api-docs')
    expect(key('https://aglyn.com/product?utm_source=x')).toBe('https://aglyn.com/product')
  })
})

describe('the 10/29 inventory: 209 pages and a press kit of 136 files', () => {
  const ORIGIN = 'https://press-kit-site.com'
  const PAGES = Array.from({ length: 207 }, (_, index) => `${ORIGIN}/page-${index + 1}`)
  const FILES = Array.from({ length: 136 }, (_, index) => `/api/media/cdn/org:FixtureOrg:FixtureHst/file${index}?download=1`)
  const html = (body: string) => new Response(`<!DOCTYPE html><html><head><title>A page</title></head><body><main>${body}</main></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } })

  beforeEach(() => {
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push({ url, headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string> })
      const { pathname } = new URL(url)
      if (pathname === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml`, { status: 200, headers: { 'content-type': 'text/plain' } })
      if (pathname === '/sitemap.xml') {
        const locations = [...PAGES, `${ORIGIN}/press`].map((page) => `<url><loc>${page}</loc></url>`).join('')
        return new Response(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations}</urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } })
      }
      if (pathname === '/') return html('<h1>Home</h1><p>Every page of the site, one link away.</p><a href="/press">Press</a>')
      if (pathname === '/press') return html(`<h1>Press kit</h1><p>Logos, photos and the brand guide.</p>${FILES.map((file) => `<a href="${file}">Download</a>`).join('')}<a href="/brochure">Brochure</a>`)
      if (pathname === '/brochure') return new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } })
      if (pathname.startsWith('/page-')) return html(`<h1>${pathname.slice(1)}</h1><p>The words of ${pathname.slice(1)} of the site.</p>`)
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })
    })
  })

  it('reads all 209 pages, never asks for a file, and leaves out the one file a link hid as a file', async () => {
    const inventory = await crawlSiteForImport({ domain: 'press-kit-site.com', maxPages: AI_SITE_IMPORT_MAX_PAGES, timeBudgetMs: 120_000 })
    expect(calls.some((call) => new URL(call.url).pathname.startsWith('/api/'))).toBe(false)
    expect(inventory.pages).toHaveLength(209)
    expect(inventory.stoppedBy).toBeNull()
    expect(inventory.skipped).toEqual([{ url: `${ORIGIN}/brochure`, reason: 'not-html', status: 200 }])
    const reasons = inventory.skipped.map((entry) => siteImportLeftOutReason(entry.reason, entry.status))
    expect(reasons).toEqual(['file'])
    expect(reasons).not.toContain('not-reached')
  })
})

describe('reading how pages are laid out', () => {
  function serveLayout() {
    const origin = SITE_LAYOUT_PAGES.pottery.url.replace(/\/$/, '')
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input)
      calls.push({ url, headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string> })
      const { pathname, hostname } = new URL(url)
      if (hostname === 'static1.squarespace.com') return new Response('.summary-item{border:1px solid #e3d9cc}', { status: 200, headers: { 'content-type': 'text/css' } })
      if (hostname === 'fonts.googleapis.com') return new Response('@font-face{font-family:Fraunces}', { status: 200, headers: { 'content-type': 'text/css' } })
      if (pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { status: 200, headers: { 'content-type': 'text/plain' } })
      if (pathname === '/' || pathname === '/visit') return new Response(siteLayoutRecording('pottery'), { status: 200, headers: { 'content-type': 'text/html' } })
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })
    })
    return origin
  }

  it('reads a wave’s pages with their layout, each linked stylesheet asked once, Google Fonts’ never', async () => {
    const origin = serveLayout()
    const inventory = await crawlSiteForImport({ domain: 'tidewater-pottery.example', maxPages: 2, only: [`${origin}/`, `${origin}/visit`] })
    expect(inventory.pages).toHaveLength(2)
    for (const page of inventory.pages) {
      expect(page.layout?.sections.map((section) => section.band)).toEqual(['dark', 'plain', 'soft', 'plain', 'soft', 'plain', 'plain', 'brand'])
    }
    expect(calls.filter((call) => call.url === 'https://static1.squarespace.com/static/versioned-site-css/site.css')).toHaveLength(1)
    expect(calls.some((call) => call.url.includes('fonts.googleapis.com'))).toBe(false)
    // The edge's headers never go to another host.
    const css = calls.find((call) => call.url.includes('static1.squarespace.com'))
    expect(css?.headers['User-Agent']).toBe(AGLYN_BOT_USER_AGENT)
    expect(css?.headers['Accept']).toMatch(/text\/css/)
  })

  it('reads the home page’s menu, footer and look on the inventory’s read, and no layout', async () => {
    serveLayout()
    const inventory = await crawlSiteForImport({ domain: 'tidewater-pottery.example', maxPages: 1 })
    const [home] = inventory.pages
    expect(home?.layout).toBeUndefined()
    expect(home?.nav?.items.map((item) => item.label)).toEqual(['Classes', 'Gallery', 'Visit', 'Shop'])
    expect(home?.footer?.copyright).toBe('© 2026 Tidewater Pottery Studio')
    expect(home?.look?.fonts).toEqual({ body: 'Work Sans', headings: 'Fraunces', google: ['Fraunces', 'Work Sans'] })
  })
})

describe('a site’s other addresses for one page (AGL-4152)', () => {
  const ORIGIN = 'https://www.cedar-ridge-paving.example'
  const paths = (inventory: SiteImportInventory) => inventory.pages.map((page) => new URL(page.url).pathname + new URL(page.url).search)
  const left = (inventory: SiteImportInventory, reason: string) =>
    inventory.skipped.filter((entry) => entry.reason === reason).map((entry) => new URL(entry.url).pathname + new URL(entry.url).search)
  const crawlCedar = (maxPages = 25) => crawlSiteForImport({ domain: 'cedar-ridge-paving.example', maxPages })

  it('reads the hosted-builder site as its real pages, and says what became of every other address', async () => {
    const inventory = await crawlCedar()
    expect(paths(inventory).sort()).toEqual(['/', '/commercial', '/contact', '/photos'])
    expect(left(inventory, 'duplicate').sort()).toEqual(['/home', '/photos?itemId=a1', '/photos?itemId=b2', '/photos?itemId=c3', '/photos?itemId=d4'])
    expect(left(inventory, 'system-page')).toEqual(['/cart'])
    expect(inventory.skipped.find((entry) => entry.url === `${ORIGIN}/home`)?.sameAs).toBe(`${ORIGIN}/`)
    expect(inventory.skipped.find((entry) => entry.url === `${ORIGIN}/photos?itemId=a1`)?.sameAs).toBe(`${ORIGIN}/photos`)
    expect(inventory.stoppedBy).toBeNull()
  })

  it('says a page the site answers 404 for is missing, not that it could not be read just now', async () => {
    const inventory = await crawlCedar()
    const dead = inventory.skipped.find((entry) => entry.url === `${ORIGIN}/our-work`)
    expect(dead).toMatchObject({ reason: 'http-error', status: 404 })
    expect(siteImportLeftOutReason(dead?.reason as never, dead?.status)).toBe('missing')
  })

  it('takes nothing from the page budget for an address that is not a page of its own', async () => {
    // Four real pages fill a budget of four; the five other addresses and the cart never count.
    const inventory = await crawlCedar(4)
    expect(paths(inventory).sort()).toEqual(['/', '/commercial', '/contact', '/photos'])
  })

  it('the inventory: fewer pages, the same list said under Not brought in, and a quote that follows the real count', async () => {
    const inventory = await crawlCedar()
    const state = aiSiteImportInventory({
      domain: 'cedar-ridge-paving.example',
      siteName: 'Cedar Ridge Paving',
      ownership: { method: 'dns', provenAt: '2026-11-05T00:00:00.000Z', detail: null } as never,
      readAt: '2026-11-05T00:00:00.000Z',
      pages: inventory.pages.map(siteImportListedPage),
      menu: [],
      skipped: inventory.skipped.map((entry) => ({
        url: entry.url,
        reason: siteImportLeftOutReason(entry.reason, entry.status),
        ...(entry.sameAs ? { sameAs: entry.sameAs } : {}),
      })),
      stoppedBy: inventory.stoppedBy,
      pageLimit: null,
      existingPages: 0,
      mintId: (() => {
        let next = 0
        return () => `draft${(next += 1)}`
      })(),
    })
    expect(state.found).toBe(4)
    expect(state.pages.map((page) => page.slug).sort()).toEqual(['/', 'commercial', 'contact', 'photos'])
    expect(state.leftOutCount).toEqual({ duplicate: 5, 'system-page': 1, missing: 1 })
    expect(state.leftOut).toContainEqual(expect.objectContaining({ path: '/photos?itemId=a1', reason: 'duplicate', sameAs: '/photos' }))
    expect(state.leftOut).toContainEqual(expect.objectContaining({ path: '/home', reason: 'duplicate', sameAs: '/' }))
    for (const reason of ['duplicate', 'system-page', 'missing'] as const) expect(AI_SITE_IMPORT_LEFT_OUT_COPY[reason]).toBeTruthy()
    // The quote is the pages kept, with nothing of its own to change.
    expect(state.waves.map((wave) => wave.slots.length)).toEqual([4])
    expect(aiSiteImportWaveCreditRange(state, state.waves[0])).toEqual(aiSiteImportCreditRange(4, { frame: true }))
  })

  it('a wave’s own read is exactly the pages it asks for: it refuses none of them', async () => {
    const inventory = await crawlSiteForImport({
      domain: 'cedar-ridge-paving.example',
      maxPages: 3,
      only: [`${ORIGIN}/`, `${ORIGIN}/home`, `${ORIGIN}/photos?itemId=a1`],
    })
    expect(paths(inventory)).toEqual(['/', '/home', '/photos?itemId=a1'])
    expect(inventory.skipped).toEqual([])
  })
})

describe('what a rule about other addresses must not break (AGL-4152)', () => {
  const ORIGIN = 'https://older-site.example'
  const WORDS = (word: string) => `<h1>${word}</h1><p>Everything we have to say about ${word}, in a sentence of its own that no other page repeats.</p>`
  type Page = { main?: string; head?: string; status?: number }
  const serve = (pages: Record<string, Page>, sitemap: readonly string[] = []) => {
    fetchSpy.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      calls.push({ url: url.toString(), headers: ((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string> })
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { status: 200, headers: { 'content-type': 'text/plain' } })
      if (url.pathname === '/sitemap.xml') {
        return new Response(`<urlset>${sitemap.map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`).join('')}</urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } })
      }
      const page = pages[`${url.pathname}${url.search}`]
      if (!page) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })
      return new Response(`<!DOCTYPE html><html><head><title>A page</title>${page.head ?? ''}</head><body><main>${page.main ?? ''}</main></body></html>`, {
        status: page.status ?? 200,
        headers: { 'content-type': 'text/html' },
      })
    })
  }
  const crawlIt = () => crawlSiteForImport({ domain: 'older-site.example', maxPages: 50 })
  const addresses = (inventory: SiteImportInventory) => inventory.pages.map((page) => new URL(page.url).pathname + new URL(page.url).search).sort()
  const canonical = (path: string) => `<link rel="canonical" href="${ORIGIN}${path}">`
  const link = (href: string) => `<a href="${href}">More</a>`

  it('keeps an older site’s pages, whose query string is what names them', async () => {
    serve({
      '/': { main: `${WORDS('home')}${link('/?page_id=12')}${link('/?p=5')}${link('/?page_id=13')}${link('/index.php?id=3')}` },
      // It names itself; it names nothing; and a template that names the home page on every page, whose words say otherwise.
      '/?page_id=12': { main: WORDS('history'), head: canonical('/?page_id=12') },
      '/?p=5': { main: WORDS('news') },
      '/?page_id=13': { main: WORDS('staff'), head: canonical('/') },
      '/index.php?id=3': { main: WORDS('hours'), head: canonical('/index.php') },
      '/index.php': { main: WORDS('index') },
    })
    expect(addresses(await crawlIt())).toEqual(expect.arrayContaining(['/', '/?p=5', '/?page_id=12', '/?page_id=13', '/index.php?id=3']))
  })

  it('keeps a page whose canonical names another page when its words are its own: a template’s mistake', async () => {
    serve({ '/': { main: `${WORDS('home')}${link('/about')}`, head: canonical('/') }, '/about': { main: WORDS('about'), head: canonical('/') } })
    const inventory = await crawlIt()
    expect(addresses(inventory)).toEqual(['/', '/about'])
    expect(inventory.skipped).toEqual([])
  })

  it('never takes the home page for another address, whatever its canonical says', async () => {
    const home = `${WORDS('home')}${link('/start')}`
    serve({ '/': { main: home, head: canonical('/start') }, '/start': { main: home } })
    const inventory = await crawlIt()
    expect(addresses(inventory)).toEqual(['/'])
    expect(inventory.skipped).toEqual([{ url: `${ORIGIN}/start`, reason: 'duplicate', sameAs: `${ORIGIN}/` }])
  })

  it('without a canonical, an address with the same main content as a page found is left out; different content is a page', async () => {
    const home = `${WORDS('home')}${link('/home')}${link('/gallery')}${link('/gallery?sort=new')}${link('/gallery?item=1')}`
    serve({
      '/': { main: home },
      '/home': { main: home },
      '/gallery': { main: WORDS('gallery') },
      '/gallery?item=1': { main: WORDS('gallery') },
      '/gallery?sort=new': { main: WORDS('newest') },
    })
    const inventory = await crawlIt()
    expect(addresses(inventory)).toEqual(['/', '/gallery', '/gallery?sort=new'])
    expect(inventory.skipped.map((entry) => entry.url).sort()).toEqual([`${ORIGIN}/gallery?item=1`, `${ORIGIN}/home`])
  })

  it('two stubs of the same few words are two pages', async () => {
    serve({
      '/': { main: `${WORDS('home')}${link('/team')}${link('/services')}` },
      '/team': { main: '<h1>Coming soon</h1><p>Check back later.</p>' },
      '/services': { main: '<h1>Coming soon</h1><p>Check back later.</p>' },
    })
    expect(addresses(await crawlIt())).toEqual(['/', '/services', '/team'])
  })

  it('two pages of different photos and no words are two pages', async () => {
    serve({
      '/': { main: `${WORDS('home')}${link('/one')}${link('/two')}` },
      '/one': { main: '<img src="https://cdn.example.com/one.jpg" alt="">' },
      '/two': { main: '<img src="https://cdn.example.com/two.jpg" alt="">' },
    })
    expect(addresses(await crawlIt())).toEqual(['/', '/one', '/two'])
  })

  it('reads the page a canonical names even when nothing else links it, and that page stands', async () => {
    serve(
      {
        '/': { main: WORDS('home') },
        '/gallery?itemId=1': { main: WORDS('gallery'), head: canonical('/gallery') },
        '/gallery': { main: WORDS('gallery'), head: canonical('/gallery') },
      },
      ['/gallery?itemId=1'],
    )
    const inventory = await crawlIt()
    expect(addresses(inventory)).toEqual(['/', '/gallery'])
    expect(inventory.skipped).toEqual([{ url: `${ORIGIN}/gallery?itemId=1`, reason: 'duplicate', sameAs: `${ORIGIN}/gallery` }])
  })

  it('a canonical that names a page that does not serve, or another site, leaves the page standing', async () => {
    serve(
      {
        '/': { main: WORDS('home') },
        '/gallery?itemId=1': { main: WORDS('gallery'), head: canonical('/gallery') },
        '/moved': { main: WORDS('moved'), head: '<link rel="canonical" href="https://another-site.example/moved">' },
      },
      ['/gallery?itemId=1', '/moved'],
    )
    const inventory = await crawlIt()
    expect(addresses(inventory)).toEqual(['/', '/gallery?itemId=1', '/moved'])
    expect(inventory.skipped).toEqual([{ url: `${ORIGIN}/gallery`, reason: 'http-error', status: 404 }])
  })

  it('a canonical over http, or with a slash, names the same address and not another page', async () => {
    serve(
      { '/': { main: WORDS('home') }, '/about/': { main: WORDS('about'), head: '<link rel="canonical" href="http://older-site.example/about">' } },
      ['/about/'],
    )
    const inventory = await crawlIt()
    expect(addresses(inventory)).toEqual(['/', '/about/'])
    expect(inventory.skipped).toEqual([])
  })

  it('reads every address without a query before the ones a link adds a query to', async () => {
    const variants = ['1', '2', '3', '4', '5', '6'].map((id) => `/gallery?itemId=${id}`)
    serve({
      '/': { main: `${WORDS('home')}${variants.map(link).join('')}${link('/gallery')}${link('/about')}` },
      '/gallery': { main: WORDS('gallery'), head: canonical('/gallery') },
      '/about': { main: WORDS('about') },
      ...Object.fromEntries(variants.map((path) => [path, { main: WORDS('gallery'), head: canonical('/gallery') }])),
    })
    await crawlIt()
    const asked = calls.map((call) => new URL(call.url)).filter((url) => !/robots|sitemap/.test(url.pathname)).map((url) => `${url.pathname}${url.search}`)
    expect(asked.slice(0, 3)).toEqual(['/', '/gallery', '/about'])
  })

  describe('a platform’s own screens', () => {
    const LONG = `<h1>Carts</h1><p>${'We build and repair golf carts in our own shop with parts we stock ourselves, and we will bring yours back better than new. '.repeat(3)}</p>`

    it('leaves out a known screen with almost no words, or one the site itself keeps out of search', async () => {
      serve({
        '/': { main: `${WORDS('home')}${['/cart', '/checkout', '/account/orders', '/en/basket', '/my-account', '/cart.php', '/search'].map(link).join('')}` },
        '/cart': { main: '<p>Your cart is empty.</p>' },
        '/checkout': { main: '<p>0</p>', head: '<meta name="robots" content="noindex">' },
        '/account/orders': { main: LONG, head: '<meta name="ROBOTS" content="NOINDEX, NOFOLLOW">' },
        '/en/basket': { main: '<h1>Basket</h1>' },
        '/my-account': { main: '<p>Sign in to see your orders.</p>' },
        '/cart.php': { main: '<p>No items yet.</p>' },
        '/search': { main: '<h1>Search</h1>' },
      })
      const inventory = await crawlIt()
      expect(addresses(inventory)).toEqual(['/'])
      expect(inventory.skipped.map((entry) => [new URL(entry.url).pathname, entry.reason]).sort()).toEqual(
        ['/account/orders', '/cart', '/cart.php', '/checkout', '/en/basket', '/my-account', '/search'].map((path) => [path, 'system-page']),
      )
    })

    it('keeps a page at one of those addresses that has plenty to say and asks to be found', async () => {
      serve({ '/': { main: `${WORDS('home')}${link('/cart')}` }, '/cart': { main: LONG } })
      expect(addresses(await crawlIt())).toEqual(['/', '/cart'])
    })

    it('keeps a product whose name only sounds like one, deep in the shop', async () => {
      serve({ '/': { main: `${WORDS('home')}${link('/shop/cart')}${link('/shop/basket')}` }, '/shop/cart': { main: '<h1>Garden cart</h1><p>Steel, two wheels.</p>' }, '/shop/basket': { main: '<h1>Willow basket</h1>' } })
      expect(addresses(await crawlIt())).toEqual(['/', '/shop/basket', '/shop/cart'])
    })

    it('keeps a page the site keeps out of search at any other address: noindex alone says nothing', async () => {
      serve({ '/': { main: `${WORDS('home')}${link('/spring-offer')}`, head: '<meta name="robots" content="noindex">' }, '/spring-offer': { main: WORDS('offer'), head: '<meta name="robots" content="noindex">' } })
      expect(addresses(await crawlIt())).toEqual(['/', '/spring-offer'])
    })
  })

  it('the Wix-style recording still reads all its pages, though every one names the home page as canonical', async () => {
    const inventory = await crawlSiteForImport({ domain: 'rosies-bakery.com', maxPages: 20, maxPageBytes: PAGE_CAP })
    expect(inventory.pages.length).toBeGreaterThan(2)
    expect(inventory.skipped.filter((entry) => entry.reason === 'duplicate')).toEqual([])
  })
})
