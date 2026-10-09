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
 * RECORDED, NOT GOLDEN: the two plan answers the local Free yoga guided start
 * of 2026-10-08 (job 5uOa6G7ITh, claude-haiku-4-5, on an empty site) gave,
 * copied by hand from its replay recording (AGL-3660). The first planned a
 * home of 6 and a Classes page of 4, ten sections against the wall's 8; told
 * only "plan at most 8", the redo cut the HOME to 4 and kept Classes at 2.
 */
export const AI_YOGA_SITE_PLAN_FIRST_ANSWER: AiBuildPlan = {
  reuse: [],
  create: [
    {
      kind: 'layout',
      name: 'Main Layout',
      why: 'The site needs a consistent layout with header, navigation, and footer for all pages.',
      duplicateOf: null,
      fields: ['regions: header, nav, main, footer'],
    },
    {
      kind: 'form',
      name: 'Contact Form',
      why: 'Beginners nervous about their first class need a low-pressure way to ask questions; the form asks for their name, email, experience level, and specific concerns or questions.',
      duplicateOf: null,
      fields: ['name', 'email', 'experience-level', 'concerns', 'consent'],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'new:Main Layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Still Point Yoga | Welcoming Drop-In Yoga Classes',
      seoDescription:
        'Beginner-friendly yoga studio offering drop-in classes for all levels. Start your yoga journey at Still Point Yoga.',
      record: null,
      sections: [
        { name: 'Hero', uses: [], items: 0 },
        { name: 'What is Yoga & Mindfulness', uses: [], items: 0 },
        { name: 'Our Drop-In Classes', uses: [], items: 0 },
        { name: 'Why Beginners Choose Still Point', uses: [], items: 0 },
        { name: 'Student Stories', uses: [], items: 0 },
        { name: 'Start Your Practice', uses: ['new:Contact Form'], items: 0 },
      ],
    },
    {
      title: 'Classes',
      slug: '/classes',
      layout: 'new:Main Layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Yoga Classes | Still Point Yoga',
      seoDescription:
        'Drop-in yoga classes for beginners and all levels. Beginner-friendly schedules and welcoming instruction.',
      record: null,
      sections: [
        { name: 'Classes Hero', uses: [], items: 0 },
        { name: 'Class Schedule', uses: [], items: 0 },
        { name: 'Class Descriptions', uses: [], items: 0 },
        { name: 'Get Started', uses: ['new:Contact Form'], items: 0 },
      ],
    },
  ],
}

/** The redo the live run kept: a home of 4 beside a Classes page of 2. */
export const AI_YOGA_SITE_PLAN_REDO_ANSWER: AiBuildPlan = {
  reuse: [],
  create: [
    {
      kind: 'layout',
      name: 'Main Layout',
      why: 'A site needs a layout with header, navigation and footer for the brand.',
      duplicateOf: null,
      fields: ['header', 'nav', 'main', 'footer'],
    },
    {
      kind: 'form',
      name: 'Contact Form',
      why: 'Beginners need a way to request contact; the site has no saved form.',
      duplicateOf: null,
      fields: [
        'name:text',
        'email:email',
        'experience-level:select (Beginner/Some experience)',
        'question:textarea',
        'phone:tel',
      ],
    },
  ],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'new:Main Layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Still Point Yoga – Begin Your Mindfulness Journey',
      seoDescription:
        'Welcome to Still Point Yoga. Drop-in classes for beginners nervous about their first yoga class. Start with mindfulness and ease.',
      record: null,
      sections: [
        { name: 'Hero', uses: [], items: 0 },
        { name: 'Drop-In Classes Overview', uses: [], items: 0 },
        { name: 'Why Beginners Choose Us', uses: [], items: 0 },
        { name: 'Contact & Get Started', uses: ['new:Contact Form'], items: 0 },
      ],
    },
    {
      title: 'Classes',
      slug: '/classes',
      layout: 'new:Main Layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Yoga Classes for Beginners | Still Point Yoga',
      seoDescription:
        "Explore Still Point Yoga's drop-in classes designed for beginners. Find your schedule and join a welcoming community.",
      record: null,
      sections: [
        { name: 'Classes Hero', uses: [], items: 0 },
        { name: 'Class Schedule & Descriptions', uses: [], items: 3 },
      ],
    },
  ],
}
