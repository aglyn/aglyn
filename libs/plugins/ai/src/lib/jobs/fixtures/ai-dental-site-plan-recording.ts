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
 * RECORDED, NOT GOLDEN: the `submit_build_plan` input the real model gave a
 * Free guided start for "a family dental practice" (Maple Street Dental) in
 * the live site-plan eval of 2026-10-15 (claude-haiku-5-5, replay entry
 * 4177de69…, on a site as provisioning leaves it), copied verbatim. Every page
 * is put in the site's layout `laySite`, and every section that places no
 * form names `laySite` again in its `uses`: rule 2's
 * `plan-layout-in-section` refused both attempts, and the job stopped at
 * needs_input with its credits refunded.
 */
export const AI_DENTAL_SITE_PLAN_ANSWER = {
  reuse: [
    {
      kind: 'layout',
      id: 'laySite',
      purpose: 'shared site header, navigation and footer for both pages',
    },
  ],
  create: [
    {
      kind: 'form',
      name: 'bookingForm',
      why: 'The site has no saved form, and the brief needs a booking request form that routes submissions to the practice inbox.',
      duplicateOf: null,
      fields: [
        'parentName:text',
        'childName:text',
        'childAge:number',
        'phone:phone',
        'email:email',
        'preferredDay:text',
        'visitReason:select',
        'consent:checkbox',
      ],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'laySite',
      template: null,
      duplicateOf: 'scrStarter',
      nav: true,
      seoTitle: 'Maple Street Dental | Family Dentist for Kids and Parents',
      seoDescription:
        'Gentle family dental care at Maple Street Dental. Check-ups, cleanings and sealants for children and parents. Book a visit online.',
      sections: [
        {
          name: 'hero with headline, short intro and book-a-visit button',
          uses: ['laySite'],
          items: 0,
        },
        {
          name: 'services list: check-ups, cleanings, sealants, emergency visits',
          uses: ['laySite'],
          items: 4,
        },
        {
          name: 'why us: a kind team, a calm office and flexible family scheduling',
          uses: ['laySite'],
          items: 3,
        },
        {
          name: 'parent testimonials',
          uses: ['laySite'],
          items: 3,
        },
        {
          name: 'closing call to action to book a visit with the booking form',
          uses: ['new:bookingForm'],
          items: 0,
        },
      ],
    },
    {
      title: 'Book a Visit',
      slug: '/book-a-visit',
      layout: 'laySite',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Book a Family Dental Visit | Maple Street Dental',
      seoDescription:
        'Request a check-up or cleaning for your child at Maple Street Dental. Share your preferred day and we will confirm your appointment.',
      sections: [
        {
          name: 'page intro: how booking works and office hours [hours to confirm]',
          uses: ['laySite'],
          items: 0,
        },
        {
          name: 'booking request form',
          uses: ['new:bookingForm'],
          items: 0,
        },
        {
          name: 'contact details: address, phone and parking [to confirm]',
          uses: ['laySite'],
          items: 0,
        },
      ],
    },
  ],
  language: 'en',
  photoWords: null,
} as const
