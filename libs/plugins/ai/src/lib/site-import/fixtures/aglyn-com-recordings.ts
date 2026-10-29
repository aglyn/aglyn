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
 * aglyn.com as AglynBot read it on 2026-10-28 (AGL-4083), for the offline
 * replay specs of Bring my site: the first site this importer was pointed at
 * that was larger than a small business's, and the one the 10/20 import of
 * read 10 pages of.
 *
 * `aglyn-com/` holds seven pages recorded whole (home, about, pricing,
 * contact, product, product/ai, legal/privacy), robots.txt, the sitemap index
 * and all six of its children. Every recording was trimmed before it entered
 * the repo: script bodies are gone (one small inline script with a hostile
 * line stands in for them; the Organization and WebSite structured data
 * stay), so are styles, inline SVG bodies, preload links and class names, and
 * every address and phone number is a placeholder. What is left is what the
 * extractor reads: the head's tags and the header, nav, main and footer whole.
 *
 * The real pages are larger than the trimmed ones; `AGLYN_PAGE_BYTES` keeps
 * their measured sizes, and the byte-budget specs serve pages of those sizes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const AGLYN_DOMAIN = 'aglyn.com'
export const AGLYN_ORIGIN = `https://${AGLYN_DOMAIN}`

const DIR = join(__dirname, 'aglyn-com')

const cache = new Map<string, string>()

/** One recorded file, as text. */
export function aglynRecording(name: string): string {
  const held = cache.get(name)
  if (held !== undefined) return held
  const text = readFileSync(join(DIR, name), 'utf8')
  cache.set(name, text)
  return text
}

/** The pages recorded whole, by path. */
export const AGLYN_RECORDED_PAGES: Readonly<Record<string, string>> = {
  '/': 'home.html',
  '/about': 'about.html',
  '/pricing': 'pricing.html',
  '/contact': 'contact.html',
  '/product': 'product.html',
  '/product/ai': 'product__ai.html',
  '/legal/privacy': 'legal__privacy.html',
}

/** A recorded page's markup. */
export function aglynPage(path: string): string {
  const name = AGLYN_RECORDED_PAGES[path]
  if (!name) throw new Error(`No recording of ${path}`)
  return aglynRecording(name)
}

/** What the live pages measured on 10/28, in bytes, before trimming. */
export const AGLYN_PAGE_BYTES: Readonly<Record<string, number>> = {
  '/': 506_077,
  '/about': 312_293,
  '/pricing': 925_686,
  '/contact': 312_917,
  '/product': 516_783,
  '/product/ai': 475_326,
  '/legal/privacy': 367_243,
}

/** The average of a sample of ten live pages, for every page not recorded. */
export const AGLYN_AVERAGE_PAGE_BYTES = 440 * 1024

/** The sitemap index's children, by the address the index names them at. */
export const AGLYN_SITEMAP_CHILDREN: Readonly<Record<string, string>> = {
  [`${AGLYN_ORIGIN}/sitemaps/pages/1.xml`]: 'sitemaps/pages.xml',
  [`${AGLYN_ORIGIN}/sitemaps/content-blog/1.xml`]: 'sitemaps/content-blog.xml',
  [`${AGLYN_ORIGIN}/sitemaps/content-changelog/1.xml`]: 'sitemaps/content-changelog.xml',
  [`${AGLYN_ORIGIN}/sitemaps/content-videos/1.xml`]: 'sitemaps/content-videos.xml',
  [`${AGLYN_ORIGIN}/sitemaps/content-newsroom/1.xml`]: 'sitemaps/content-newsroom.xml',
  [`${AGLYN_ORIGIN}/sitemaps/authors/1.xml`]: 'sitemaps/authors.xml',
}

/** Every page address the six children list, in the index's order. */
export function aglynSitemapUrls(): string[] {
  const urls: string[] = []
  for (const file of Object.values(AGLYN_SITEMAP_CHILDREN)) {
    for (const match of aglynRecording(file).matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(match[1].trim())
  }
  return urls
}

/**
 * A page of aglyn.com that was not recorded, padded to `bytes`: a title, a
 * heading and a paragraph that say which page it is, so the inventory has
 * words to list, then a comment the extractor throws away.
 */
export function aglynSyntheticPage(path: string, bytes = AGLYN_AVERAGE_PAGE_BYTES): string {
  const name = path.split('/').filter(Boolean).pop() ?? 'home'
  const head = `<!DOCTYPE html><html lang="en"><head><title>${name} | ${AGLYN_DOMAIN}</title><meta name="description" content="The ${name} page."></head><body><main><h1>${name}</h1><p>This is the ${name} page of ${AGLYN_DOMAIN}, recorded as a stand-in.</p></main>`
  const tail = '</body></html>'
  const pad = Math.max(0, bytes - head.length - tail.length - 7)
  return `${head}<!--${'x'.repeat(pad)}-->${tail}`
}

export interface AglynAnswer {
  status: number
  headers: Record<string, string>
  body: string
}

const HTML = { 'content-type': 'text/html; charset=utf-8' }

/** What Vercel's managed bot protection answers a client it challenges. */
export const AGLYN_CHALLENGE: AglynAnswer = {
  status: 429,
  headers: { ...HTML, server: 'Vercel', 'x-vercel-mitigated': 'challenge' },
  body: '<!DOCTYPE html><html><head><title>Vercel Security Checkpoint</title></head><body><p>We are verifying your browser.</p></body></html>',
}

export interface AglynSiteOptions {
  /**
   * The edge as it stood on 10/20: bot protection challenges every page but
   * the store-review bypass paths (/contact, /legal/*) and the crawler
   * metadata (robots.txt, sitemaps).
   */
  challenged?: boolean
  /** The byte size every page answers with; the measured sizes when absent. */
  pageBytes?: number
}

/** What aglyn.com answers an address, as recorded. */
export function aglynAnswer(url: string, options: AglynSiteOptions = {}): AglynAnswer {
  const parsed = new URL(url)
  if (parsed.origin !== AGLYN_ORIGIN) {
    // The bare name is the one the site answers on; www sends visitors there.
    if (parsed.origin === `https://www.${AGLYN_DOMAIN}`) {
      return { status: 308, headers: { location: `${AGLYN_ORIGIN}${parsed.pathname}${parsed.search}` }, body: '' }
    }
    return { status: 404, headers: HTML, body: 'Not found' }
  }
  const path = parsed.pathname
  if (path === '/robots.txt') return { status: 200, headers: { 'content-type': 'text/plain' }, body: aglynRecording('robots.txt') }
  if (path === '/sitemap.xml') return { status: 200, headers: { 'content-type': 'application/xml' }, body: aglynRecording('sitemap.xml') }
  const child = AGLYN_SITEMAP_CHILDREN[`${AGLYN_ORIGIN}${path}`]
  if (child) return { status: 200, headers: { 'content-type': 'application/xml' }, body: aglynRecording(child) }
  const bypassed = path === '/contact' || path.startsWith('/legal/')
  if (options.challenged && !bypassed) return AGLYN_CHALLENGE
  if (!aglynSitemapUrls().includes(`${AGLYN_ORIGIN}${path}`)) return { status: 404, headers: HTML, body: 'Not found' }
  const recorded = AGLYN_RECORDED_PAGES[path]
  if (recorded && options.pageBytes === undefined) return { status: 200, headers: HTML, body: aglynRecording(recorded) }
  return { status: 200, headers: HTML, body: aglynSyntheticPage(path, options.pageBytes ?? AGLYN_PAGE_BYTES[path] ?? AGLYN_AVERAGE_PAGE_BYTES) }
}
