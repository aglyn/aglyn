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

// Leaf imports only, deliberately (AGL-687). This module is imported from
// BOTH graphs — the console's client gallery renders virtual starters from
// it, the console's seed route materializes them, and the AI plugin's server
// shows them to a model — and neither barrel works in both: the full
// `@aglyn/aglyn` barrel breaks the RSC/server-route graph, while the server
// entry drags `node:fs` into the client bundle. The starter kit imports only
// the canvas constants, a leaf with no imports of their own; the compiled
// plugin starters are data behind a type-only import; and `screen-route`
// imports only a TYPE from foundation — so all three are safe on either side.
import { PLUGIN_STARTER_TEMPLATES } from './plugin-starter-templates.generated'
import { normalizeScreenSlug } from './screen-route'
import {
  buildStarterNodes as buildNodes,
  starterHeroSection as heroSection,
  starterSection as section,
  starterText as text,
  type StarterNodeSpec as NodeSpec,
  type StarterTemplate,
} from './starter-template-nodes'

export type {
  StarterNodeSpec,
  StarterSectionWidth,
  StarterTemplate,
  StarterTemplateScreen,
} from './starter-template-nodes'
export {
  buildStarterNodes,
  starterHeroSection,
  starterSection,
  starterText,
} from './starter-template-nodes'

/**
 * First-party starter definitions (AGL-78/79), SEED INPUT (AGL-687).
 *
 * These used to be rendered straight into the gallery and instantiated from
 * code, which made a starter a second kind of template: no version history,
 * no placeholders, no editor, changeable only by shipping a release. Now
 * they are seeded into each host's own template library as ordinary
 * `hosts/{hostId}/templates` documents (see the console's
 * `utils/server/seed-starter-templates.ts` for why copy-on-use rather than a
 * global read-only collection), and nothing reads this file at render time.
 *
 * They are also the page examples the AI plugin's template generator shows a
 * model (AGL-2909), which is why they live in the core package rather than
 * beside the console gallery that renders them.
 *
 * Node ids stay template-local (unique within each screen's version doc);
 * `createPageFromTemplate` re-keys screen and version ids at instantiation.
 *
 * PERSISTED IDENTIFIERS: `StarterTemplate.id`, `StarterTemplateScreen.key`
 * and every node id below appear in stored documents (seeded template doc
 * ids are derived from the first two). They must never be renamed.
 */
export interface StarterTemplateDoc {
  id: string
  /** Which starter this page belongs to — lets one starter be selected. */
  starterId: string
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
  return starter.screens.map((screen, index) => {
    // Normalized on the way into the document so the persisted address is in
    // the routing-map format the tenant matches against — in particular the
    // root, which the previous `screen.slug ? …` guard dropped entirely when
    // home was spelled `''` (AGL-1575). A slug that sanitizes away carries no
    // field, and the apply path derives one from the display name.
    const slug = normalizeScreenSlug(screen.slug)
    return {
      id: starterTemplateDocId(starter.id, screen.key),
      starterId: starter.id,
      data: {
        kind: 'page',
        displayName: screen.displayName,
        // Only the screen's own description, never the starter blurb: a
        // template's `description` is carried onto the page it creates, and a
        // screen description is the live site's meta-description fallback.
        // The bundle blurb lives on `source.starterDescription` instead.
        ...(screen.description ? { description: screen.description } : {}),
        category: starter.category,
        ...(slug ? { slug } : {}),
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
    }
  })
}

/** Every document a starter COULD materialize as, in bundle order. */
export function buildAllStarterTemplateDocs(): StarterTemplateDoc[] {
  return STARTER_TEMPLATES.flatMap(buildStarterTemplateDocs)
}

const featureColumn = (id: string, title: string, body: string): NodeSpec => ({
  id,
  componentId: 'muiStack',
  props: { spacing: 1 },
  // `flex: 1` is a column's share of its row, not a width cap — it survives
  // the sweep deliberately. Only `maxWidth` in raw pixels was the violation.
  sx: {
    flex: 1,
    paddingTop: 2,
    paddingRight: 2,
    paddingBottom: 2,
    paddingLeft: 2,
  },
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


/**
 * The home page every new site is born with now lives with the rest of the
 * site it is born into — layout, theme and SEO — in `default-site.ts`
 * (AGL-3497). Re-exported so the name keeps its home here.
 */
export { buildDefaultHomeScreen } from './default-site'

/** The platform's own starters, which name no plugin's elements. */
const PLATFORM_STARTER_TEMPLATES: StarterTemplate[] = [
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
          section('l_featuresSection', 'xl', 6, [
            {
              id: 'l_features',
              componentId: 'muiStack',
              props: { direction: 'row', spacing: 2 },
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
          ]),
          // Was `maxWidth: 560`. A band, not an inner measure: it sat at the
          // top level carrying the section's own gutters and rhythm, so the
          // pixel value was capping the BAND. MD is the stock width for a
          // narrow, form-led column.
          section('l_contactSection', 'md', 6, [
            {
              id: 'l_contact',
              componentId: 'muiStack',
              props: { spacing: 2 },
              children: [
                text('l_contactTitle', 'h4', 'Get in touch'),
                contactForm('l_'),
              ],
            },
          ]),
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
          section('b_servicesSection', 'xl', 6, [
            {
              id: 'b_services',
              componentId: 'muiStack',
              props: { direction: 'row', spacing: 2 },
              children: [
                featureColumn('b_s1', 'Service one', 'Describe this service.'),
                featureColumn('b_s2', 'Service two', 'Describe this service.'),
                featureColumn(
                  'b_s3',
                  'Service three',
                  'Describe this service.',
                ),
              ],
            },
          ]),
        ]),
      },
      {
        key: 'about-us',
        displayName: 'About Us',
        slug: 'about-us',
        seo: { title: 'About us' },
        nodes: buildNodes([
          // Was `maxWidth: 720` — the one unambiguous PROSE band in the set,
          // and the case the Prose Container preset exists for. MD (900px)
          // lands near the 65–75 characters a line that reads comfortably.
          section('a_wrapSection', 'md', 8, [
            {
              id: 'a_wrap',
              componentId: 'muiStack',
              props: { spacing: 2 },
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
        ]),
      },
      {
        key: 'contact-us',
        displayName: 'Contact Us',
        slug: 'contact-us',
        seo: { title: 'Contact' },
        nodes: buildNodes([
          // Was `maxWidth: 560`. Same reading as the landing page's contact
          // band: text plus a form column, so MD.
          section('c_wrapSection', 'md', 8, [
            {
              id: 'c_wrap',
              componentId: 'muiStack',
              props: { spacing: 2 },
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
          section('p_gridSection', 'xl', 6, [
            {
              id: 'p_grid',
              componentId: 'muiStack',
              props: { direction: 'row', spacing: 2 },
              children: [
                {
                  id: 'p_img1',
                  componentId: 'image',
                  // `height` is an image's own intrinsic sizing prop, not a
                  // band cap — out of scope for the container standard.
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
          ]),
          // Was `maxWidth: 560`, the third of the three contact bands.
          section('p_contactSection', 'md', 6, [
            {
              id: 'p_contact',
              componentId: 'muiStack',
              props: { spacing: 2 },
              children: [
                text('p_contactTitle', 'h4', 'Work with me'),
                contactForm('p_'),
              ],
            },
          ]),
        ]),
      },
    ],
  },
]

/**
 * Every starter in this build, in gallery order: the platform's own, then
 * each plugin's in config order (AGL-3080). A plugin whose elements a starter
 * is built around — a storefront's product grid and cart — declares it under
 * `starterTemplates` in plugins.config.json, and the manifest generator
 * compiles what it returns, so the gallery, the seed route and a model
 * shown examples all read one list without loading any plugin.
 */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  ...PLATFORM_STARTER_TEMPLATES,
  ...PLUGIN_STARTER_TEMPLATES,
]
