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
 * Demo brand packs (AGL-1734).
 *
 * The founding demo (`Design-Partner-Outreach.md` §4) spends minutes 3–10 —
 * its largest block, and the one the GTM doc calls "the wedge, proven
 * visually" — on *switching between several sites in one org*. The seeder
 * used to stamp one hard-coded bakery, so N hosts produced N identical
 * bakeries and the demo argued the opposite of the pitch: one site cloned,
 * not a portfolio consolidated.
 *
 * A pack is therefore not a string table. Three sites that differ only in
 * colour still read as one template, so a pack also decides **which modules
 * exist at all**: the law firm has no storefront, the restaurant has no
 * bookable services but does have tables and two locations, the dental
 * practice has appointments and no commerce. Clicking through the switcher
 * lands on visibly different *products*, not on one product repainted.
 *
 * | module        | bakery | dental | legal | restaurant | fitness |
 * | ------------- | :----: | :----: | :---: | :--------: | :-----: |
 * | commerce      |   ✓    |   —    |   —   |     ✓      |    ✓    |
 * | services      |   ✓    |   ✓    |   —   |     —      |    ✓    |
 * | reservations  |   —    |   —    |   —   |     ✓      |    —    |
 * | site members  |   ✓    |   —    |   ✓   |     —      |    ✓    |
 * | overlays      |  bar   |  bar   |   —   |  bar+popup |  popup  |
 * | experiments   |   ✓    |   —    |   —   |     ✓      |    ✓    |
 * | locations     |   1    |   0    |   0   |     2      |    1    |
 * | home sections |   2    |   3    |   3   |     3      |    3    |
 *
 * `bakery` stays the default so `--brand` is opt-in and an unflagged run
 * still seeds what it always seeded.
 *
 * Every fixture id in here is `seed-…`-prefixed on purpose: that prefix is
 * the contract the reset path deletes against, so a host can be re-branded
 * (or wiped between two live demo runs) without leaving the previous
 * brand's documents behind pretending to be this one's.
 */

// ── Home-screen section builders ────────────────────────────────────────────
// A pack names sections; the builders below emit the node subtrees. The
// point of building them from a shared vocabulary is that the packs then
// differ in COMPOSITION — count, order, and component mix — rather than in
// copy alone, which is what stops five sites from looking like five colour
// swaps of one layout.

/** Canvas root id (NODE_ROOT_ID / CANVAS_ROOT_ELEMENT_ID). */
export const CANVAS_ROOT_ID = '_@_'

/** Centred headline + lede + button, in a plain container. */
function heroCentered(key, { eyebrow, title, body, cta, sx }) {
  const nodes = {
    [`${key}`]: {
      $id: key,
      componentId: 'section',
      pluginId: 'mui',
      parentId: CANVAS_ROOT_ID,
      nodes: [`${key}-c`],
      sx: { py: 10, ...sx },
    },
    [`${key}-c`]: {
      $id: `${key}-c`,
      componentId: 'muiContainer',
      pluginId: 'mui',
      parentId: key,
      nodes: [`${key}-s`],
      props: { maxWidth: 'md' },
    },
    [`${key}-s`]: {
      $id: `${key}-s`,
      componentId: 'muiStack',
      pluginId: 'mui',
      parentId: `${key}-c`,
      nodes: [],
      props: { spacing: 3 },
      sx: { textAlign: 'center', alignItems: 'center' },
    },
  }
  const children = nodes[`${key}-s`].nodes
  if (eyebrow) {
    children.push(`${key}-e`)
    nodes[`${key}-e`] = {
      $id: `${key}-e`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${key}-s`,
      props: { children: eyebrow, variant: 'overline' },
    }
  }
  children.push(`${key}-t`, `${key}-b`, `${key}-cta`)
  nodes[`${key}-t`] = {
    $id: `${key}-t`,
    componentId: 'muiTypography',
    pluginId: 'mui',
    parentId: `${key}-s`,
    props: { children: title, variant: 'h2' },
  }
  nodes[`${key}-b`] = {
    $id: `${key}-b`,
    componentId: 'muiTypography',
    pluginId: 'mui',
    parentId: `${key}-s`,
    props: { children: body, variant: 'body1' },
  }
  nodes[`${key}-cta`] = {
    $id: `${key}-cta`,
    componentId: 'muiButton',
    pluginId: 'mui',
    parentId: `${key}-s`,
    props: { children: cta.label, href: cta.href, variant: 'contained' },
  }
  return nodes
}

/** Image left, copy right — a structurally different hero, not a restyled one. */
function heroSplit(key, { title, body, cta, image, alt }) {
  return {
    [key]: {
      $id: key,
      componentId: 'section',
      pluginId: 'mui',
      parentId: CANVAS_ROOT_ID,
      nodes: [`${key}-c`],
      sx: { py: 8 },
    },
    [`${key}-c`]: {
      $id: `${key}-c`,
      componentId: 'muiContainer',
      pluginId: 'mui',
      parentId: key,
      nodes: [`${key}-g`],
      props: { maxWidth: 'lg' },
    },
    [`${key}-g`]: {
      $id: `${key}-g`,
      componentId: 'muiGrid',
      pluginId: 'mui',
      parentId: `${key}-c`,
      nodes: [`${key}-gi-img`, `${key}-gi-txt`],
      props: { container: true, spacing: 6 },
      sx: { alignItems: 'center' },
    },
    [`${key}-gi-img`]: {
      $id: `${key}-gi-img`,
      componentId: 'muiGrid',
      pluginId: 'mui',
      parentId: `${key}-g`,
      nodes: [`${key}-img`],
      props: { size: { xs: 12, md: 6 } },
    },
    [`${key}-img`]: {
      $id: `${key}-img`,
      componentId: 'image',
      pluginId: 'mui',
      parentId: `${key}-gi-img`,
      props: { src: image, alt },
      sx: { width: '100%', borderRadius: 2 },
    },
    [`${key}-gi-txt`]: {
      $id: `${key}-gi-txt`,
      componentId: 'muiGrid',
      pluginId: 'mui',
      parentId: `${key}-g`,
      nodes: [`${key}-s`],
      props: { size: { xs: 12, md: 6 } },
    },
    [`${key}-s`]: {
      $id: `${key}-s`,
      componentId: 'muiStack',
      pluginId: 'mui',
      parentId: `${key}-gi-txt`,
      nodes: [`${key}-t`, `${key}-b`, `${key}-cta`],
      props: { spacing: 3 },
      sx: { alignItems: 'flex-start' },
    },
    [`${key}-t`]: {
      $id: `${key}-t`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${key}-s`,
      props: { children: title, variant: 'h3' },
    },
    [`${key}-b`]: {
      $id: `${key}-b`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${key}-s`,
      props: { children: body, variant: 'body1' },
    },
    [`${key}-cta`]: {
      $id: `${key}-cta`,
      componentId: 'muiButton',
      pluginId: 'mui',
      parentId: `${key}-s`,
      props: { children: cta.label, href: cta.href, variant: 'contained' },
    },
  }
}

/** N cards in a grid. */
function featureGrid(key, { heading, items }) {
  const nodes = {
    [key]: {
      $id: key,
      componentId: 'section',
      pluginId: 'mui',
      parentId: CANVAS_ROOT_ID,
      nodes: [`${key}-c`],
      sx: { py: 8 },
    },
    [`${key}-c`]: {
      $id: `${key}-c`,
      componentId: 'muiContainer',
      pluginId: 'mui',
      parentId: key,
      nodes: heading ? [`${key}-h`, `${key}-g`] : [`${key}-g`],
      props: { maxWidth: 'lg' },
    },
    [`${key}-g`]: {
      $id: `${key}-g`,
      componentId: 'muiGrid',
      pluginId: 'mui',
      parentId: `${key}-c`,
      nodes: [],
      props: { container: true, spacing: 4 },
    },
  }
  if (heading) {
    nodes[`${key}-h`] = {
      $id: `${key}-h`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${key}-c`,
      props: { children: heading, variant: 'h4' },
      sx: { mb: 4 },
    }
  }
  const span = Math.max(3, Math.round(12 / items.length))
  items.forEach((item, index) => {
    const gi = `${key}-gi${index}`
    const card = `${key}-card${index}`
    nodes[`${key}-g`].nodes.push(gi)
    nodes[gi] = {
      $id: gi,
      componentId: 'muiGrid',
      pluginId: 'mui',
      parentId: `${key}-g`,
      nodes: [card],
      props: { size: { xs: 12, md: span } },
    }
    nodes[card] = {
      $id: card,
      componentId: 'muiCard',
      pluginId: 'mui',
      parentId: gi,
      nodes: [`${card}-body`],
      props: { variant: 'outlined' },
      sx: { height: '100%' },
    }
    nodes[`${card}-body`] = {
      $id: `${card}-body`,
      componentId: 'muiCardContent',
      pluginId: 'mui',
      parentId: card,
      nodes: [`${card}-t`, `${card}-b`],
    }
    nodes[`${card}-t`] = {
      $id: `${card}-t`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${card}-body`,
      props: { children: item.title, variant: 'h6' },
    }
    nodes[`${card}-b`] = {
      $id: `${card}-b`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${card}-body`,
      props: { children: item.body, variant: 'body2' },
    }
  })
  return nodes
}

/** A plain list — the layout a firm or a menu wants and a card grid doesn't. */
function listBand(key, { heading, items }) {
  const nodes = {
    [key]: {
      $id: key,
      componentId: 'section',
      pluginId: 'mui',
      parentId: CANVAS_ROOT_ID,
      nodes: [`${key}-c`],
      sx: { py: 8 },
    },
    [`${key}-c`]: {
      $id: `${key}-c`,
      componentId: 'muiContainer',
      pluginId: 'mui',
      parentId: key,
      nodes: [`${key}-h`, `${key}-l`],
      props: { maxWidth: 'md' },
    },
    [`${key}-h`]: {
      $id: `${key}-h`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${key}-c`,
      props: { children: heading, variant: 'h4' },
      sx: { mb: 3 },
    },
    [`${key}-l`]: {
      $id: `${key}-l`,
      componentId: 'muiList',
      pluginId: 'mui',
      parentId: `${key}-c`,
      nodes: [],
    },
  }
  items.forEach((item, index) => {
    const li = `${key}-li${index}`
    nodes[`${key}-l`].nodes.push(li)
    nodes[li] = {
      $id: li,
      componentId: 'muiListItem',
      pluginId: 'mui',
      parentId: `${key}-l`,
      nodes: [`${li}-t`],
      props: { divider: true },
    }
    nodes[`${li}-t`] = {
      $id: `${li}-t`,
      componentId: 'muiListItemText',
      pluginId: 'mui',
      parentId: li,
      props: { primary: item.primary, secondary: item.secondary },
    }
  })
  return nodes
}

/** Big numbers in a row — the only section with no prose at all. */
function statBand(key, { stats, sx }) {
  const nodes = {
    [key]: {
      $id: key,
      componentId: 'section',
      pluginId: 'mui',
      parentId: CANVAS_ROOT_ID,
      nodes: [`${key}-c`],
      sx: { py: 6, ...sx },
    },
    [`${key}-c`]: {
      $id: `${key}-c`,
      componentId: 'muiContainer',
      pluginId: 'mui',
      parentId: key,
      nodes: [`${key}-g`],
      props: { maxWidth: 'lg' },
    },
    [`${key}-g`]: {
      $id: `${key}-g`,
      componentId: 'muiGrid',
      pluginId: 'mui',
      parentId: `${key}-c`,
      nodes: [],
      props: { container: true, spacing: 4 },
      sx: { textAlign: 'center' },
    },
  }
  stats.forEach((stat, index) => {
    const gi = `${key}-gi${index}`
    nodes[`${key}-g`].nodes.push(gi)
    nodes[gi] = {
      $id: gi,
      componentId: 'muiGrid',
      pluginId: 'mui',
      parentId: `${key}-g`,
      nodes: [`${gi}-v`, `${gi}-l`],
      props: { size: { xs: 12, sm: 4 } },
    }
    nodes[`${gi}-v`] = {
      $id: `${gi}-v`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: gi,
      props: { children: stat.value, variant: 'h2' },
    }
    nodes[`${gi}-l`] = {
      $id: `${gi}-l`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: gi,
      props: { children: stat.label, variant: 'overline' },
    }
  })
  return nodes
}

/** Closing band on a filled surface. */
function ctaBand(key, { title, cta, sx }) {
  return {
    [key]: {
      $id: key,
      componentId: 'section',
      pluginId: 'mui',
      parentId: CANVAS_ROOT_ID,
      nodes: [`${key}-p`],
      sx: { py: 8 },
    },
    [`${key}-p`]: {
      $id: `${key}-p`,
      componentId: 'muiPaper',
      pluginId: 'mui',
      parentId: key,
      nodes: [`${key}-s`],
      props: { elevation: 0 },
      sx: { p: 6, ...sx },
    },
    [`${key}-s`]: {
      $id: `${key}-s`,
      componentId: 'muiStack',
      pluginId: 'mui',
      parentId: `${key}-p`,
      nodes: [`${key}-t`, `${key}-cta`],
      props: { spacing: 3 },
      sx: { alignItems: 'center', textAlign: 'center' },
    },
    [`${key}-t`]: {
      $id: `${key}-t`,
      componentId: 'muiTypography',
      pluginId: 'mui',
      parentId: `${key}-s`,
      props: { children: title, variant: 'h4' },
    },
    [`${key}-cta`]: {
      $id: `${key}-cta`,
      componentId: 'muiButton',
      pluginId: 'mui',
      parentId: `${key}-s`,
      props: { children: cta.label, href: cta.href, variant: 'outlined' },
    },
  }
}

const SECTION_BUILDERS = {
  heroCentered,
  heroSplit,
  featureGrid,
  listBand,
  statBand,
  ctaBand,
}

/**
 * Assembles a pack's `home.sections` into a canvas node map.
 *
 * Section keys are positional (`s0`, `s1`, …) so two packs that use the same
 * builder still produce independent ids, and re-running a pack converges on
 * the same map rather than accumulating orphans.
 */
export function buildHomeNodes(sections) {
  const rootChildren = []
  let nodes = {}
  sections.forEach((section, index) => {
    const key = `s${index}`
    const build = SECTION_BUILDERS[section.type]
    if (!build) throw new Error(`Unknown home section type "${section.type}"`)
    rootChildren.push(key)
    nodes = { ...nodes, ...build(key, section) }
  })
  return {
    // `div`, not `root` — this is what the console writes for a new screen
    // (`screens/page.tsx`), and a canvas root the editor does not recognise
    // is the kind of thing that only shows up when someone opens the demo
    // site in besigner on the call.
    [CANVAS_ROOT_ID]: {
      $id: CANVAS_ROOT_ID,
      componentId: 'div',
      nodes: rootChildren,
    },
    ...nodes,
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

const img = (seed, size = '960/540') => `https://picsum.photos/seed/${seed}/${size}`

/** A palette entry, so packs read as design decisions rather than hex soup. */
const scheme = ({ primary, secondary, tertiary, bg, paper, text }) => ({
  light: {
    primary: { main: primary },
    secondary: { main: secondary },
    tertiary: { main: tertiary },
    background: { default: bg, paper },
    text: { primary: text },
  },
})

// ── Brand packs ─────────────────────────────────────────────────────────────

/** @type {Record<string, object>} */
export const BRANDS = {
  // ── 1. Bakery — the historical default ───────────────────────────────────
  //
  // Kept as the default so an unflagged run seeds what it always seeded, and
  // kept recognisable (Demo Bakery, the sourdough and croissant posts, Avery
  // / Sam / Jordan, the cake tasting). Its COMMERCE fixtures are the one
  // deliberate departure: they used to be a vented brake rotor, a trail
  // riding program, a "Main warehouse" and a Pinecrest Cabin reservation —
  // an auto-parts shop and a holiday let wearing a bakery's name. Clicking
  // Products on the demo site showed brake discs. Those fixtures were not
  // lost, they moved to the brands that actually sell that (`fitness` took
  // the digital training program); the bakery now sells bread.
  bakery: {
    id: 'bakery',
    displayName: 'Demo Bakery',
    subdomain: 'demo',
    tagline: 'Fresh every morning',
    theme: {
      colorSchemes: scheme({
        primary: '#8B5E3C',
        secondary: '#C9A227',
        tertiary: '#6B7F5A',
        bg: '#FFFDF7',
        paper: '#FFFFFF',
        text: '#2A1F16',
      }),
      fonts: [{ family: 'Fraunces', weights: [400, 700], source: 'google' }],
      typography: { fontFamily: 'Fraunces, Georgia, serif' },
      shape: { borderRadius: 12 },
    },
    home: {
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'Est. 2014 · Georgetown, TX',
          title: 'Fresh sourdough, every morning',
          body: 'Small-batch breads and pastries, out of the oven by six.',
          cta: { label: 'Order now', href: '/order' },
        },
        {
          type: 'featureGrid',
          heading: 'This week',
          items: [
            { title: 'Country loaf', body: 'Three-day ferment, blistered crust, open crumb.' },
            { title: 'Butter croissant', body: 'Twenty-seven layers of cultured butter.' },
            { title: 'Cardamom bun', body: 'Saturday only. They go by nine.' },
          ],
        },
      ],
    },
    variables: [
      { id: 'seed-site-name', name: 'siteName', type: 'text', value: 'Demo Bakery' },
      { id: 'seed-tagline', name: 'tagline', type: 'text', value: 'Fresh every morning' },
      { id: 'seed-base-price', name: 'basePrice', type: 'number', value: '4' },
    ],
    logic: {
      fn: {
        id: 'seed-order-total',
        name: 'OrderTotal',
        parameters: [
          { name: 'Qty', type: 'number', required: true },
          { name: 'Price', type: 'number', required: false },
        ],
        variables: [{ name: 'Total', type: 'number' }],
        operations: [
          {
            if: { left: 'Qty', comparator: '>=', right: '12' },
            then: [{ set: 'Total', expression: 'Qty * Price * 0.9' }],
            otherwise: [{ set: 'Total', expression: 'Qty * Price' }],
          },
        ],
        returnValue: 'Total',
      },
      workflow: {
        id: 'seed-quote',
        name: 'DozenQuote',
        steps: [
          { functionName: 'OrderTotal', args: ['12', 'basePrice'], resultName: 'dozenPrice' },
        ],
        returnValue: 'dozenPrice',
        trigger: { event: 'formSubmission' },
      },
      action: {
        id: 'seed-welcome',
        name: 'Form thank-you',
        trigger: { event: 'formSubmission' },
        steps: [
          {
            type: 'siteAlert',
            severity: 'success',
            message: 'Thanks — we read every message the same day!',
          },
        ],
        enabled: true,
      },
    },
    datasets: [
      {
        id: 'seed-team',
        name: 'Team',
        fields: ['name', 'role', 'photo'],
        rows: [
          { name: 'Avery Quinn', role: 'Head Baker', photo: img('avery', '240') },
          { name: 'Sam Rivera', role: 'Pastry Chef', photo: img('sam', '240') },
          { name: 'Jordan Lee', role: 'Front of House', photo: img('jordan', '240') },
        ],
      },
      {
        id: 'seed-menu',
        name: 'Menu',
        fields: ['label', 'href'],
        rows: [
          { label: 'Home', href: '/' },
          { label: 'Our story', href: '/about' },
          { label: 'Order', href: '/order' },
        ],
      },
    ],
    collections: [
      {
        id: 'seed-blog',
        displayName: 'Blog',
        slug: 'blog',
        entries: [
          {
            id: 'seed-post-1',
            title: 'Why our sourdough takes three days',
            slug: 'three-day-sourdough',
            excerpt: 'Slow fermentation is the whole secret.',
            coverImage: img('sourdough'),
            body:
              '## The starter\n\nOur starter is **nine years old** and lives in the ' +
              'walk-in.\n\n- Day 1: feed and rest\n- Day 2: shape and cold proof\n' +
              '- Day 3: bake\n\n*Patience tastes better.*',
          },
          {
            id: 'seed-post-2',
            title: 'Croissant lamination, step by step',
            slug: 'croissant-lamination',
            excerpt: 'Twenty-seven layers, zero shortcuts.',
            coverImage: img('croissant'),
            body:
              '## Butter matters\n\nWe use cultured butter at 82% fat.\n\n' +
              '## The folds\n\nThree letter folds with a full rest between each.',
          },
        ],
      },
    ],
    media: [
      { id: 'seed-media-1', fileName: 'hero.jpg', folder: 'Marketing', tags: ['hero', 'home'], seed: 'hero/1200/600' },
      { id: 'seed-media-2', fileName: 'team.jpg', folder: 'About', tags: ['team'], seed: 'teamphoto/800/500' },
      { id: 'seed-media-3', fileName: 'loaf.jpg', folder: 'Products', tags: ['bread'], seed: 'loaf/600/600' },
    ],
    leads: [
      { id: 'seed-lead-1', email: 'wholesale@example.com', source: 'signup' },
      { id: 'seed-lead-2', email: 'events@example.com', source: 'booking' },
    ],
    siteMembers: [
      { id: 'seed-member', email: 'regular@example.com', displayName: 'Demo Regular' },
    ],
    services: [
      {
        id: 'seed-svc-1',
        name: 'Cake tasting',
        durationMinutes: 30,
        priceUsd: 0,
        description: 'Pick your wedding or event cake over coffee.',
        timezone: 'America/Chicago',
        windows: { 2: [{ start: 600, end: 960 }], 4: [{ start: 600, end: 960 }] },
      },
    ],
    commerce: {
      categories: [{ id: 'seed-cat-1', name: 'Breads', slug: 'breads' }],
      collections: [
        { id: 'seed-coll-1', name: 'Featured', slug: 'featured', productIds: ['seed-prod-1', 'seed-prod-2'] },
      ],
      locations: [{ id: 'seed-loc-1', name: 'Georgetown bakehouse' }],
      products: [
        {
          id: 'seed-prod-1',
          name: 'Country sourdough',
          slug: 'country-sourdough',
          description: 'Three-day ferment, 900g or 1.6kg miche.',
          categoryIds: ['seed-cat-1'],
          tags: ['bread', 'signature'],
          imageSeed: 'loafshop/800/800',
          priceUsd: 9,
          inventory: 24,
          options: [{ name: 'Size', values: ['900g', '1.6kg miche'] }],
          variants: [
            { id: 'v-900', options: { Size: '900g' }, priceUsd: 9, inventoryByLocation: { 'seed-loc-1': 24 } },
            { id: 'v-miche', options: { Size: '1.6kg miche' }, priceUsd: 16, inventoryByLocation: { 'seed-loc-1': 8 } },
          ],
          lowStockThreshold: 5,
        },
        {
          id: 'seed-prod-2',
          name: 'Weekly bread subscription',
          slug: 'weekly-bread-subscription',
          description: 'Two loaves a week, collected Saturday morning.',
          tags: ['subscription'],
          imageSeed: 'breadbox/800/800',
          priceUsd: 32,
          variants: [{ id: 'v-default', options: {}, priceUsd: 32 }],
          subscription: { interval: 'month', trialDays: 0 },
        },
      ],
      orders: [
        {
          id: 'seed-order-1',
          orderNumber: 1001,
          email: 'wholesale@example.com',
          status: 'paid',
          items: [
            { productId: 'seed-prod-1', variantId: 'v-miche', name: 'Country sourdough — 1.6kg miche', quantity: 2, unitPriceCents: 1600 },
          ],
          totals: { itemsCents: 3200, shippingCents: 0, taxCents: 264, discountCents: 0, totalCents: 3464, feeCents: 96 },
        },
      ],
      discounts: [{ id: 'seed-disc-1', name: 'Day-old 30%', type: 'automatic', percentOff: 30, active: true }],
      coupons: [{ id: 'seed-coupon-1', code: 'WELCOME15', percentOff: 15, active: true, redemptions: 3 }],
      giftCards: [{ id: 'seed-gift-1', code: 'GIFT-DEMO-0001', balanceCents: 5000, initialCents: 5000, active: true }],
      reviews: [
        {
          id: 'seed-review-1',
          productId: 'seed-prod-1',
          rating: 5,
          title: 'Best loaf in town',
          body: 'The crust is worth the drive.',
          authorName: 'Sam R.',
        },
      ],
    },
    reservations: null,
    marketing: {
      campaigns: [
        {
          id: 'seed-campaign-1',
          subject: 'Saturday bake list',
          body: 'Cardamom buns are back this weekend.',
          audience: 'leads',
          stats: { recipients: 2, sent: 2, opens: 1, clicks: 0 },
        },
      ],
      email: {
        subject: 'Welcome to the bakehouse, {{contact.firstName}}',
        preheader: 'Your 15% code is inside',
        heading: 'Hi {{contact.firstName}}, welcome!',
        button: 'See this week’s bakes',
      },
      overlays: [
        { id: 'seed-overlay-bar', name: 'Pre-order bar', kind: 'bar', bar: { text: 'Holiday pre-orders close Friday', link: '/order' }, enabled: true },
      ],
      experiments: [
        {
          id: 'seed-exp-1',
          name: 'CTA copy test',
          target: 'section',
          variants: [{ id: 'a', name: 'Order now' }, { id: 'b', name: 'See the bake list' }],
        },
      ],
    },
    redirects: [
      { id: 'seed-redir-1', source: '/old-home', destination: '/', statusCode: 301, kind: 'exact', priority: 10 },
      { id: 'seed-redir-2', source: '/shop', destination: '/products', statusCode: 302, kind: 'prefix', priority: 50 },
      { id: 'seed-redir-3', source: '/p/(\\d+)', destination: '/products/item-$1', statusCode: 301, kind: 'regex', priority: 100 },
    ],
    orgData: {
      contacts: [
        { id: 'seed-contact-1', email: 'wholesale@example.com', name: 'Robin Wells', tags: ['customer', 'wholesale'], sources: { order: true, newsletter: true }, purchaseCents: 3464 },
      ],
      segments: [{ id: 'seed-seg-1', name: 'Wholesale accounts', tags: ['wholesale'] }],
      lists: [{ id: 'seed-list-1', name: 'Newsletter subscribers' }],
      datasets: [
        {
          id: 'seed-orgdata-1',
          name: 'Inventory log',
          model: { fields: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'delta', label: 'Delta', type: 'number' }] },
        },
      ],
    },
    teamMember: { email: 'teammate@example.com', role: 'editor' },
  },

  // ── 2. Dental practice — appointments, no storefront ─────────────────────
  //
  // The agency ICP's most common client type and the clearest structural
  // contrast with the bakery: a full services/bookings surface and an
  // entirely EMPTY commerce surface. A practice that sells nothing is the
  // honest fixture, and an empty Products list next to the bakery's full one
  // is exactly the proof that these are four businesses, not four skins.
  dental: {
    id: 'dental',
    displayName: 'Northgate Dental',
    subdomain: 'northgate-dental',
    tagline: 'Careful dentistry, on time',
    theme: {
      colorSchemes: scheme({
        primary: '#0E7C86',
        secondary: '#4FB0C6',
        tertiary: '#1D3557',
        bg: '#F7FBFC',
        paper: '#FFFFFF',
        text: '#12303A',
      }),
      fonts: [{ family: 'Inter', weights: [400, 600], source: 'google' }],
      typography: { fontFamily: 'Inter, system-ui, sans-serif' },
      shape: { borderRadius: 8 },
    },
    home: {
      sections: [
        {
          type: 'heroSplit',
          title: 'Now accepting new patients',
          body: 'Same-week appointments, transparent pricing, and a hygienist who remembers your name.',
          cta: { label: 'Book an exam', href: '/book' },
          image: img('dentalchair', '800/600'),
          alt: 'Treatment room at Northgate Dental',
        },
        {
          type: 'featureGrid',
          heading: 'What we do',
          items: [
            { title: 'Preventive care', body: 'Cleanings, sealants, and the six-month check that stops the big bills.' },
            { title: 'Restorative', body: 'Fillings, crowns and same-day repairs.' },
            { title: 'Emergency', body: 'Two slots held open every weekday for pain that will not wait.' },
          ],
        },
        {
          type: 'ctaBand',
          title: 'Most PPO plans accepted — check yours in 30 seconds',
          cta: { label: 'Check my plan', href: '/insurance' },
          sx: { bgcolor: 'tint.primary' },
        },
      ],
    },
    variables: [
      { id: 'seed-site-name', name: 'siteName', type: 'text', value: 'Northgate Dental' },
      { id: 'seed-tagline', name: 'tagline', type: 'text', value: 'Careful dentistry, on time' },
      { id: 'seed-base-price', name: 'examFee', type: 'number', value: '89' },
    ],
    logic: {
      // A coverage estimate rather than an order total — the same engine
      // exercised by a different trade's arithmetic.
      fn: {
        id: 'seed-fn-coverage',
        name: 'EstimateCoverage',
        parameters: [
          { name: 'Fee', type: 'number', required: true },
          { name: 'CoveragePct', type: 'number', required: false },
        ],
        variables: [{ name: 'OutOfPocket', type: 'number' }],
        operations: [
          {
            if: { left: 'CoveragePct', comparator: '>', right: '0' },
            then: [{ set: 'OutOfPocket', expression: 'Fee - (Fee * CoveragePct / 100)' }],
            otherwise: [{ set: 'OutOfPocket', expression: 'Fee' }],
          },
        ],
        returnValue: 'OutOfPocket',
      },
      workflow: null,
      action: {
        id: 'seed-action-intake',
        name: 'New-patient acknowledgement',
        trigger: { event: 'formSubmission' },
        steps: [
          {
            type: 'siteAlert',
            severity: 'success',
            message: 'Thanks — the front desk will call within one business day.',
          },
        ],
        enabled: true,
      },
    },
    datasets: [
      {
        id: 'seed-team',
        name: 'Providers',
        fields: ['name', 'role', 'photo'],
        rows: [
          { name: 'Dr. Nadia Okafor, DDS', role: 'Owner · General dentistry', photo: img('nadia', '240') },
          { name: 'Dr. Elias Vance, DMD', role: 'Restorative', photo: img('elias', '240') },
          { name: 'Priya Raman, RDH', role: 'Lead hygienist', photo: img('priya', '240') },
        ],
      },
      {
        id: 'seed-insurance',
        name: 'Insurance accepted',
        fields: ['carrier', 'network'],
        rows: [
          { carrier: 'Delta Dental', network: 'PPO — in network' },
          { carrier: 'Cigna', network: 'PPO — in network' },
          { carrier: 'MetLife', network: 'Out of network, we file for you' },
        ],
      },
    ],
    collections: [
      {
        id: 'seed-blog',
        displayName: 'Patient guides',
        slug: 'guides',
        entries: [
          {
            id: 'seed-post-1',
            title: 'What a cleaning actually costs with insurance',
            slug: 'cleaning-cost-with-insurance',
            excerpt: 'The number your plan quotes and the number you pay are rarely the same.',
            coverImage: img('dentalcost'),
            body:
              '## The three numbers\n\n1. The **fee** — what the procedure lists at.\n' +
              '2. The **allowed amount** — what your carrier agrees to.\n' +
              '3. Your **share** — coinsurance plus anything left on the deductible.\n\n' +
              'We quote all three before we start.',
          },
          {
            id: 'seed-post-2',
            title: 'Sealants: worth it after twelve?',
            slug: 'sealants-after-twelve',
            excerpt: 'The short answer is usually yes, and here is when it is not.',
            coverImage: img('sealants'),
            body:
              '## Who benefits\n\nDeep grooves and a history of decay make sealants worth ' +
              'it well into adulthood.\n\n## Who does not\n\nAlready-restored molars gain nothing.',
          },
        ],
      },
    ],
    media: [
      { id: 'seed-media-1', fileName: 'reception.jpg', folder: 'Practice', tags: ['office'], seed: 'reception/1200/600' },
      { id: 'seed-media-2', fileName: 'operatory.jpg', folder: 'Practice', tags: ['office'], seed: 'operatory/800/500' },
      { id: 'seed-media-3', fileName: 'dr-okafor.jpg', folder: 'Providers', tags: ['team'], seed: 'nadia/600/600' },
    ],
    leads: [
      { id: 'seed-lead-1', email: 'newpatient@example.com', source: 'signup' },
      { id: 'seed-lead-2', email: 'toothache@example.com', source: 'booking' },
      { id: 'seed-lead-3', email: 'invisalign@example.com', source: 'signup' },
    ],
    siteMembers: [],
    services: [
      {
        id: 'seed-svc-1',
        name: 'New patient exam & X-rays',
        durationMinutes: 60,
        priceUsd: 89,
        description: 'Full charting, digital X-rays, and a written treatment plan.',
        timezone: 'America/Chicago',
        windows: { 1: [{ start: 480, end: 1020 }], 2: [{ start: 480, end: 1020 }], 3: [{ start: 480, end: 1020 }] },
      },
      {
        id: 'seed-svc-2',
        name: 'Hygiene visit',
        durationMinutes: 45,
        priceUsd: 0,
        description: 'Routine cleaning and periodontal check.',
        timezone: 'America/Chicago',
        windows: { 1: [{ start: 480, end: 960 }], 3: [{ start: 480, end: 960 }], 5: [{ start: 480, end: 720 }] },
      },
      {
        id: 'seed-svc-3',
        name: 'Emergency slot',
        durationMinutes: 30,
        priceUsd: 0,
        description: 'Held open every weekday for pain, swelling or a broken tooth.',
        timezone: 'America/Chicago',
        windows: { 1: [{ start: 900, end: 990 }], 2: [{ start: 900, end: 990 }], 4: [{ start: 900, end: 990 }] },
      },
    ],
    commerce: null,
    reservations: null,
    marketing: {
      campaigns: [
        {
          id: 'seed-campaign-1',
          subject: 'You are due for a cleaning',
          body: 'It has been six months — here are this month’s open slots.',
          audience: 'contacts',
          stats: { recipients: 3, sent: 3, opens: 2, clicks: 1 },
        },
      ],
      email: {
        subject: 'Your appointment on {{booking.date}}',
        preheader: 'Directions, parking, and what to bring',
        heading: 'See you soon, {{contact.firstName}}',
        button: 'Add to calendar',
      },
      overlays: [
        { id: 'seed-overlay-bar', name: 'Accepting patients bar', kind: 'bar', bar: { text: 'Now accepting new patients — same-week openings', link: '/book' }, enabled: true },
      ],
      experiments: [],
    },
    redirects: [
      { id: 'seed-redir-1', source: '/dentist', destination: '/services', statusCode: 301, kind: 'exact', priority: 10 },
      { id: 'seed-redir-2', source: '/new-patients', destination: '/book', statusCode: 301, kind: 'prefix', priority: 50 },
    ],
    orgData: {
      contacts: [
        { id: 'seed-contact-1', email: 'newpatient@example.com', name: 'Dana Whitfield', tags: ['patient', 'recall-due'], sources: { form: true }, purchaseCents: 8900 },
      ],
      segments: [{ id: 'seed-seg-1', name: 'Recall due', tags: ['recall-due'] }],
      lists: [{ id: 'seed-list-1', name: 'Practice newsletter' }],
      datasets: [
        {
          id: 'seed-orgdata-1',
          name: 'Referral sources',
          model: { fields: [{ key: 'source', label: 'Source', type: 'text' }, { key: 'count', label: 'Count', type: 'number' }] },
        },
      ],
    },
    teamMember: { email: 'frontdesk@example.com', role: 'editor' },
  },

  // ── 3. Law firm — content and intake only ────────────────────────────────
  //
  // The deliberately SPARSE site: no commerce, no bookable services, no
  // overlays and no experiments. Its depth is elsewhere — a client portal
  // (site members), long-form insights, an intake workflow, and the biggest
  // redirect table of the five, because a firm that has just migrated off a
  // ten-year-old site is the agency's most common first job.
  legal: {
    id: 'legal',
    displayName: 'Harborline Law',
    subdomain: 'harborline-law',
    tagline: 'Counsel for founders and operators',
    theme: {
      colorSchemes: scheme({
        primary: '#1B2A41',
        secondary: '#B08D57',
        tertiary: '#3E5C76',
        bg: '#FBFAF8',
        paper: '#FFFFFF',
        text: '#14202F',
      }),
      fonts: [{ family: 'Source Serif 4', weights: [400, 600], source: 'google' }],
      typography: {
        fontFamily: '"Source Serif 4", Georgia, serif',
        variants: {
          h2: { fontWeight: 600, letterSpacing: '-0.01em' },
          button: { textTransform: 'none', fontWeight: 600 },
        },
      },
      shape: { borderRadius: 2 },
    },
    home: {
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'Austin, Texas',
          title: 'Counsel that reads the whole contract',
          body: 'Formation, commercial agreements, and the awkward conversations before they become disputes.',
          cta: { label: 'Request a consultation', href: '/contact' },
          sx: { py: 14 },
        },
        {
          type: 'listBand',
          heading: 'Practice areas',
          items: [
            { primary: 'Company formation', secondary: 'Entity choice, cap table hygiene, founder agreements.' },
            { primary: 'Commercial contracts', secondary: 'MSAs, DPAs, reseller and channel terms.' },
            { primary: 'Employment', secondary: 'Offer letters, contractor classification, separations.' },
            { primary: 'Disputes', secondary: 'Demand letters through mediation. Litigation referred out.' },
          ],
        },
        {
          type: 'ctaBand',
          title: 'Existing clients: your documents live in the portal',
          cta: { label: 'Client portal', href: '/portal' },
          sx: { bgcolor: 'tint.secondary' },
        },
      ],
    },
    variables: [
      { id: 'seed-site-name', name: 'siteName', type: 'text', value: 'Harborline Law' },
      { id: 'seed-tagline', name: 'tagline', type: 'text', value: 'Counsel for founders and operators' },
      { id: 'seed-base-price', name: 'consultFee', type: 'number', value: '0' },
    ],
    logic: {
      fn: null,
      workflow: {
        id: 'seed-wf-intake',
        name: 'RouteIntake',
        steps: [],
        returnValue: '',
        trigger: { event: 'formSubmission' },
      },
      action: {
        id: 'seed-action-intake',
        name: 'Intake acknowledgement',
        trigger: { event: 'formSubmission' },
        steps: [
          {
            type: 'siteAlert',
            severity: 'info',
            message:
              'Received. Note that contacting the firm does not create an ' +
              'attorney-client relationship until an engagement letter is signed.',
          },
        ],
        enabled: true,
      },
    },
    datasets: [
      {
        id: 'seed-team',
        name: 'Attorneys',
        fields: ['name', 'role', 'photo'],
        rows: [
          { name: 'Marisol Okonjo', role: 'Founding partner', photo: img('marisol', '240') },
          { name: 'Theo Brandt', role: 'Associate · Commercial', photo: img('theo', '240') },
        ],
      },
      {
        id: 'seed-practice-areas',
        name: 'Practice areas',
        fields: ['area', 'lead', 'engagement'],
        rows: [
          { area: 'Formation', lead: 'Marisol Okonjo', engagement: 'Flat fee' },
          { area: 'Commercial contracts', lead: 'Theo Brandt', engagement: 'Hourly or retainer' },
          { area: 'Employment', lead: 'Marisol Okonjo', engagement: 'Retainer' },
          { area: 'Disputes', lead: 'Marisol Okonjo', engagement: 'Hourly' },
        ],
      },
    ],
    collections: [
      {
        id: 'seed-blog',
        displayName: 'Insights',
        slug: 'insights',
        entries: [
          {
            id: 'seed-post-1',
            title: 'The three clauses founders sign without reading',
            slug: 'three-clauses-founders-miss',
            excerpt: 'Indemnity, assignment, and the survival clause that outlives the deal.',
            coverImage: img('contracts'),
            body:
              '## Uncapped indemnity\n\nIf the cap excludes indemnity, there is no cap.\n\n' +
              '## Assignment on change of control\n\nA silent clause is not a permissive one.\n\n' +
              '## Survival\n\nCheck what survives termination. It is usually more than you expect.',
          },
          {
            id: 'seed-post-2',
            title: 'Contractor or employee: the test that actually gets applied',
            slug: 'contractor-or-employee',
            excerpt: 'Control, not the title on the invoice.',
            coverImage: img('worker'),
            body:
              '## Behavioural control\n\nWho decides how and when the work happens?\n\n' +
              '## Financial control\n\nWho carries the tools, the risk, and the chance of loss?',
          },
          {
            id: 'seed-post-3',
            title: 'Do you need a DPA? A decision tree',
            slug: 'do-you-need-a-dpa',
            excerpt: 'Four questions, and only one of them is about Europe.',
            coverImage: img('privacy'),
            body:
              '## 1. Do you process personal data for someone else?\n\nIf no, stop.\n\n' +
              '## 2. Is any of it from the EEA, UK or California?\n\nThis widens the answer, ' +
              'it does not create it.',
          },
        ],
      },
    ],
    media: [
      { id: 'seed-media-1', fileName: 'office.jpg', folder: 'Firm', tags: ['office'], seed: 'lawoffice/1200/600' },
      { id: 'seed-media-2', fileName: 'library.jpg', folder: 'Firm', tags: ['office'], seed: 'lawlibrary/800/500' },
    ],
    leads: [
      { id: 'seed-lead-1', email: 'founder@example.com', source: 'form' },
      { id: 'seed-lead-2', email: 'ops@example.com', source: 'form' },
    ],
    siteMembers: [
      { id: 'seed-member-1', email: 'client-a@example.com', displayName: 'Fernwood Foods (client)' },
      { id: 'seed-member-2', email: 'client-b@example.com', displayName: 'Halyard Systems (client)' },
    ],
    services: [],
    commerce: null,
    reservations: null,
    marketing: {
      campaigns: [
        {
          id: 'seed-campaign-1',
          subject: 'Q3 contract review reminder',
          body: 'A short note on the renewals landing this quarter.',
          audience: 'contacts',
          stats: { recipients: 2, sent: 2, opens: 2, clicks: 1 },
        },
      ],
      email: {
        subject: 'Your engagement letter is ready',
        preheader: 'Signature requested',
        heading: 'Hello {{contact.firstName}},',
        button: 'Open the portal',
      },
      overlays: [],
      experiments: [],
    },
    // The migration table: a firm moving off a decade-old site is the
    // agency's most common first job, so this is where the redirects live.
    redirects: [
      { id: 'seed-redir-1', source: '/attorneys.html', destination: '/team', statusCode: 301, kind: 'exact', priority: 10 },
      { id: 'seed-redir-2', source: '/practice', destination: '/practice-areas', statusCode: 301, kind: 'prefix', priority: 20 },
      { id: 'seed-redir-3', source: '/blog', destination: '/insights', statusCode: 301, kind: 'prefix', priority: 30 },
      { id: 'seed-redir-4', source: '/news/(\\d+)/(.*)', destination: '/insights/$2', statusCode: 301, kind: 'regex', priority: 100 },
    ],
    orgData: {
      contacts: [
        { id: 'seed-contact-1', email: 'founder@example.com', name: 'Ines Delacroix', tags: ['client', 'formation'], sources: { form: true }, purchaseCents: 0 },
      ],
      segments: [{ id: 'seed-seg-1', name: 'Active engagements', tags: ['client'] }],
      lists: [{ id: 'seed-list-1', name: 'Insights subscribers' }],
      datasets: [
        {
          id: 'seed-orgdata-1',
          name: 'Matter log',
          model: { fields: [{ key: 'matter', label: 'Matter', type: 'text' }, { key: 'hours', label: 'Hours', type: 'number' }] },
        },
      ],
    },
    teamMember: { email: 'paralegal@example.com', role: 'editor' },
  },

  // ── 4. Restaurant — two locations, tables, retail ────────────────────────
  //
  // The only pack with RESERVATIONS and the only one with more than one
  // location, which is what makes the per-location pricing argument in
  // Touch 1 Variant B concrete: Square charges $49–149 per location, and
  // this fixture has two.
  restaurant: {
    id: 'restaurant',
    displayName: 'Casa Verde Cantina',
    subdomain: 'casa-verde',
    tagline: 'Masa, mezcal, and a patio',
    theme: {
      colorSchemes: scheme({
        primary: '#C1440E',
        secondary: '#2E7D32',
        tertiary: '#F2A65A',
        bg: '#FFF8F0',
        paper: '#FFFFFF',
        text: '#2B1A12',
      }),
      fonts: [{ family: 'Poppins', weights: [400, 600], source: 'google' }],
      typography: { fontFamily: 'Poppins, system-ui, sans-serif' },
      shape: { borderRadius: 20 },
    },
    home: {
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'South Congress · Round Rock',
          title: 'Masa ground here, every morning',
          body: 'Two rooms, one kitchen philosophy: short menu, long fermentations, cold beer.',
          cta: { label: 'Book a table', href: '/reserve' },
          sx: { py: 12, bgcolor: 'tint.tertiary' },
        },
        {
          type: 'listBand',
          heading: 'On the menu this week',
          items: [
            { primary: 'Suadero taco', secondary: 'Confit brisket, salsa verde cruda. $4.50' },
            { primary: 'Hongos con queso', secondary: 'Oyster mushrooms, Oaxaca, epazote. $12' },
            { primary: 'Pescado a la talla', secondary: 'Whole snapper, two salsas, for the table. $46' },
            { primary: 'Flan de cajeta', secondary: 'Goat’s milk caramel. $9' },
          ],
        },
        {
          type: 'featureGrid',
          heading: 'Also from us',
          items: [
            { title: 'Catering', body: 'Taquiza for 20 to 200, on-site plancha and a taquero.' },
            { title: 'Gift cards', body: 'Redeemable at either room, no expiry.' },
          ],
        },
      ],
    },
    variables: [
      { id: 'seed-site-name', name: 'siteName', type: 'text', value: 'Casa Verde Cantina' },
      { id: 'seed-tagline', name: 'tagline', type: 'text', value: 'Masa, mezcal, and a patio' },
      { id: 'seed-base-price', name: 'partySizeCap', type: 'number', value: '12' },
    ],
    logic: {
      fn: {
        id: 'seed-fn-deposit',
        name: 'PartyDeposit',
        parameters: [{ name: 'Guests', type: 'number', required: true }],
        variables: [{ name: 'Deposit', type: 'number' }],
        operations: [
          {
            if: { left: 'Guests', comparator: '>=', right: '8' },
            then: [{ set: 'Deposit', expression: 'Guests * 20' }],
            otherwise: [{ set: 'Deposit', expression: '0' }],
          },
        ],
        returnValue: 'Deposit',
      },
      workflow: {
        id: 'seed-wf-deposit',
        name: 'LargePartyQuote',
        steps: [{ functionName: 'PartyDeposit', args: ['partySizeCap'], resultName: 'deposit' }],
        returnValue: 'deposit',
        trigger: { event: 'formSubmission' },
      },
      action: null,
    },
    datasets: [
      {
        id: 'seed-team',
        name: 'Kitchen',
        fields: ['name', 'role', 'photo'],
        rows: [
          { name: 'Ximena Cortés', role: 'Chef / owner', photo: img('ximena', '240') },
          { name: 'Beto Alarcón', role: 'Masa & tortillas', photo: img('beto', '240') },
          { name: 'Rae Lindqvist', role: 'Bar', photo: img('rae', '240') },
        ],
      },
      {
        id: 'seed-menu',
        name: 'Menu',
        fields: ['label', 'href'],
        rows: [
          { label: 'Menu', href: '/menu' },
          { label: 'Reserve', href: '/reserve' },
          { label: 'Catering', href: '/catering' },
          { label: 'Locations', href: '/locations' },
        ],
      },
    ],
    collections: [
      {
        id: 'seed-blog',
        displayName: 'From the kitchen',
        slug: 'kitchen',
        entries: [
          {
            id: 'seed-post-1',
            title: 'We bought a mill',
            slug: 'we-bought-a-mill',
            excerpt: 'Nixtamal at 6am changes everything downstream.',
            coverImage: img('masa'),
            body:
              '## Why bother\n\nDry masa harina is a compromise. A **molino** is not.\n\n' +
              '- Soak overnight in cal\n- Rinse, grind warm\n- Press within the hour',
          },
        ],
      },
    ],
    media: [
      { id: 'seed-media-1', fileName: 'patio.jpg', folder: 'Rooms', tags: ['hero'], seed: 'patio/1200/600' },
      { id: 'seed-media-2', fileName: 'tacos.jpg', folder: 'Food', tags: ['menu'], seed: 'tacos/800/500' },
      { id: 'seed-media-3', fileName: 'bar.jpg', folder: 'Rooms', tags: ['bar'], seed: 'cantinabar/800/500' },
      { id: 'seed-media-4', fileName: 'masa.jpg', folder: 'Food', tags: ['story'], seed: 'masa/600/600' },
    ],
    leads: [
      { id: 'seed-lead-1', email: 'catering@example.com', source: 'form' },
      { id: 'seed-lead-2', email: 'privateevent@example.com', source: 'booking' },
    ],
    siteMembers: [],
    services: [],
    commerce: {
      categories: [{ id: 'seed-cat-1', name: 'Catering & retail', slug: 'catering-retail' }],
      collections: [
        { id: 'seed-coll-1', name: 'Gifts', slug: 'gifts', productIds: ['seed-prod-1', 'seed-prod-2'] },
      ],
      // Two locations: the per-location pricing argument, made countable.
      locations: [
        { id: 'seed-loc-1', name: 'South Congress' },
        { id: 'seed-loc-2', name: 'Round Rock' },
      ],
      products: [
        {
          id: 'seed-prod-1',
          name: 'Taquiza catering package',
          slug: 'taquiza-catering',
          description: 'On-site plancha, taquero, three meats, all the salsas. Per guest.',
          categoryIds: ['seed-cat-1'],
          tags: ['catering'],
          imageSeed: 'taquiza/800/800',
          priceUsd: 28,
          inventory: 200,
          options: [{ name: 'Party size', values: ['20–49', '50–99', '100+'] }],
          variants: [
            { id: 'v-s', options: { 'Party size': '20–49' }, priceUsd: 28, inventoryByLocation: { 'seed-loc-1': 100, 'seed-loc-2': 100 } },
            { id: 'v-m', options: { 'Party size': '50–99' }, priceUsd: 25, inventoryByLocation: { 'seed-loc-1': 100, 'seed-loc-2': 100 } },
            { id: 'v-l', options: { 'Party size': '100+' }, priceUsd: 22, inventoryByLocation: { 'seed-loc-1': 100, 'seed-loc-2': 100 } },
          ],
          lowStockThreshold: 10,
        },
        {
          id: 'seed-prod-2',
          name: 'Salsa macha, two jars',
          slug: 'salsa-macha',
          description: 'Peanut, sesame, morita. Ships cold in Texas summer.',
          categoryIds: ['seed-cat-1'],
          tags: ['retail'],
          imageSeed: 'salsa/800/800',
          priceUsd: 18,
          inventory: 60,
          variants: [{ id: 'v-default', options: {}, priceUsd: 18, inventoryByLocation: { 'seed-loc-1': 40, 'seed-loc-2': 20 } }],
          lowStockThreshold: 12,
        },
      ],
      orders: [
        {
          id: 'seed-order-1',
          orderNumber: 2041,
          email: 'catering@example.com',
          status: 'paid',
          items: [
            { productId: 'seed-prod-1', variantId: 'v-m', name: 'Taquiza catering — 50–99', quantity: 60, unitPriceCents: 2500 },
          ],
          totals: { itemsCents: 150000, shippingCents: 0, taxCents: 12375, discountCents: 7500, totalCents: 154875, feeCents: 4200 },
        },
      ],
      discounts: [{ id: 'seed-disc-1', name: 'Weekday catering 5%', type: 'automatic', percentOff: 5, active: true }],
      coupons: [{ id: 'seed-coupon-1', code: 'PATIO10', percentOff: 10, active: true, redemptions: 11 }],
      giftCards: [{ id: 'seed-gift-1', code: 'GIFT-CV-0042', balanceCents: 7500, initialCents: 10000, active: true }],
      reviews: [
        {
          id: 'seed-review-1',
          productId: 'seed-prod-2',
          rating: 5,
          title: 'I put this on everything',
          body: 'Two jars did not last the week.',
          authorName: 'Marta L.',
        },
      ],
    },
    reservations: {
      units: [
        { id: 'seed-unit-1', name: 'Patio table (up to 6)', nightlyRateCents: 0, depositCents: 0 },
        { id: 'seed-unit-2', name: 'Chef’s counter (2)', nightlyRateCents: 0, depositCents: 2500 },
        { id: 'seed-unit-3', name: 'Back room (up to 24)', nightlyRateCents: 0, depositCents: 20000 },
      ],
      bookings: [
        {
          id: 'seed-resv-1',
          unitId: 'seed-unit-3',
          email: 'privateevent@example.com',
          startDay: '2026-09-12',
          endDay: '2026-09-12',
          nights: 1,
          status: 'confirmed',
          totalCents: 20000,
        },
        {
          id: 'seed-resv-2',
          unitId: 'seed-unit-2',
          email: 'guest@example.com',
          startDay: '2026-09-05',
          endDay: '2026-09-05',
          nights: 1,
          status: 'confirmed',
          totalCents: 2500,
        },
      ],
    },
    marketing: {
      campaigns: [
        {
          id: 'seed-campaign-1',
          subject: 'Snapper is back on Thursday',
          body: 'Whole pescado a la talla, while the fish holds.',
          audience: 'leads',
          stats: { recipients: 2, sent: 2, opens: 2, clicks: 1 },
        },
      ],
      email: {
        subject: 'Your table on {{booking.date}}',
        preheader: 'Parking, patio rules, and the large-party deposit',
        heading: 'See you Thursday, {{contact.firstName}}',
        button: 'View the menu',
      },
      overlays: [
        { id: 'seed-overlay-bar', name: 'Taco Tuesday bar', kind: 'bar', bar: { text: 'Taco Tuesday — $3 suadero all night', link: '/menu' }, enabled: true },
        { id: 'seed-overlay-popup', name: 'Catering enquiry popup', kind: 'popup', popup: { title: 'Feeding a crowd?', body: 'Taquiza packages from 20 guests.' }, enabled: true, frequency: 'oncePerVisitor' },
      ],
      experiments: [
        {
          id: 'seed-exp-1',
          name: 'Reserve button placement',
          target: 'section',
          variants: [{ id: 'a', name: 'Hero' }, { id: 'b', name: 'Sticky footer' }],
        },
      ],
    },
    redirects: [
      { id: 'seed-redir-1', source: '/menu.pdf', destination: '/menu', statusCode: 301, kind: 'exact', priority: 10 },
      { id: 'seed-redir-2', source: '/opentable', destination: '/reserve', statusCode: 302, kind: 'exact', priority: 20 },
    ],
    orgData: {
      contacts: [
        { id: 'seed-contact-1', email: 'catering@example.com', name: 'Priyanka Shah', tags: ['customer', 'catering'], sources: { order: true }, purchaseCents: 154875 },
      ],
      segments: [{ id: 'seed-seg-1', name: 'Catering buyers', tags: ['catering'] }],
      lists: [{ id: 'seed-list-1', name: 'Weekly specials' }],
      datasets: [
        {
          id: 'seed-orgdata-1',
          name: 'Waste log',
          model: { fields: [{ key: 'item', label: 'Item', type: 'text' }, { key: 'lbs', label: 'Pounds', type: 'number' }] },
        },
      ],
    },
    teamMember: { email: 'gm@example.com', role: 'admin' },
  },

  // ── 5. Fitness studio — memberships and gated video ──────────────────────
  //
  // Where the recurring-revenue surfaces live: two subscription products, a
  // digital program with gated videos, and site members. It inherited the
  // digital "Trail Riding Program" the bakery used to carry, which is the
  // brand it always belonged to.
  fitness: {
    id: 'fitness',
    displayName: 'Ironleaf Strength',
    subdomain: 'ironleaf',
    tagline: 'Barbells, coached',
    theme: {
      colorSchemes: scheme({
        primary: '#111827',
        secondary: '#A3E635',
        tertiary: '#EF4444',
        bg: '#F5F5F4',
        paper: '#FFFFFF',
        text: '#0B0F19',
      }),
      fonts: [{ family: 'Barlow Condensed', weights: [500, 700], source: 'google' }],
      typography: {
        fontFamily: '"Barlow Condensed", Impact, sans-serif',
        variants: {
          h2: { textTransform: 'uppercase', letterSpacing: '0.02em', fontWeight: 700 },
          button: { textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.08em' },
        },
      },
      shape: { borderRadius: 0 },
    },
    home: {
      sections: [
        {
          type: 'heroCentered',
          eyebrow: 'Coached strength · East side',
          title: 'Lift heavy. Get coached.',
          body: 'Small groups, a written programme, and someone watching your third rep.',
          cta: { label: 'Start the two-week trial', href: '/trial' },
          sx: { py: 12 },
        },
        {
          type: 'statBand',
          stats: [
            { value: '6:1', label: 'Members per coach' },
            { value: '14', label: 'Classes a week' },
            { value: '2 wks', label: 'Free trial' },
          ],
          sx: { bgcolor: 'tint.secondary' },
        },
        {
          type: 'featureGrid',
          heading: 'Membership',
          items: [
            { title: 'Unlimited', body: '$149/mo. Every class, programme included, no contract.' },
            { title: 'Three a week', body: '$99/mo. The one most people actually use.' },
            { title: 'Programme only', body: '$39/mo. Train anywhere, gated video library.' },
          ],
        },
      ],
    },
    variables: [
      { id: 'seed-site-name', name: 'siteName', type: 'text', value: 'Ironleaf Strength' },
      { id: 'seed-tagline', name: 'tagline', type: 'text', value: 'Barbells, coached' },
      { id: 'seed-base-price', name: 'dropInPrice', type: 'number', value: '25' },
    ],
    logic: {
      fn: {
        id: 'seed-fn-pack',
        name: 'ClassPackPrice',
        parameters: [
          { name: 'Classes', type: 'number', required: true },
          { name: 'DropIn', type: 'number', required: false },
        ],
        variables: [{ name: 'Total', type: 'number' }],
        operations: [
          {
            if: { left: 'Classes', comparator: '>=', right: '10' },
            then: [{ set: 'Total', expression: 'Classes * DropIn * 0.8' }],
            otherwise: [{ set: 'Total', expression: 'Classes * DropIn' }],
          },
        ],
        returnValue: 'Total',
      },
      workflow: {
        id: 'seed-wf-pack',
        name: 'TenPackQuote',
        steps: [{ functionName: 'ClassPackPrice', args: ['10', 'dropInPrice'], resultName: 'packPrice' }],
        returnValue: 'packPrice',
        trigger: { event: 'formSubmission' },
      },
      action: {
        id: 'seed-action-trial',
        name: 'Trial signup alert',
        trigger: { event: 'formSubmission' },
        steps: [
          { type: 'siteAlert', severity: 'success', message: 'You are in — your first session is on us.' },
        ],
        enabled: true,
      },
    },
    datasets: [
      {
        id: 'seed-team',
        name: 'Coaches',
        fields: ['name', 'role', 'photo'],
        rows: [
          { name: 'Dez Marchetti', role: 'Head coach · CSCS', photo: img('dez', '240') },
          { name: 'Hana Ito', role: 'Olympic lifting', photo: img('hana', '240') },
        ],
      },
      {
        id: 'seed-schedule',
        name: 'Class schedule',
        fields: ['day', 'time', 'class', 'coach'],
        rows: [
          { day: 'Monday', time: '06:00', class: 'Strength A', coach: 'Dez' },
          { day: 'Monday', time: '17:30', class: 'Strength A', coach: 'Hana' },
          { day: 'Wednesday', time: '06:00', class: 'Strength B', coach: 'Dez' },
          { day: 'Saturday', time: '09:00', class: 'Open barbell', coach: 'Hana' },
        ],
      },
    ],
    collections: [
      {
        id: 'seed-blog',
        displayName: 'Training notes',
        slug: 'notes',
        entries: [
          {
            id: 'seed-post-1',
            title: 'Why we programme in blocks, not sessions',
            slug: 'blocks-not-sessions',
            excerpt: 'Progress is a twelve-week story, not a Tuesday.',
            coverImage: img('barbell'),
            body:
              '## Accumulation\n\nVolume up, intensity moderate. Four weeks.\n\n' +
              '## Intensification\n\nVolume down, load up. Three weeks.\n\n' +
              '## Realisation\n\nTest. One week. Then rest, properly.',
          },
          {
            id: 'seed-post-2',
            title: 'The two-week trial, honestly described',
            slug: 'the-trial',
            excerpt: 'What it includes, what it does not, and who it is wrong for.',
            coverImage: img('gymfloor'),
            body:
              '## Included\n\nEvery class, the programme, and a movement screen.\n\n' +
              '## Not included\n\nNutrition coaching, and we will not sell you supplements.',
          },
        ],
      },
    ],
    media: [
      { id: 'seed-media-1', fileName: 'floor.jpg', folder: 'Gym', tags: ['hero'], seed: 'gymfloor/1200/600' },
      { id: 'seed-media-2', fileName: 'rack.jpg', folder: 'Gym', tags: ['equipment'], seed: 'rack/800/500' },
      { id: 'seed-media-3', fileName: 'coach.jpg', folder: 'Coaches', tags: ['team'], seed: 'dez/600/600' },
    ],
    leads: [
      { id: 'seed-lead-1', email: 'trial@example.com', source: 'signup' },
      { id: 'seed-lead-2', email: 'corporate@example.com', source: 'form' },
    ],
    siteMembers: [
      { id: 'seed-member-1', email: 'member-a@example.com', displayName: 'Alex Fenn' },
      { id: 'seed-member-2', email: 'member-b@example.com', displayName: 'Ruth Oyelaran' },
      { id: 'seed-member-3', email: 'member-c@example.com', displayName: 'Kai Brennan' },
    ],
    services: [
      {
        id: 'seed-svc-1',
        name: 'Movement screen',
        durationMinutes: 45,
        priceUsd: 0,
        description: 'Free, and required before your first barbell class.',
        timezone: 'America/Chicago',
        windows: { 2: [{ start: 660, end: 1140 }], 4: [{ start: 660, end: 1140 }] },
      },
      {
        id: 'seed-svc-2',
        name: 'Personal training hour',
        durationMinutes: 60,
        priceUsd: 95,
        description: 'One-to-one, member rate applies automatically.',
        timezone: 'America/Chicago',
        windows: { 1: [{ start: 420, end: 1200 }], 3: [{ start: 420, end: 1200 }], 5: [{ start: 420, end: 1020 }] },
      },
    ],
    commerce: {
      categories: [{ id: 'seed-cat-1', name: 'Memberships', slug: 'memberships' }],
      collections: [
        { id: 'seed-coll-1', name: 'Popular', slug: 'popular', productIds: ['seed-prod-1', 'seed-prod-2'] },
      ],
      locations: [{ id: 'seed-loc-1', name: 'East side studio' }],
      products: [
        {
          id: 'seed-prod-1',
          name: 'Studio membership',
          slug: 'studio-membership',
          description: 'Unlimited or three-a-week, cancel any time.',
          categoryIds: ['seed-cat-1'],
          tags: ['membership', 'subscription'],
          imageSeed: 'membership/800/800',
          priceUsd: 149,
          options: [{ name: 'Plan', values: ['Unlimited', 'Three a week'] }],
          variants: [
            { id: 'v-unlimited', options: { Plan: 'Unlimited' }, priceUsd: 149 },
            { id: 'v-three', options: { Plan: 'Three a week' }, priceUsd: 99 },
          ],
          subscription: { interval: 'month', trialDays: 14 },
        },
        {
          id: 'seed-prod-2',
          name: 'Trail Riding Program (digital)',
          slug: 'trail-riding-program',
          description: 'Downloadable training plan with monthly updates and video.',
          tags: ['digital', 'training'],
          imageSeed: 'guide/800/800',
          priceUsd: 39,
          variants: [{ id: 'v-default', options: {}, priceUsd: 39 }],
          digitalFiles: [{ url: 'https://example.com/program.pdf', fileName: 'program.pdf', version: '1' }],
          subscription: { interval: 'month', trialDays: 7 },
          gatedVideos: [
            { title: 'Week 1 — squat pattern', url: 'https://example.com/w1.m3u8' },
            { title: 'Week 2 — hinge pattern', url: 'https://example.com/w2.m3u8' },
          ],
        },
      ],
      orders: [
        {
          id: 'seed-order-1',
          orderNumber: 3307,
          email: 'member-a@example.com',
          status: 'paid',
          items: [
            { productId: 'seed-prod-1', variantId: 'v-unlimited', name: 'Studio membership — Unlimited', quantity: 1, unitPriceCents: 14900 },
          ],
          totals: { itemsCents: 14900, shippingCents: 0, taxCents: 1229, discountCents: 0, totalCents: 16129, feeCents: 498 },
        },
      ],
      discounts: [{ id: 'seed-disc-1', name: 'Annual prepay 15%', type: 'automatic', percentOff: 15, active: true }],
      coupons: [{ id: 'seed-coupon-1', code: 'BRINGAFRIEND', percentOff: 50, active: true, redemptions: 7 }],
      giftCards: [],
      reviews: [
        {
          id: 'seed-review-1',
          productId: 'seed-prod-1',
          rating: 5,
          title: 'First gym that programmed for me',
          body: 'Added 40lb to my deadlift in a block.',
          authorName: 'Ruth O.',
        },
      ],
    },
    reservations: null,
    marketing: {
      campaigns: [
        {
          id: 'seed-campaign-1',
          subject: 'New block starts Monday',
          body: 'Twelve weeks, testing in week eight.',
          audience: 'members',
          stats: { recipients: 3, sent: 3, opens: 3, clicks: 2 },
        },
      ],
      email: {
        subject: 'Welcome to Ironleaf, {{contact.firstName}}',
        preheader: 'Book your movement screen',
        heading: 'You are in, {{contact.firstName}}',
        button: 'Book the screen',
      },
      overlays: [
        { id: 'seed-overlay-popup', name: 'Trial popup', kind: 'popup', popup: { title: 'Two weeks, free', body: 'Every class, no card up front.' }, enabled: true, frequency: 'oncePerVisitor' },
      ],
      experiments: [
        {
          id: 'seed-exp-1',
          name: 'Trial length copy',
          target: 'section',
          variants: [{ id: 'a', name: 'Two weeks free' }, { id: 'b', name: 'First month half price' }],
        },
      ],
    },
    redirects: [
      { id: 'seed-redir-1', source: '/join', destination: '/trial', statusCode: 302, kind: 'exact', priority: 10 },
      { id: 'seed-redir-2', source: '/wod', destination: '/notes', statusCode: 301, kind: 'prefix', priority: 40 },
    ],
    orgData: {
      contacts: [
        { id: 'seed-contact-1', email: 'member-a@example.com', name: 'Alex Fenn', tags: ['member', 'unlimited'], sources: { order: true, newsletter: true }, purchaseCents: 16129 },
      ],
      segments: [{ id: 'seed-seg-1', name: 'Unlimited members', tags: ['unlimited'] }],
      lists: [{ id: 'seed-list-1', name: 'Block announcements' }],
      datasets: [
        {
          id: 'seed-orgdata-1',
          name: 'Attendance log',
          model: { fields: [{ key: 'class', label: 'Class', type: 'text' }, { key: 'attended', label: 'Attended', type: 'number' }] },
        },
      ],
    },
    teamMember: { email: 'coach@example.com', role: 'editor' },
  },
}

/** Brand ids, in the order they read best in a switcher. */
export const BRAND_IDS = Object.keys(BRANDS)

/** The historical default — an unflagged run must not change what it seeds. */
export const DEFAULT_BRAND = 'bakery'

/**
 * The four-site agency demo (`Design-Partner-Outreach.md` §4, minutes 3–10).
 *
 * Four visibly different clients under one org is the shape the Agency ICP
 * needs to see; the bakery is deliberately NOT in it, because the default
 * host is already seeded with it and a fifth site adds no argument.
 */
export const AGENCY_DEMO_BRANDS = ['dental', 'legal', 'restaurant', 'fitness']

/** Resolves a brand id, failing loudly rather than silently seeding the default. */
export function resolveBrand(id) {
  const brand = BRANDS[id]
  if (!brand) {
    throw new Error(
      `Unknown brand "${id}". Known brands: ${BRAND_IDS.join(', ')}`,
    )
  }
  return brand
}
