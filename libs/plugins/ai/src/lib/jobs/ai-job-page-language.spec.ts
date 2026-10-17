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

import { aiLayoutLeftOutNote, aiLayoutPageCheck } from './ai-job-page-language'

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

  /*
   * The Panaderia El Trigal start (AGL-3771, beta.249): its home's "Del menú"
   * section was planned with six items and both answers showed none, so the
   * whole home was refused and the published site had nothing at its
   * address. The last answer's empty section is taken out instead, and the
   * rest of the page kept.
   */
  it('takes an empty section out of the last answer rather than refusing the page', () => {
    const check = page()
    const empty = {
      sections: [hero, { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'What the inspection covers'), block('lede', 'Every part of the roof.')] }],
    }
    expect(check(empty).violations.map((violation) => violation.code)).toEqual(['layout-section-no-items'])
    const last = check(empty)
    expect(last.violations).toEqual([])
    expect(last.value?.dropped).toEqual(['the section "What the inspection covers", planned with 3 items and showing none'])
    const nodes = last.value?.nodes as unknown as Record<string, unknown>
    expect(nodes['sec-1']).toBeUndefined()
    expect(JSON.stringify(nodes)).not.toContain('Every part of the roof.')
    expect(JSON.stringify(nodes)).toContain('Storm damage, checked')
    expect(aiLayoutLeftOutNote(screen, ['sec-0', 'sec-1'], nodes)).toBe(
      'Left out: the section “What the inspection covers”, which could not be built well enough to publish. Add it in the Besigner when you are ready.',
    )
  })

  it('never takes out the section that heads the page', () => {
    const headed = { ...screen, sections: [{ name: 'Services', uses: [], items: 3 }, screen.sections[0]] }
    const check = aiLayoutPageCheck({
      screen: headed as never,
      sectionIds: ['sec-0', 'sec-1'],
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A roofer.' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: ['sec-0', 'sec-1'], reusableComponents: false },
      reusableComponents: false,
    })
    const answer = { sections: [hero, { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'Call us'), block('lede', 'We answer.')] }] }
    check(answer)
    const last = check(answer)
    expect(last.value).toBeNull()
    expect(last.violations.map((violation) => violation.code)).toEqual(['layout-section-no-items'])
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

/*
 * A Free guided start's café (beta.243, 2026-10-12, job 4ctq-dfbUP): Home
 * placed the "Contact & pre-order" section with the site's form, and the
 * Menu page's "Request weekend pickup" — sent to that form, so to Home — was
 * refused on every answer for rule 10. It goes to the page that places the
 * form, and the page is built (AGL-3729).
 */
describe('a call to action on another page goes to the form Home places (AGL-3729)', () => {
  const screen = {
    title: 'Menu',
    slug: '/menu',
    template: null,
    sections: [
      { name: 'Menu hero', uses: [], items: 0 },
      { name: 'Weekend pre-orders', uses: [], items: 0 },
    ],
  }
  const ids = ['sec-0', 'sec-1']
  const targets = {
    pageId: 'p-menu',
    pages: [{ id: 'p-home', label: 'Home', slug: '/' }],
    homeIds: ['p-home'],
    forms: [],
    formPageId: 'p-home',
    components: [],
    facts: 'A café and bakery that takes weekend pre-orders.',
  }
  const menu = (to: string) => ({
    sections: [
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Our menu'), block('lede', 'Baked fresh every morning.')] },
      {
        band: 'soft',
        align: 'start',
        cols: [],
        blocks: [block('heading', 'Weekend pre-orders'), block('text', 'Order by Thursday for Saturday pickup.'), { ...block('button', 'Request weekend pickup'), to }],
      },
    ],
  })
  const check = () =>
    aiLayoutPageCheck({
      screen: screen as never,
      sectionIds: ids,
      targets: targets as never,
      context: { screenIds: ['p-home'], formIds: [], componentIds: [], codeBuilt: true, homeScreenIds: ['p-home'], reusableComponents: false },
      reusableComponents: false,
    })
  const buttons = (nodes: unknown) =>
    Object.values(nodes as Record<string, { componentId: string; props?: Record<string, unknown> }>).filter(
      (node) => node.componentId === 'muiButton',
    )

  for (const to of ['form', 'page:Home', '']) {
    it(`builds the Menu page with "Request weekend pickup" linking Home's form (to: "${to}")`, () => {
      const result = check()(menu(to))
      expect(result.violations).toEqual([])
      expect(buttons(result.value?.nodes).map((node) => [node.props?.['children'], node.props?.['screenId']])).toEqual([
        ['Request weekend pickup', 'p-home'],
      ])
    })
  }

  it('still refuses nothing when the site has no form page: the link is left out', () => {
    const result = aiLayoutPageCheck({
      screen: screen as never,
      sectionIds: ids,
      targets: { ...targets, formPageId: null } as never,
      context: { screenIds: ['p-home'], formIds: [], componentIds: [], codeBuilt: true, homeScreenIds: ['p-home'], reusableComponents: false },
      reusableComponents: false,
    })(menu('form'))
    expect(result.violations).toEqual([])
    expect(buttons(result.value?.nodes)).toEqual([])
  })
})

/*
 * The live Whitmore Lane Family Law home (beta.262, 2026-10-16, AGL-3887):
 * its "Client feedback" section read "We are building this space for the
 * words of families we have worked with." A section that promises its
 * content later is asked for again, and the last answer's is taken out. An
 * event that is genuinely coming soon, on a dated list, is no such promise.
 */
describe('a section that promises its content later (AGL-3887)', () => {
  const screen = {
    title: 'Home',
    slug: '/',
    template: null,
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Client feedback', uses: [], items: 0 },
    ],
  }
  const sectionIds = ['sec-0', 'sec-1']
  const run = (options: { promisesAllowed?: boolean } = {}) =>
    aiLayoutPageCheck({
      screen: screen as never,
      sectionIds,
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A family law firm in Columbus.' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: sectionIds, reusableComponents: false },
      reusableComponents: false,
      ...options,
    })
  const page = (blocks: unknown[]) => ({
    sections: [
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Family law, handled with care'), block('lede', 'Divorce and custody in Columbus.')] },
      { band: 'soft', align: 'start', cols: [], blocks },
    ],
  })
  const WHITMORE = page([
    block('heading', 'Client feedback'),
    block('text', 'We are building this space for the words of families we have worked with. To learn more about the attorneys, visit About Our Attorneys.'),
  ])

  it('asks again about "We are building this space…", naming the section and the line', () => {
    const result = run()(WHITMORE)
    expect(result.value).toBeNull()
    expect(result.violations.map((violation) => violation.code)).toEqual(['layout-promised-copy'])
    expect(result.violations[0].message).toContain('Section 2 ("Client feedback") promises content that is not there')
    expect(result.violations[0].message).toContain('We are building this space')
  })

  it('takes the section out of the last answer rather than publishing it', () => {
    const check = run()
    check(WHITMORE)
    const last = check(WHITMORE)
    expect(last.violations).toEqual([])
    expect(last.value?.dropped).toEqual(['the section "Client feedback", which promised content that is not there'])
    const nodes = last.value?.nodes as unknown as Record<string, unknown>
    expect(nodes['sec-1']).toBeUndefined()
    expect(JSON.stringify(nodes)).not.toContain('building this space')
    expect(JSON.stringify(nodes)).toContain('Family law, handled with care')
  })

  it('admits an event that is genuinely coming soon on a dated list', () => {
    const events = {
      ...block('list', ''),
      items: [
        { title: 'Co-parenting workshop, Nov 12', text: 'A free evening session at our office.', to: '', icon: '' },
        { title: 'Spring legal clinic', text: 'Coming soon: dates to be announced.', to: '', icon: '' },
      ],
    }
    const result = run()(page([block('heading', 'Upcoming events'), events]))
    expect(result.violations.map((violation) => violation.code)).not.toContain('layout-promised-copy')
    expect(JSON.stringify(result.value?.nodes ?? {})).toContain('Coming soon: dates to be announced.')
  })

  it('admits a coming-soon site saying what is coming', () => {
    const soon = page([block('heading', 'Our new office'), block('text', 'This page is under construction. Stay tuned for this space.')])
    expect(run()(soon).violations.map((violation) => violation.code)).toContain('layout-promised-copy')
    expect(run({ promisesAllowed: true })(soon).violations.map((violation) => violation.code)).not.toContain('layout-promised-copy')
  })
})
