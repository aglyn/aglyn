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

import type { AiStoreFrameLinks } from '../model/ai-site-store-pages'
import { AI_ICON_LIBRARY } from '../runtime/ai-icon-library'
import {
  AI_LAYOUT_MAX_IMAGES,
  bandSx,
  compileFlow,
  compileRow,
  destinationProps,
  type PageScope,
  type SectionScope,
} from './ai-layout-compiler'
import { aiLayoutContactItems, aiLayoutContactShown } from './ai-layout-contact'
import { aiLayoutFitText } from './ai-layout-copy'
import { aiLayoutRepairFrameHollows } from './ai-layout-frame-hollows'
import { AI_LAYOUT_CART_ELEMENT } from './ai-layout-listings'
import {
  AI_LAYOUT_MAX_ITEMS,
  type AiLayoutBand,
  type AiLayoutBlock,
  type AiLayoutSection,
  type AiLayoutSettlement,
} from './ai-layout-language'
import { AI_LAYOUT_LABELS_EN, aiLayoutLabel } from './ai-layout-labels'
import {
  aiLayoutRenamedLabel,
  aiLayoutResolveLink,
  type AiLayoutPage,
  type AiLayoutTargets,
} from './ai-layout-links'
import {
  AI_LAYOUT_HEADER_MEASURE,
  aiLayoutNavBreakpoint,
  aiLayoutSourceFooter,
  aiLayoutSourceHeader,
  type AiLayoutFrameSource,
} from './ai-layout-frame-source'
import { AiLayoutTreeBuilder, type AiLayoutRawTree } from './ai-layout-tree'

/**
 * A site's frame — the header and the footer every page renders between —
 * compiled from the layout language (AGL-3660), the same language a page is
 * designed in.
 *
 * The design is the model's: the header's band and alignment and its one
 * call to action, and the footer's columns and every word in them. What a
 * frame owes the site is the platform's, written here, so it is never wrong
 * and never invented: the site's name as the brand, linking home; its pages
 * as the navigation, a row on a wide screen and the platform's Drawer behind
 * its Menu Button on a phone; the Layout Slot, the page's one main landmark,
 * held tall enough that the footer sits at the bottom of a short page; and
 * the site's pages and name in the footer, where the design gave neither.
 *
 * Every label of the navigation is held to one line, the logo never narrower
 * than itself, and the row shows from the screen width it measures to fit
 * (`aiLayoutNavBreakpoint`), the Menu Button below it (AGL-4108: the 10/29
 * import's seven long titles wrapped from 900 px up and the logo lay over
 * "Home" at 1280). A site brought in from elsewhere whose menu the reader
 * found is drawn as its source builds it instead (`plan.source`,
 * `ai-layout-frame-source.ts`): its menus, its buttons, its phone menu and its
 * footer, in place of the site's pages and the design's button and footer.
 */

export interface AiLayoutFramePlan {
  /** The site's name, which the header and the footer carry as its brand. */
  siteName: string
  /** The site's home page, which the brand links; none where the site has none yet. */
  homeId: string | null
  /** The pages the navigation links, in order. */
  navPages: readonly AiLayoutPage[]
  /**
   * Whether the site's pages close on a dark photo band (AGL-3660,
   * `AiLayoutDesignChoices.coverClose`): a brand or dark footer under it
   * would read as a second loud band, so the footer takes the quiet one.
   */
  closesDark?: boolean
  /**
   * Whether the site sells (AGL-3676): its header carries the store's cart
   * button — the commerce plugin's Cart, which opens the cart in a drawer
   * from every page — beside the navigation.
   */
  cart?: boolean
  /**
   * A selling store's Shop page (AGL-3676), by its id. Its header is a
   * storefront's: the cart beside the navigation and no call-to-action button
   * repeating a link the navigation already has, and a thin announcement bar
   * above it — the line the design gave its header as a note, else one that
   * opens the shop — linking the Shop page.
   */
  shopId?: string | null
  /**
   * A store's own pages (AGL-3676), by path: the header links the account
   * beside the cart, and the footer the account and the store's policies
   * under the site's pages. They are written after the layout, so they are
   * linked by their addresses, as the blog is.
   */
  storeLinks?: AiStoreFrameLinks | null
  /** The site's language (AGL-3760): the frame's own words are in it where `ai-layout-labels.ts` lists it. */
  language?: string
  /**
   * The brand as a site brought in from elsewhere draws it (AGL-4084): its
   * logo alone, its logo with its name, or its name alone, as the source's
   * header shows it. Absent, the name alone.
   */
  brand?: AiLayoutFrameBrand | null
  /**
   * A site brought in from elsewhere whose header the reader found
   * (AGL-4108): its menu with its menus, its buttons with their own
   * addresses, its phone menu and its footer, drawn as the source has them
   * (`ai-layout-frame-source.ts`) in place of the site's pages and the
   * design's button and footer.
   */
  source?: AiLayoutFrameSource | null
}

/** A header's brand as the source shows it (AGL-4084). */
export interface AiLayoutFrameBrand {
  /** The logo, from the site's own media library. */
  logo?: { src: string } | null
  /** Whether the header prints the name as words, beside the logo or alone. */
  name: boolean
  /** The logo's words for a screen reader, as the source names it (AGL-4108); the site's name where it gave none. */
  alt?: string
  /** The logo's width over its height, which the header row is measured with (AGL-4108). */
  aspect?: number
}

/** The height a header's logo is drawn at: a Besigner field the owner may change. */
export const AI_LAYOUT_LOGO_HEIGHT = '40px'

/** What the header's link to a store's account page says (AGL-3676), in English. */
export const AI_LAYOUT_ACCOUNT_LINK = AI_LAYOUT_LABELS_EN.account

/** What a store's announcement bar says where its design gave it no line (AGL-3676): true of every store. */
export const AI_LAYOUT_STORE_ANNOUNCEMENT = AI_LAYOUT_LABELS_EN.storeAnnouncement

/** The way into the shop beside the design's own announcement (AGL-3676). */
export const AI_LAYOUT_STORE_ANNOUNCEMENT_LINK = AI_LAYOUT_LABELS_EN.shopNow

export interface AiLayoutCompiledFrame {
  tree: AiLayoutRawTree
  settled: AiLayoutSettlement[]
}

/** The header's colors by band, as palette roles. */
function headerLook(band: AiLayoutBand): {
  props: Record<string, unknown>
  sx: Record<string, unknown>
} {
  if (band === 'brand')
    return { props: { color: 'primary' }, sx: { boxShadow: 'none' } }
  if (band === 'dark') {
    return {
      props: { color: 'primary' },
      sx: {
        boxShadow: 'none',
        bgcolor: 'primary.dark',
        color: 'primary.contrastText',
      },
    }
  }
  // A rule, a shadow or nothing under a plain header is the site theme's
  // MuiAppBar style (AGL-3660); the band's color stays here.
  return {
    props: { color: 'inherit' },
    sx: { bgcolor: 'background.paper' },
  }
}

/** A line that reads as a copyright notice: "© 2026 …", "Copyright …", "All rights reserved." */
export function aiLayoutIsCopyright(text: unknown): boolean {
  return typeof text === 'string' && /^\s*(?:©|\(c\)|copyright\b)|all rights reserved/i.test(text)
}

/** What a footer leaves out: a picture slot, and the page sections a footer is no place for. */
const FOOTER_LEAVES_OUT: ReadonlySet<AiLayoutBlock['kind']> = new Set([
  'image',
  'faq',
  'quotes',
  'cards',
  'steps',
  'stats',
  'form',
  'component',
])

/** A frame scope: no headings of its own (a layout carries no outline), no pictures. */
function frameScope(
  page: PageScope,
  at: string,
  band: AiLayoutBand,
  centered: boolean,
): SectionScope {
  return {
    page,
    index: at === 'header' ? 0 : 1,
    at,
    band,
    centered,
    level: 2,
    headed: true,
    itemsLeft: AI_LAYOUT_MAX_ITEMS,
    frame: true,
    link: { sections: [], from: -1, formSection: null },
  }
}

/** Compiles a site's header and footer, designed in the layout language, into its layout. */
export function aiCompileLayoutFrame(
  frame: { header: AiLayoutSection | null; footer: AiLayoutSection | null },
  plan: AiLayoutFramePlan,
  targets: AiLayoutTargets,
): AiLayoutCompiledFrame {
  const tree = new AiLayoutTreeBuilder('lf')
  // A store's own pages are destinations the footer's list links by path (AGL-3676).
  const storePages: AiLayoutPage[] = (plan.storeLinks?.footer ?? []).map((link) => ({
    id: `store:${link.href}`,
    label: link.label,
    slug: link.href,
    href: link.href,
  }))
  const page: PageScope = {
    tree,
    plan: { title: plan.siteName, sections: [] },
    targets: { ...targets, pages: [...targets.pages, ...storePages], pageId: null },
    // A footer is drawn compact: its lines are lines, never blocks rule 1 would ask to share.
    options: { reusableComponents: true, ...(plan.language ? { language: plan.language } : {}) },
    settled: [],
    scrollTo: {},
    // A frame's lines are its own, never a page section's items.
    itemIds: [],
    // A frame shows no picture slot: a header and a footer are the same on every page.
    images: AI_LAYOUT_MAX_IMAGES,
    strong: { brand: 0, dark: 0 },
    formSection: null,
    pageIcon: AI_ICON_LIBRARY.sparkle,
    formsPlaced: new Set(),
    // A frame is drawn the platform's one way on every site.
    design: null,
    pictures: 0,
    features: 0,
    splitAt: -2,
    quotesOnly: [],
  }
  const name = aiLayoutFitText(plan.siteName, 'heading', plan.language) || 'Home'
  const header = frame.header ?? { blocks: [] }
  const band = header.band ?? 'plain'
  const look = headerLook(band)
  const scope = frameScope(
    page,
    'header',
    band === 'brand' || band === 'dark' ? 'brand' : 'plain',
    false,
  )
  const navLink = (
    entry: AiLayoutPage,
    role: string,
    interactions?: unknown[],
  ) => {
    const id = tree.add(
      'muiScreenLink',
      {
        children:
          aiLayoutFitText(entry.label, 'label', plan.language) || entry.label.slice(0, 28),
        // The blog is a path, not a page (AGL-3660).
        ...(entry.href ? { href: entry.href } : { screenId: entry.id }),
        renderAs: 'link',
        color: 'inherit',
      },
      { textDecoration: 'none' },
      null,
      role,
    )
    if (interactions) tree.nodes[id].interactions = interactions
    return id
  }
  const pages = plan.navPages.filter((entry) => entry.label.trim())
  const centeredNav = header.align === 'center' && pages.length > 0
  // The brand takes the room the navigation does not, and gives way before
  // it does: a long name ends in an ellipsis rather than pushing into the links.
  // A logo never gives way: drawn narrower than itself it lay over the first
  // link (the 10/29 header at 1280, AGL-4108).
  const brandSx = {
    typography: 'h6',
    fontWeight: 800,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
    ...(centeredNav ? {} : { flexGrow: 1 }),
  }
  const logo = plan.brand?.logo?.src ? plan.brand.logo.src : null
  const source = plan.source ?? null
  const alt = (plan.brand?.alt ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || name.slice(0, 40)
  const brand = logo
    ? brandMark(tree, { src: logo, name: name.slice(0, 40), alt, withName: plan.brand?.name === true, homeId: plan.homeId, centered: centeredNav, grow: !source })
    : plan.homeId
    ? tree.add(
        'muiScreenLink',
        {
          children: name.slice(0, 40),
          screenId: plan.homeId,
          renderAs: 'link',
          color: 'inherit',
        },
        brandSx,
        null,
        'brand',
      )
    : tree.add(
        'muiTypography',
        { children: name, variant: 'h6', component: 'p' },
        brandSx,
        null,
        'brand',
      )
  // How wide the brand is drawn, which the row is measured with (AGL-4108).
  const aspect = plan.brand?.aspect && Number.isFinite(plan.brand.aspect) && plan.brand.aspect > 0 ? Math.min(plan.brand.aspect, 8) : null
  const logoHeight = Number.parseInt(AI_LAYOUT_LOGO_HEIGHT, 10)
  const brandWidth = logo
    ? (aspect ? Math.round(aspect * logoHeight) : AI_LAYOUT_HEADER_MEASURE.logo) + (plan.brand?.name ? name.slice(0, 40).length * 11 + 12 : 0)
    : Math.min(name.length, 40) * 11
  // The source's own header (AGL-4108), drawn as it builds it.
  const close = [AI_LAYOUT_CLOSE_DRAWER]
  const drawn = source ? aiLayoutSourceHeader(tree, source, { onBrand: band === 'brand' || band === 'dark', close, brandWidth }) : null
  // Every label on one line, and the row only on a screen it fits (AGL-4108).
  const pagesBreakpoint = aiLayoutNavBreakpoint({ brandWidth, nav: pages.map((entry) => ({ label: entry.label, menu: false })), ctas: [] })
  const breakpoint = drawn?.breakpoint ?? pagesBreakpoint
  const nav = drawn
    ? drawn.nav
    : pages.length
      ? tree.add(
          'muiStack',
          {
            component: 'nav',
            ariaLabel: 'Main',
            direction: 'row',
            spacing: '3',
            alignItems: 'center',
          },
          { display: { xs: 'none', [breakpoint]: 'flex' }, whiteSpace: 'nowrap' },
          pages.map((entry) => navLink(entry, 'navLink')),
          'nav',
        )
      : null
  // The design's call to action: its first button, where it goes somewhere.
  // A source's header carries its own buttons instead (AGL-4108).
  const ctaBlock = source ? undefined : header.blocks.find((block) => block.kind === 'button')
  // A store's announcement: the first short line the design gave its header (AGL-3676).
  const store = !!plan.shopId
  const noteBlock = store ? header.blocks.find((block) => block.kind === 'note' || block.kind === 'text' || block.kind === 'lede') : undefined
  for (const block of header.blocks) {
    if (block !== ctaBlock && block !== noteBlock)
      page.settled.push({
        at: 'header',
        what: `a ${block.kind} in the header; left out`,
      })
  }
  const ctaLabel = ctaBlock ? aiLayoutFitText(ctaBlock.text, 'label', plan.language) : ''
  const ctaResolved =
    ctaBlock && ctaLabel
      ? aiLayoutResolveLink(ctaBlock.to, ctaLabel, scope.link, page.targets)
      : null
  if (ctaBlock && !ctaResolved)
    page.settled.push({
      at: 'header',
      what: `the button "${ctaLabel}" has nowhere to go; left out`,
    })
  // A storefront's header is its navigation and its cart (AGL-3676): the
  // live Willow Wick header's "Shop candles" button repeated its nav's Shop.
  // A store's button that only repeats a page the navigation links is left
  // out, and a store that sells carries its cart in that place instead.
  const repeatsNav =
    ctaResolved?.kind === 'page' && pages.some((entry) => !entry.href && entry.id === ctaResolved.screenId)
  const ctaTo = ctaResolved && store && (plan.cart || repeatsNav) ? null : ctaResolved
  if (ctaResolved && !ctaTo)
    page.settled.push({
      at: 'header',
      what: `the button "${ctaLabel}" left out: a store's header carries its ${plan.cart ? 'cart' : 'navigation'}, not a button repeating it`,
    })
  const ctaProps = ctaTo
    ? {
        children: aiLayoutRenamedLabel(ctaLabel, ctaTo),
        variant: 'contained',
        color: scope.band === 'brand' ? 'secondary' : 'primary',
        ...destinationProps(ctaTo),
      }
    : null
  // On the smallest phones the call to action moves into the menu.
  const cta = ctaProps
    ? tree.add(
        'muiButton',
        ctaProps,
        {
          display: { xs: 'none', sm: 'inline-flex' },
          whiteSpace: 'nowrap',
          flexShrink: 0,
        },
        null,
        'cta',
      )
    : null
  // A store's account, beside its cart and in the phone's menu (AGL-3676).
  const accountPath = plan.storeLinks?.account ?? null
  const accountLink = (role: string, interactions?: unknown[], sx?: Record<string, unknown>) => {
    const id = tree.add(
      'muiScreenLink',
      { children: aiLayoutLabel('account', plan.language), href: accountPath, renderAs: 'link', color: 'inherit' },
      { textDecoration: 'none', whiteSpace: 'nowrap', ...sx },
      null,
      role,
    )
    if (interactions) tree.nodes[id].interactions = interactions
    return id
  }
  // A phone's menu: the platform's Drawer, opened by its Menu Button; a link
  // followed from it closes it. A source's holds its menus, links and buttons (AGL-4108).
  const drawer = drawn?.drawer.length
    ? tree.add(
        'muiDrawer',
        { anchor: 'right' },
        null,
        [
          tree.add(
            'muiStack',
            { component: 'nav', ariaLabel: 'Menu' },
            { display: 'flex', flexDirection: 'column', gap: 3, p: 3 },
            [...drawn.drawer, accountPath ? accountLink('menuAccount', close) : null],
            'menu',
          ),
        ],
        'drawer',
      )
    : !source && pages.length
    ? tree.add(
        'muiDrawer',
        { anchor: 'right' },
        null,
        [
          tree.add(
            'muiStack',
            { component: 'nav', ariaLabel: 'Menu' },
            {
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              p: 3,
              typography: 'h6',
            },
            [
              ...pages.map((entry) => navLink(entry, 'menuLink', close)),
              accountPath ? accountLink('menuAccount', close) : null,
              ctaProps
                ? tree.add(
                    'muiButton',
                    { ...ctaProps, fullWidth: true },
                    { mt: 2 },
                    null,
                    'menuCta',
                  )
                : null,
            ],
            'menu',
          ),
        ],
        'drawer',
      )
    : null
  const toggle = drawer
    ? tree.add(
        'muiDrawerToggle',
        { ariaLabel: 'Open the menu' },
        // Pushed to the end of the row where no button is there to push it.
        { display: { xs: 'inline-flex', [breakpoint]: 'none' }, flexShrink: 0, ...(drawn && !drawn.ctas ? { ml: 'auto' } : {}) },
        null,
        'menuButton',
      )
    : null
  const middle =
    nav && centeredNav
      ? tree.add(
          'muiBox',
          null,
          { flexGrow: 1, display: 'flex', justifyContent: 'center' },
          [nav],
          'navRoom',
        )
      : nav
  // A store's cart, on every page, where a shopper looks for it (AGL-3676).
  const cart = plan.cart
    ? tree.add(AI_LAYOUT_CART_ELEMENT, { variant: 'button' }, { flexShrink: 0 }, null, 'cart')
    : null
  // On a phone the account is in the menu, and the cart stays in the bar.
  const account = accountPath ? accountLink('account', undefined, { display: { xs: 'none', [breakpoint]: 'inline-flex' }, flexShrink: 0 }) : null
  // The row lives in a Container inside the Toolbar Content, which may only sit in an App Bar.
  const row = tree.add(
    'muiContainer',
    { maxWidth: 'lg' },
    { display: 'flex', alignItems: 'center', columnGap: 3 },
    [brand, middle, drawn ? drawn.ctas : cta, account, cart, toggle, drawer],
    'headerRow',
  )
  const toolbar = tree.add(
    'muiToolbar',
    { disableGutters: true },
    { minHeight: { xs: 64, md: 76 } },
    [row],
    'toolbar',
  )
  // A source's header bar on the ground it sits on (AGL-4108): the page's own, where it is the page's.
  const barLook = source?.header === 'page' ? { props: { color: 'inherit' }, sx: { bgcolor: 'background.default' } } : look
  const bar = tree.add(
    'muiAppBar',
    {
      ...barLook.props,
      position: 'sticky',
      // Over a page that opens with a photo cover, the bar sits on the photo (AGL-3660).
      overHero: true,
      component: 'header',
      ariaLabel: 'Site header',
    },
    barLook.sx,
    [toolbar],
    'header',
  )
  // A selling store's announcement bar, above the header, linking its shop (AGL-3676).
  const announcement =
    store && plan.cart && plan.shopId
      ? (() => {
          const said = aiLayoutFitText(noteBlock?.text, 'note', plan.language)
          if (noteBlock && !said) page.settled.push({ at: 'header', what: 'an announcement with no words left; the shop’s own line instead' })
          // The design's line, then the way into the shop; else the way in alone.
          const link = tree.add(
            'muiScreenLink',
            {
              children: aiLayoutLabel(said ? 'shopNow' : 'storeAnnouncement', plan.language),
              screenId: plan.shopId,
              renderAs: 'link',
              color: 'inherit',
            },
            { fontWeight: 700 },
            null,
            'announcementLink',
          )
          const words = said
            ? tree.add('muiTypography', { children: said, variant: 'body2', component: 'p' }, null, null, 'announcementText')
            : null
          return tree.add(
            'muiStack',
            { direction: 'row', spacing: '1.5', justifyContent: 'center', alignItems: 'baseline', useFlexGap: true, flexWrap: 'wrap' },
            { bgcolor: 'primary.main', color: 'primary.contrastText', typography: 'body2', py: 1, px: 2 },
            [words, link],
            'announcement',
          )
        })()
      : null
  // The page grows into the room the window leaves, so a short page keeps
  // its footer at the bottom.
  const slot = tree.add(
    'layoutSlot',
    { component: 'main' },
    { flexGrow: 1 },
    null,
    'slot',
  )
  const footer = source?.footer ? sourceFooter(page, source, name) : compileFooter(page, frame.footer, plan, name)
  // No heading with nothing under it, no column of only a heading, columns
  // top-aligned (AGL-3735): a list under a heading can compile to nothing.
  if (aiLayoutRepairFrameHollows(tree.nodes as unknown as Record<string, unknown>)) {
    page.settled.push({ at: 'footer', what: 'a heading with nothing under it taken out, and its column with it' })
  }
  const column = tree.add(
    'muiStack',
    null,
    { minHeight: '100vh' },
    [announcement, bar, slot, footer],
    'frame',
  )
  tree.prune(column, new Set([slot]))
  const rootId = tree.add('div', null, null, [column], 'layout')
  return { tree: { rootId, nodes: tree.nodes }, settled: page.settled }
}

/** What a store's own column of account and policy links is headed where the footer design gave no store heading (AGL-3735). */
export const AI_LAYOUT_STORE_FOOTER_HEADING = AI_LAYOUT_LABELS_EN.customerCare

/** A footer heading a store's account and policies belong under (AGL-3735). */
const STORE_HEADING = /\b(?:shop|store|shopping|help|customer|care|support|service|orders?|account|policies|policy|legal|info|information|shipping|returns)\b/i

/**
 * The footer heading a store's account and policy links go under
 * (AGL-3735): a heading of the design's that names the store or its help
 * ("Our shop", "Help", "Customer care"), the first with nothing under it
 * before one with words or links of its own. Never the heading over the
 * site's pages, whose list is the site's navigation. `end` is where the
 * links go: the end of what that heading heads.
 */
export function aiLayoutFooterStoreHeading(
  columns: readonly AiLayoutBlock[][],
  navItems: readonly { to: string }[],
): { column: AiLayoutBlock[]; end: number; heading: string } | null {
  const navTo = new Set(navItems.map((item) => item.to))
  const candidates: Array<{ column: AiLayoutBlock[]; end: number; heading: string; empty: boolean }> = []
  for (const column of columns) {
    column.forEach((block, at) => {
      if (block.kind !== 'heading' || !STORE_HEADING.test(block.text ?? '')) return
      let end = at + 1
      while (end < column.length && column[end].kind !== 'heading') end += 1
      const under = column.slice(at + 1, end)
      const site = under.some((one) => one.kind === 'list' && (one.items ?? []).some((item) => navTo.has(item.to ?? '')))
      if (site) return
      candidates.push({ column: column as AiLayoutBlock[], end, heading: String(block.text), empty: under.length === 0 })
    })
  }
  const pick = candidates.find((one) => one.empty) ?? candidates[0]
  return pick ? { column: pick.column, end: pick.end, heading: pick.heading } : null
}

/** A link followed from the phone menu closes it. */
const AI_LAYOUT_CLOSE_DRAWER = {
  id: 'ai-close-menu',
  name: 'Close the menu',
  enabled: true,
  trigger: { event: 'elementClick', everyTime: true },
  steps: [{ type: 'closeDrawer' }],
}

/**
 * The footer the design describes, with what every footer owes a visitor
 * written by code: the site's pages, where the design links none of them,
 * and the site's name under a rule.
 */
function compileFooter(
  page: PageScope,
  footer: AiLayoutSection | null,
  plan: AiLayoutFramePlan,
  name: string,
): string {
  const tree = page.tree
  const asked = footer?.band ?? 'soft'
  const band = plan.closesDark && (asked === 'brand' || asked === 'dark') ? 'soft' : asked
  if (band !== asked) page.settled.push({ at: 'footer', what: `a ${asked} footer under a dark closing band drawn soft` })
  const scope = frameScope(page, 'footer', band, footer?.align === 'center')
  // The footer's page links are the site's pages, every one, as the header's
  // are (AGL-3660): a list the model wrote of page links is drawn with them
  // in its place, and a footer with none gets one. The model places the list;
  // it never chooses which pages it holds.
  const navItems = plan.navPages.map((entry) => ({
    title: entry.label,
    text: '',
    to: `page:${entry.id}`,
  }))
  let linksPages = false
  const blocks = (footer?.blocks ?? []).flatMap((given): AiLayoutBlock[] => {
    // The bottom bar carries the frame's one copyright line; a line of the
    // answer's own that reads as one would print it twice.
    if (aiLayoutIsCopyright(given.text)) {
      page.settled.push({ at: 'footer', what: 'a copyright line; the footer writes its own' })
      return []
    }
    const notice = (item: { title: string; text: string }) => aiLayoutIsCopyright(item.title) || aiLayoutIsCopyright(item.text)
    const block = given.items?.some(notice) ? { ...given, items: given.items.filter((item) => !notice(item)) } : given
    if (block !== given) page.settled.push({ at: 'footer', what: 'a copyright line in a list; the footer writes its own' })
    if (FOOTER_LEAVES_OUT.has(block.kind)) {
      page.settled.push({
        at: 'footer',
        what: `a ${block.kind} in the footer; left out`,
      })
      return []
    }
    const pageLinks =
      block.kind === 'list' &&
      (block.items ?? []).some((item) => /^page:/.test(item.to ?? ''))
    if (!pageLinks) return [block]
    if (linksPages || !navItems.length) {
      page.settled.push({ at: 'footer', what: 'a second list of page links; left out' })
      return []
    }
    linksPages = true
    return [{ ...block, items: navItems }]
  })
  const cols = footer?.cols && footer.cols.length >= 2 ? footer.cols : null
  const columns: AiLayoutBlock[][] = cols ? cols.map(() => []) : [[]]
  for (const block of blocks)
    columns[
      cols && block.col !== undefined ? Math.min(block.col, cols.length - 1) : 0
    ].push(block)
  const weights = cols ? [...cols] : [2]
  if (!linksPages && plan.navPages.length) {
    columns.push([
      {
        kind: 'list',
        items: plan.navPages.map((entry) => ({
          title: entry.label,
          text: '',
          to: `page:${entry.id}`,
        })),
      },
    ])
    weights.push(1)
  }
  // A store's account and policies (AGL-3676): under the store heading the
  // design already wrote ("Our shop", "Help"…), never as a column with no
  // heading beside a heading with nothing under it (AGL-3735); where the
  // design wrote none, a column of their own, headed.
  const storeLinks = plan.storeLinks?.footer ?? []
  if (storeLinks.length) {
    const list: AiLayoutBlock = { kind: 'list', items: storeLinks.map((link) => ({ title: link.label, text: '', to: `page:store:${link.href}` })) }
    const home = aiLayoutFooterStoreHeading(columns, navItems)
    if (home) {
      home.column.splice(home.end, 0, list)
      page.settled.push({ at: 'footer', what: `the store's account and policy links under "${home.heading}"` })
    } else {
      columns.push([{ kind: 'heading', text: aiLayoutLabel('customerCare', plan.language) }, list])
      weights.push(1)
    }
  }
  // How to reach the business (AGL-3979): the phone and email it gave, as
  // links that call and write, in a column of their own under its heading,
  // wherever the design's footer did not already show them.
  const contact = page.targets.contact
  const contactItems = contact ? aiLayoutContactItems(contact, aiLayoutContactShown(blocks, contact)) : []
  if (contactItems.length) {
    columns.push([
      { kind: 'heading', text: aiLayoutLabel('contact', plan.language) },
      { kind: 'list', items: contactItems },
    ])
    weights.push(1)
    page.settled.push({ at: 'footer', what: 'the phone and email the business gave, in a column of their own' })
  }
  const filled = columns
    .map((column, position) => ({ column, weight: weights[position] ?? 1 }))
    .filter((entry) => entry.column.length)
  // A footer's columns are top-aligned: each starts at its heading (AGL-3735).
  const top =
    filled.length > 1
      ? compileRow(scope, filled, 'flex-start')
      : filled.length === 1
        ? compileFlow(scope, filled[0].column, 'full')
        : null
  const copyright = tree.add(
    'muiTypography',
    { children: `© ${name}`, variant: 'body2', component: 'p' },
    scope.band === 'brand' ? null : { color: 'text.secondary' },
    null,
    'copyright',
  )
  const bottom = tree.add(
    'muiBox',
    null,
    { pt: 3, borderTop: 1, borderColor: 'divider' },
    [copyright],
    'footerBottom',
  )
  const stack = tree.add(
    'muiStack',
    { spacing: '6' },
    null,
    [top, bottom],
    'footerStack',
  )
  const container = tree.add(
    'muiContainer',
    { maxWidth: 'lg' },
    { py: { xs: 6, md: 8 } },
    [stack],
    'footerInner',
  )
  return tree.add(
    'section',
    {
      element: 'footer',
      ariaLabel: 'Site footer',
      ...(scope.band === 'dark' ? { colorScheme: 'dark' } : {}),
    },
    scope.band === 'soft'
      ? { bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }
      : bandSx(scope.band),
    [container],
    'footer',
  )
}

/**
 * A source's footer (AGL-4108): its columns, words, profiles and © line, as
 * the source has them, on the quiet band a footer sits on.
 */
function sourceFooter(page: PageScope, source: AiLayoutFrameSource, name: string): string {
  const tree = page.tree
  const drawn = aiLayoutSourceFooter(tree, source.footer as NonNullable<AiLayoutFrameSource['footer']>, { name })
  const stack = tree.add('muiStack', { spacing: '6' }, drawn.sx, [drawn.top, drawn.bottom], 'footerStack')
  const container = tree.add('muiContainer', { maxWidth: 'lg' }, { py: { xs: 6, md: 8 } }, [stack], 'footerInner')
  return tree.add(
    'section',
    { element: 'footer', ariaLabel: 'Site footer' },
    { bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' },
    [container],
    'footer',
  )
}

/**
 * The header's brand drawn with the site's logo (AGL-4084), as the source's
 * header draws it: the logo alone, named by its alt text, or the logo with
 * the name beside it; either way the link home.
 */
function brandMark(
  tree: AiLayoutTreeBuilder,
  input: { src: string; name: string; alt: string; withName: boolean; homeId: string | null; centered: boolean; grow: boolean },
): string {
  const image = (alone: boolean) =>
    tree.add(
      'image',
      {
        src: input.src,
        ...(alone ? { alt: input.alt } : { decorative: true }),
        objectFit: 'contain',
        width: 'auto',
        height: AI_LAYOUT_LOGO_HEIGHT,
        loading: 'eager',
        ...(alone && input.homeId ? { screenId: input.homeId } : {}),
      },
      null,
      null,
      'logo',
    )
  // Never narrower than the logo (AGL-4108); it grows into the room the
  // navigation leaves only where the navigation does not take it itself.
  const grow = input.centered || !input.grow ? null : { flexGrow: 1 }
  if (!input.withName) {
    return tree.add('muiBox', null, { ...(grow ?? {}), display: 'flex', alignItems: 'center', flexShrink: 0 }, [image(true)], 'brand')
  }
  const words = tree.add('muiTypography', { children: input.name, variant: 'h6', component: 'p' }, { fontWeight: 800, whiteSpace: 'nowrap' }, null, 'brandName')
  const row = tree.add('muiStack', { direction: 'row', spacing: '1.5', alignItems: 'center' }, null, [image(false), words], 'brandRow')
  return input.homeId
    ? tree.add('muiLinkBox', { screenId: input.homeId, ariaLabel: input.name }, { ...(grow ?? {}), textDecoration: 'none', color: 'inherit', flexShrink: 0 }, [row], 'brand')
    : tree.add('muiBox', null, { ...(grow ?? {}), flexShrink: 0 }, [row], 'brand')
}
