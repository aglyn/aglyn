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
 * Answers to `submit_improved_page` for the four basic sites (AGL-4152),
 * WRITTEN BY HAND, in the shape the tool answers. No model wrote these and none
 * was called: they say what a good redesign of each page looks like in structure,
 * so the code that draws and scores one can be held offline. The paid eval
 * records real answers; these are not a measure of what a model will do.
 */

import type { SiteBasicPageName } from './site-layout-recordings'

type Answer = Record<string, unknown>

const block = (kind: string, rest: Partial<{ col: number; text: string; to: string; style: string; icon: string; items: Answer[]; ref: string }> = {}): Answer => ({
  kind,
  col: rest.col ?? -1,
  text: rest.text ?? '',
  to: rest.to ?? '',
  style: rest.style ?? 'none',
  icon: rest.icon ?? '',
  items: rest.items ?? [],
  ref: rest.ref ?? '',
})
const item = (title: string, text: string, rest: Partial<{ to: string; icon: string; ref: string }> = {}): Answer => ({ title, text, to: rest.to ?? '', icon: rest.icon ?? '', ref: rest.ref ?? '' })
const section = (band: string, blocks: Answer[], rest: Partial<{ cols: number[]; align: string }> = {}): Answer => ({ band, cols: rest.cols ?? [], align: rest.align ?? 'start', blocks })
const keep = (ref: string, col = -1) => block('keep', { ref, col })

export const SITE_IMPORT_IMPROVE_ANSWERS: Readonly<Record<SiteBasicPageName, { sections: Answer[] }>> = {
  'tax-firm': {
    sections: [
      section('plain', [
        block('eyebrow', { text: 'Tax preparation, planning and bookkeeping' }),
        block('heading', { text: 'Keep your taxes calm and keep more of what you earn' }),
        block('lede', { text: 'We find every deduction and meet every deadline, for you and for your business.' }),
        block('button', { text: 'Start now', to: 'link:1', style: 'primary' }),
        block('button', { text: 'How we work', to: 'link:2', style: 'secondary' }),
        keep('picture:1'),
      ]),
      section('soft', [
        block('heading', { text: 'What we do' }),
        block('lede', { text: 'Three ways we take the hassle of your taxes and your books off your plate.' }),
        block('cards', {
          items: [
            item('Tax preparation', 'Accurate and timely filings, for a personal return or your business.', { ref: 'picture:2' }),
            item('Strategic planning', 'A customized plan so you receive every deduction you are entitled to.', { ref: 'picture:3' }),
            item('Bookkeeping', 'We handle the balancing of your books, so you can manage your business better.', { ref: 'picture:4' }),
          ],
        }),
      ]),
      section('plain', [
        block('heading', { text: 'How working with us goes' }),
        block('steps', {
          items: [
            item('Tell us where you stand', 'Share your return, your business and what is worrying you.'),
            item('Get a plan', 'We look for every deduction and tell you what to expect.'),
            item('Stay on top of it', 'We file on time and keep your books in order.'),
          ],
        }),
      ]),
      section(
        'dark',
        [block('heading', { col: 0, text: 'Talk to us' }), block('lede', { col: 0, text: 'Tell us what you need and we will take it from there.' }), keep('contact:1', 0), keep('form:1', 1)],
        { cols: [5, 7] },
      ),
    ],
  },
  contractor: {
    sections: [
      section('plain', [
        block('heading', { text: 'Roofs and remodels done right' }),
        block('lede', { text: 'Family owned since 1994. Licensed and insured, license 88213.' }),
        block('button', { text: 'Ask for an estimate', to: 'link:1', style: 'primary' }),
        block('button', { text: 'See our projects', to: 'link:2', style: 'secondary' }),
        keep('picture:1'),
      ]),
      section('soft', [
        block('heading', { text: 'What we do for your home' }),
        block('cards', {
          items: [
            item('Roof repair', 'After storms, leaks and age.', { icon: 'home' }),
            item('New roofs', 'In asphalt, metal and cedar.', { icon: 'home' }),
            item('Siding and gutters', 'Fitted and sealed.', { icon: 'home' }),
            item('Kitchen remodels', 'From cabinets to counters.', { icon: 'home' }),
          ],
        }),
      ]),
      section(
        'plain',
        [
          block('heading', { text: 'Recent work' }),
          block('cards', {
            items: [
              item('A standing seam roof', 'On a lake house.', { ref: 'picture:2' }),
              item('A kitchen opened up', 'Connected to the dining room.', { ref: 'picture:3' }),
            ],
          }),
        ],
      ),
      section('soft', [block('heading', { text: 'What neighbors say' }), keep('quote:1')]),
      section('dark', [block('heading', { text: 'Tell us about your roof or your kitchen' }), keep('contact:1'), block('button', { text: 'Ask for an estimate', to: 'link:1', style: 'primary' })], { align: 'center' }),
    ],
  },
  salon: {
    sections: [
      section(
        'plain',
        [
          block('heading', { text: 'Hair that feels like yours' }),
          block('lede', { text: 'Cuts, color and care in a small salon on Juniper Row.' }),
          block('button', { text: 'Book a chair', to: 'link:1', style: 'primary' }),
          keep('picture:1'),
        ],
      ),
      section('soft', [block('heading', { text: 'Our prices' }), keep('table:1')]),
      section(
        'plain',
        [
          block('heading', { text: 'The studio', col: 0 }),
          block('text', { text: 'Four chairs, plenty of light, and a stylist who remembers how you like it.', col: 0 }),
          block('heading', { text: 'What we use', col: 1 }),
          block('text', { text: 'We use Oribe and Davines products.', col: 1 }),
        ],
        { cols: [1, 1] },
      ),
      section(
        'dark',
        [
          block('heading', { text: 'Find us on Juniper Row' }),
          keep('contact:1'),
          block('button', { text: 'Book a chair', to: 'link:1', style: 'primary' }),
          block('button', { text: 'Follow us on Instagram', to: 'link:2', style: 'secondary' }),
        ],
        { align: 'center' },
      ),
    ],
  },
  clinic: {
    sections: [
      section('plain', [
        block('heading', { text: 'Care for your whole family' }),
        block('lede', { text: 'Primary care for children and adults, with same-week visits.' }),
        block('button', { text: 'Plan a visit', to: 'link:1', style: 'primary' }),
        keep('picture:1'),
      ]),
      section('soft', [
        block('heading', { text: 'What we treat' }),
        block('cards', {
          items: [
            item('Checkups and vaccines', 'For every age.', { icon: 'heart' }),
            item('Colds, flu and infections', 'Seen the same week.', { icon: 'heart' }),
            item('Diabetes and blood pressure', 'Followed over time.', { icon: 'heart' }),
            item('Sports physicals', 'Ready for the season.', { icon: 'heart' }),
          ],
        }),
      ]),
      section('plain', [block('heading', { text: 'Doctors who know you' }), block('text', { text: 'Dr. Amara Voss and Dr. Felix Ono have seen patients here for 12 years.' })], { align: 'center' }),
      section('soft', [
        block('heading', { text: 'Common questions' }),
        block('faq', {
          items: [
            item('Do you take new patients?', 'Yes. Call us and we will find you a time this week.'),
            item('Which insurance do you accept?', 'We accept most major plans. Ask at the front desk about yours.'),
            item('Where do I park?', 'There is a free lot behind the building.'),
          ],
        }),
      ]),
      section('dark', [block('heading', { col: 0, text: 'Reach the front desk' }), keep('contact:1', 0), keep('form:1', 1)], { cols: [5, 7] }),
    ],
  },
}
