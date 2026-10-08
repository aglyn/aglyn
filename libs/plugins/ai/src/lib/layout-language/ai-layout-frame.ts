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
import { aiLayoutFitText } from './ai-layout-copy'
import {
  AI_LAYOUT_MAX_ITEMS,
  type AiLayoutBand,
  type AiLayoutBlock,
  type AiLayoutSection,
  type AiLayoutSettlement,
} from './ai-layout-language'
import {
  aiLayoutResolveLink,
  type AiLayoutPage,
  type AiLayoutTargets,
} from './ai-layout-links'
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
 */

export interface AiLayoutFramePlan {
  /** The site's name, which the header and the footer carry as its brand. */
  siteName: string
  /** The site's home page, which the brand links; none where the site has none yet. */
  homeId: string | null
  /** The pages the navigation links, in order. */
  navPages: readonly AiLayoutPage[]
}

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
  const page: PageScope = {
    tree,
    plan: { title: plan.siteName, sections: [] },
    targets: { ...targets, pageId: null },
    // A footer is drawn compact: its lines are lines, never blocks rule 1 would ask to share.
    options: { reusableComponents: true },
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
  }
  const name = aiLayoutFitText(plan.siteName, 'heading') || 'Home'
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
          aiLayoutFitText(entry.label, 'label') || entry.label.slice(0, 28),
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
  const brand = plan.homeId
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
  const nav = pages.length
    ? tree.add(
        'muiStack',
        {
          component: 'nav',
          ariaLabel: 'Main',
          direction: 'row',
          spacing: '3',
          alignItems: 'center',
        },
        { display: { xs: 'none', md: 'flex' } },
        pages.map((entry) => navLink(entry, 'navLink')),
        'nav',
      )
    : null
  // The design's call to action: its first button, where it goes somewhere.
  const ctaBlock = header.blocks.find((block) => block.kind === 'button')
  for (const block of header.blocks) {
    if (block !== ctaBlock)
      page.settled.push({
        at: 'header',
        what: `a ${block.kind} in the header; left out`,
      })
  }
  const ctaLabel = ctaBlock ? aiLayoutFitText(ctaBlock.text, 'label') : ''
  const ctaTo =
    ctaBlock && ctaLabel
      ? aiLayoutResolveLink(ctaBlock.to, ctaLabel, scope.link, page.targets)
      : null
  if (ctaBlock && !ctaTo)
    page.settled.push({
      at: 'header',
      what: `the button "${ctaLabel}" has nowhere to go; left out`,
    })
  const ctaProps = ctaTo
    ? {
        children: ctaLabel,
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
  // A phone's menu: the platform's Drawer, opened by its Menu Button; a link
  // followed from it closes it.
  const close = [AI_LAYOUT_CLOSE_DRAWER]
  const drawer = pages.length
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
        { display: { xs: 'inline-flex', md: 'none' }, flexShrink: 0 },
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
  // The row lives in a Container inside the Toolbar Content, which may only sit in an App Bar.
  const row = tree.add(
    'muiContainer',
    { maxWidth: 'lg' },
    { display: 'flex', alignItems: 'center', columnGap: 3 },
    [brand, middle, cta, toggle, drawer],
    'headerRow',
  )
  const toolbar = tree.add(
    'muiToolbar',
    { disableGutters: true },
    { minHeight: { xs: 64, md: 76 } },
    [row],
    'toolbar',
  )
  const bar = tree.add(
    'muiAppBar',
    {
      ...look.props,
      position: 'sticky',
      component: 'header',
      ariaLabel: 'Site header',
    },
    look.sx,
    [toolbar],
    'header',
  )
  // The page grows into the room the window leaves, so a short page keeps
  // its footer at the bottom.
  const slot = tree.add(
    'layoutSlot',
    { component: 'main' },
    { flexGrow: 1 },
    null,
    'slot',
  )
  const footer = compileFooter(page, frame.footer, plan, name)
  const column = tree.add(
    'muiStack',
    null,
    { minHeight: '100vh' },
    [bar, slot, footer],
    'frame',
  )
  tree.prune(column, new Set([slot]))
  const rootId = tree.add('div', null, null, [column], 'layout')
  return { tree: { rootId, nodes: tree.nodes }, settled: page.settled }
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
  const band = footer?.band ?? 'soft'
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
  const filled = columns
    .map((column, position) => ({ column, weight: weights[position] ?? 1 }))
    .filter((entry) => entry.column.length)
  const top =
    filled.length > 1
      ? compileRow(scope, filled)
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
