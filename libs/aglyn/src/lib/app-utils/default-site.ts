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
import type { HostTheme } from '@aglyn/shared-data-types'
import type { NodeInteraction } from './node-interactions'
import { nodeInteractionSelector } from './node-interactions'
import { SCREEN_ROOT_PATH } from './screen-route'
import {
  buildStarterNodes as buildNodes,
  starterSection as container,
  starterText as text,
  type StarterNodeSpec as NodeSpec,
  type StarterTemplateScreen,
} from './starter-template-nodes'

/**
 * The website every new site is born with (AGL-3497).
 *
 * It used to be one heading and "our new website is on its way" (AGL-3408):
 * a site that answered `/` instead of 404ing, and showed an owner nothing of
 * what the product does. Now a site starts as a real one — a shared header
 * and footer, a home page with the sections an ordinary business site has,
 * photos, a theme and its SEO — and each section says, to the owner, how to
 * make it theirs.
 *
 * It is published and open to search engines from the first request, as every
 * new site's home page has been since AGL-3408.
 *
 * The photos ship with the apps under `/_static/starter/` (see the CREDITS
 * file there). A published page's `img-src` admits only its own origin and
 * the media CDN, so a stock-photo URL would be blocked, and there is no
 * platform-wide media scope to hold them. Both the tenant and the console
 * serve the same files at the same path, so they draw on the live site and in
 * the Besigner alike.
 *
 * PERSISTED IDENTIFIERS: every node id below is stored on every new site.
 */

/** Where the starter photos are served from, on every tenant and in the console. */
export const DEFAULT_SITE_IMAGE_BASE = '/_static/starter'

/** The starter photos, with the sizes the files actually are. */
export const DEFAULT_SITE_IMAGES = {
  hero: { src: `${DEFAULT_SITE_IMAGE_BASE}/hero-team.jpg`, width: 1600, height: 1067 },
  about: { src: `${DEFAULT_SITE_IMAGE_BASE}/about-owner.jpg`, width: 1600, height: 900 },
  desk: { src: `${DEFAULT_SITE_IMAGE_BASE}/gallery-desk.jpg`, width: 1600, height: 1068 },
  plants: { src: `${DEFAULT_SITE_IMAGE_BASE}/gallery-plants.jpg`, width: 1200, height: 900 },
  craft: { src: `${DEFAULT_SITE_IMAGE_BASE}/gallery-craft.jpg`, width: 1600, height: 1065 },
} as const

/** The node a call to action scrolls to, and the one the features link names. */
export const DEFAULT_HOME_CONTACT_SECTION_ID = 'dh_contactSection'
export const DEFAULT_HOME_FEATURES_SECTION_ID = 'dh_featuresSection'

/** Room left above a scrolled-to section for the sticky header. */
const HEADER_OFFSET_PX = 72

/**
 * Icon outlines, from Material Design Icons. Written in rather than looked up:
 * a published page reads an icon's stored path and never loads the catalog
 * (AGL-1212), and the catalog is the whole icon set.
 */
const ICONS = {
  'pencil-outline':
    'M14.06,9L15,9.94L5.92,19H5V18.08L14.06,9M17.66,3C17.41,3 17.15,3.1 16.96,3.29L15.13,5.12L18.88,8.87L20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18.17,3.09 17.92,3 17.66,3M14.06,6.19L3,17.25V21H6.75L17.81,9.94L14.06,6.19Z',
  'palette-outline':
    'M12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2C17.5,2 22,6 22,11A6,6 0 0,1 16,17H14.2C13.9,17 13.7,17.2 13.7,17.5C13.7,17.6 13.8,17.7 13.8,17.8C14.2,18.3 14.4,18.9 14.4,19.5C14.5,20.9 13.4,22 12,22M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C12.3,20 12.5,19.8 12.5,19.5C12.5,19.3 12.4,19.2 12.4,19.1C12,18.6 11.8,18.1 11.8,17.5C11.8,16.1 12.9,15 14.3,15H16A4,4 0 0,0 20,11C20,7.1 16.4,4 12,4M6.5,10C7.3,10 8,10.7 8,11.5C8,12.3 7.3,13 6.5,13C5.7,13 5,12.3 5,11.5C5,10.7 5.7,10 6.5,10M9.5,6C10.3,6 11,6.7 11,7.5C11,8.3 10.3,9 9.5,9C8.7,9 8,8.3 8,7.5C8,6.7 8.7,6 9.5,6M14.5,6C15.3,6 16,6.7 16,7.5C16,8.3 15.3,9 14.5,9C13.7,9 13,8.3 13,7.5C13,6.7 13.7,6 14.5,6M17.5,10C18.3,10 19,10.7 19,11.5C19,12.3 18.3,13 17.5,13C16.7,13 16,12.3 16,11.5C16,10.7 16.7,10 17.5,10Z',
  'image-multiple-outline':
    'M21,17H7V3H21M21,1H7A2,2 0 0,0 5,3V17A2,2 0 0,0 7,19H21A2,2 0 0,0 23,17V3A2,2 0 0,0 21,1M3,5H1V21A2,2 0 0,0 3,23H19V21H3M15.96,10.29L13.21,13.83L11.25,11.47L8.5,15H19.5L15.96,10.29Z',
  'email-fast-outline':
    'M22 5.5H9C7.9 5.5 7 6.4 7 7.5V16.5C7 17.61 7.9 18.5 9 18.5H22C23.11 18.5 24 17.61 24 16.5V7.5C24 6.4 23.11 5.5 22 5.5M22 16.5H9V9.17L15.5 12.5L22 9.17V16.5M15.5 10.81L9 7.5H22L15.5 10.81M5 16.5C5 16.67 5.03 16.83 5.05 17H1C.448 17 0 16.55 0 16S.448 15 1 15H5V16.5M3 7H5.05C5.03 7.17 5 7.33 5 7.5V9H3C2.45 9 2 8.55 2 8S2.45 7 3 7M1 12C1 11.45 1.45 11 2 11H5V13H2C1.45 13 1 12.55 1 12Z',
  magnify:
    'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
  'page-layout-header-footer':
    'M18 2H6C4.89 2 4 2.9 4 4V20C4 21.11 4.89 22 6 22H18C19.11 22 20 21.11 20 20V4C20 2.9 19.11 2 18 2M18 20H6V16H18V20M18 8H6V4H18V8Z',
  'check-circle-outline':
    'M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M12 20C7.59 20 4 16.41 4 12S7.59 4 12 4 20 7.59 20 12 16.41 20 12 20M16.59 7.58L10 14.17L7.41 11.59L6 13L10 17L18 9L16.59 7.58Z',
  'format-quote-open': 'M10,7L8,11H11V17H5V11L7,7H10M18,7L16,11H19V17H13V11L15,7H18Z',
} as const

type IconId = keyof typeof ICONS

const icon = (id: string, iconId: IconId, color = 'primary.main'): NodeSpec => ({
  id,
  componentId: 'icon',
  props: { iconId, iconPath: ICONS[iconId], size: 32 },
  sx: { color },
})

/** A click that brings a section of the page into view under the header. */
const scrollTo = (targetId: string, name: string): NodeInteraction[] => [
  {
    id: 'scroll-to-section',
    name: `Scroll to ${name}`,
    enabled: true,
    trigger: { event: 'elementClick', everyTime: true },
    steps: [
      {
        type: 'scrollTo',
        selector: nodeInteractionSelector(targetId),
        offsetPx: HEADER_OFFSET_PX,
      },
    ],
  },
]

const button = (
  id: string,
  label: string,
  variant: 'contained' | 'outlined',
  target: { id: string; name: string },
  extra?: Record<string, unknown>,
): NodeSpec => ({
  id,
  componentId: 'muiButton',
  props: { variant, size: 'large', children: label, ...extra },
  interactions: scrollTo(target.id, target.name),
})

const CONTACT = { id: DEFAULT_HOME_CONTACT_SECTION_ID, name: 'the contact form' }
const FEATURES = { id: DEFAULT_HOME_FEATURES_SECTION_ID, name: 'what is included' }

/**
 * One full-width band: a semantic `section` carrying the band's background,
 * around a Container at a stock width carrying its rhythm (AGL-1298).
 */
const band = (
  id: string,
  ariaLabel: string,
  width: 'md' | 'lg' | 'xl',
  children: NodeSpec[],
  sx?: Record<string, unknown>,
): NodeSpec => ({
  id,
  componentId: 'section',
  props: { element: 'section', ariaLabel },
  ...(sx ? { sx } : {}),
  children: [container(`${id}Inner`, width, 10, children)],
})

/** A section's heading block: an overline, the heading and a lede. */
const heading = (
  prefix: string,
  overline: string,
  title: string,
  lede: string,
  align: 'center' | 'left' = 'center',
): NodeSpec => ({
  id: `${prefix}Heading`,
  componentId: 'muiStack',
  props: { spacing: 1.5 },
  sx: {
    alignItems: align === 'center' ? 'center' : 'flex-start',
    marginBottom: 6,
    ...(align === 'center' ? { marginLeft: 'auto', marginRight: 'auto', maxWidth: 'md' } : {}),
  },
  children: [
    text(`${prefix}Overline`, 'overline', overline, { align, color: 'primary' }),
    text(`${prefix}Title`, 'h2', title, { align }),
    text(`${prefix}Lede`, 'lede', lede, { align, color: 'text.secondary' }),
  ],
})

const grid = (id: string, spacing: number, children: NodeSpec[], sx?: Record<string, unknown>): NodeSpec => ({
  id,
  componentId: 'muiGrid',
  props: { container: true, spacing },
  ...(sx ? { sx } : {}),
  children,
})

/**
 * A grid cell. `size` is the Grid element's STORED syntax — `'xs:12 md:6'`,
 * per-breakpoint column counts in one string — which its parser turns into
 * MUI's responsive object; an object here would be ignored.
 */
const cell = (id: string, size: string, children: NodeSpec[], sx?: Record<string, unknown>): NodeSpec => ({
  id,
  componentId: 'muiGrid',
  props: { size },
  ...(sx ? { sx } : {}),
  children,
})

const photo = (
  id: string,
  image: { src: string; width: number; height: number },
  alt: string,
  height: string,
  loading: 'eager' | 'lazy' = 'lazy',
): NodeSpec => ({
  id,
  componentId: 'image',
  props: {
    src: image.src,
    alt,
    height,
    objectFit: 'cover',
    radius: 16,
    loading,
    intrinsicWidth: image.width,
    intrinsicHeight: image.height,
  },
})

const featureCard = (id: string, iconId: IconId, title: string, body: string): NodeSpec =>
  cell(`${id}Cell`, 'xs:12 sm:6 md:4', [
    {
      id,
      componentId: 'muiCard',
      props: { variant: 'outlined' },
      sx: { height: '100%', borderRadius: 3 },
      children: [
        {
          id: `${id}Content`,
          componentId: 'muiCardContent',
          sx: { paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4 },
          children: [
            {
              id: `${id}Stack`,
              componentId: 'muiStack',
              props: { spacing: 1.5 },
              children: [
                icon(`${id}Icon`, iconId),
                text(`${id}Title`, 'h5', title, { component: 'h3' }),
                text(`${id}Body`, 'body1', body, { color: 'text.secondary' }),
              ],
            },
          ],
        },
      ],
    },
  ])

const checkRow = (id: string, label: string): NodeSpec => ({
  id,
  componentId: 'muiStack',
  props: { direction: 'row', spacing: 1.5 },
  sx: { alignItems: 'center' },
  children: [icon(`${id}Icon`, 'check-circle-outline', 'secondary.main'), text(`${id}Text`, 'body1', label)],
})

const testimonial = (id: string, quote: string, name: string, detail: string): NodeSpec =>
  cell(`${id}Cell`, 'xs:12 md:4', [
    {
      id,
      componentId: 'muiCard',
      props: { variant: 'outlined' },
      sx: { height: '100%', borderRadius: 3 },
      children: [
        {
          id: `${id}Content`,
          componentId: 'muiCardContent',
          sx: { paddingTop: 4, paddingRight: 4, paddingBottom: 4, paddingLeft: 4 },
          children: [
            {
              id: `${id}Stack`,
              componentId: 'muiStack',
              props: { spacing: 2 },
              children: [
                icon(`${id}Icon`, 'format-quote-open', 'secondary.main'),
                text(`${id}Quote`, 'body1', quote),
                {
                  id: `${id}By`,
                  componentId: 'muiStack',
                  props: { spacing: 0 },
                  children: [
                    text(`${id}Name`, 'subtitle2', name),
                    text(`${id}Detail`, 'body2', detail, { color: 'text.secondary' }),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ])

const faq = (id: string, question: string, answer: string, defaultExpanded = false): NodeSpec => ({
  id,
  componentId: 'muiAccordion',
  props: { disableGutters: true, ...(defaultExpanded ? { defaultExpanded: true } : {}) },
  sx: { borderRadius: 2 },
  children: [
    {
      id: `${id}Q`,
      componentId: 'muiAccordionSummary',
      props: { children: question },
      sx: { fontWeight: 700, fontSize: '1rem', paddingTop: 1, paddingBottom: 1 },
    },
    {
      id: `${id}A`,
      componentId: 'muiAccordionDetails',
      children: [text(`${id}AText`, 'body1', answer, { color: 'text.secondary' })],
    },
  ],
})

/**
 * The contact form. `pluginId: 'forms'` because a node names the bundle that
 * REGISTERS its component, and that is what decides whether the form draws
 * with the page or arrives after hydration (see the forms plugin's
 * `form-survives-the-bundle-move.spec.tsx`).
 */
const contactForm = (): NodeSpec => ({
  id: 'dh_form',
  componentId: 'form',
  pluginId: 'forms',
  props: {
    formName: 'Contact',
    submitLabel: 'Send message',
    successMessage: 'Thanks — your message is on its way. We will be in touch soon.',
  },
  children: [
    {
      id: 'dh_fName',
      componentId: 'formField',
      pluginId: 'forms',
      props: { fieldName: 'name', label: 'Name', required: true },
    },
    {
      id: 'dh_fEmail',
      componentId: 'formField',
      pluginId: 'forms',
      props: { fieldName: 'email', label: 'Email', fieldType: 'email', required: true },
    },
    {
      id: 'dh_fMessage',
      componentId: 'formField',
      pluginId: 'forms',
      props: { fieldName: 'message', label: 'Message', fieldType: 'textarea', required: true },
    },
  ],
})

/** What a search result and a shared link say about the home page. */
export function defaultHomeDescription(siteName: string): string {
  const name = siteName.trim() || 'our website'
  return `Welcome to ${name}. See what we do, browse our work and get in touch.`
}

/**
 * The home page every new site is born with (AGL-3497, after AGL-3408).
 *
 * Its `seo` is written onto the screen, and the site's header and footer come
 * from the layout `buildDefaultSiteLayout` makes, which the provisioning
 * write binds it to.
 *
 * The site's name is written in as text, not bound: a page has no token for
 * it, and the heading is the first thing an owner rewrites anyway.
 */
export function buildDefaultHomeScreen(siteName: string): StarterTemplateScreen {
  const name = siteName.trim() || 'Welcome'
  return {
    key: 'home',
    displayName: 'Home',
    slug: SCREEN_ROOT_PATH,
    seo: { title: name, description: defaultHomeDescription(siteName) },
    nodes: buildNodes([
      // ── Hero ────────────────────────────────────────────────────────────
      band(
        'dh_heroSection',
        'Introduction',
        'xl',
        [
          grid('dh_heroGrid', 6, [
            cell('dh_heroTextCell', 'xs:12 md:6', [
              {
                id: 'dh_hero',
                componentId: 'muiStack',
                props: { spacing: 3 },
                children: [
                  text('dh_heroOverline', 'overline', 'Welcome to your new website', { color: 'primary' }),
                  text('dh_heroTitle', 'h1', name),
                  text(
                    'dh_heroSub',
                    'lede',
                    'This page is ready to make your own. Every heading, photo, ' +
                      'button and color on it can be changed in the Besigner, and ' +
                      'nothing you change goes live until you press Publish.',
                    { color: 'text.secondary' },
                  ),
                  {
                    id: 'dh_heroActions',
                    componentId: 'muiStack',
                    props: { direction: 'row' },
                    // `gap`, not `spacing`: Stack spacing is a margin on every
                    // child after the first, so a button that wraps onto a
                    // second line keeps a left margin it no longer needs.
                    sx: { flexWrap: 'wrap', gap: 2 },
                    children: [
                      button('dh_heroCta', 'Get in touch', 'contained', CONTACT),
                      button('dh_heroMore', 'See what’s included', 'outlined', FEATURES),
                    ],
                  },
                ],
              },
            ], { alignSelf: 'center' }),
            cell('dh_heroImageCell', 'xs:12 md:6', [
              photo(
                'dh_heroImage',
                DEFAULT_SITE_IMAGES.hero,
                'A small team working together around a table in a bright office',
                '420px',
                'eager',
              ),
            ]),
          ]),
        ],
        { bgcolor: 'background.paper' },
      ),

      // ── Features ────────────────────────────────────────────────────────
      band(DEFAULT_HOME_FEATURES_SECTION_ID, 'What is included', 'xl', [
        heading(
          'dh_features',
          'What’s already here',
          'Everything a real website needs, ready to edit',
          'Each block on this page shows one thing you can do. Keep the ones ' +
            'you need, delete the rest, and add more from the elements panel.',
        ),
        grid('dh_featuresGrid', 3, [
          featureCard(
            'dh_f1',
            'pencil-outline',
            'Edit right on the page',
            'Click any heading, paragraph or button in the Besigner and type. ' +
              'Changes stay a draft until you press Publish.',
          ),
          featureCard(
            'dh_f2',
            'palette-outline',
            'Your colors and fonts',
            'The colors and typefaces here come from your site theme. Change ' +
              'them once under Setup → Theme and every page follows.',
          ),
          featureCard(
            'dh_f3',
            'image-multiple-outline',
            'Photos you choose',
            'Upload your own pictures under Media, then pick one for any image ' +
              'on the page — the photos here are placeholders.',
          ),
          featureCard(
            'dh_f4',
            'email-fast-outline',
            'A contact form that works',
            'The form at the bottom of this page is live. Every message is ' +
              'saved under Forms, and you are notified when one arrives.',
          ),
          featureCard(
            'dh_f5',
            'magnify',
            'Ready to be found',
            'Set the title, description and image that search results and ' +
              'shared links show under Setup → SEO.',
          ),
          featureCard(
            'dh_f6',
            'page-layout-header-footer',
            'One header and footer',
            'The header and footer are a shared layout. Edit them once under ' +
              'Layouts and every page you add uses them.',
          ),
        ]),
      ]),

      // ── About ───────────────────────────────────────────────────────────
      band(
        'dh_aboutSection',
        'About us',
        'xl',
        [
          grid('dh_aboutGrid', 6, [
            cell('dh_aboutImageCell', 'xs:12 md:6', [
              photo(
                'dh_aboutImage',
                DEFAULT_SITE_IMAGES.about,
                'A smiling business owner standing behind the counter of her coffee shop',
                '440px',
              ),
            ]),
            cell('dh_aboutTextCell', 'xs:12 md:6', [
              {
                id: 'dh_about',
                componentId: 'muiStack',
                props: { spacing: 2.5 },
                children: [
                  text('dh_aboutOverline', 'overline', 'About us', { color: 'primary' }),
                  text('dh_aboutTitle', 'h2', 'Tell visitors who you are'),
                  text(
                    'dh_aboutBody',
                    'body1',
                    'People want to know who is behind a business before they get ' +
                      'in touch. Replace this with how you started, who you help ' +
                      'and what makes your work different.',
                    { color: 'text.secondary' },
                  ),
                  text(
                    'dh_aboutBody2',
                    'body1',
                    'A few honest sentences and a real photo of you or your team ' +
                      'will do more than a long page.',
                    { color: 'text.secondary' },
                  ),
                  {
                    id: 'dh_aboutChecks',
                    componentId: 'muiStack',
                    props: { spacing: 1.5 },
                    children: [
                      checkRow('dh_aboutCheck1', 'Say what you do in one sentence'),
                      checkRow('dh_aboutCheck2', 'Show the people behind the work'),
                      checkRow('dh_aboutCheck3', 'Tell visitors what to do next'),
                    ],
                  },
                  {
                    id: 'dh_aboutActions',
                    componentId: 'muiStack',
                    props: { direction: 'row' },
                    children: [button('dh_aboutCta', 'Contact us', 'outlined', CONTACT)],
                  },
                ],
              },
            ], { alignSelf: 'center' }),
          ]),
        ],
        { bgcolor: 'background.paper' },
      ),

      // ── Gallery ─────────────────────────────────────────────────────────
      band('dh_gallerySection', 'Gallery', 'xl', [
        heading(
          'dh_gallery',
          'Gallery',
          'Show your work',
          'Three photos in a grid that reflows on a phone. Replace them with ' +
            'your products, projects or space, or add more to the grid.',
        ),
        grid('dh_galleryGrid', 3, [
          cell('dh_g1Cell', 'xs:12 sm:4', [
            photo('dh_g1', DEFAULT_SITE_IMAGES.desk, 'A tidy desk with a laptop, a lamp and fresh flowers', '320px'),
          ]),
          cell('dh_g2Cell', 'xs:12 sm:4', [
            photo('dh_g2', DEFAULT_SITE_IMAGES.plants, 'Houseplants on a sunny windowsill', '320px'),
          ]),
          cell('dh_g3Cell', 'xs:12 sm:4', [
            photo('dh_g3', DEFAULT_SITE_IMAGES.craft, 'Hands working on a craft project at a workbench', '320px'),
          ]),
        ]),
      ]),

      // ── Testimonials ────────────────────────────────────────────────────
      band(
        'dh_testimonialsSection',
        'What people say',
        'xl',
        [
          heading(
            'dh_testimonials',
            'Testimonials',
            'What people say',
            'A few words from real customers build trust faster than anything ' +
              'you can say about yourself. Replace these with quotes of your own.',
          ),
          grid('dh_testimonialsGrid', 3, [
            testimonial(
              'dh_t1',
              'Put a short quote from a happy customer here: one or two ' +
                'sentences about the result you got them.',
              'Customer name',
              'Their business',
            ),
            testimonial(
              'dh_t2',
              'Pick quotes that answer what a new visitor is unsure about, ' +
                'like price, timing or quality.',
              'Customer name',
              'Their city',
            ),
            testimonial(
              'dh_t3',
              'Ask before you publish a quote, and use the person’s real name ' +
                'and photo if they are happy for you to.',
              'Customer name',
              'Their role',
            ),
          ]),
        ],
        { bgcolor: 'background.paper' },
      ),

      // ── FAQ ─────────────────────────────────────────────────────────────
      band('dh_faqSection', 'Frequently asked questions', 'md', [
        heading(
          'dh_faq',
          'FAQ',
          'Frequently asked questions',
          'Answer the questions people ask you most. These answers are about ' +
            'building this site, so replace them with your own.',
        ),
        {
          id: 'dh_faqList',
          componentId: 'muiStack',
          props: { spacing: 1.5 },
          children: [
            faq(
              'dh_q1',
              'How do I change what this page says?',
              'Open this page in the Besigner. When you are signed in, the bar ' +
                'across the top of your live site opens it in one click. Click ' +
                'any text to edit it, then press Publish.',
              true,
            ),
            faq(
              'dh_q2',
              'How do I add another page?',
              'Open Pages in your site’s menu and create one. It gets this ' +
                'header and footer automatically, and you can link to it from ' +
                'the header.',
            ),
            faq(
              'dh_q3',
              'Where do messages from the contact form go?',
              'Every message sent through the form below is saved under Forms, ' +
                'where you can read it and keep track of who you have answered.',
            ),
            faq(
              'dh_q4',
              'Can I use my own domain name?',
              'Yes. Custom domains are included from the Starter plan. Connect ' +
                'one from your site’s Admin page, under Custom Domain.',
            ),
            faq(
              'dh_q5',
              'Will search engines find my site?',
              'Yes. This site is published and open to search engines from day ' +
                'one. Fill in Setup → SEO so results show the title and ' +
                'description you want.',
            ),
          ],
        },
      ]),

      // ── Call to action ──────────────────────────────────────────────────
      band(
        'dh_ctaSection',
        'Get started',
        'md',
        [
          {
            id: 'dh_cta',
            componentId: 'muiStack',
            props: { spacing: 3 },
            sx: { alignItems: 'center' },
            children: [
              text('dh_ctaTitle', 'h2', 'Ready to make it yours?', { align: 'center' }),
              text(
                'dh_ctaBody',
                'lede',
                'Change the words, swap the photos and pick your colors, then ' +
                  'share your link with the world.',
                { align: 'center' },
              ),
              {
                // A paper-colored button on the primary band: `inherit` would
                // take the band's text color as a grey fill, and `primary`
                // would vanish into the band it sits on.
                ...button('dh_ctaButton', 'Get in touch', 'contained', CONTACT),
                sx: {
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  '&:hover': { bgcolor: 'background.default' },
                },
              },
            ],
          },
        ],
        { bgcolor: 'primary.main', color: 'primary.contrastText' },
      ),

      // ── Contact ─────────────────────────────────────────────────────────
      band(DEFAULT_HOME_CONTACT_SECTION_ID, 'Contact', 'md', [
        heading(
          'dh_contact',
          'Contact',
          'Get in touch',
          'Questions, quotes or bookings: send a message and we will reply as ' +
            'soon as we can.',
        ),
        contactForm(),
      ]),
    ]),
  }
}

/** The shared header and footer every page of a new site renders inside. */
export interface DefaultSiteLayout {
  displayName: string
  description: string
  nodes: Record<string, any>
}

/**
 * The header and footer a new site is born with (AGL-3497).
 *
 * The brand reads `{{host.businessName}}`, so it follows the site's name in
 * Setup rather than freezing the one it was created under. The header's
 * Contact button scrolls to the home page's contact section; on another page
 * it has nothing to scroll to and does nothing, which is the step's own rule.
 *
 * `homeScreenId` is the home page the brand and the footer's Home link point
 * at — a link by id, so it survives a slug change.
 */
export function buildDefaultSiteLayout(homeScreenId: string): DefaultSiteLayout {
  const brand = '{{host.businessName}}'
  return {
    displayName: 'Site header and footer',
    description: 'The header and footer every page of this site shows.',
    nodes: buildNodes([
      {
        id: 'dl_header',
        componentId: 'muiAppBar',
        props: { position: 'sticky', color: 'inherit', component: 'header', ariaLabel: 'Site header' },
        sx: { bgcolor: 'background.paper', boxShadow: 'none', borderBottom: 1, borderColor: 'divider' },
        children: [
          {
            id: 'dl_headerInner',
            componentId: 'muiContainer',
            props: { maxWidth: 'xl' },
            children: [
              {
                id: 'dl_toolbar',
                componentId: 'muiToolbar',
                props: { disableGutters: true },
                sx: { columnGap: 2 },
                children: [
                  {
                    id: 'dl_brand',
                    componentId: 'muiScreenLink',
                    props: { children: brand, screenId: homeScreenId, renderAs: 'link', color: 'inherit' },
                    sx: { fontWeight: 800, fontSize: '1.25rem', textDecoration: 'none', flexGrow: 1 },
                  },
                  {
                    id: 'dl_search',
                    componentId: 'searchBox',
                    props: { placeholder: 'Search' },
                    sx: { display: { xs: 'none', md: 'flex' }, width: 220 },
                  },
                  { id: 'dl_mode', componentId: 'themeModeSwitcher', props: { variant: 'icon' } },
                  {
                    id: 'dl_contact',
                    componentId: 'muiButton',
                    props: { variant: 'contained', children: 'Contact us' },
                    sx: { whiteSpace: 'nowrap', flexShrink: 0 },
                    interactions: scrollTo(CONTACT.id, CONTACT.name),
                  },
                ],
              },
            ],
          },
        ],
      },
      { id: 'dl_slot', componentId: 'layoutSlot', props: { component: 'main' } },
      {
        id: 'dl_footer',
        componentId: 'section',
        props: { element: 'footer', ariaLabel: 'Site footer' },
        sx: { bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' },
        children: [
          container('dl_footerInner', 'xl', 8, [
            grid('dl_footerGrid', 4, [
              cell('dl_footerBrandCell', 'xs:12 md:6', [
                {
                  id: 'dl_footerBrand',
                  componentId: 'muiStack',
                  props: { spacing: 1.5 },
                  children: [
                    text('dl_footerName', 'h6', brand, { component: 'p' }),
                    text(
                      'dl_footerAbout',
                      'body2',
                      'This footer is part of your site’s shared layout. Edit it ' +
                        'once under Layouts and it changes on every page.',
                      { color: 'text.secondary' },
                    ),
                  ],
                },
              ]),
              cell('dl_footerLinksCell', 'xs:6 md:3', [
                {
                  id: 'dl_footerLinks',
                  componentId: 'muiStack',
                  props: { spacing: 1 },
                  children: [
                    text('dl_footerLinksTitle', 'subtitle2', 'Explore', { component: 'p' }),
                    {
                      id: 'dl_footerHome',
                      componentId: 'muiScreenLink',
                      props: { children: 'Home', screenId: homeScreenId, renderAs: 'link', color: 'inherit' },
                    },
                    {
                      id: 'dl_footerSearch',
                      componentId: 'muiScreenLink',
                      props: { children: 'Search', href: '/search', renderAs: 'link', color: 'inherit' },
                    },
                  ],
                },
              ]),
              cell('dl_footerFollowCell', 'xs:6 md:3', [
                {
                  id: 'dl_footerFollow',
                  componentId: 'muiStack',
                  props: { spacing: 1 },
                  children: [
                    text('dl_footerFollowTitle', 'subtitle2', 'Follow along', { component: 'p' }),
                    text(
                      'dl_footerFollowBody',
                      'body2',
                      'Add your social profiles to the links element here and ' +
                        'their icons appear.',
                      { color: 'text.secondary' },
                    ),
                    { id: 'dl_footerSocial', componentId: 'socialLinks', props: {} },
                  ],
                },
              ]),
            ]),
            {
              ...text('dl_footerCopyright', 'caption', `© ${brand}. All rights reserved.`, {
                color: 'text.secondary',
                component: 'p',
              }),
              sx: { marginTop: 6, paddingTop: 3, borderTop: 1, borderColor: 'divider' },
            },
          ]),
        ],
      },
    ]),
  }
}

/**
 * The theme a new site starts with (AGL-3497): an indigo and teal palette on
 * a soft neutral ground, one Google family, rounder corners and buttons that
 * do not shout. Written as the site's own `theme`, so the theme library files
 * it as "Site theme" and keeps it when the owner switches to another.
 *
 * Dark is authored too, because a visitor's device decides which one they
 * see, and the header's switcher lets them choose.
 */
export const DEFAULT_SITE_THEME: HostTheme = {
  colorSchemes: {
    light: {
      primary: { main: '#4338ca', light: '#6366f1', dark: '#3730a3', contrastText: '#ffffff' },
      secondary: { main: '#0f766e', light: '#14b8a6', dark: '#115e59', contrastText: '#ffffff' },
      tertiary: { main: '#b45309', light: '#d97706', dark: '#92400e', contrastText: '#ffffff' },
      surface: { main: '#f1f5f9', contrastText: '#0f172a' },
      background: {
        default: '#f8fafc',
        paper: '#ffffff',
      },
      text: { primary: '#0f172a', secondary: '#475569', disabled: '#94a3b8' },
      tint: { primary: '#eef2ff', secondary: '#f0fdfa', tertiary: '#fffbeb' },
      divider: '#e2e8f0',
    },
    dark: {
      primary: { main: '#a5b4fc', light: '#c7d2fe', dark: '#818cf8', contrastText: '#1e1b4b' },
      secondary: { main: '#5eead4', light: '#99f6e4', dark: '#2dd4bf', contrastText: '#042f2e' },
      tertiary: { main: '#fcd34d', light: '#fde68a', dark: '#fbbf24', contrastText: '#451a03' },
      surface: { main: '#1e293b', contrastText: '#e2e8f0' },
      background: {
        default: '#0b1120',
        paper: '#111827',
      },
      text: { primary: '#e2e8f0', secondary: '#94a3b8', disabled: '#475569' },
      tint: { primary: '#1e1b4b', secondary: '#042f2e', tertiary: '#451a03' },
      divider: '#1e293b',
    },
  },
  fonts: [{ family: 'Plus Jakarta Sans', weights: [400, 500, 600, 700, 800], source: 'google' }],
  typography: {
    fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    variants: {
      h1: { fontSize: '3.25rem', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' },
      h2: { fontSize: '2.25rem', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.015em' },
      h3: { fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.2 },
      h4: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.25 },
      h5: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.3 },
      h6: { fontSize: '1.125rem', fontWeight: 700, lineHeight: 1.35 },
      lede: { fontSize: '1.1875rem', fontWeight: 400, lineHeight: 1.6 },
      overline: { fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.12em' },
      button: { fontWeight: 700, textTransform: 'none' },
    },
  },
  shape: { borderRadius: 12 },
}

/** The site-wide SEO a new site starts with: its name, a description and a sharing image. */
export function defaultSiteSeo(siteName: string): Record<string, unknown> {
  return {
    title: siteName.trim() || 'Welcome',
    description: defaultHomeDescription(siteName),
    image: DEFAULT_SITE_IMAGES.hero.src,
    imageWidth: DEFAULT_SITE_IMAGES.hero.width,
    imageHeight: DEFAULT_SITE_IMAGES.hero.height,
    imageAlt: 'A small team working together around a table in a bright office',
  }
}
