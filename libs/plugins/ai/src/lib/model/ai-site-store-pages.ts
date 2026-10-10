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
 * A STORE'S OWN PAGES (AGL-3676, third round).
 *
 * Zach, 2026-10-10: "We seem to be missing the account pages for the
 * shop/store AI generation, make sure all they would have to do is setup the
 * payment info and update products to finish up their storefront." The
 * Ember & Oak Candle Co start had Home, Shop, Gift sets, About, Shipping &
 * care and Contact, and a product page per product; a shopper had nowhere to
 * sign in, see an order, find what they saved, or read the store's privacy
 * policy and terms.
 *
 * So a paid store start gets the pages every storefront has, written by code
 * from the platform's own elements — never asked of the model:
 *
 *  - ACCOUNT at /account: the commerce plugin's Customer account (sign in,
 *    create an account, profile, addresses, order history with status and
 *    tracking, sign out) and Saved items (the Wishlist the product page's
 *    Save fills, kept for a guest in the browser and on the account once
 *    they sign in);
 *  - CART at /cart: the Cart in full, with its checkout, for a shopper who
 *    goes to the address rather than the header's cart drawer;
 *  - SHIPPING & RETURNS at /shipping-returns, PRIVACY POLICY at /privacy and
 *    TERMS OF SALE at /terms: editable drafts in the Markdown element, every
 *    fact only the merchant knows left as a [bracketed placeholder] — never a
 *    return window, a price or a promise the brief did not give.
 *
 * The account and the cart are a shopper's own pages, written UNLISTED
 * (noindex, out of the sitemap); the policies are indexable like every other
 * page.
 *
 * An order's own page is the commerce plugin's built-in /order-status, which
 * every order email links with its signed key; the Account page says so.
 *
 * ── Outside the plan's page count ───────────────────────────────────────
 *
 * They are STORE PAGES, not planned pages: the plan's four to eight pages are
 * the content the model designs, and these are added beside them, so they
 * never crowd one out. They still count toward the plan's pages allowance
 * (`screensPerHost`), as every page a site has does; a store is Starter and
 * up, whose allowance holds both.
 *
 * A page the plan already has stands for its store page instead of a second
 * one: a planned "Shipping & care" is the store's shipping page, and a page
 * the plan put at /privacy is its privacy policy. The header and footer link
 * that page.
 *
 * Pure: names, paths, words and node trees. Safe for the console to import.
 */

/** A store page, by what it is. Persisted in job outputs (`proposal.storePage`); never renamed. */
export type AiStorePageKey = 'account' | 'cart' | 'shipping' | 'privacy' | 'terms'

export interface AiStorePageDefinition {
  key: AiStorePageKey
  /** The page's name in Pages, and its heading. */
  title: string
  slug: string
  /** What the footer's link to it says. */
  link: string
  seo: { title: string; description: string }
  /**
   * A shopper's own page, not one to find by search: written UNLISTED, the
   * page's Access setting the console offers, so the tenant serves it
   * `noindex` and leaves it out of the sitemap. Only the account and the
   * cart; the policies, like every content and landing page, stay indexable.
   */
  noindex?: true
}

/** Every store page, in the order the job writes them and the footer links them. */
export const AI_STORE_PAGES: readonly AiStorePageDefinition[] = [
  {
    key: 'account',
    title: 'Your account',
    slug: 'account',
    link: 'Your account',
    noindex: true,
    seo: { title: 'Your account', description: 'Sign in to see your orders, saved addresses and saved items.' },
  },
  {
    key: 'cart',
    title: 'Your cart',
    slug: 'cart',
    link: 'Cart',
    noindex: true,
    seo: { title: 'Your cart', description: 'Review your cart and check out.' },
  },
  {
    key: 'shipping',
    title: 'Shipping & returns',
    slug: 'shipping-returns',
    link: 'Shipping & returns',
    seo: { title: 'Shipping & returns', description: 'How we ship your order, and how returns and refunds work.' },
  },
  {
    key: 'privacy',
    title: 'Privacy policy',
    slug: 'privacy',
    link: 'Privacy policy',
    seo: { title: 'Privacy policy', description: 'What we collect when you shop with us, and what we do with it.' },
  },
  {
    key: 'terms',
    title: 'Terms of sale',
    slug: 'terms',
    link: 'Terms of sale',
    seo: { title: 'Terms of sale', description: 'The terms that apply when you buy from our store.' },
  },
]

/** What the job's row for the store pages reads. */
export const AI_SITE_STORE_PAGES_LABEL = 'Adding your account, cart and policy pages'

/** The note the row carries once they are written: what the merchant fills in. */
export const AI_SITE_STORE_PAGES_NOTE =
  'Your shipping, privacy and terms pages are drafts: fill in the parts in [brackets] with your store’s own details.'

/** A planned page whose words say it is the store's shipping page: "Shipping & care", "Delivery & returns". */
const SHIPPING_WORDS = /\b(shipping|delivery|returns?|refunds?)\b/i

/** The words of a planned page's address and title, spaced. */
const wordsOf = (screen: { slug: string; title: string }) => `${screen.slug.replace(/[-/_]+/g, ' ')} ${screen.title}`

const firstSegment = (slug: string) => slug.trim().replace(/^\/+/, '').split('/')[0].toLowerCase()

/** A store page as a start builds or links it. */
export interface AiStorePagePlan {
  key: AiStorePageKey
  title: string
  slug: string
  /** Where the header and footer link it. */
  href: string
  /** What the footer's link says. */
  link: string
  /**
   * The planned page that stands for it, by its title, where the plan has
   * one: nothing is written for this key, and its links go to that page.
   */
  planned?: string
}

/**
 * The store pages a store plan gets: each one written, or — where a planned
 * page already holds its address, or a planned page's words say it is the
 * store's shipping page — that planned page, linked in its place.
 */
export function aiStorePagesOfPlan(screens: ReadonlyArray<{ slug: string; title: string; record?: unknown }>): AiStorePagePlan[] {
  const pages = screens.filter((screen) => !screen.record && firstSegment(screen.slug) !== '')
  return AI_STORE_PAGES.map((page) => {
    const holds =
      pages.find((screen) => firstSegment(screen.slug) === page.slug) ??
      (page.key === 'shipping' ? pages.find((screen) => SHIPPING_WORDS.test(wordsOf(screen))) : undefined)
    if (holds) {
      const slug = firstSegment(holds.slug)
      return { key: page.key, title: page.title, slug, href: `/${slug}`, link: holds.title.trim() || page.link, planned: holds.title }
    }
    return { key: page.key, title: page.title, slug: page.slug, href: `/${page.slug}`, link: page.link }
  })
}

/** The store pages a start writes itself: those no planned page stands for. */
export function aiStorePagesToWrite(pages: readonly AiStorePagePlan[]): AiStorePagePlan[] {
  return pages.filter((page) => !page.planned)
}

/** The unit input a site layout is told the store's links under. */
export const AI_SITE_STORE_LINKS_INPUT = 'storeLinks'

/** What a store's header and footer link (AGL-3676): the account beside the cart, and the store's pages under the site's. */
export interface AiStoreFrameLinks {
  /** The account page's path, which the header links beside the cart. */
  account: string | null
  /** The footer's store links, in order: the account, then the policies. */
  footer: Array<{ label: string; href: string }>
}

/** The header's and footer's store links for these store pages. The cart is the header's own button. */
export function aiStoreFrameLinks(pages: readonly AiStorePagePlan[]): AiStoreFrameLinks {
  const account = pages.find((page) => page.key === 'account')
  return {
    account: account?.href ?? null,
    footer: pages.filter((page) => page.key !== 'cart').map((page) => ({ label: page.link, href: page.href })),
  }
}

const PATH = /^\/[a-z0-9-]+$/

/** The store links a layout unit's inputs carry; none for any other layout. */
export function aiStoreFrameLinksOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiStoreFrameLinks | null {
  const raw = inputs?.[AI_SITE_STORE_LINKS_INPUT]
  if (!raw || typeof raw !== 'object') return null
  const { account, footer } = raw as Record<string, unknown>
  const links = Array.isArray(footer)
    ? footer.flatMap((entry) => {
        const { label, href } = (entry ?? {}) as Record<string, unknown>
        return typeof label === 'string' && label.trim() && typeof href === 'string' && PATH.test(href)
          ? [{ label: label.trim().slice(0, 40), href }]
          : []
      })
    : []
  const accountPath = typeof account === 'string' && PATH.test(account) ? account : null
  return accountPath || links.length ? { account: accountPath, footer: links.slice(0, 6) } : null
}

// ── The pages, as node trees ──────────────────────────────────────────────

/** The canvas root every stored page hangs from (`CANVAS_ROOT_ELEMENT_ID`). */
const ROOT = '_@_'

/** The longest one Markdown element is given: the element's own text limit. */
export const AI_STORE_MARKDOWN_MAX = 2000

/** The commerce plugin's elements a store page places, by the ids it persists (`ai-site-store-pages.spec.ts` holds them). */
export const AI_STORE_ELEMENTS = {
  account: 'customer-account',
  wishlist: 'wishlist',
  cart: 'cart',
} as const

/** The host token that reads the site's own name at render (`AI_SITE_NAME_TOKEN`). */
const NAME = '{{host.businessName}}'

/** What a store page's words may link: the site's contact page and its shop, where the plan has them. */
export interface AiStorePageFacts {
  /** The contact page's path, or `null` where the plan has none. */
  contactPath: string | null
  /** The shop's path, `/shop` where the plan has none. */
  shopPath: string
  /** The shipping page's path, as the terms link it. */
  shippingPath: string
}

interface StoredNode {
  $id: string
  type: 'node'
  componentId: string
  pluginId: string
  parentId: string | null
  nodes: string[]
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
}

/** How a sentence asks a shopper to get in touch: the contact page, else a reply to their order email. */
function contact(facts: AiStorePageFacts, words = 'contact us'): string {
  return facts.contactPath ? `[${words}](${facts.contactPath})` : `${words} by replying to your order email`
}

/** The policy's sections, as markdown, each a `##` heading and its paragraphs. */
export function aiStorePolicySections(key: 'shipping' | 'privacy' | 'terms', facts: AiStorePageFacts): string[] {
  if (key === 'shipping') {
    return [
      '## Shipping\n\nWe ship orders from [where you ship from]. Orders are packed within [number] business days, and you will get an email with tracking as soon as yours is on its way.\n\nShipping costs and delivery options are shown at checkout before you pay. [List the countries or regions you ship to, and any free-shipping offer you make.]',
      `## Returns\n\nYou can return an item within [number] days of delivery if it is [unused and in its original packaging]. [Name anything that cannot be returned, such as gift cards or personalized items.]\n\nTo start a return, open the link in your order email and choose Request a return, or ${contact(facts)}. [Say who pays for return shipping.]`,
      '## Refunds\n\nOnce we receive and check your return, we refund it to your original payment method within [number] business days. [Say whether the original shipping cost is refunded.]',
      `## Damaged or wrong items\n\nIf your order arrives damaged or is not what you ordered, ${contact(facts)} within [number] days of delivery with your order number and a photo, and we will put it right.`,
    ]
  }
  if (key === 'privacy') {
    return [
      `## Who we are\n\n${NAME} runs this online store. This policy explains what we collect when you visit, shop or create an account, and what we do with it. [Add your business’s legal name and postal address.]`,
      '## What we collect\n\n- **When you order:** your name, email address, shipping and billing address, your phone number if you give one, and what you bought.\n- **When you create an account:** your name, email address, saved addresses, order history and saved items.\n- **When you sign up for emails:** your email address and your choice to hear from us.\n- **Payments:** card payments are processed by Stripe. We never see or store your full card number.',
      '## How we use it\n\nWe use your information to process and deliver your orders, to send order and shipping emails, to answer your questions, and, only if you opt in, to send you news and offers. You can unsubscribe from marketing emails at any time with the link in each one.',
      '## Who we share it with\n\nWe share only what is needed with the services that run the store: our website and store platform, our payment processor (Stripe), and the carriers that deliver your order. [List any other services you use, such as an email or analytics tool.] We do not sell your personal information.',
      '## Cookies\n\nThis site uses cookies to keep your cart and your sign-in working. [Describe any analytics or advertising cookies you use, and how visitors choose.]',
      `## Your choices\n\nYou can ask to see, correct or delete the information we hold about you: ${contact(facts)}. [Say how long you keep order records, and the privacy rights that apply where you sell.]\n\nWe post any change to this policy on this page. Last updated: [date].`,
    ]
  }
  return [
    `## About these terms\n\nThese terms apply to purchases from ${NAME} through this website. By placing an order you agree to them. [Add your business’s legal name and where it is registered.]`,
    '## Orders\n\nYour order is an offer to buy. We accept it when we send your order confirmation email. If an item turns out to be unavailable, we will tell you and refund what you paid for it.',
    '## Prices and payment\n\nPrices are shown in [currency] and [include or exclude] [sales tax or VAT]. Shipping and any taxes are shown at checkout before you pay. Payment is taken securely through Stripe when you place your order.',
    `## Shipping, returns and refunds\n\nHow we ship, and how returns and refunds work, is set out on our [Shipping & returns](${facts.shippingPath}) page.`,
    '## Products\n\nWe describe and photograph our products as accurately as we can. [Note anything that naturally varies, such as handmade pieces, colors or sizes.]',
    `## Liability\n\n[State any limit on your liability, as the law where you sell allows.] Nothing in these terms limits your rights under consumer law.\n\n## Contact\n\nQuestions about an order? ${contact(facts, 'Contact us')}. Last updated: [date].`,
  ]
}

/** Sections joined into as few Markdown elements as fit the element's limit, in order. */
export function aiStoreMarkdownChunks(sections: readonly string[], max = AI_STORE_MARKDOWN_MAX): string[] {
  const chunks: string[] = []
  for (const section of sections) {
    const last = chunks[chunks.length - 1]
    if (last !== undefined && last.length + 2 + section.length <= max) chunks[chunks.length - 1] = `${last}\n\n${section}`
    else chunks.push(section.slice(0, max))
  }
  return chunks
}

/**
 * A store page's node tree, root first, as a page's first version stores it:
 * the page's heading over the platform's elements, in one section the
 * site's layout renders inside.
 */
export function aiStorePageNodes(key: AiStorePageKey, facts: AiStorePageFacts): Record<string, StoredNode> {
  const page = AI_STORE_PAGES.find((one) => one.key === key) as AiStorePageDefinition
  const nodes: Record<string, StoredNode> = {}
  const id = (role: string) => `store-${key}-${role}`
  const container = id('container')
  const add = (role: string, componentId: string, pluginId: string, props: Record<string, unknown>, sx?: Record<string, unknown>): string => {
    const nodeId = id(role)
    nodes[nodeId] = { $id: nodeId, type: 'node', componentId, pluginId, parentId: container, nodes: [], props, ...(sx ? { sx } : {}) }
    return nodeId
  }
  const children: string[] = [add('title', 'muiTypography', 'mui', { children: page.title, variant: 'h1', component: 'h1' }, { mb: 4 })]
  if (key === 'account') {
    children.push(
      add('account', AI_STORE_ELEMENTS.account, 'commerce', { signedOutHeading: 'Sign in or create an account' }),
      add(
        'guest',
        'muiTypography',
        'mui',
        { children: 'Checked out as a guest? The link in your order email opens your order’s status and tracking.', variant: 'body2', component: 'p' },
        { color: 'text.secondary', mt: 3 },
      ),
      add(
        'saved',
        AI_STORE_ELEMENTS.wishlist,
        'commerce',
        { heading: 'Saved items', emptyText: 'Nothing saved yet. Tap Save on any product to keep it here.' },
        { mt: 8 },
      ),
    )
  } else if (key === 'cart') {
    children.push(
      add('cart', AI_STORE_ELEMENTS.cart, 'commerce', { variant: 'inline', showCoupon: true }),
      add('shop', 'muiButton', 'mui', { children: 'Continue shopping', variant: 'outlined', href: facts.shopPath }, { mt: 4 }),
    )
  } else {
    aiStoreMarkdownChunks(aiStorePolicySections(key, facts)).forEach((content, index) => {
      children.push(add(`text${index + 1}`, 'markdown', 'mui', { content }))
    })
  }
  const section = id('section')
  nodes[ROOT] = { $id: ROOT, type: 'node', componentId: 'div', pluginId: 'mui', parentId: null, nodes: [section] }
  nodes[section] = {
    $id: section,
    type: 'node',
    componentId: 'section',
    pluginId: 'mui',
    parentId: ROOT,
    nodes: [container],
    props: { element: 'section', ariaLabel: page.title },
  }
  nodes[container] = {
    $id: container,
    type: 'node',
    componentId: 'muiContainer',
    pluginId: 'mui',
    parentId: section,
    nodes: children,
    props: { maxWidth: key === 'account' || key === 'cart' ? 'lg' : 'md' },
    sx: { py: { xs: 6, md: 10 } },
  }
  return nodes
}

// ── Finishing the store ───────────────────────────────────────────────────

/** One thing left before an AI-built store sells, as its done page lists it. */
export interface AiStoreFinishStep {
  id: 'payments' | 'products' | 'shipping' | 'policies'
  title: string
  text: string
  /** The record route kind whose list the step opens (`plugin-record-routes`), or `pages` for the site's Pages. */
  opens: 'store-settings' | 'product' | 'pages'
  action: string
}

/**
 * What is left once an AI store is built (Zach, 2026-10-10): connect
 * payments, review the products and their prices, set shipping and tax, and
 * fill in the policies' brackets. Everything else — the storefront, the
 * account, cart and policy pages, the header's cart and account — is done.
 */
export const AI_STORE_FINISH_STEPS: readonly AiStoreFinishStep[] = [
  {
    id: 'payments',
    title: 'Connect payments',
    text: 'Connect Stripe so your store can take payments and pay you out.',
    opens: 'store-settings',
    action: 'Set up payments',
  },
  {
    id: 'products',
    title: 'Review your products and prices',
    text: 'Your first products are listed with a starting price. Set your real prices, photos and stock.',
    opens: 'product',
    action: 'Open products',
  },
  {
    id: 'shipping',
    title: 'Set shipping and tax',
    text: 'Choose your shipping rates and how tax is charged at checkout.',
    opens: 'store-settings',
    action: 'Open store settings',
  },
  {
    id: 'policies',
    title: 'Fill in your policies',
    text: 'Your Shipping & returns, Privacy policy and Terms of sale pages are drafts: replace the parts in [brackets].',
    opens: 'pages',
    action: 'Open pages',
  },
]
