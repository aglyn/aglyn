/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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

/**
 * The VALUES behind AGL-2486's route guard.
 *
 * `page-title.spec.ts` proves each entity route mentions its id param; it
 * cannot prove the resulting string is any good. This pins the two properties
 * the tab actually depends on: that two entities produce two titles, and that
 * the client's id → name swap is a safe no-op in every case where it should
 * not fire.
 */

import { entityPageTitle, renameTitleSubject } from './entity-page-title'

describe('entityPageTitle', () => {
  it('puts the subject first, where a truncated tab can still show it', () => {
    // The reported bug is a tab reading `Screen besigner · aglyn-m…`: cut off
    // before anything distinguishing. Order is the fix, not just content.
    const title = entityPageTitle({
      subject: 'Home',
      noun: 'Screen besigner',
      scope: 'demo.aglyn.app',
    })
    expect(title).toBe('Home · Screen besigner · demo.aglyn.app')
    expect(title.startsWith('Home')).toBe(true)
  })

  it('gives two entities on one site two different titles', () => {
    // THE regression. Four tabs on four screens of one host read identically;
    // everything else in this file is detail beside it.
    const of = (subject: string) =>
      entityPageTitle({ subject, noun: 'Screen besigner', scope: 'demo' })
    expect(of('4L_o499p_p')).not.toBe(of('9Xk_22bTq'))
    expect(new Set(['Home', 'Checkout', 'About'].map(of)).size).toBe(3)
  })

  it('degrades to the container title rather than emitting a stray separator', () => {
    // `strictNullChecks` is off repo-wide, so an absent subject arrives at
    // runtime rather than at compile time. It must read as the OLD title, not
    // as " · Screen besigner · demo".
    expect(entityPageTitle({ noun: 'Screen besigner', scope: 'demo' })).toBe(
      'Screen besigner · demo',
    )
    expect(
      entityPageTitle({ subject: '   ', noun: 'Screen', scope: 'demo' }),
    ).toBe('Screen · demo')
    expect(entityPageTitle({ subject: 'abc', noun: 'Staff user' })).toBe(
      'abc · Staff user',
    )
  })
})

describe('renameTitleSubject', () => {
  const SERVED = '4L_o499p_p · Screen besigner · demo.aglyn.app'

  it('swaps the id the server rendered for the loaded name', () => {
    expect(renameTitleSubject(SERVED, '4L_o499p_p', 'Home')).toBe(
      'Home · Screen besigner · demo.aglyn.app',
    )
  })

  it('is idempotent, because the observer will re-run it', () => {
    // `ConsoleBrandingEffects` re-applies on every `<head>` mutation, and its
    // own write IS one. A transform that kept matching would grow the title
    // without bound.
    const once = renameTitleSubject(SERVED, '4L_o499p_p', 'Home')
    expect(renameTitleSubject(once, '4L_o499p_p', 'Home')).toBe(once)
  })

  it('only rewrites at the START, never inside the title', () => {
    // A screen genuinely named after an id, or a host whose name contains
    // one, must not be rewritten mid-string.
    const title = 'Home · Screen besigner · 4L_o499p_p.example.com'
    expect(renameTitleSubject(title, '4L_o499p_p', 'Renamed')).toBe(title)
  })

  it('leaves a title alone when the id is not its subject', () => {
    // The common case by far: most console routes carry no subject id, and
    // the owner runs this against every title it sees.
    expect(renameTitleSubject('Billing · Aglyn', '4L_o499p_p', 'Home')).toBe(
      'Billing · Aglyn',
    )
    // A prefix that is not a whole segment must not match either.
    expect(renameTitleSubject('4L_o499p_pXY · Screen', '4L_o499p_p', 'Home')).toBe(
      '4L_o499p_pXY · Screen',
    )
  })

  it('never blanks the tab on missing input', () => {
    // A name that has not loaded is `''` here. Blanking a tab would be a
    // worse bug than the one this issue is about — an empty tab shows the URL.
    expect(renameTitleSubject(SERVED, '4L_o499p_p', '')).toBe(SERVED)
    expect(renameTitleSubject(SERVED, '', 'Home')).toBe(SERVED)
    expect(renameTitleSubject(SERVED, '4L_o499p_p', '   ')).toBe(SERVED)
  })

  it('does nothing when the name IS the id', () => {
    expect(renameTitleSubject(SERVED, '4L_o499p_p', '4L_o499p_p')).toBe(SERVED)
  })
})
