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
 * RECONSTRUCTED, NOT RECORDED: the shape of the plan a production guided
 * start failed on (AGL-3660). On 2026-10-09 (beta.237) a paid five-page
 * portfolio start for "a ceramic artist who makes stoneware bowls, mugs and
 * vases" (site kind portfolio, 94 credits, refunded) stopped at its plan with
 * one finding, rule 3 `plan-form-not-placed` at `screens[1].sections[4]`,
 * after its answer and its re-ask. The job keeps the findings but not the
 * refused plan, so this is built from the job's inputs and that finding: the
 * plan makes one contact form and places it on its Contact page, and its
 * Work page ends with a section that asks for commissions and places
 * nothing. The business name is replaced.
 */
export const AI_CERAMICS_PORTFOLIO_SITE_PLAN: AiBuildPlan = {
  reuse: [{ kind: 'layout', id: 'laySite', purpose: 'the site header, navigation and footer' }],
  create: [
    {
      kind: 'form',
      name: 'Contact form',
      why: 'Collectors and shops need a way to ask about pieces, commissions and wholesale orders.',
      duplicateOf: null,
      fields: ['name', 'email', 'subject', 'message'],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Handmade Stoneware Ceramics | Kiln Street Ceramics',
      seoDescription: 'Wheel-thrown stoneware bowls, mugs and vases, made by hand in small batches.',
      record: null,
      sections: [
        { name: 'Hero', uses: [], items: 0 },
        { name: 'Featured works', uses: [], items: 6 },
        { name: 'About the maker', uses: [], items: 0 },
        { name: 'From clay to kiln', uses: [], items: 3 },
        { name: 'Studio notes', uses: [], items: 3 },
        { name: 'Visit the studio', uses: [], items: 0 },
      ],
    },
    {
      title: 'Work',
      slug: '/work',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Stoneware Bowls, Mugs and Vases | Kiln Street Ceramics',
      seoDescription: 'Browse handmade stoneware: serving bowls, everyday mugs and sculptural vases.',
      record: null,
      sections: [
        { name: 'Work intro', uses: [], items: 0 },
        { name: 'Bowls collection', uses: [], items: 6 },
        { name: 'Mugs collection', uses: [], items: 6 },
        { name: 'Vases collection', uses: [], items: 6 },
        { name: 'Commission inquiry', uses: [], items: 0 },
      ],
    },
    {
      title: 'About',
      slug: '/about',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About the Potter | Kiln Street Ceramics',
      seoDescription: 'The story behind the studio, the clay and the glazes.',
      record: null,
      sections: [
        { name: 'Story', uses: [], items: 0 },
        { name: 'The studio', uses: [], items: 0 },
        { name: 'Materials and glazes', uses: [], items: 3 },
      ],
    },
    {
      title: 'Process',
      slug: '/process',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'How Each Piece Is Made | Kiln Street Ceramics',
      seoDescription: 'Throwing, trimming, glazing and firing: how a stoneware piece comes to be.',
      record: null,
      sections: [
        { name: 'Process intro', uses: [], items: 0 },
        { name: 'Steps', uses: [], items: 4 },
        { name: 'Care for your pieces', uses: [], items: 0 },
      ],
    },
    {
      title: 'Contact',
      slug: '/contact',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Contact the Studio | Kiln Street Ceramics',
      seoDescription: 'Ask about a piece, a commission or a wholesale order.',
      record: null,
      sections: [
        { name: 'Contact intro', uses: [], items: 0 },
        { name: 'Contact form', uses: ['new:Contact form'], items: 0 },
        { name: 'Studio hours', uses: [], items: 0 },
      ],
    },
  ],
}
