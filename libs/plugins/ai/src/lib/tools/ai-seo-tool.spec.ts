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
 * The SEO tools (AGL-2910): the listing tool is built from the editor's own
 * field list, in both directions, and each check holds an answer to the
 * editor, to the audit's findings and to what the site actually shows.
 */

import {
  SCREEN_SEO_LISTING_FIELDS,
  SCREEN_SEO_CARD_TEXT_FIELDS,
  SEO_LISTING_FIELDS,
  isSeoListingFieldKey,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type { AiSeoFindingCode } from '../model/ai-seo'
import { aiSeoPageFacts } from '../runtime/seo-page-facts'
import {
  AI_SEO_ENTITY_TYPE_VALUES,
  AI_SEO_FIELDS_TOOL_NAME,
  AI_SEO_MAX_KEYWORDS,
  aiSeoFieldsTool,
  aiSeoFixesTool,
  aiSeoKeywordCount,
  aiSeoKeywordCoverage,
  aiSeoKeywordList,
  aiSeoSiteTool,
  checkAiSeoFields,
  checkAiSeoFixes,
  checkAiSeoSite,
  type AiSeoBatchPage,
} from './ai-seo-tool'

type Schema = { properties: Record<string, { description?: string }>; required: string[]; additionalProperties: boolean }

describe('the listing tool is the editor’s field list (parity)', () => {
  const tool = aiSeoFieldsTool(SCREEN_SEO_LISTING_FIELDS)
  const schema = tool.inputSchema as unknown as Schema

  it('offers every field the screen SEO card edits, and states each one’s length', () => {
    expect(Object.keys(schema.properties)).toEqual([...SCREEN_SEO_LISTING_FIELDS])
    for (const key of SCREEN_SEO_LISTING_FIELDS) {
      expect(schema.properties[key].description).toContain(
        `At most ${SEO_LISTING_FIELDS[key].maxLength} characters`,
      )
    }
    // The card's text inputs are all in it; the one field beside them is the image's description.
    expect(SCREEN_SEO_CARD_TEXT_FIELDS.every((key) => key in schema.properties)).toBe(true)
    expect(Object.keys(schema.properties).filter((key) => !(SCREEN_SEO_CARD_TEXT_FIELDS as readonly string[]).includes(key))).toEqual([
      'imageAlt',
    ])
  })

  it('offers nothing the editor cannot hold', () => {
    for (const key of Object.keys(schema.properties)) {
      expect([key, isSeoListingFieldKey(key)]).toEqual([key, true])
      expect(SCREEN_SEO_LISTING_FIELDS).toContain(key)
    }
    expect(schema.required).toEqual(Object.keys(schema.properties))
    expect(schema.additionalProperties).toBe(false)
    expect(tool).toMatchObject({ name: AI_SEO_FIELDS_TOOL_NAME, strict: true })
  })

  it('builds a product’s tool from the product editor’s narrower list, in the catalog’s order', () => {
    const product = aiSeoFieldsTool(['description', 'title']).inputSchema as unknown as Schema
    expect(Object.keys(product.properties)).toEqual(['title', 'description'])
  })
})

describe('checkAiSeoFields', () => {
  const context = { fields: SCREEN_SEO_LISTING_FIELDS, hasImage: true, keywords: ['brass lamps'] }
  const good = {
    title: 'Brass desk lamps, made to order',
    description: 'Hand-finished brass desk lamps with warm dimmable bulbs, built to order in Austin.',
    breadcrumb: 'Desk lamps',
    imageAlt: 'A brass desk lamp lit on a walnut desk',
  }

  it('accepts an answer that keeps every rule, trimmed', () => {
    expect(checkAiSeoFields({ ...good, title: `  ${good.title}  ` }, context)).toEqual({ value: good, violations: [] })
  })

  it('refuses a value past its length, and says the length and the limit', () => {
    const long = 'x'.repeat(SEO_LISTING_FIELDS.title.maxLength + 1)
    const result = checkAiSeoFields({ ...good, title: long }, context)
    expect(result.value).toBeNull()
    expect(result.violations[0]).toMatchObject({
      code: 'too-long',
      message: expect.stringContaining('is 61 characters; the limit is 60.'),
    })
    expect(result.offending).toEqual({ title: long })
  })

  it('requires the title, description and breadcrumb, and lets the image description be null', () => {
    const result = checkAiSeoFields({ ...good, breadcrumb: null, imageAlt: null }, context)
    expect(result.violations.map((violation) => violation.code)).toEqual(['missing'])
    expect(checkAiSeoFields({ ...good, imageAlt: null }, context).value).toEqual({
      title: good.title,
      description: good.description,
      breadcrumb: good.breadcrumb,
    })
  })

  it('drops an image description when the listing has no image, without asking again', () => {
    expect(checkAiSeoFields(good, { ...context, hasImage: false }).value).toEqual({
      title: good.title,
      description: good.description,
      breadcrumb: good.breadcrumb,
    })
  })

  it('refuses a keyword used past its count, and a word repeated to rank', () => {
    const stuffed = checkAiSeoFields({ ...good, title: 'Brass lamps | brass lamps shop' }, context)
    expect(stuffed.violations[0].code).toBe('keyword-stuffing')
    const repeated = checkAiSeoFields(
      { ...good, description: 'Lamps for desks, lamps for floors, lamps for every room.' },
      context,
    )
    expect(repeated.violations[0].code).toBe('repetition')
  })

  it('refuses a title another page uses, whatever its case', () => {
    const result = checkAiSeoFields(good, { ...context, otherTitles: ['brass desk lamps, MADE to order'] })
    expect(result.violations[0].code).toBe('duplicate-title')
  })

  it('refuses a value that is not text', () => {
    expect(checkAiSeoFields({ ...good, title: 42 }, context).violations[0].code).toBe('type')
  })
})

describe('keywords', () => {
  it('counts whole words in any case, and nothing inside a longer word', () => {
    expect(aiSeoKeywordCount('Brass lamps, BRASS LAMPS and brasslamps', 'brass lamps')).toBe(2)
    expect(aiSeoKeywordCount('Lampshade', 'lamp')).toBe(0)
    expect(aiSeoKeywordCount('', 'lamp')).toBe(0)
  })

  it('reads a typed list trimmed, deduplicated and capped', () => {
    expect(aiSeoKeywordList(' Lamps, lamps ,brass\n, ,  desk lamps ')).toEqual(['Lamps', 'brass', 'desk lamps'])
    expect(aiSeoKeywordList('a,b,c,d,e,f,g')).toHaveLength(AI_SEO_MAX_KEYWORDS)
  })

  it('reports where a page already says each keyword', () => {
    expect(
      aiSeoKeywordCoverage(['lamps', 'austin'], { title: 'Desk lamps', body: 'Made in Austin.' }),
    ).toEqual([
      { keyword: 'lamps', inTitle: true, inDescription: false, inH1: false, inBody: false },
      { keyword: 'austin', inTitle: false, inDescription: false, inH1: false, inBody: true },
    ])
  })
})

const facts = aiSeoPageFacts({
  root: { componentId: 'div', nodes: ['main'] },
  main: { componentId: 'section', props: { component: 'main' }, nodes: ['h', 'img', 'img2'] },
  h: { componentId: 'muiTypography', props: { variant: 'h1', children: 'Home' }, nodes: [] },
  img: { componentId: 'image', props: { src: 'media:host-1/lamp' }, nodes: [] },
  img2: { componentId: 'image', props: { src: 'media:host-1/desk', alt: 'A desk' }, nodes: [] },
}, { rootId: 'root' })

const page = (codes: AiSeoFindingCode[], patch: Partial<AiSeoBatchPage> = {}): AiSeoBatchPage => ({
  screenId: 's1',
  path: '/lamps',
  name: 'Lamps',
  codes: new Set(codes),
  keywords: ['lamps'],
  seo: {},
  facts,
  ...patch,
})

describe('checkAiSeoFixes', () => {
  const entry = {
    screenId: 's1',
    title: 'Brass desk lamps',
    description: 'Hand-finished brass lamps for desks.',
    h1: 'Brass desk lamps, made to order',
    imageAlts: [
      { nodeId: 'img', alt: 'A brass lamp' },
      { nodeId: 'img2', alt: 'Already described' },
      { nodeId: 'nope', alt: 'Not an image here' },
    ],
  }

  it('takes each value only where a finding asks for it, and image descriptions only for undescribed images', () => {
    const result = checkAiSeoFixes({ pages: [entry] }, [page(['title-missing', 'image-alt-missing'])], [])
    expect(result.value).toEqual({
      s1: { title: 'Brass desk lamps', description: null, h1: null, imageAlts: [{ nodeId: 'img', alt: 'A brass lamp' }] },
    })
  })

  it('refuses a broken value with the page named, quoting only that page', () => {
    const long = { ...entry, title: 'x'.repeat(61) }
    const result = checkAiSeoFixes({ pages: [long, { ...entry, screenId: 'other' }] }, [page(['title-missing'])], [])
    expect(result.value).toBeNull()
    expect(result.violations[0].message).toContain('Page s1: title is 61 characters')
    expect(result.offending).toEqual({ pages: [long] })
  })

  it('refuses a title another page uses, and a keyword past its count', () => {
    expect(
      checkAiSeoFixes({ pages: [entry] }, [page(['title-duplicate'])], ['BRASS DESK LAMPS']).violations[0].message,
    ).toContain('another page')
    expect(
      checkAiSeoFixes({ pages: [{ ...entry, description: 'Lamps, lamps and lamps.' }] }, [page(['description-missing'])], [])
        .violations[0].message,
    ).toContain('repeats a keyword')
  })

  it('refuses an answer that lists no pages', () => {
    expect(checkAiSeoFixes({}, [page(['title-missing'])], []).violations[0].code).toBe('shape')
  })

  it('offers only the batch’s pages in the tool', () => {
    const schema = aiSeoFixesTool(['s1', 's2']).inputSchema as {
      properties: { pages: { items: { properties: { screenId: { enum: string[] } } } } }
    }
    expect(schema.properties.pages.items.properties.screenId.enum).toEqual(['s1', 's2'])
  })
})

describe('checkAiSeoSite', () => {
  const blank = new Set([
    'seo.entity.type',
    'seo.entity.description',
    'seo.entity.email',
    'seo.entity.telephone',
    'seo.entity.contactType',
    'seo.agent.whenToUse',
  ] as const)
  const siteText = 'Write to hello@acme.test or call +1 (512) 555-0100 for orders.'
  const answer = {
    entityType: 'Organization',
    entityName: 'Acme Lamps',
    entityDescription: 'Acme makes brass desk lamps to order in Austin.',
    contactEmail: 'hello@acme.test',
    contactTelephone: '+1-512-555-0100',
    contactType: 'orders',
    whenToUse: 'Questions about brass desk lamps, their finishes and lead times.',
    howToUse: 'Start from /lamps.',
  }

  it('fills only the fields blank on the site, with the form’s own values', () => {
    const result = checkAiSeoSite(answer, { blank, siteText })
    expect(result.value).toEqual({
      values: {
        'seo.entity.type': AI_SEO_ENTITY_TYPE_VALUES['Organization'],
        'seo.entity.description': answer.entityDescription,
        'seo.entity.email': 'hello@acme.test',
        'seo.entity.telephone': '+1-512-555-0100',
        'seo.entity.contactType': 'orders',
        'seo.agent.whenToUse': answer.whenToUse,
      },
      notes: [],
    })
    // The name and the how-to are set on the site already, so they are not proposed.
    expect(AI_SEO_ENTITY_TYPE_VALUES['Organization']).toBe('1')
  })

  it('leaves out a contact detail no page shows, with a note, rather than asking for one', () => {
    const result = checkAiSeoSite(
      { ...answer, contactEmail: 'sales@acme.test', contactTelephone: '+1 512 555 9999' },
      { blank, siteText },
    )
    expect(result.value?.values['seo.entity.email']).toBeUndefined()
    expect(result.value?.values['seo.entity.telephone']).toBeUndefined()
    expect(result.value?.values['seo.entity.contactType']).toBeUndefined()
    expect(result.value?.notes).toHaveLength(2)
  })

  it('refuses a description or guidance past the form’s length', () => {
    const result = checkAiSeoSite({ ...answer, entityDescription: 'x'.repeat(301) }, { blank, siteText })
    expect(result.value).toBeNull()
    expect(result.violations[0]).toMatchObject({
      code: 'too-long',
      message: 'The entity description is 301 characters; the limit is 300.',
    })
  })

  it('is a strict tool whose every field is required', () => {
    const schema = aiSeoSiteTool().inputSchema as unknown as Schema
    expect(schema.required).toEqual(Object.keys(schema.properties))
    expect(schema.additionalProperties).toBe(false)
  })
})
