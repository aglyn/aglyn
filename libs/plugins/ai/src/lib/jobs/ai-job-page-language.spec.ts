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
