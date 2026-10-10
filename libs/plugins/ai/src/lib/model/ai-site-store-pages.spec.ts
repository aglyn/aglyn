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
 * A store's own pages (AGL-3676, third round). Zach, 2026-10-10: "We seem to
 * be missing the account pages for the shop/store AI generation, make sure
 * all they would have to do is setup the payment info and update products to
 * finish up their storefront." The prod Ember & Oak Candle Co start had Home,
 * Shop, Gift sets, About, Shipping & care and Contact, and nowhere to sign
 * in, see an order, find a saved item or read a policy.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiLayoutFrameCheck } from '../jobs/ai-job-layout-language'
import { aiLayoutWithNavigation } from '../jobs/ai-site-publish'
import { AI_LAYOUT_ACCOUNT_LINK } from '../layout-language/ai-layout-frame'
import type { AiLayoutListing } from '../layout-language/ai-layout-listings'
import type { AiLayoutTargets } from '../layout-language/ai-layout-links'
import {
  AI_SITE_STORE_LINKS_INPUT,
  AI_STORE_ELEMENTS,
  AI_STORE_FINISH_STEPS,
  AI_STORE_MARKDOWN_MAX,
  AI_STORE_PAGES,
  aiStoreFrameLinks,
  aiStoreFrameLinksOf,
  aiStoreMarkdownChunks,
  aiStorePageNodes,
  aiStorePagesOfPlan,
  aiStorePagesToWrite,
  aiStorePolicySections,
  type AiStorePageFacts,
} from './ai-site-store-pages'

/** The Ember & Oak Candle Co start's pages, as its plan named them. */
const EMBER_AND_OAK = [
  { title: 'Home', slug: '/' },
  { title: 'Shop', slug: '/shop' },
  { title: 'Gift sets', slug: '/gift-sets' },
  { title: 'About', slug: '/about' },
  { title: 'Shipping & care', slug: '/shipping-care' },
  { title: 'Contact', slug: '/contact' },
]

const FACTS: AiStorePageFacts = { contactPath: '/contact', shopPath: '/shop', shippingPath: '/shipping-returns' }

type Node = { componentId: string; pluginId?: string; props?: Record<string, unknown>; nodes?: string[]; parentId?: string | null }
const nodesOf = (value: unknown) => Object.values((value ?? {}) as Record<string, Node>)

describe('the pages a store gets beside its plan', () => {
  it('writes an account, a cart, and its policies, and takes a planned "Shipping & care" as its shipping page', () => {
    const pages = aiStorePagesOfPlan(EMBER_AND_OAK)
    expect(pages.map((page) => [page.key, page.href, page.planned ?? null])).toEqual([
      ['account', '/account', null],
      ['cart', '/cart', null],
      ['shipping', '/shipping-care', 'Shipping & care'],
      ['privacy', '/privacy', null],
      ['terms', '/terms', null],
    ])
    expect(aiStorePagesToWrite(pages).map((page) => page.slug)).toEqual(['account', 'cart', 'privacy', 'terms'])
    // A plan with none of them gets all five, at their own addresses.
    expect(aiStorePagesToWrite(aiStorePagesOfPlan(EMBER_AND_OAK.filter((page) => !/shipping/.test(page.slug)))).map((page) => page.slug)).toEqual([
      'account',
      'cart',
      'shipping-returns',
      'privacy',
      'terms',
    ])
  })

  it('leaves a store page’s address to a planned page that holds it, and the home and a record template never stand in', () => {
    const pages = aiStorePagesOfPlan([
      { title: 'Our privacy promise', slug: '/privacy' },
      { title: 'Returns? Home', slug: '/' },
      { title: 'Product returns', slug: '/item', record: { dataset: 'x' } },
    ])
    expect(pages.find((page) => page.key === 'privacy')).toMatchObject({ href: '/privacy', planned: 'Our privacy promise', link: 'Our privacy promise' })
    expect(pages.find((page) => page.key === 'shipping')?.planned).toBeUndefined()
  })

  it('marks only the account and the cart as a shopper’s own, unlisted pages; the policies stay indexable', () => {
    expect(AI_STORE_PAGES.filter((page) => page.noindex).map((page) => page.key)).toEqual(['account', 'cart'])
  })

  it('links the account beside the cart, and the account and the policies in the footer; the cart is the header’s own button', () => {
    const links = aiStoreFrameLinks(aiStorePagesOfPlan(EMBER_AND_OAK))
    expect(links).toEqual({
      account: '/account',
      footer: [
        { label: 'Your account', href: '/account' },
        { label: 'Shipping & care', href: '/shipping-care' },
        { label: 'Privacy policy', href: '/privacy' },
        { label: 'Terms of sale', href: '/terms' },
      ],
    })
    // As a layout unit's inputs carry them, and nothing else.
    expect(aiStoreFrameLinksOf({ [AI_SITE_STORE_LINKS_INPUT]: links })).toEqual(links)
    expect(aiStoreFrameLinksOf({ [AI_SITE_STORE_LINKS_INPUT]: { account: 'https://elsewhere.test', footer: [{ label: 'x', href: '//evil' }] } })).toBeNull()
    expect(aiStoreFrameLinksOf({})).toBeNull()
  })
})

describe('the pages, built by code from the platform’s elements', () => {
  const commerce = (file: string) => readFileSync(join(__dirname, '../../../../commerce/src/lib/components', file), 'utf8')

  it('names the commerce plugin’s Customer account, Wishlist and Cart by the ids and props it persists', () => {
    expect(commerce('account.tsx')).toContain(`export const ID: Aglyn.ComponentId = '${AI_STORE_ELEMENTS.account}'`)
    expect(commerce('account.tsx')).toMatch(/\bsignedOutHeading\?:/)
    expect(commerce('wishlist.tsx')).toContain(`export const ID: Aglyn.ComponentId = '${AI_STORE_ELEMENTS.wishlist}'`)
    expect(commerce('wishlist.tsx')).toMatch(/\bheading\?:[\s\S]*\bemptyText\?:/)
    expect(commerce('cart.tsx')).toContain(`export const ID: Aglyn.ComponentId = '${AI_STORE_ELEMENTS.cart}'`)
    expect(commerce('cart.tsx')).toMatch(/variant\?: 'button' \| 'inline'/)
  })

  it('puts sign-in, the profile, the orders and the saved items on the account page', () => {
    const nodes = nodesOf(aiStorePageNodes('account', FACTS))
    expect(nodes.find((node) => node.componentId === 'customer-account')).toMatchObject({ pluginId: 'commerce' })
    expect(nodes.find((node) => node.componentId === 'wishlist')?.props).toMatchObject({ heading: 'Saved items' })
    expect(nodes.find((node) => node.props?.['variant'] === 'h1')?.props?.['children']).toBe('Your account')
  })

  it('puts the whole cart, its checkout and the way back to the shop on the cart page', () => {
    const nodes = nodesOf(aiStorePageNodes('cart', FACTS))
    expect(nodes.find((node) => node.componentId === 'cart')?.props).toEqual({ variant: 'inline', showCoupon: true })
    expect(nodes.find((node) => node.componentId === 'muiButton')?.props).toMatchObject({ href: '/shop' })
  })

  it('stores each page as a page’s first version: one root, every child under its parent', () => {
    for (const page of AI_STORE_PAGES) {
      const tree = aiStorePageNodes(page.key, FACTS)
      expect(tree['_@_']).toMatchObject({ componentId: 'div', parentId: null })
      for (const [id, node] of Object.entries(tree)) {
        for (const child of node.nodes) expect(tree[child]?.parentId).toBe(id)
      }
    }
  })

  it('writes each policy as editable drafts in the Markdown element, every fact only the merchant knows in brackets', () => {
    for (const key of ['shipping', 'privacy', 'terms'] as const) {
      const blocks = nodesOf(aiStorePageNodes(key, FACTS)).filter((node) => node.componentId === 'markdown')
      expect(blocks.length).toBeGreaterThan(0)
      const text = blocks.map((node) => String(node.props?.['content'])).join('\n\n')
      for (const node of blocks) expect(String(node.props?.['content']).length).toBeLessThanOrEqual(AI_STORE_MARKDOWN_MAX)
      // Never an invented number: a window, a price, a threshold, a date.
      expect(text.replace(/\[[^\]]*\]/g, '')).not.toMatch(/\d|\$|€|£/)
      expect(text).toMatch(/\[[^\]]+\]/)
    }
    expect(aiStorePolicySections('privacy', FACTS).join('\n')).toContain('{{host.businessName}}')
    expect(aiStorePolicySections('terms', { ...FACTS, shippingPath: '/shipping-care' }).join('\n')).toContain('(/shipping-care)')
  })

  it('asks a shopper to reply to their order email where the plan has no contact page', () => {
    expect(aiStorePolicySections('shipping', FACTS).join('\n')).toContain('[contact us](/contact)')
    const none = aiStorePolicySections('shipping', { ...FACTS, contactPath: null }).join('\n')
    expect(none).not.toContain('(/contact)')
    expect(none).toContain('contact us by replying to your order email')
  })

  it('joins sections into as few Markdown elements as fit', () => {
    expect(aiStoreMarkdownChunks(['a', 'b', 'c'], 4)).toEqual(['a\n\nb', 'c'])
  })
})

describe('a store’s header and footer link them (AGL-3676)', () => {
  const PRODUCTS: AiLayoutListing = { id: 'listing:products', kind: 'products', name: 'the shop', records: ['Fig candle'], placements: [] }
  const targets: AiLayoutTargets = {
    pageId: null,
    pages: [],
    homeIds: [],
    forms: [],
    formPageId: null,
    components: [],
    facts: 'Ember & Oak Candle Co: hand-poured candles.',
    listings: [PRODUCTS],
  }
  const block = (kind: string, text: string) => ({ kind, col: -1, text, to: '', icon: '', style: 'none', items: [] })
  const frame = (storeLinks: ReturnType<typeof aiStoreFrameLinks> | null) =>
    aiLayoutFrameCheck({
      siteName: 'Ember & Oak Candle Co',
      homeId: 'home',
      pages: [
        { id: 'home', label: 'Home', slug: '/' },
        { id: 'shop', label: 'Shop', slug: '/shop' },
      ],
      targets,
      extend: () => [],
      storeLinks,
    })({
      header: { band: 'plain', align: 'start', cols: [], blocks: [] },
      footer: { band: 'soft', align: 'start', cols: [], blocks: [block('text', 'Hand-poured candles.')] },
    })
  const links = aiStoreFrameLinks(aiStorePagesOfPlan(EMBER_AND_OAK))

  it('puts the account beside the cart and in the phone’s menu, and the account and policies in the footer', () => {
    const result = frame(links)
    expect(result.violations).toEqual([])
    const nodes = (result.value?.nodes ?? {}) as unknown as Record<string, Node>
    const accounts = Object.values(nodes).filter((node) => node.componentId === 'muiScreenLink' && node.props?.['children'] === AI_LAYOUT_ACCOUNT_LINK)
    expect(accounts.map((node) => node.props?.['href'])).toEqual(['/account', '/account'])
    // In the header's row, right before the cart.
    const row = Object.values(nodes).find((node) => node.nodes?.some((id) => nodes[id]?.componentId === 'cart'))
    const at = row?.nodes?.findIndex((id) => nodes[id]?.componentId === 'cart') ?? -1
    expect(nodes[row?.nodes?.[at - 1] ?? '']?.props?.['children']).toBe(AI_LAYOUT_ACCOUNT_LINK)
    for (const link of links.footer) {
      expect(Object.values(nodes).some((node) => node.componentId === 'muiScreenLink' && node.props?.['children'] === link.label && node.props?.['href'] === link.href)).toBe(true)
    }
  })

  it('links none of them where the start adds none', () => {
    const nodes = Object.values((frame(null).value?.nodes ?? {}) as unknown as Record<string, Node>)
    expect(nodes.some((node) => node.props?.['href'] === '/account' || node.props?.['href'] === '/privacy')).toBe(false)
  })

  it('takes out, at publish, the links to the store pages the start did not write', () => {
    const nodes = frame(links).value?.nodes
    if (!nodes) throw new Error('the frame compiles')
    const next = aiLayoutWithNavigation(nodes, { entries: [], droppedHrefs: ['/account', '/privacy', '/terms'] })
    const left = Object.values((next ?? {}) as unknown as Record<string, Node>)
    expect(left.some((node) => ['/account', '/privacy', '/terms'].includes(String(node.props?.['href'])))).toBe(false)
    // The planned shipping page is the site's own, and stays linked.
    expect(left.some((node) => node.props?.['href'] === '/shipping-care')).toBe(true)
  })
})

describe('what is left to finish the store', () => {
  it('is payments, products and prices, shipping and tax, and the policies’ brackets — nothing else', () => {
    expect(AI_STORE_FINISH_STEPS.map((step) => [step.id, step.opens])).toEqual([
      ['payments', 'store-settings'],
      ['products', 'product'],
      ['shipping', 'store-settings'],
      ['policies', 'pages'],
    ])
  })
})
