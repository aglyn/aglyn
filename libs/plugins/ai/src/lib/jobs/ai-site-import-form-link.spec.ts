/**
 * @license
 * Copyright 2022 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @jest-environment node
 */

/**
 * A redesign's link to `form` on a page with no form of its own (AGL-4152): it
 * goes to the site's page that holds the form, as a link to that page goes,
 * and a refusal names only the destinations the page has. Every fixture is
 * invented, on the replay recordings' `.example` sites.
 */
import type { AiSiteImportPage, AiSiteImportPlan, AiSiteImportState } from '../model/ai-site-import'
import { siteImportReplayDocument } from '../site-import/fixtures/site-import-fidelity-replay'
import { SITE_IMPORT_IMPROVE_ANSWERS } from '../site-import/fixtures/site-import-improve-answers'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, aiSiteImportDocumentOf, type AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportHonesty, aiSiteImportLinkKinds, AI_SITE_IMPORT_INVENTED_FACT_CODE } from './ai-site-import-honesty'
import { aiSiteImportFormPageId } from './ai-job-import-step'
import {
  aiReadImprovedPage,
  aiSiteImportFormPageOf,
  aiSiteImportImproveCheck,
  aiSiteImportImproveDestinations,
  aiSiteImportImprovedPage,
  aiSiteImportImproveLedger,
  aiSiteImportImproveScope,
  type AiSiteImportImprovedPage,
} from './ai-site-import-improve'

type Answer = { sections: Array<{ blocks: Array<Record<string, unknown>> } & Record<string, unknown>> }

/** The contractor's home page: no form of its own, its estimate page holding the site's (`p-estimate`). */
const home = (more: Partial<AiSiteImportDocument> = {}): AiSiteImportDocument => ({ ...(siteImportReplayDocument('contractor') as unknown as AiSiteImportDocument), ...more })

const planTo = (target: string, page?: string): AiSiteImportPlan => ({ site: { what: 'Roofing and remodels', audience: 'Homeowners' }, nav: { groups: [], primaryCta: { label: 'Ask for an estimate', target, ...(page ? { page } : {}) }, footer: [] } }) as unknown as AiSiteImportPlan

/** The recorded contractor answer, its opening's first button sent to `form`. */
const toForm = (): Answer => {
  const answer: Answer = JSON.parse(JSON.stringify(SITE_IMPORT_IMPROVE_ANSWERS.contractor))
  const opening = answer.sections[0] as Answer['sections'][number]
  const at = opening.blocks.findIndex((block) => block['kind'] === 'button')
  opening.blocks[at] = { ...(opening.blocks[at] as Record<string, unknown>), to: 'form' }
  return answer
}

const honestyOf = (doc: AiSiteImportDocument, answer: unknown) => {
  const ledger = aiSiteImportImproveLedger(doc)
  const read = aiReadImprovedPage(answer) ?? []
  const formAt = read.findIndex((section) => section.blocks.some((block) => block.kind === 'keep' && block.ref.startsWith('form:')))
  const destinations = aiSiteImportImproveDestinations(doc, ledger, { sections: read.length, formSection: formAt === -1 ? null : formAt })
  return { destinations, violations: aiSiteImportHonesty(read, { ledger, scope: aiSiteImportImproveScope(doc, null), destinations }) }
}

describe('a link to form on a page with no form (AGL-4152)', () => {
  it('goes to the page the plan sends the header button’s form to', () => {
    const doc = home({ plan: planTo('form', 'p-estimate') })
    expect(aiSiteImportFormPageOf(doc)).toBe('page:p-estimate')
    const { destinations, violations } = honestyOf(doc, toForm())
    expect(destinations.get('form')).toBe('page:p-estimate')
    expect(violations).toEqual([])
  })

  it('else goes to the page the import read a form on', () => {
    const doc = home({ plan: planTo('p-projects'), formPage: 'p-estimate' })
    expect(aiSiteImportFormPageOf(doc)).toBe('page:p-estimate')
    expect(honestyOf(doc, toForm()).violations).toEqual([])
  })

  it('the plan’s form page outranks the read’s', () => {
    expect(aiSiteImportFormPageOf(home({ plan: planTo('form', 'p-projects'), formPage: 'p-estimate' }))).toBe('page:p-projects')
  })

  it('compiles to the same destination as a link to that page', () => {
    const doc = home({ plan: planTo('form', 'p-estimate') })
    const ledger = aiSiteImportImproveLedger(doc)
    let page: AiSiteImportImprovedPage | null = null
    const check = aiSiteImportImproveCheck<true>({
      doc,
      ledger,
      design: { kind: 'business', seed: 7, home: true } as never,
      scope: aiSiteImportImproveScope(doc, null),
      formId: null,
      build: (built) => {
        page = built
        return { value: true, violations: [] }
      },
      score: () => [],
    })
    const result = check(toForm())
    expect(result.violations).toEqual([])
    const linkedTo = (compiled: AiSiteImportImprovedPage | null) => JSON.stringify(compiled?.given).match(/"Ask for an estimate"[^}]*/)?.[0]
    // The recorded answer, its button to the estimate page by its link, compiles that button the same way.
    const plain = aiReadImprovedPage(SITE_IMPORT_IMPROVE_ANSWERS.contractor) ?? []
    const destinations = aiSiteImportImproveDestinations(doc, ledger, { sections: plain.length })
    const recorded = aiSiteImportImprovedPage(plain, { doc, ledger, design: { kind: 'business', seed: 7, home: true } as never, destinations, formId: null })
    expect(linkedTo(page)).toContain('p-estimate')
    expect(linkedTo(page)).toBe(linkedTo(recorded))
  })

  it('a page that keeps its form sends form to it, whatever the plan says', () => {
    const doc = home({ plan: planTo('form', 'p-estimate') })
    const ledger = aiSiteImportImproveLedger(doc)
    expect(aiSiteImportImproveDestinations(doc, ledger, { sections: 3, formSection: 2 }).get('form')).toBe('#3')
  })

  it('is never the page itself, nor a page no link may go to', () => {
    const estimate = home({ url: 'https://www.brightwater-roofing.example/estimate', plan: planTo('form', 'p-estimate') })
    expect(aiSiteImportFormPageOf(estimate)).toBeNull()
    expect(aiSiteImportFormPageOf(home({ formPage: 'p-gone' }))).toBeNull()
  })

  it('where no page of the site holds a form, is refused, and the refusal names no form', () => {
    const { destinations, violations } = honestyOf(home(), toForm())
    expect(destinations.has('form')).toBe(false)
    const refused = violations.filter((violation) => violation.code === AI_SITE_IMPORT_INVENTED_FACT_CODE)
    expect(refused).toHaveLength(1)
    expect(refused[0]?.message).toContain('it links to "form"')
    expect(refused[0]?.message).toContain('which is not a page of this site, phone, a section as #n, or an address the source links.')
    expect(refused[0]?.message).not.toMatch(/\bform,|\bemail\b/)
  })
})

describe('where a page may link, in words (AGL-4152)', () => {
  const none = { links: [] }
  it('names only the kinds the page has', () => {
    expect(aiSiteImportLinkKinds(new Map([['page:p-a', 'page:p-a']]), none)).toBe('a page of this site')
    expect(aiSiteImportLinkKinds(new Map([['page:p-a', 'page:p-a'], ['form', '#2'], ['email', 'mailto:x'], ['#1', '#1']]), none)).toBe('a page of this site, form, email, or a section as #n')
    expect(aiSiteImportLinkKinds(new Map(), none)).toBe('a destination this page has (it has none)')
  })
})

describe('the page that holds the site’s form, as the import step finds it (AGL-4152)', () => {
  const page = (draftId: string, more: Partial<AiSiteImportPage> = {}) => ({ draftId, ...more }) as unknown as AiSiteImportPage
  const state = (pages: AiSiteImportPage[]) => ({ pages }) as Pick<AiSiteImportState, 'pages'>

  it('is the first page whose read has a form with fields, or that saved one once its read was emptied', () => {
    expect(aiSiteImportFormPageId(state([page('d-1'), page('d-2', { read: { forms: [{ fields: [{}] }] } as never })]))).toBe('d-2')
    expect(aiSiteImportFormPageId(state([page('d-1', { forms: [{ index: 0, formId: 'form-1' }] })]))).toBe('d-1')
  })

  it('is none where every form is empty, unsaved, or on a refused page', () => {
    expect(aiSiteImportFormPageId(state([page('d-1', { read: { forms: [{ fields: [] }] } as never }), page('d-2', { forms: [{ index: 0, formId: null }] })]))).toBeNull()
    expect(aiSiteImportFormPageId(state([page('d-1', { refused: true, forms: [{ index: 0, formId: 'form-1' }] } as never)]))).toBeNull()
  })

  it('rides the page job’s document', () => {
    const carried = (formPage: unknown) => aiSiteImportDocumentOf({ [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: { ...home(), formPage } })
    expect(carried('p-estimate')?.formPage).toBe('p-estimate')
    expect(carried(7)?.formPage).toBeUndefined()
  })
})
