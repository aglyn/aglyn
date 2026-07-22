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

// Server entry, not the barrel: this file is now reached from an API route
// (the seed), and `@aglyn/aglyn` pulls React contexts into the RSC graph.
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/server'

/**
 * First-party starter definitions (AGL-78/79), now SEED INPUT ONLY
 * (AGL-687).
 *
 * These used to be rendered straight into the gallery and instantiated from
 * code, which made a starter a second kind of template: no version history,
 * no placeholders, no editor, changeable only by shipping a release. Now
 * they are seeded into each host's own template library as ordinary
 * `hosts/{hostId}/templates` documents (see
 * `utils/server/seed-starter-templates.ts` for why copy-on-use rather than a
 * global read-only collection), and nothing reads this file at render time.
 *
 * Node ids stay template-local (unique within each screen's version doc);
 * `createPageFromTemplate` re-keys screen and version ids at instantiation.
 *
 * PERSISTED IDENTIFIERS: `StarterTemplate.id`, `StarterTemplateScreen.key`
 * and every node id below appear in stored documents (seeded template doc
 * ids are derived from the first two). They must never be renamed.
 */
export interface StarterTemplateScreen {
  /**
   * Stable, starter-local key. Part of the seeded document id, so it is a
   * persisted identifier — never rename one.
   */
  key: string
  displayName: string
  description?: string
  /** Routing-map slug ('' = home). */
  slug: string
  seo?: { title?: string; description?: string }
  /** Flat node map including the canvas root. */
  nodes: Record<string, any>
}

export interface StarterTemplate {
  id: string
  displayName: string
  description: string
  category: string
  screens: StarterTemplateScreen[]
}

/** A seeded starter template document, keyed by its deterministic id. */
export interface StarterTemplateDoc {
  id: string
  data: Record<string, unknown>
}

/**
 * Deterministic document id for a seeded starter screen (AGL-687).
 *
 * Derived from the starter id and the screen key — never randomly generated
 * — so re-running the seed addresses the same documents instead of stacking
 * duplicate copies of every starter on every run.
 */
export function starterTemplateDocId(
  starterId: string,
  screenKey: string,
): string {
  return `starter-${starterId}-${screenKey}`
}

/**
 * Expands one starter into the template documents it seeds as.
 *
 * One page template per screen, matching what a marketplace install of a
 * multi-screen site template already produces (AGL-669) — the alternative,
 * a bespoke multi-page template shape, would be a third lifecycle on top of
 * the two this issue exists to merge. The bundle's name/description/order
 * ride `source` so the gallery can still present the starter as one card.
 */
export function buildStarterTemplateDocs(
  starter: StarterTemplate,
): StarterTemplateDoc[] {
  return starter.screens.map((screen, index) => ({
    id: starterTemplateDocId(starter.id, screen.key),
    data: {
      kind: 'page',
      displayName: screen.displayName,
      // Only the screen's own description, never the starter blurb: a
      // template's `description` is carried onto the page it creates, and a
      // screen description is the live site's meta-description fallback.
      // The bundle blurb lives on `source.starterDescription` instead.
      ...(screen.description ? { description: screen.description } : {}),
      category: starter.category,
      ...(screen.slug ? { slug: screen.slug } : {}),
      ...(screen.seo ? { seo: screen.seo } : {}),
      nodes: screen.nodes,
      source: {
        type: 'starter',
        starterId: starter.id,
        starterName: starter.displayName,
        starterDescription: starter.description,
        starterOrder: index,
      },
    },
  }))
}

/** Every document the starter seed is responsible for, in bundle order. */
export function buildAllStarterTemplateDocs(): StarterTemplateDoc[] {
  return STARTER_TEMPLATES.flatMap(buildStarterTemplateDocs)
}

type NodeSpec = {
  id: string
  componentId: string
  /** Bundle owning the component; defaults to 'mui' (AGL-300). */
  pluginId?: string
  props?: Record<string, unknown>
  children?: NodeSpec[]
}

/** Builds the flat, persisted node map from a nested spec. */
function buildNodes(children: NodeSpec[]): Record<string, any> {
  const map: Record<string, any> = {
    [CANVAS_ROOT_ELEMENT_ID]: {
      $id: CANVAS_ROOT_ELEMENT_ID,
      componentId: 'div',
      nodes: children.map((child) => child.id),
    },
  }
  const walk = (spec: NodeSpec, parentId: string) => {
    map[spec.id] = {
      $id: spec.id,
      componentId: spec.componentId,
      pluginId: spec.pluginId ?? 'mui',
      parentId,
      props: spec.props ?? {},
      nodes: (spec.children ?? []).map((child) => child.id),
    }
    for (const child of spec.children ?? []) walk(child, spec.id)
  }
  for (const child of children) walk(child, CANVAS_ROOT_ELEMENT_ID)
  return map
}

const text = (
  id: string,
  variant: string,
  children: string,
  extra?: Record<string, unknown>,
): NodeSpec => ({
  id,
  componentId: 'muiTypography',
  props: { variant, children, ...extra },
})

const heroSection = (prefix: string, headline: string, tagline: string) => ({
  id: `${prefix}hero`,
  componentId: 'muiStack',
  props: { spacing: 2, sx: { py: 10, px: 4, alignItems: 'center' } },
  children: [
    text(`${prefix}heroTitle`, 'h2', headline, { align: 'center' }),
    text(`${prefix}heroSub`, 'h6', tagline, { align: 'center' }),
    {
      id: `${prefix}heroCta`,
      componentId: 'muiButton',
      props: { variant: 'contained', size: 'large', children: 'Get in touch' },
    },
  ],
})

const featureColumn = (id: string, title: string, body: string): NodeSpec => ({
  id,
  componentId: 'muiStack',
  props: { spacing: 1, sx: { flex: 1, p: 2 } },
  children: [text(`${id}T`, 'h5', title), text(`${id}B`, 'body1', body)],
})

const contactForm = (prefix: string): NodeSpec => ({
  id: `${prefix}form`,
  componentId: 'form',
  props: {
    formName: 'Contact',
    submitLabel: 'Send message',
    successMessage: 'Thanks — we will get back to you soon.',
  },
  children: [
    {
      id: `${prefix}fName`,
      componentId: 'formField',
      props: { fieldName: 'name', label: 'Name', required: true },
    },
    {
      id: `${prefix}fEmail`,
      componentId: 'formField',
      props: {
        fieldName: 'email',
        label: 'Email',
        fieldType: 'email',
        required: true,
      },
    },
    {
      id: `${prefix}fMessage`,
      componentId: 'formField',
      props: {
        fieldName: 'message',
        label: 'Message',
        fieldType: 'textarea',
        required: true,
      },
    },
  ],
})


const commerceBlock = (
  id: string,
  componentId: string,
  props?: Record<string, unknown>,
): NodeSpec => ({ id, componentId, pluginId: 'commerce', props })

/** Shared screens for the shop starters (AGL-300). */
function shopScreens(prefix: string, digital: boolean): StarterTemplateScreen[] {
  return [
    {
      key: 'home',
      displayName: 'Home',
      slug: '',
      seo: {
        title: digital ? 'Digital shop' : 'Shop',
        description: 'Browse our products.',
      },
      nodes: buildNodes([
        heroSection(
          `${prefix}h_`,
          digital ? 'Downloads that level you up' : 'Gear you can trust',
          digital
            ? 'Instant delivery. Lifetime updates.'
            : 'Quality parts, shipped fast.',
        ),
        commerceBlock(`${prefix}h_grid`, 'product-grid', {
          source: 'all',
          sort: 'newest',
          columns: 3,
          maxItems: 6,
        }),
        commerceBlock(`${prefix}h_news`, 'newsletter-signup', {
          heading: 'Get updates and offers',
        }),
      ]),
    },
    {
      key: 'shop',
      displayName: 'Shop',
      slug: 'shop',
      seo: { title: 'All products' },
      nodes: buildNodes([
        text(`${prefix}s_title`, 'h3', 'All products'),
        commerceBlock(`${prefix}s_grid`, 'product-grid', {
          source: 'all',
          columns: 4,
          showFilters: true,
        }),
      ]),
    },
    {
      key: 'product',
      displayName: 'Product page',
      slug: 'product',
      seo: { title: 'Product' },
      nodes: buildNodes([
        commerceBlock(`${prefix}p_detail`, 'product-detail', {}),
      ]),
    },
    {
      key: 'cart',
      displayName: 'Cart',
      slug: 'cart',
      seo: { title: 'Your cart' },
      nodes: buildNodes([
        text(`${prefix}c_title`, 'h3', 'Your cart'),
        commerceBlock(`${prefix}c_cart`, 'cart', {
          variant: 'inline',
          showCoupon: true,
        }),
      ]),
    },
    {
      key: 'account',
      displayName: 'Account',
      slug: 'account',
      seo: { title: 'Your account' },
      nodes: buildNodes([
        commerceBlock(`${prefix}a_account`, 'customer-account', {
          signedOutHeading: 'Your account',
        }),
      ]),
    },
  ]
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'landing',
    displayName: 'Landing Page',
    description:
      'One-page launch site: hero, three selling points, and a contact form.',
    category: 'Marketing',
    screens: [
      {
        key: 'landing',
        displayName: 'Landing',
        slug: 'landing',
        seo: {
          title: 'Welcome',
          description: 'Everything you need to know, on one page.',
        },
        nodes: buildNodes([
          heroSection(
            'l_',
            'A headline that sells your idea',
            'One clear sentence about the value you deliver.',
          ),
          {
            id: 'l_features',
            componentId: 'muiStack',
            props: { direction: 'row', spacing: 2, sx: { px: 4, py: 6 } },
            children: [
              featureColumn(
                'l_f1',
                'Fast',
                'Explain the first reason customers pick you.',
              ),
              featureColumn(
                'l_f2',
                'Simple',
                'Explain the second reason customers pick you.',
              ),
              featureColumn(
                'l_f3',
                'Reliable',
                'Explain the third reason customers pick you.',
              ),
            ],
          },
          {
            id: 'l_contact',
            componentId: 'muiStack',
            props: { spacing: 2, sx: { px: 4, py: 6, maxWidth: 560 } },
            children: [
              text('l_contactTitle', 'h4', 'Get in touch'),
              contactForm('l_'),
            ],
          },
        ]),
      },
    ],
  },
  {
    id: 'business',
    displayName: 'Business',
    description:
      'Company site: home with services, an about page, and a contact page.',
    category: 'Business',
    screens: [
      {
        key: 'home',
        displayName: 'Business Home',
        slug: 'home',
        seo: { title: 'Home' },
        nodes: buildNodes([
          heroSection(
            'b_',
            'Your business, done right',
            'Tell visitors what you do and who you do it for.',
          ),
          {
            id: 'b_services',
            componentId: 'muiStack',
            props: { direction: 'row', spacing: 2, sx: { px: 4, py: 6 } },
            children: [
              featureColumn('b_s1', 'Service one', 'Describe this service.'),
              featureColumn('b_s2', 'Service two', 'Describe this service.'),
              featureColumn('b_s3', 'Service three', 'Describe this service.'),
            ],
          },
        ]),
      },
      {
        key: 'about-us',
        displayName: 'About Us',
        slug: 'about-us',
        seo: { title: 'About us' },
        nodes: buildNodes([
          {
            id: 'a_wrap',
            componentId: 'muiStack',
            props: { spacing: 2, sx: { px: 4, py: 8, maxWidth: 720 } },
            children: [
              text('a_title', 'h3', 'About us'),
              text(
                'a_body',
                'body1',
                'Share your story: how you started, what you believe, and ' +
                  'why customers trust you.',
              ),
            ],
          },
        ]),
      },
      {
        key: 'contact-us',
        displayName: 'Contact Us',
        slug: 'contact-us',
        seo: { title: 'Contact' },
        nodes: buildNodes([
          {
            id: 'c_wrap',
            componentId: 'muiStack',
            props: { spacing: 2, sx: { px: 4, py: 8, maxWidth: 560 } },
            children: [
              text('c_title', 'h3', 'Contact us'),
              text(
                'c_body',
                'body1',
                'Questions or quotes — send a message and we reply within ' +
                  'one business day.',
              ),
              contactForm('c_'),
            ],
          },
        ]),
      },
    ],
  },
  {
    id: 'portfolio',
    displayName: 'Portfolio',
    description: 'Personal portfolio: intro, work grid, and contact form.',
    category: 'Personal',
    screens: [
      {
        key: 'portfolio',
        displayName: 'Portfolio',
        slug: 'portfolio',
        seo: { title: 'Portfolio' },
        nodes: buildNodes([
          heroSection(
            'p_',
            'Hi, I make things',
            'Designer / developer / photographer — introduce yourself here.',
          ),
          {
            id: 'p_grid',
            componentId: 'muiStack',
            props: { direction: 'row', spacing: 2, sx: { px: 4, py: 6 } },
            children: [
              {
                id: 'p_img1',
                componentId: 'image',
                props: { alt: 'Project one', height: '220px' },
              },
              {
                id: 'p_img2',
                componentId: 'image',
                props: { alt: 'Project two', height: '220px' },
              },
              {
                id: 'p_img3',
                componentId: 'image',
                props: { alt: 'Project three', height: '220px' },
              },
            ],
          },
          {
            id: 'p_contact',
            componentId: 'muiStack',
            props: { spacing: 2, sx: { px: 4, py: 6, maxWidth: 560 } },
            children: [
              text('p_contactTitle', 'h4', 'Work with me'),
              contactForm('p_'),
            ],
          },
        ]),
      },
    ],
  },
  {
    id: 'physical-shop',
    displayName: 'Shop (physical products)',
    description:
      'Storefront starter: home with featured products, filterable shop, ' +
      'product page, cart, and customer accounts. After applying, set the ' +
      'Product page as the product template in Store settings.',
    category: 'Commerce',
    screens: shopScreens('ps_', false),
  },
  {
    id: 'digital-shop',
    displayName: 'Shop (digital products)',
    description:
      'Digital storefront starter: downloads-focused home, shop, product ' +
      'page, cart, and accounts with a newsletter capture. Set the Product ' +
      'page as the product template in Store settings after applying.',
    category: 'Commerce',
    screens: shopScreens('ds_', true),
  },
]
