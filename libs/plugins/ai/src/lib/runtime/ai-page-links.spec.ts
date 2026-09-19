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

/**
 * A link to a section of its own page (AGL-3097): how a written link names a
 * section of the plan, and the interaction the page step writes for it, held
 * to the platform's own readers of a stored interaction.
 */

import { validateHostAction } from '@aglyn/aglyn/app-utils/actions'
import { collectNodeInteractions } from '@aglyn/aglyn/app-utils/node-interactions'
import {
  aiPageLinkSection,
  aiPageLinkTarget,
  aiPageScrollInteraction,
  aiStoredScrollTargets,
  isAiFragmentHref,
} from './ai-page-links'

/** The live Free About page's plan. */
const SECTIONS = ['hero introduction', 'who we are', 'practice areas', 'how we work with clients', 'consultation request form']

describe('the section a link names', () => {
  it('matches a section’s name in any case and spacing, and an anchor made of its words', () => {
    expect(aiPageLinkSection('consultation request form', SECTIONS)).toBe(4)
    expect(aiPageLinkSection(' Consultation-Request_Form ', SECTIONS)).toBe(4)
    expect(aiPageLinkSection('#consultation-form', SECTIONS)).toBe(4)
    expect(aiPageLinkSection('#practice-areas', SECTIONS)).toBe(2)
    expect(aiPageLinkSection('#clients', SECTIONS)).toBe(3)
  })

  it('names nothing for words no section holds, for words two sections hold, and for no words at all', () => {
    expect(aiPageLinkSection('#contact', SECTIONS)).toBeNull()
    expect(aiPageLinkSection('contact form', SECTIONS)).toBeNull()
    expect(aiPageLinkSection('#form', ['contact form', 'consultation request form'])).toBeNull()
    // A name one section has exactly is that section, though another holds its words too.
    expect(aiPageLinkSection('contact form', ['contact form', 'contact form and map'])).toBe(0)
    expect(aiPageLinkSection('#', SECTIONS)).toBeNull()
    expect(aiPageLinkSection('   ', SECTIONS)).toBeNull()
    expect(aiPageLinkSection('practice areas', [])).toBeNull()
  })

  it('reads an href as an anchor only when it is nothing but a fragment', () => {
    expect([' #consultation-form ', '#x'].map(isAiFragmentHref)).toEqual([true, true])
    expect(['#', '/about#team', 'https://example.com/#top', '', null, 7].map(isAiFragmentHref)).toEqual([false, false, false, false, false, false])
  })

  it('reads a written link’s scrollTo before its anchor, and says what it wrote when no section has it', () => {
    const link = (props: Record<string, unknown>) => ({ componentId: 'muiButton', props })
    expect(aiPageLinkTarget(link({ scrollTo: 'practice areas', href: '#consultation-form' }), SECTIONS)).toEqual({ kind: 'section', section: 2 })
    expect(aiPageLinkTarget(link({ href: '#consultation-form' }), SECTIONS)).toEqual({ kind: 'section', section: 4 })
    expect(aiPageLinkTarget(link({ scrollTo: ' our fees ' }), SECTIONS)).toEqual({ kind: 'unknown', value: 'our fees', via: 'scrollTo' })
    expect(aiPageLinkTarget(link({ href: '#contact' }), SECTIONS)).toEqual({ kind: 'unknown', value: '#contact', via: 'href' })
    // A scrollTo that is no text is read as unwritten.
    expect(aiPageLinkTarget(link({ scrollTo: { section: 4 }, href: '#consultation-form' }), SECTIONS)).toEqual({ kind: 'section', section: 4 })
    expect(aiPageLinkTarget(link({ href: '/contact' }), SECTIONS)).toBeNull()
    expect(aiPageLinkTarget(undefined, SECTIONS)).toBeNull()
  })
})

describe('the interaction a link to a section carries', () => {
  const interaction = aiPageScrollInteraction('ai-job12345678-section-5', 'consultation request form')

  it('is the Scroll to element interaction the editor stores on a node, with its defaults', () => {
    expect(interaction).toEqual({
      id: 'ai-scroll-to-section',
      name: 'Scroll to the consultation request form section',
      enabled: true,
      trigger: { event: 'elementClick', everyTime: true },
      steps: [{ type: 'scrollTo', selector: '[data-aglyn="leaf:ai-job12345678-section-5"]' }],
    })
  })

  it('is collected from its node as the runtime runs it, and is an action the platform keeps', () => {
    const [collected] = collectNodeInteractions([{ $id: 'cta', interactions: [interaction] }, { $id: 'ai-job12345678-section-5' }])
    expect(collected.action).toEqual({
      ...interaction,
      trigger: { event: 'elementClick', everyTime: true, selector: '[data-aglyn="leaf:cta"]' },
    })
    expect(validateHostAction(collected.action)).toBeNull()
  })

  it('is read back from a stored node by the section it scrolls to, and nothing else is', () => {
    expect(aiStoredScrollTargets({ interactions: [interaction] })).toEqual(['ai-job12345678-section-5'])
    const other = (patch: Record<string, unknown>) => ({ interactions: [{ ...interaction, ...patch }] })
    expect(aiStoredScrollTargets(other({ enabled: false }))).toEqual([])
    expect(aiStoredScrollTargets(other({ trigger: { event: 'elementHoverEnter' } }))).toEqual([])
    expect(aiStoredScrollTargets(other({ steps: [{ type: 'toggleElement', selector: '[data-aglyn="leaf:x"]' }] }))).toEqual([])
    expect(aiStoredScrollTargets(other({ steps: [{ type: 'scrollTo', selector: '#consultation-form' }] }))).toEqual([])
    expect([aiStoredScrollTargets({}), aiStoredScrollTargets(null), aiStoredScrollTargets({ interactions: 'x' })]).toEqual([[], [], []])
  })
})
