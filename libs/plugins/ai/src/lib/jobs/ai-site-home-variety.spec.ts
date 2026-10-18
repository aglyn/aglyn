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

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { AiBuildPlan, AiBuildPlanScreen } from '../model/ai-build-plan'
import type { AiJob } from '../model/ai-jobs.types'
import { aiPlanCapabilitiesForJob, type AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiSiteHomeArc, aiSiteHomeArcsFor } from '../model/ai-site-home-arcs'
import { AI_SITE_KINDS } from '../model/ai-site-kinds'
import { AI_SITE_HOME_MIN_SECTIONS, AI_SITE_THIN_HOME_CODE, aiSiteThinHomeViolations } from '../model/ai-site-job'
import { aiSiteStartBrief, AI_SITE_START_ANSWERS } from '../model/ai-site-start'
import { aiSiteSeed } from '../model/ai-site-look'
import { aiDoctrinePlanCheck } from '../runtime/ai-doctrine'
import { aiSettlePlanHomeForms } from '../runtime/ai-doctrine-validators'
import { aiCompileLayoutPage } from '../layout-language/ai-layout-compiler'
import { aiLayoutDesignChoices } from '../layout-language/ai-layout-design'
import type { AiLayoutTargets } from '../layout-language/ai-layout-links'
import type { AiLayoutSection } from '../layout-language/ai-layout-language'
import { aiPlanCapabilitiesFrom } from './ai-job-drafts'
import { aiLayoutFormLine, aiLayoutFormPageOfPlan } from './ai-job-page-language'
import {
  AI_JOB_PLAN_SCOPES,
  AI_SITE_FORM_PAGE_SENTENCE,
  AI_SITE_ITEMS_SENTENCE,
  aiJobPlanPrompt,
  aiPlanSiteLines,
  aiSiteFormStaysHome,
  aiSitePlanCapabilities,
  aiSitePlanHomeArc,
  aiSitePlanHomeRule,
} from './ai-job-plan-step'

/**
 * Every AI site gets its own home (AGL-3899). Zach, 2026-10-16: "almost
 * every AI site seems to look the same, like they all have a form on the
 * home page at the bottom, they all have the same sections". Of the 22
 * newest production starts, 16 homes were hero → offer → about → proof →
 * closing call to action, 17 carried the contact form (16 in the last band)
 * and 47 of 55 groups had three items.
 */

const NOW = new Date('2026-10-16T12:00:00Z')
const FREE_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: 'free', ownerUid: 'owner-1' }
const PAID_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: 'business', ownerUid: 'owner-1' }

/** A site as provisioning leaves it (AGL-3497): its layout and its untouched starter home. */
const PROVISIONED: AiSiteInventory = {
  ...emptyAiSiteInventory('host-1'),
  layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }],
  screens: [{ id: 'scrStarter', name: 'Home', slug: '/', layoutId: 'laySite', template: false, replaceable: true }],
}
const LAYOUTS = { layout: [{ id: 'laySite', kind: undefined, sourceType: undefined, deletedAt: undefined }], template: [] }

function siteJob(id: string, inputs: Record<string, unknown> = {}, brief = 'A 2-page website for a neighborhood dog groomer.'): AiJob {
  return {
    $id: id,
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'site',
    status: 'running',
    brief,
    inputs: { businessType: 'a neighborhood dog groomer', siteKind: 'business', pages: 2, welcomeEmail: false, ...inputs },
    steps: [{ name: 'plan', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
}

function capabilitiesFor(job: AiJob, org: typeof FREE_ORG): AiPlanCapabilities {
  return aiSitePlanCapabilities(job, aiPlanCapabilitiesForJob(aiPlanCapabilitiesFrom(org, LAYOUTS), AI_JOB_PLAN_SCOPES.site ?? null)) as AiPlanCapabilities
}

const shape = (kind: string, id: string) => aiSiteHomeArc({ kind, seed: aiSiteSeed(id) }).sections.map((section) => section.role).join(' > ')
const ids = (count: number) => Array.from({ length: count }, (_, index) => `job${String(index).padStart(4, '0')}x${(index * 7919).toString(36)}`)

function screen(title: string, slug: string, sections: Array<[string, string[]?, number?]>): AiBuildPlanScreen {
  return {
    title,
    slug,
    layout: 'laySite',
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: `${title} | Fern & Fur`,
    seoDescription: `${title} at Fern & Fur, a neighborhood dog groomer.`,
    sections: sections.map(([name, uses = [], items = 0]) => ({ name, uses, items })),
  } as AiBuildPlanScreen
}

const targets = (formPageId: string | null): AiLayoutTargets => ({
  pageId: 'pg-home',
  pages: [
    { id: 'pg-home', label: 'Home', slug: '/' },
    { id: 'pg-contact', label: 'Contact', slug: '/contact' },
  ],
  homeIds: ['pg-home'],
  forms: [{ id: 'form-contact', name: 'Contact form' }],
  formPageId,
  components: [],
  facts: 'A neighborhood dog groomer.',
})

const CONTACT_FORM = { kind: 'form' as const, name: 'Contact form', why: 'The site has no form.', duplicateOf: null, fields: ['name', 'email', 'message'] }

describe('a seeded home arc (AGL-3899)', () => {
  it('gives every kind three to five arcs, each its own order, each a hero and at least four sections', () => {
    for (const kind of AI_SITE_KINDS) {
      const arcs = aiSiteHomeArcsFor(kind.id)
      expect([kind.id, arcs.length >= 3 && arcs.length <= 5]).toEqual([kind.id, true])
      expect(new Set(arcs.map((arc) => arc.id)).size).toBe(arcs.length)
      expect(new Set(arcs.map((arc) => arc.sections.map((section) => section.role).join(' > '))).size).toBe(arcs.length)
      for (const arc of arcs) expect(1 + arc.sections.length).toBeGreaterThanOrEqual(AI_SITE_HOME_MIN_SECTIONS)
    }
  })

  it('never plans what a new site has none of: no testimonials, and every figure, price or listing only as the brief gives it', () => {
    for (const kind of AI_SITE_KINDS) {
      for (const arc of aiSiteHomeArcsFor(kind.id)) {
        for (const section of arc.sections) {
          if (kind.id !== 'store') expect(section.words).not.toMatch(/testimonial|review|kind words|what .* say/i)
          if (/\b(?:prices?|packages|impact|memberships?|hours|shows|listings)\b/i.test(section.words)) {
            expect(`${kind.id}: ${section.words}`).toMatch(/only as the brief (?:gives|names)|the owner fills in/)
          }
        }
      }
    }
  })

  it('draws at least three different homes over 20 seeds of one brief, for every kind', () => {
    for (const kind of AI_SITE_KINDS) {
      const shapes = new Set(ids(20).map((id) => shape(kind.id, id)))
      expect([kind.id, shapes.size >= 3]).toEqual([kind.id, true])
    }
    // The measured case: one business brief, 20 jobs.
    const business = new Set(ids(20).map((id) => shape('business', id)))
    expect(business.size).toBeGreaterThanOrEqual(3)
  })

  it('tells two identical briefs with different seeds two different homes, in one line of the plan turn', () => {
    const [first, ...rest] = ids(20)
    const other = rest.find((id) => shape('business', id) !== shape('business', first)) as string
    const free = capabilitiesFor(siteJob(first), FREE_ORG)
    const one = aiJobPlanPrompt(siteJob(first), free, PROVISIONED)
    const two = aiJobPlanPrompt(siteJob(other), free, PROVISIONED)
    const arcLine = (prompt: string) => prompt.split('\n').filter((line) => line.startsWith("This site's home tells its story"))
    expect(arcLine(one)).toHaveLength(1)
    expect(arcLine(two)).toHaveLength(1)
    expect(arcLine(one)).not.toEqual(arcLine(two))
    // Everything else the two are told is the same.
    expect(one.split('\n').filter((line) => !arcLine(one).includes(line))).toEqual(two.split('\n').filter((line) => !arcLine(two).includes(line)))
  })

  it('draws the arc from the site start, so a page derived from it is told the same one', () => {
    const origin = siteJob('jobOrigin123')
    const derived = { $id: 'jobDerived456', inputs: { ...origin.inputs, originJobId: 'jobOrigin123' } }
    expect(aiSitePlanHomeArc(derived)).toEqual(aiSitePlanHomeArc(origin))
    expect(aiSitePlanHomeArc({ inputs: origin.inputs })).toBeNull()
  })

  it.each([
    ['Free', FREE_ORG],
    ['paid', PAID_ORG],
  ])('holds every arc of every kind to the home minimum and, on %s, the wall', (_label, org) => {
    const failures: string[] = []
    for (const kind of AI_SITE_KINDS) {
      const job = siteJob('jobArcs', { siteKind: kind.id })
      const capabilities = capabilitiesFor(job, org)
      const rule = aiSitePlanHomeRule(PROVISIONED, capabilities)
      for (const arc of aiSiteHomeArcsFor(kind.id)) {
        const home = screen('Home', '/', [
          ['Hero'],
          ...arc.sections.map((section): [string, string[], number] => [section.words.replace(/"/g, ''), [], section.role === 'cta' ? 0 : 4]),
        ])
        const contact = screen('Contact', '/contact', [['Contact intro'], ['Contact form', ['new:Contact form']]])
        const plan: AiBuildPlan = { reuse: [{ kind: 'layout', id: 'laySite', purpose: 'the site layout' }], create: [CONTACT_FORM], screens: [home, contact] } as AiBuildPlan
        const result = aiDoctrinePlanCheck(PROVISIONED, null, capabilities, null, (placed) =>
          aiSettlePlanHomeForms(placed, PROVISIONED, { keep: aiSiteFormStaysHome(job, capabilities.freeSitePages) }),
        )(plan as never)
        const settled = result.value as AiBuildPlan
        const codes = result.violations.map((violation) => violation.code)
        const blocking = codes.filter((code) => code === 'plan-over-free-wall' || code === 'plan-form-not-placed' || code === 'plan-store-shop-page')
        if (blocking.length) failures.push(`${kind.id}/${arc.id}: ${blocking.join(', ')}`)
        if (aiSiteThinHomeViolations(settled, rule).some((violation) => violation.code === AI_SITE_THIN_HOME_CODE)) {
          failures.push(`${kind.id}/${arc.id}: thin home (${settled.screens[0].sections.length})`)
        }
        if (settled.screens[0].sections[0].name !== 'Hero') failures.push(`${kind.id}/${arc.id}: the hero is not first`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('the form lives on the contact page (AGL-3899)', () => {
  const plan = (home: Array<[string, string[]?, number?]>, other: Array<[string, string[]?, number?]>, title = 'Contact', slug = '/contact'): AiBuildPlan =>
    ({
      reuse: [{ kind: 'layout', id: 'laySite', purpose: 'the site layout' }],
      create: [CONTACT_FORM],
      screens: [screen('Home', '/', home), screen(title, slug, other)],
    }) as AiBuildPlan

  it('takes the form off a home whose Contact page holds it, and names the closing band for what it still is', () => {
    const before = plan(
      [['Hero'], ['Services', [], 4], ['Contact us', ['new:Contact form']], ['Closing call to action with contact form', ['new:Contact form']]],
      [['Contact intro'], ['Contact form', ['new:Contact form']]],
    )
    const after = aiSettlePlanHomeForms(before, PROVISIONED, { keep: false })
    expect(after.screens[0].sections).toEqual([
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Services', uses: [], items: 4 },
      { name: 'Get in touch', uses: [], items: 0 },
      { name: 'Closing call to action', uses: [], items: 0 },
    ])
    expect(after.screens[1]).toEqual(before.screens[1])
    // The form's fields and where its answers go are the plan's, untouched.
    expect(after.create).toEqual(before.create)
  })

  it('moves the form to a page that reads as the contact page when only the home placed it', () => {
    const before = plan([['Hero'], ['About'], ['Book a visit', ['new:Contact form']]], [['Booking intro'], ['Visit us and hours']], 'Book a visit', '/book')
    const after = aiSettlePlanHomeForms(before, PROVISIONED, { keep: false })
    expect(after.screens[0].sections.flatMap((section) => section.uses)).toEqual([])
    expect(after.screens[1].sections.map((section) => section.uses)).toEqual([[], ['new:Contact form']])
    expect(aiLayoutFormPageOfPlan({ create: after.create, screens: after.screens.map((entry, index) => ({ ...entry, id: `p${index}` })) })).toBe('p1')
  })

  it('keeps the form on the home where no other page could hold it, a one-page site, or a start that keeps it there', () => {
    const lonely = plan([['Hero'], ['Contact us', ['new:Contact form']]], [['Services', [], 4], ['Pricing', [], 3]], 'Services', '/services')
    expect(aiSettlePlanHomeForms(lonely, PROVISIONED, { keep: false })).toBe(lonely)
    const onePage = { ...lonely, screens: [lonely.screens[0]] }
    expect(aiSettlePlanHomeForms(onePage, PROVISIONED, { keep: false })).toBe(onePage)
    const both = plan([['Hero'], ['Contact us', ['new:Contact form']]], [['Contact form', ['new:Contact form']]])
    expect(aiSettlePlanHomeForms(both, PROVISIONED, { keep: true })).toBe(both)
  })

  it('invents no form, and leaves a newsletter sign-up as it is', () => {
    const none = { ...plan([['Hero'], ['Closing call to action']], [['Contact intro']]), create: [] }
    expect(aiSettlePlanHomeForms(none, PROVISIONED, { keep: false })).toBe(none)
    const signup = plan([['Hero'], ['Newsletter sign-up', ['new:Contact form']]], [['Contact form', ['new:Contact form']]])
    expect(aiSettlePlanHomeForms(signup, PROVISIONED, { keep: false })).toBe(signup)
  })

  it('decides which homes keep the form: one page, a landing or coming-soon page, a brief that asks', () => {
    expect(aiSiteFormStaysHome(siteJob('a'))).toBe(false)
    expect(aiSiteFormStaysHome(siteJob('a', { pages: 1 }))).toBe(true)
    expect(aiSiteFormStaysHome(siteJob('a', { pages: 5 }), 1)).toBe(true)
    expect(aiSiteFormStaysHome(siteJob('a', { siteKind: 'landing' }))).toBe(true)
    expect(aiSiteFormStaysHome(siteJob('a', { siteKind: 'coming-soon' }))).toBe(true)
    expect(aiSiteFormStaysHome(siteJob('a', {}, 'A 3-page site. Put a contact form on the home page, please.'))).toBe(true)
    expect(aiSiteFormStaysHome(siteJob('a', {}, aiSiteStartBrief({ ...AI_SITE_START_ANSWERS, siteType: 'a dog groomer', pages: 3 })))).toBe(false)
  })

  it('tells the plan where the form goes, and drops "one form may be placed on several pages"', () => {
    const free = capabilitiesFor(siteJob('a'), FREE_ORG)
    const lines = aiPlanSiteLines(siteJob('a'), PROVISIONED, free).join('\n')
    expect(lines).toContain('Put the contact form on the page that is not the home page.')
    expect(lines).toContain(AI_SITE_FORM_PAGE_SENTENCE)
    expect(lines).not.toContain('One form may be placed on several pages')
    const landing = aiPlanSiteLines(siteJob('a', { siteKind: 'landing' }), PROVISIONED, free).join('\n')
    expect(landing).toContain('Put the contact form on the home page.')
    expect(landing).not.toContain(AI_SITE_FORM_PAGE_SENTENCE)
  })

  it('settles the form off the home through the plan step’s own check, before any rule reads it', () => {
    const job = siteJob('a')
    const capabilities = capabilitiesFor(job, FREE_ORG)
    const answer = plan(
      [['Hero'], ['Services', [], 4], ['How it works', [], 4], ['Questions', [], 5], ['Contact us']],
      [['Contact intro'], ['Contact form']],
    )
    const result = aiDoctrinePlanCheck(PROVISIONED, null, capabilities, null, (placed) =>
      aiSettlePlanHomeForms(placed, PROVISIONED, { keep: false }),
    )(answer as never)
    const settled = result.value as AiBuildPlan
    expect(result.violations.map((violation) => violation.code)).not.toContain('plan-form-not-placed')
    expect(settled.screens[0].sections.at(-1)).toEqual({ name: 'Get in touch', uses: [], items: 0 })
    expect(settled.screens[1].sections[1].uses).toEqual(['new:Contact form'])
  })

  it('tells a page that places no form where the form lives, and a page that places it the form', () => {
    const home = { sections: [{ name: 'Hero', uses: [], items: 0 }, { name: 'Closing call to action', uses: [], items: 0 }] }
    expect(aiLayoutFormLine(home, targets('pg-contact'))).toBe(
      "The site's form is on the Contact page (page:pg-contact): place no form on this page, and make a call to action that asks visitors to get in touch a button to that page.",
    )
    expect(aiLayoutFormLine(home, targets(null))).toBe("The site's form: Contact form (form-contact).")
    expect(aiLayoutFormLine({ sections: [{ name: 'Get in touch', uses: ['form-contact'], items: 0 }] }, targets('pg-contact'))).toBe(
      "The site's form: Contact form (form-contact).",
    )
  })

  const closing: AiLayoutSection[] = [
    { band: 'plain', blocks: [{ kind: 'heading', text: 'Grooming, gently' }, { kind: 'lede', text: 'Calm visits for nervous dogs.' }] },
    { band: 'brand', blocks: [{ kind: 'heading', text: 'Book a calm groom' }, { kind: 'text', text: 'Tell us about your dog.' }, { kind: 'form' }] },
  ]
  const homePlan = { title: 'Home', sections: [{ name: 'Hero', uses: [], items: 0 }, { name: 'Closing call to action', uses: [], items: 0 }] }

  it('draws a form the design put on the home as a button to the Contact page that holds it', () => {
    const compiled = aiCompileLayoutPage(closing, homePlan, targets('pg-contact'), { reusableComponents: false, sectionIds: ['s1', 's2'] })
    const nodes = Object.values(compiled.tree.nodes)
    expect(nodes.some((node) => node.componentId === 'form')).toBe(false)
    expect(nodes.some((node) => (node.props as Record<string, unknown> | undefined)?.['screenId'] === 'pg-contact')).toBe(true)
    expect(compiled.settled.map((entry) => entry.what)).toContain('a form on a page it does not live on; a button to its page instead')
  })

  it('keeps a one-page site’s form where its design drew it', () => {
    const compiled = aiCompileLayoutPage(closing, homePlan, { ...targets(null), pages: [{ id: 'pg-home', label: 'Home', slug: '/' }] }, {
      reusableComponents: false,
      sectionIds: ['s1', 's2'],
    })
    expect(Object.values(compiled.tree.nodes).some((node) => node.componentId === 'form')).toBe(true)
  })
})

describe('item counts and the compiler’s choices vary (AGL-3899)', () => {
  it('tells the plan to use as many items as the content has, never 3 everywhere', () => {
    const free = capabilitiesFor(siteJob('a'), FREE_ORG)
    expect(aiPlanSiteLines(siteJob('a'), PROVISIONED, free)).toContain(AI_SITE_ITEMS_SENTENCE)
    expect(AI_SITE_ITEMS_SENTENCE).toContain('from 2 to 6')
  })

  it('draws a group with as many items as the design gave it, two to six', () => {
    for (const count of [2, 4, 5, 6]) {
      const items = Array.from({ length: count }, (_, index) => ({ title: `Offer ${index + 1}`, text: `A short line about offer ${index + 1}.` }))
      const compiled = aiCompileLayoutPage(
        [{ blocks: [{ kind: 'heading', text: 'Grooming, gently' }] }, { blocks: [{ kind: 'heading', text: 'What we offer' }, { kind: 'cards', items }] }],
        { title: 'Home', sections: [{ name: 'Hero', uses: [], items: 0 }, { name: 'What we offer', uses: [], items: count }] },
        targets(null),
        { reusableComponents: false, sectionIds: ['s1', 's2'], design: { kind: 'business', seed: 7, home: true } },
      )
      expect(compiled.itemIds[1]).toHaveLength(count)
    }
  })

  it('draws heroes, group styles and photo-led sections at even odds where the kind allows', () => {
    const seeds = Array.from({ length: 600 }, (_, index) => (index * 2_654_435_761) >>> 0)
    const tally = (kind: string, pick: (choices: ReturnType<typeof aiLayoutDesignChoices>) => string) => {
      const counts = new Map<string, number>()
      for (const seed of seeds) {
        const value = pick(aiLayoutDesignChoices({ kind, seed, home: true }))
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      return counts
    }
    // Business opens split, cover or editorial: each about a third.
    const heroes = tally('business', (choices) => choices.hero)
    expect([...heroes.keys()].sort()).toEqual(['cover', 'editorial', 'split'])
    for (const count of heroes.values()) expect(count / seeds.length).toBeGreaterThan(0.25)
    // A kind of two heroes takes each about half the time, never its first 77%.
    const yoga = tally('yoga', (choices) => choices.hero)
    for (const count of yoga.values()) expect(count / seeds.length).toBeGreaterThan(0.4)
    const groups = tally('business', (choices) => choices.group)
    expect([...groups.keys()].sort()).toEqual(['cards', 'icons', 'ruled'])
    for (const count of groups.values()) expect(count / seeds.length).toBeGreaterThan(0.25)
    const features = tally('business', (choices) => String(choices.features))
    expect([...features.keys()].sort()).toEqual(['false', 'true'])
    // A storefront's story always takes its photo (AGL-3676).
    expect([...tally('store', (choices) => String(choices.features)).keys()]).toEqual(['true'])
  })
})
