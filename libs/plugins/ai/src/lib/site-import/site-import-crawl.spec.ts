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
  siteImportPagePromptText,
  type SiteImportInventory,
} from './site-import-crawl'
import { SITE_IMPORT_RECORDINGS } from './fixtures/site-import-crawl-recordings'
import { aiSiteImportReadVerdict } from '../model/ai-site-import'
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
          { type: 'text', name: 'name' },
          { type: 'email', name: 'email' },
          { type: 'textarea', name: 'message' },
        ],
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
