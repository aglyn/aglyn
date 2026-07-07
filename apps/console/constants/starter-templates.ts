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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'

/**
 * First-party starter templates (AGL-78/79). Shipped in code so they
 * version with the app and need no seeded data; node ids are template-local
 * (unique within each screen's version doc). The apply util re-keys screen
 * and version ids at instantiation.
 */
export interface StarterTemplateScreen {
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

type NodeSpec = {
  id: string
  componentId: string
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
      pluginId: 'mui',
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

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'landing',
    displayName: 'Landing Page',
    description:
      'One-page launch site: hero, three selling points, and a contact form.',
    category: 'Marketing',
    screens: [
      {
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
]
