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
 * The business's phone and email on an AI-built site (AGL-3979): a link to
 * `phone` calls and one to `email` writes; the footer and the page that
 * places the site's form show them as links wherever the design did not; the
 * links survive the palette check and the doctrine; and a start that gave
 * neither builds exactly as before, with no empty contact row anywhere.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { aiSiteContactOf } from '../model/ai-site-details'
import { validateAiDoctrineTree } from '../runtime/ai-doctrine-validators'
import { isContactHref } from '../runtime/ai-node-tree'
import { aiCompileLayoutPage, type AiLayoutPagePlan } from './ai-layout-compiler'
import { aiLayoutContactLabel, aiLayoutContactShown, aiLayoutWithContactLines } from './ai-layout-contact'
import { aiLayoutGuardContacts } from './ai-layout-copy'
import { aiCompileLayoutFrame } from './ai-layout-frame'
import { aiReadLayoutFrame, type AiLayoutSection } from './ai-layout-language'
import { aiLayoutResolveLink, type AiLayoutTargets } from './ai-layout-links'
import { aiLayoutStoredTree } from './ai-layout-store'

const HOME = 'pg-home'
const CONTACT_PAGE = 'pg-contact'
const FORM = 'form-contact'
const PHONE = '(512) 555-0142'
const EMAIL = 'hello@pipeworks.co'
const CONTACT = aiSiteContactOf({ phone: PHONE, email: EMAIL })

const PAGES = [
  { id: HOME, label: 'Home', slug: '/' },
  { id: CONTACT_PAGE, label: 'Contact', slug: '/contact' },
]

const targets = (overrides: Partial<AiLayoutTargets> = {}): AiLayoutTargets => ({
  pageId: CONTACT_PAGE,
  pages: PAGES,
  homeIds: [HOME],
  forms: [{ id: FORM, name: 'Contact form' }],
  formPageId: CONTACT_PAGE,
  components: [],
  facts: `A family plumber in Austin.\nphone: ${PHONE}\nemail: ${EMAIL}`,
  contact: CONTACT,
  ...overrides,
})

const SCOPE = { sections: ['Hero', 'Get in touch'], from: 0, formSection: 1 }

const PLAN: AiLayoutPagePlan = {
  title: 'Contact Pipeworks',
  sections: [
    { name: 'Hero', uses: [], items: 0 },
    { name: 'Get in touch', uses: [FORM], items: 0 },
  ],
}

const SECTIONS: AiLayoutSection[] = [
  { band: 'plain', blocks: [{ kind: 'heading', text: 'Talk to a plumber today' }, { kind: 'lede', text: 'Tell us what is leaking and we will get back to you.' }] },
  {
    band: 'soft',
    cols: [5, 7],
    blocks: [
      { kind: 'heading', col: 0, text: 'Send us a message' },
      { kind: 'text', col: 0, text: 'We answer every message within a working day.' },
      { kind: 'form', col: 1, to: FORM },
    ],
  },
]

const sectionIds = PLAN.sections.map((_, index) => `sec-${index + 1}`)
const pageContext = {
  screenIds: PAGES.map((page) => page.id),
  formIds: [FORM],
  componentIds: [],
  homeScreenIds: [HOME],
  pageSections: PLAN.sections.map((section) => section.name),
  scrollTargetIds: sectionIds,
  repeatsCompiled: true,
  codeBuilt: true,
}

/** A page compiled, stored and checked as the page step does it. */
function page(sections: readonly AiLayoutSection[], given: AiLayoutTargets) {
  const compiled = aiCompileLayoutPage(sections, PLAN, given, { reusableComponents: true, sectionIds })
  const stored = aiLayoutStoredTree(compiled.tree, 'screen', pageContext, sectionIds)
  if (stored.ok === false) throw new Error(stored.error)
  const report = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: stored.nodes }, 'page', pageContext)
  return { stored, report, json: JSON.stringify(stored.nodes) }
}

/** A frame compiled, stored and checked as the layout step does it. */
function frame(raw: unknown, given: AiLayoutTargets) {
  const layoutContext = { screenIds: PAGES.map((entry) => entry.id), formIds: [FORM], homeScreenIds: [HOME], codeBuilt: true }
  const compiled = aiCompileLayoutFrame(aiReadLayoutFrame(raw), { siteName: 'Pipeworks', homeId: HOME, navPages: PAGES }, { ...given, pageId: null })
  const stored = aiLayoutStoredTree(compiled.tree, 'layout', layoutContext)
  if (stored.ok === false) throw new Error(stored.error)
  const report = validateAiDoctrineTree({ rootId: stored.rootId, nodes: stored.nodes }, 'layout', layoutContext)
  return { stored, report, json: JSON.stringify(stored.nodes) }
}

const hrefs = (nodes: Record<string, { props?: Record<string, unknown> }>) =>
  Object.values(nodes)
    .map((node) => node.props?.['href'])
    .filter((href): href is string => typeof href === 'string')

describe('a link to the phone or the email', () => {
  it('calls the number and writes to the address the job was given', () => {
    expect(aiLayoutResolveLink('phone', 'Call us', SCOPE, targets())).toEqual({ kind: 'contact', href: 'tel:5125550142' })
    expect(aiLayoutResolveLink('email', 'Email us', SCOPE, targets())).toEqual({ kind: 'contact', href: `mailto:${EMAIL}` })
    // A number it was not given never becomes a call link.
    expect(aiLayoutResolveLink('tel:5125550199', 'Call', SCOPE, targets())).not.toMatchObject({ kind: 'contact' })
    expect(aiLayoutResolveLink('tel:5125550142', 'Call', SCOPE, targets())).toEqual({ kind: 'contact', href: 'tel:5125550142' })
    expect(aiLayoutResolveLink('mailto:someone@else.com', 'Email', SCOPE, targets())).toBeNull()
  })

  it('goes nowhere it was not given: a call with no number falls back to the words', () => {
    // "Call us" asks to get in touch, so it goes to the form, never to a number.
    expect(aiLayoutResolveLink('phone', 'Call us', { ...SCOPE, from: 1, formSection: null }, targets({ contact: null, pageId: HOME }))).toEqual({
      kind: 'page',
      screenId: CONTACT_PAGE,
    })
  })

  it('keeps words that carry the number or address whole', () => {
    expect(aiLayoutContactLabel(`Email ${EMAIL}`, CONTACT)).toBe(`Email ${EMAIL}`)
    expect(aiLayoutContactLabel('Book a visit', CONTACT)).toBe('')
  })

  it('is a link the palette admits only when well formed', () => {
    expect(isContactHref('tel:5125550142')).toBe(true)
    expect(isContactHref('tel:+442079460958')).toBe(true)
    expect(isContactHref(`mailto:${EMAIL}`)).toBe(true)
    expect(isContactHref('tel:call-me')).toBe(false)
    expect(isContactHref(`mailto:${EMAIL}?bcc=x@y.co`)).toBe(false)
    expect(isContactHref('javascript:alert(1)')).toBe(false)
  })
})

describe('the page that places the site’s form', () => {
  it('shows the phone and email as links beside the form, and passes every check', () => {
    const { stored, report, json } = page(SECTIONS, targets())
    expect(report.violations).toEqual([])
    expect(hrefs(stored.nodes as never)).toEqual(expect.arrayContaining(['tel:5125550142', `mailto:${EMAIL}`]))
    expect(json).toContain(PHONE)
    expect(json).toContain(EMAIL)
    expect(json).not.toMatch(/\[(?:phone|email)[^\]]*\]/i)
  })

  it('adds nothing the design already shows, in its words or as a link', () => {
    const shown: AiLayoutSection[] = [
      SECTIONS[0],
      { ...SECTIONS[1], blocks: [...SECTIONS[1].blocks, { kind: 'button', col: 0, text: `Call ${PHONE}`, to: 'phone' }] },
    ]
    expect(aiLayoutContactShown(shown.flatMap((section) => section.blocks), CONTACT as never)).toEqual({ phone: true, email: false })
    const withLines = aiLayoutWithContactLines(shown, 1, CONTACT)
    const list = withLines[1].blocks.find((block) => block.kind === 'list')
    expect(list?.items).toEqual([{ title: EMAIL, text: '', to: 'email' }])
    // In the column of the words beside the form.
    expect(list?.col).toBe(0)
  })

  it('a start that gave neither builds the page as before, with no contact row', () => {
    const before = page(SECTIONS, targets({ contact: null }))
    expect(before.report.violations).toEqual([])
    expect(hrefs(before.stored.nodes as never).some((href) => /^(?:tel|mailto):/.test(href))).toBe(false)
    expect(aiLayoutWithContactLines(SECTIONS, 1, null)).toBe(SECTIONS)
    expect(before.json).not.toMatch(/\[(?:phone|email)[^\]]*\]/i)
  })
})

describe('the footer', () => {
  const FOOTER = {
    header: { band: 'plain', blocks: [{ kind: 'button', text: 'Call now', to: 'phone' }] },
    footer: {
      band: 'dark',
      cols: [2, 1],
      blocks: [
        { kind: 'heading', col: 0, text: 'Pipeworks' },
        { kind: 'text', col: 0, text: 'Family plumbing for Austin homes.' },
      ],
    },
  }

  it('shows the phone and email under Contact, a header button calls, and every check passes', () => {
    const { stored, report, json } = frame(FOOTER, targets())
    expect(report.violations).toEqual([])
    expect(stored.ok && stored.repairs).toEqual([])
    expect(hrefs(stored.nodes as never).filter((href) => href === 'tel:5125550142').length).toBeGreaterThanOrEqual(2)
    expect(hrefs(stored.nodes as never)).toContain(`mailto:${EMAIL}`)
    expect(json).toContain('"Contact"')
  })

  it('a start that gave neither has no contact column, and its call button goes to the contact page', () => {
    const { stored, report, json } = frame(FOOTER, targets({ contact: null, facts: 'A family plumber in Austin.' }))
    expect(report.violations).toEqual([])
    expect(hrefs(stored.nodes as never).some((href) => /^(?:tel|mailto):/.test(href))).toBe(false)
    expect(json).not.toContain(EMAIL)
    expect(json).not.toContain('555-0142')
    expect(json).toContain(`"screenId":"${CONTACT_PAGE}"`)
    expect(json).not.toMatch(/\[(?:phone|email)[^\]]*\]/i)
  })
})

describe('a phone number the copy writes', () => {
  it('is the given one with or without its country code, else a gap', () => {
    const facts = 'phone: +1 512 555 0142'
    expect(aiLayoutGuardContacts('Call (512) 555-0142 today', facts)).toBe('Call (512) 555-0142 today')
    expect(aiLayoutGuardContacts('Call (512) 555-0199 today', facts)).toBe('Call [phone number] today')
  })
})
