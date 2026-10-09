/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { aiLayoutPageCheck } from './ai-job-page-language'

const block = (kind: string, text: string) => ({ kind, col: -1, text, to: '', icon: '', style: 'none', items: [] })

/** A two-section page in the language, its second section saying where the business is. */
function answer(where: string) {
  return {
    sections: [
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Gentle grooming in Austin'), block('lede', 'Calm handling for nervous dogs.')] },
      { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'Visit us'), block('text', where)] },
    ],
  }
}

function check(facts: string) {
  const screen = { title: 'Home', slug: '/', template: null, sections: [{ name: 'Hero', uses: [], items: 0 }, { name: 'Visit', uses: [], items: 0 }] }
  const sectionIds = ['sec-0', 'sec-1']
  return aiLayoutPageCheck({
    screen: screen as never,
    sectionIds,
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts } as never,
    context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: sectionIds },
    reusableComponents: false,
  })
}

describe('a page in the layout language gives no contact detail the job was not given (AGL-3596, AGL-3660)', () => {
  it('refuses a street address and opening hours the brief never gave', () => {
    const result = check('A dog groomer in Austin.')(answer('Find us at 1420 Barton Springs Road, open Mon–Sat, 8am–6pm.'))
    expect(result.value).toBeNull()
    expect(result.violations.map((violation) => violation.code)).toContain('contact-not-in-brief')
  })

  it('admits the address and hours the brief gives', () => {
    const result = check('A dog groomer at 1420 Barton Springs Road, Austin. Open Mon–Sat, 8am–6pm.')(
      answer('Find us at 1420 Barton Springs Road, open Mon–Sat, 8am–6pm.'),
    )
    expect(result.violations.map((violation) => violation.code)).not.toContain('contact-not-in-brief')
  })

  it('admits a page that names no contact detail at all', () => {
    const result = check('A dog groomer in Austin.')(answer('Book a groom and we will find a time that suits your dog.'))
    expect(result.violations).toEqual([])
    expect(result.value).not.toBeNull()
  })

  it('asks again about a gap, and takes it out of the last answer rather than publishing it', () => {
    const page = check('A dog groomer in Austin.')
    const gapped = answer('Call us at [phone number] to book.')
    const first = page(gapped)
    expect(first.value).toBeNull()
    expect(first.violations.map((violation) => violation.code)).toEqual(['layout-gap'])
    const last = page(gapped)
    expect(last.violations).toEqual([])
    expect(last.value?.dropped).toEqual(['Call us at [phone number] to book.', 'the section "Visit", left with only its heading'])
    expect(JSON.stringify(last.value?.nodes)).not.toContain('[phone number]')
  })
})

/*
 * A section planned with repeated items that shows none (AGL-3660): the
 * business contact sheets showed "What the inspection covers" as a heading
 * and an intro over nothing. Such a page is asked for again.
 */
describe('a section planned with items shows them (AGL-3660)', () => {
  const screen = {
    title: 'Home',
    slug: '/',
    template: null,
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'What the inspection covers', uses: [], items: 3 },
    ],
  }
  const page = () =>
    aiLayoutPageCheck({
      screen: screen as never,
      sectionIds: ['sec-0', 'sec-1'],
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A roofer.' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: ['sec-0', 'sec-1'], reusableComponents: false },
      reusableComponents: false,
    })
  const hero = { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Storm damage, checked'), block('lede', 'A free inspection.')] }

  it('refuses a heading and an intro over nothing', () => {
    const result = page()({
      sections: [hero, { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'What the inspection covers'), block('lede', 'Every part of the roof.')] }],
    })
    expect(result.value).toBeNull()
    expect(result.violations.map((violation) => violation.code)).toEqual(['layout-section-no-items'])
    expect(result.violations[0].message).toBe('Section 2 ("What the inspection covers") is planned with 3 items and shows none.')
  })

  /*
   * The live eval's towing Services page (AGL-3660): the model opened with a
   * hero of its own and added a closing call to action, six sections for a
   * plan of three, and the cut fell on the planned sections that carried
   * their items. The plan's sections now take the answer's that fit them.
   */
  it('matches an answer with extra sections to the plan by its headings and items', () => {
    const plan = {
      title: 'Services',
      slug: '/services',
      template: null,
      sections: [
        { name: 'Roadside services', uses: [], items: 3 },
        { name: 'Service area', uses: [], items: 0 },
        { name: 'Common questions', uses: [], items: 3 },
      ],
    }
    const ids = ['sec-0', 'sec-1', 'sec-2']
    const check = aiLayoutPageCheck({
      screen: plan as never,
      sectionIds: ids,
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A towing company.' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: ids, reusableComponents: false },
      reusableComponents: false,
    })
    const items = (titles: string[]) => titles.map((title) => ({ title, text: `${title}, any hour.`, to: '', icon: '' }))
    const section = (blocks: unknown[]) => ({ band: 'plain', align: 'start', cols: [], blocks })
    const result = check({
      sections: [
        section([block('heading', 'Help on the road, any hour'), block('lede', 'Towing and roadside help.')]),
        section([block('heading', 'Our roadside services'), { ...block('cards', ''), items: items(['Towing', 'Jump starts', 'Lockouts']) }]),
        section([block('heading', 'Where we serve'), block('text', 'The Phoenix metro and the highways around it.')]),
        section([block('heading', 'Common questions'), { ...block('faq', ''), items: items(['How fast?', 'What vehicles?', 'Holidays?']) }]),
        section([block('heading', 'Need a tow now?'), block('lede', 'Tell us where you are.')]),
      ],
    })
    expect(result.violations).toEqual([])
    expect(result.value?.items).toEqual([3, 0, 3])
  })

  it('admits the section with its cards', () => {
    const cards = {
      ...block('cards', ''),
      items: [
        { title: 'Shingles', text: 'Wind lift and hail bruising.', to: '', icon: '' },
        { title: 'Flashing', text: 'Where leaks start.', to: '', icon: '' },
        { title: 'Gutters', text: 'Dents and blockage.', to: '', icon: '' },
      ],
    }
    const result = page()({
      sections: [hero, { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'What the inspection covers'), cards] }],
    })
    expect(result.violations).toEqual([])
  })
})

/*
 * A live blog plan (2026-10-09) named a section "reader notes and kind words
 * [to be added by owner]". Its label read as a gap and the gap pass took the
 * whole section out; and a section whose only items were customer quotes has
 * none any answer may give (AGL-3676).
 */
describe('a section the plan named with a note, or planned as customer words', () => {
  const screen = {
    title: 'Home',
    slug: '/',
    template: null,
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'reader notes and kind words [to be added by owner]', uses: [], items: 3 },
    ],
  }
  const sectionIds = ['sec-0', 'sec-1']
  const page = (blocks: unknown[]) => ({
    sections: [
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Clay Notes')] },
      { band: 'soft', align: 'start', cols: [], blocks },
    ],
  })
  const run = () =>
    aiLayoutPageCheck({
      screen: screen as never,
      sectionIds,
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'Clay Notes' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: sectionIds, reusableComponents: false },
      reusableComponents: false,
    })
  const item = (title: string) => ({ title, text: `${title}, in a line.`, to: '', icon: '' })

  it('keeps the section, labelled without the note', () => {
    const result = run()(page([block('heading', 'Write in'), { ...block('cards', ''), items: [item('Ask'), item('Suggest'), item('Share')] }]))
    expect(result.violations).toEqual([])
    const label = (result.value?.nodes as unknown as Record<string, { props?: Record<string, unknown> }>)['sec-1']?.props?.['ariaLabel']
    expect(label).toBe('reader notes and kind words')
  })

  it('asks no items of a section whose only items were customer quotes', () => {
    const result = run()(page([block('heading', 'Kind words'), block('lede', 'Readers write in.'), { ...block('quotes', ''), items: [item('A reader'), item('Another')] }]))
    expect(result.violations.map((violation) => violation.code)).not.toContain('layout-section-no-items')
  })
})
