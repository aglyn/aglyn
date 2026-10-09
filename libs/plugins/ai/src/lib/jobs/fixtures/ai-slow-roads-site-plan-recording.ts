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

import type { AiBuildPlan } from '../../model/ai-build-plan'

/**
 * RECORDED, NOT GOLDEN: the first plan answer of the local paid (Pro) blog
 * guided start of 2026-10-08, "Slow Roads, a personal travel blog about long
 * train journeys through Europe, written by one person" (job cvS0nF0rWP,
 * claude-sonnet-5-5), copied by hand from its replay recording (AGL-3660).
 * Its start wrote three posts at /blog, and this plan also planned an
 * "Articles" page of featured cards at /articles, which the header linked
 * while it never linked the blog.
 */
export const AI_SLOW_ROADS_SITE_PLAN_FIRST_ANSWER: AiBuildPlan = {
  reuse: [],
  create: [
    {
      kind: 'layout',
      name: 'Slow Roads site layout',
      why: 'The site has no layouts, and the header, navigation and footer must live in one shared layout rather than on each page.',
      duplicateOf: null,
      fields: ['header', 'nav', 'main', 'footer'],
    },
    {
      kind: 'form',
      name: 'Reader contact form',
      why: 'The site has no saved forms, and the Contact page needs one to let readers ask to be contacted.',
      duplicateOf: null,
      fields: [
        'name',
        'email',
        'topic',
        'favorite route or journey',
        'message',
        'consent to be contacted and subscribe to new posts',
      ],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'new:Slow Roads site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Slow Roads | A travel blog about long train journeys',
      seoDescription:
        'Slow Roads is a personal travel blog about long train journeys through Europe, for readers who love slow travel by train.',
      record: null,
      sections: [
        { name: 'Hero with blog tagline and read-the-journeys button', uses: [], items: 0 },
        { name: 'Latest journeys featured cards', uses: [], items: 3 },
        { name: 'Why travel slowly by train', uses: [], items: 3 },
        { name: 'About the writer teaser', uses: [], items: 0 },
        { name: 'Reader kind words', uses: [], items: 3 },
        { name: 'Closing call to action to subscribe or get in touch', uses: [], items: 0 },
      ],
    },
    {
      title: 'Articles',
      slug: '/articles',
      layout: 'new:Slow Roads site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Articles | Slow Roads',
      seoDescription:
        'Read stories and notes from long train journeys through Europe: routes, carriages, stations and the people met along the way.',
      record: null,
      sections: [
        { name: 'Page introduction', uses: [], items: 0 },
        { name: 'Featured article cards', uses: [], items: 4 },
        { name: 'Note that new posts are added over time, with a link to get in touch', uses: [], items: 0 },
      ],
    },
    {
      title: 'About',
      slug: '/about',
      layout: 'new:Slow Roads site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About | Slow Roads',
      seoDescription:
        'Meet the writer behind Slow Roads and learn why long train journeys through Europe are worth taking slowly.',
      record: null,
      sections: [
        { name: 'About heading and intro', uses: [], items: 0 },
        { name: "The writer's story", uses: [], items: 0 },
        { name: 'How I travel and write', uses: [], items: 3 },
        { name: 'Call to action to read the articles', uses: [], items: 0 },
      ],
    },
    {
      title: 'Contact',
      slug: '/contact',
      layout: 'new:Slow Roads site layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Contact and subscribe | Slow Roads',
      seoDescription:
        'Get in touch with Slow Roads or ask to hear about new train journeys. Share a route, a question or a note for the writer.',
      record: null,
      sections: [
        { name: 'Contact introduction', uses: [], items: 0 },
        { name: 'Contact form', uses: ['new:Reader contact form'], items: 0 },
        { name: 'What to expect after you write', uses: [], items: 0 },
      ],
    },
  ],
}
