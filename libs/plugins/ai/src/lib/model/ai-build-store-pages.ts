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

import type { AiBuildItem, AiBuildPlanScreen } from './ai-build-plan'
import type { AiStoreLayoutLinks } from './ai-layout-store-links'
import {
  AI_STORE_PAGES,
  aiStoreFrameLinks,
  aiStorePagesOfPlan,
  aiStorePagesToWrite,
  type AiStoreFinishStep,
  type AiStorePageFacts,
  type AiStorePageKey,
  type AiStorePagePlan,
} from './ai-site-store-pages'

/**
 * A STORE'S OWN PAGES, ADDED BY AN ASSIST BUILD (AGL-3676).
 *
 * A site start that builds a store adds its account, cart and policy pages
 * (`ai-site-store-pages.ts`). An Assist build has no site kind, so a member
 * who asked Assist to "add a shop" got products and a Shop page and nowhere
 * for a shopper to sign in, see a cart or read the store's policies.
 *
 * So a build whose plan turns the site into a store — it makes products, a
 * product page template, or plans a Shop page — gets the same store pages,
 * written by the same code-built unit, behind the same gate (a plan with
 * commerce, Commerce on for the site, an editor). Only the pages the site
 * does not already have: a page of the site's own, or of the plan, that
 * holds one's address or says it is one ("Privacy Policy" at
 * /privacy-policy) stands for it, and nothing is written for that one.
 *
 * The plan keeps what it adds (`AiBuildPlan.storePages`), worked out by code
 * when the plan is kept, never asked of the model; the plan card shows those
 * pages as added by the platform, at no credits, and the build writes them in
 * one unit of its own after every planned unit. The build checks the site
 * again before writing, so a page made since the plan is not made twice.
 *
 * Pure: safe for the console to import.
 */

/** The ledger slot, and the op, of a build's store pages unit. Persisted; never renamed. */
export const AI_BUILD_STORE_SLOT = 'store'
export const AI_BUILD_STORE_OP = 'store'

/** The commerce plugin's product operation (`PRODUCT_AI_OP`), which a build that makes products plans. */
export const AI_BUILD_PRODUCT_OP = 'product'

/** What the build's row for its store pages reads. */
export const AI_BUILD_STORE_PAGES_LABEL = 'Account, cart and policy pages'

/** What a build's store pages row says where the site already had every one by the time it ran. */
export const AI_BUILD_STORE_PAGES_PRESENT_NOTE = 'Your site already has its account, cart and policy pages.'

/** What a build adds for a store: its store pages, each written or stood for by a page, and what their words link. */
export interface AiBuildStorePages {
  pages: AiStorePagePlan[]
  facts: AiStorePageFacts
}

/** A page a build reads to decide what a store lacks: a planned page, or one the site has. */
export interface AiStoreSitePage {
  /** The site's page id, where it is one of the site's own. */
  id?: string
  slug: string
  title: string
  /** A record template or entry template, which is no page at its own address. */
  template?: boolean
  /** The layout the page renders inside, where it is one of the site's own. */
  layoutId?: string | null
}

const firstSegment = (slug: string) => slug.trim().replace(/^\/+/, '').split('/')[0].toLowerCase()
const wordsOf = (page: { slug: string; title: string }) => `${page.slug.replace(/[-/_]+/g, ' ')} ${page.title}`

/** A planned page whose address or name says it is the store's own: Shop, Store, Products. */
const STORE_PAGE = /\b(shop|store|products?)\b/i

/**
 * What a page's words say it is, by store page (beyond its address): a site's
 * "Privacy Policy" at /privacy-policy is its privacy policy, its "Terms &
 * conditions" its terms, its "My account" its account, its "Basket" its cart.
 */
const PURPOSE: Readonly<Record<AiStorePageKey, RegExp>> = {
  account: /\b(my account|your account|account|sign in|log in|login)\b/i,
  cart: /\b(cart|basket|shopping bag)\b/i,
  shipping: /\b(shipping|delivery|returns?|refunds?)\b/i,
  privacy: /\bprivacy\b/i,
  terms: /\b(terms|conditions)\b/i,
}

/**
 * Whether a build's plan turns its site into a store: it makes products, a
 * page template for products, or plans the store's own page (Shop, Store,
 * Products). A page that only names collections or a range is not enough:
 * a gallery has those too.
 */
export function aiBuildMakesStore(plan: {
  screens: ReadonlyArray<Pick<AiBuildPlanScreen, 'slug' | 'title' | 'record'>>
  items?: ReadonlyArray<Pick<AiBuildItem, 'op' | 'args'>>
}): boolean {
  const items = plan.items ?? []
  if (items.some((item) => item.op === AI_BUILD_PRODUCT_OP)) return true
  if (items.some((item) => item.op === 'template' && item.args?.['subject'] === 'product')) return true
  return plan.screens.some((screen) => !screen.record && firstSegment(screen.slug) !== '' && STORE_PAGE.test(wordsOf(screen)))
}

/**
 * The store pages for these pages — the plan's and the site's own together:
 * `aiStorePagesOfPlan`'s answer, and then any store page still to write that
 * a page's words say it already is.
 */
export function aiStorePagesForSite(pages: readonly AiStoreSitePage[]): AiStorePagePlan[] {
  const real = pages.filter((page) => !page.template && firstSegment(page.slug) !== '')
  return aiStorePagesOfPlan(real).map((page) => {
    if (page.planned) return page
    const holds = real.find((one) => PURPOSE[page.key].test(wordsOf(one)))
    if (!holds) return page
    const slug = firstSegment(holds.slug)
    return { ...page, slug, href: `/${slug}`, link: holds.title.trim() || page.link, planned: holds.title }
  })
}

const CONTACT = /\b(contact|get in touch|visit us)\b/i

/** What a store page's words link, read off the pages a site has or plans: its contact page, its shop and its shipping page. */
export function aiStorePageFactsOf(pages: readonly AiStoreSitePage[], storePages: readonly AiStorePagePlan[]): AiStorePageFacts {
  const real = pages.filter((page) => !page.template && firstSegment(page.slug) !== '')
  const path = (page: AiStoreSitePage | undefined) => (page ? `/${firstSegment(page.slug)}` : null)
  return {
    contactPath: path(real.find((page) => CONTACT.test(wordsOf(page)))),
    shopPath: path(real.find((page) => STORE_PAGE.test(wordsOf(page)))) ?? '/shop',
    shippingPath: storePages.find((page) => page.key === 'shipping')?.href ?? '/shipping-returns',
  }
}

/**
 * What a build adds for a store (AGL-3676), or `null` where it adds nothing:
 * the plan does not make a store, the site cannot have one (`store` false:
 * no commerce on the plan, or Commerce off for the site), or every store page
 * is already there. The site's own pages come after the plan's, so a page the
 * plan builds at an address is the one linked.
 */
export function aiBuildStorePagesFor(
  plan: Parameters<typeof aiBuildMakesStore>[0],
  site: { pages: readonly AiStoreSitePage[]; store: boolean },
): AiBuildStorePages | null {
  if (!site.store || !aiBuildMakesStore(plan)) return null
  const all: AiStoreSitePage[] = [
    ...plan.screens.map((screen) => ({ slug: screen.slug, title: screen.title, template: Boolean(screen.record) })),
    ...site.pages,
  ]
  const pages = aiStorePagesForSite(all)
  if (!aiStorePagesToWrite(pages).length) return null
  return { pages, facts: aiStorePageFactsOf(all, pages) }
}

/**
 * The store pages a build still writes once it runs: those its plan kept,
 * less any the site has gained since — by address or by what the page says
 * it is. `[]` when the site now has them all.
 */
export function aiBuildStorePagesStillMissing(
  kept: readonly AiStorePagePlan[],
  sitePages: readonly AiStoreSitePage[],
): AiStorePagePlan[] {
  const now = aiStorePagesForSite(sitePages)
  return kept.map((page) => {
    if (page.planned) return page
    const held = now.find((one) => one.key === page.key && one.planned)
    return held ?? page
  })
}

/** Whether a value read off a kept plan is a build's store pages; a plan kept before them carries none. */
export function aiBuildStorePagesOf(plan: { storePages?: unknown } | null | undefined): AiBuildStorePages | null {
  const raw = plan?.storePages as Partial<AiBuildStorePages> | undefined
  if (!raw || !Array.isArray(raw.pages) || !raw.facts) return null
  const keys = new Set(AI_STORE_PAGES.map((page) => page.key))
  const pages = raw.pages.filter((page): page is AiStorePagePlan => Boolean(page) && keys.has(page.key) && typeof page.href === 'string')
  return pages.length ? { pages, facts: raw.facts as AiStorePageFacts } : null
}

/** The store pages a build's plan card lists as added for the store: the ones written, not the ones a page stands for. */
export function aiBuildStorePagesAdded(plan: { storePages?: unknown } | null | undefined): AiStorePagePlan[] {
  return aiStorePagesToWrite(aiBuildStorePagesOf(plan)?.pages ?? [])
}

// ── The store's links in the site's own layout ────────────────────────────

/**
 * What a store's links in a layout record on the build's outputs (AGL-3676),
 * as `proposal.storeLinks`: `draft` on the layout version written with them,
 * `missing` where the layout had no header or footer list to add them to.
 */
export type AiBuildStoreLinksState = 'draft' | 'missing'

/** What a header's link to the store's account and cart say (`AI_LAYOUT_ACCOUNT_LINK`). */
export const AI_BUILD_STORE_ACCOUNT_LINK = 'Account'
export const AI_BUILD_STORE_CART_LINK = 'Cart'

/**
 * The links a build adds to the site's own layout for these store pages:
 * Account in the header, the cart there too where the header has none, and
 * the account and the policies in the footer — only for the pages that are
 * there, written by the build or stood for by a page the site has.
 */
export function aiBuildStoreLayoutLinks(pages: readonly AiStorePagePlan[], written: ReadonlySet<string>): AiStoreLayoutLinks {
  const there = pages.filter((page) => page.planned || written.has(page.key))
  const account = there.find((page) => page.key === 'account')
  const cart = there.find((page) => page.key === 'cart')
  return {
    header: account ? [{ label: AI_BUILD_STORE_ACCOUNT_LINK, href: account.href }] : [],
    cart: cart ? { label: AI_BUILD_STORE_CART_LINK, href: cart.href } : null,
    footer: aiStoreFrameLinks(there).footer,
  }
}

/** The layout a build's store pages render inside, and its links go in: the Shop page's, else the home page's, else the one most of the site's pages use. */
export function aiBuildStoreLayoutOf(shopLayoutId: string | null, sitePages: readonly AiStoreSitePage[]): string | null {
  if (shopLayoutId) return shopLayoutId
  const pages = sitePages.filter((page) => !page.template && page.layoutId)
  const home = pages.find((page) => firstSegment(page.slug) === '')
  if (home?.layoutId) return home.layoutId
  const counts = new Map<string, number>()
  for (const page of pages) counts.set(page.layoutId as string, (counts.get(page.layoutId as string) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** The finish card's step where the site's layout had no list for the store's links: add them by hand. */
export const AI_BUILD_STORE_LINKS_MISSING_STEP: AiStoreFinishStep = {
  id: 'links',
  title: 'Add Account and policy links to your header and footer',
  text: 'Your header and footer have no list of links to add them to. Add links to your account, cart and policy pages.',
  opens: 'layouts',
  action: 'Open layouts',
}

/** The finish card's step where the store's links wait in a draft version of the site's layout: publish it. */
export const AI_BUILD_STORE_LINKS_DRAFT_STEP: AiStoreFinishStep = {
  id: 'links',
  title: 'Publish your header and footer links',
  text: 'Account and policy links are in a new draft version of your layout. Open it and publish that version so shoppers see them.',
  opens: 'layout',
  action: 'Open the layout',
}
