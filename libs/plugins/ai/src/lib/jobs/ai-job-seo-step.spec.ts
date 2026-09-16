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
 * The `seo` step (AGL-2910), against a fixture site in a Firestore double
 * that logs every read and every write, with the provider faked at the
 * runtime's `runAiRequest` seam. Nothing here fetches a live site: the audit
 * reads the pages the way the tenant's sitemap lists them, from the fixture.
 *
 * What it proves: what each target sends and how, what comes back as a
 * proposal, that an audit works through its units a pass at a time — and
 * that the step WRITES NOTHING, on any target, on any pass.
 */

type Doc = Record<string, unknown>

let mockDocs = new Map<string, Doc>()
const mockReads: string[] = []
const mockWrites: string[] = []
const mockRunAiRequest = jest.fn()
const mockTemplateScreenIds = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  getTemplateScreenIds: (...args: unknown[]) => mockTemplateScreenIds(...args),
}))

import { SEO_LISTING_FIELDS } from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { aiSeoAuditView, readAiSeoProposal, type AiSeoAuditReport } from '../model/ai-seo'
import { aiModelForStep } from '../providers/routing'
import { AI_TEXT_LIMITS } from '../runtime/ai-palette'
import { AI_SEO_AUDIT_BATCH_SIZE } from '../runtime/seo-audit'
import {
  AI_DOCTRINE_SYSTEM_BLOCK,
  aiDoctrineNeedsInputMessage,
  aiDoctrineSystemBlock,
} from '../runtime/ai-doctrine'
import { AI_SEO_FIELDS_MAX_TOKENS } from '../runtime/seo-fields'
import {
  AI_SEO_AGENT_GUIDANCE_MAX_CHARS,
  AI_SEO_ENTITY_DESCRIPTION_MAX_CHARS,
  AI_SEO_FIELDS_TOOL_NAME,
  AI_SEO_FIXES_TOOL_NAME,
  AI_SEO_FIX_ALT_MAX_CHARS,
  AI_SEO_FIX_IMAGES_PER_PAGE,
  AI_SEO_SITE_TOOL_NAME,
  checkAiSeoFields,
} from '../tools/ai-seo-tool'
import {
  AI_SEO_FIXES_MAX_TOKENS,
  AI_SEO_NO_PAGE_COPY,
  AI_SEO_NO_SITE_COPY,
  AI_SEO_SITE_MAX_TOKENS,
  runAiJobSeoStep,
} from './ai-job-seo-step'

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return {
    id: path.split('/').pop() as string,
    ref: mockRef(path),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ?? {})[field],
  }
}

function mockRef(path: string): any {
  const write = async () => {
    mockWrites.push(path)
  }
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => mockCollection(`${path}/${name}`),
    get: async () => {
      mockReads.push(path)
      return mockSnapshot(path)
    },
    set: write,
    update: write,
    create: write,
    delete: write,
  }
}

function mockQuery(prefix: string, max = Infinity): any {
  return {
    select: () => mockQuery(prefix, max),
    where: () => mockQuery(prefix, max),
    orderBy: () => mockQuery(prefix, max),
    limit: (count: number) => mockQuery(prefix, count),
    get: async () => {
      mockReads.push(prefix)
      const docs = [...mockDocs.keys()]
        .filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .slice(0, max)
        .map(mockSnapshot)
      return { docs, empty: docs.length === 0 }
    },
  }
}

function mockCollection(prefix: string): any {
  return {
    ...mockQuery(prefix),
    doc: (id: string) => mockRef(`${prefix}/${id}`),
    add: async () => {
      mockWrites.push(prefix)
    },
  }
}

const firestore = {
  collection: (name: string) => mockCollection(name),
  runTransaction: async () => {
    throw new Error('the SEO step takes no transaction')
  },
  batch: () => {
    throw new Error('the SEO step writes no batch')
  },
} as unknown as FirebaseFirestore.Firestore

const ORG = 'org-1'
const HOST = 'host-1'
const NOW = new Date('2026-09-15T12:00:00.000Z')
const USAGE = { inputTokens: 1_000, outputTokens: 300, cacheReadTokens: 500, cacheWriteTokens: 0 }

type NodeMap = Record<string, { componentId: string; props?: Doc; nodes?: string[] }>

/** A page: a document root, the site's navigation, and a `main` region holding the children. */
function body(children: NodeMap): NodeMap {
  return {
    root: { componentId: 'div', nodes: ['main'] },
    main: { componentId: 'section', props: { component: 'main' }, nodes: Object.keys(children) },
    ...children,
  }
}
const heading = (level: number, text: string) => ({
  componentId: 'muiTypography',
  props: { variant: `h${level}`, children: text },
  nodes: [],
})
const paragraph = (text: string) => ({ componentId: 'muiTypography', props: { variant: 'body1', children: text }, nodes: [] })

function seed() {
  mockDocs = new Map<string, Doc>([
    [
      `hosts/${HOST}`,
      {
        orgId: ORG,
        displayName: 'Acme Lamps',
        subdomain: 'acme',
        screens: { home: '/', lamps: 'lamps', about: 'about', tpl: 'journal/entry', err: '404', hidden: 'hidden' },
        seo: { description: 'Brass desk lamps.', entity: { name: 'Acme Lamps' }, agent: {} },
      },
    ],
    [`hosts/${HOST}/screens/home`, { displayName: 'Home', versionId: 'hv', seo: { title: 'Acme Lamps — brass desk lamps', description: 'Brass desk lamps made to order.' } }],
    [
      `hosts/${HOST}/screens/home/versions/hv`,
      {
        rootId: 'root',
        nodes: body({
          hh: heading(1, 'Brass desk lamps made to order'),
          hl: { componentId: 'muiButton', props: { children: 'See the lamps', screenId: 'screen:lamps' }, nodes: [] },
          hp: paragraph('Write to hello@acme.test or call +1 512 555 0100.'),
        }),
      },
    ],
    [`hosts/${HOST}/screens/lamps`, { displayName: 'Lamps', versionId: 'lv', seo: {} }],
    [
      `hosts/${HOST}/screens/lamps/versions/lv`,
      {
        rootId: 'root',
        nodes: body({
          lh: heading(2, 'Our lamps'),
          limg: { componentId: 'image', props: { src: 'media:host-1/lamp' }, nodes: [] },
          lp: paragraph('Every lamp is dimmable and finished by hand in Austin.'),
        }),
      },
    ],
    [`hosts/${HOST}/screens/about`, { displayName: 'About', versionId: 'av', seo: { title: 'About Acme' } }],
    [`hosts/${HOST}/screens/about/versions/av`, { rootId: 'root', nodes: body({ ah: heading(1, 'About'), ap: paragraph('We are Acme.') }) }],
    [`hosts/${HOST}/screens/tpl`, { displayName: 'Journal entry', versionId: 'tv', seo: {} }],
    [`hosts/${HOST}/screens/err`, { displayName: 'Not found', versionId: 'ev', seo: {} }],
    [`hosts/${HOST}/screens/hidden`, { displayName: 'Hidden', versionId: 'xv', visibility: 'not-public', seo: {} }],
    [`hosts/${HOST}/layouts/site`, { versionId: 'slv' }],
    [
      `hosts/${HOST}/layouts/site/versions/slv`,
      {
        nodes: {
          root: { componentId: 'div', nodes: ['link'] },
          link: { componentId: 'muiScreenLink', props: { screenId: 'about', children: 'About' }, nodes: [] },
        },
      },
    ],
    ['hosts/host-2', { orgId: 'org-2', screens: {} }],
  ])
}

const job = (patch: Partial<AiJob> = {}): AiJob =>
  ({
    $id: 'job-1',
    orgId: ORG,
    hostId: HOST,
    kind: 'seo',
    status: 'running',
    brief: 'Improve the SEO',
    inputs: { target: 'site' },
    steps: [],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'uid-1',
    ...patch,
  }) as AiJob

const run = (patch: Partial<AiJob> = {}) => runAiJobSeoStep({ job: job(patch), stepIndex: 0, now: NOW, firestore })

const answer = (name: string, input: Doc | null, text = '') => ({
  kind: 'completion',
  text,
  toolUse: input ? [{ name, input }] : [],
  usage: USAGE,
  estCostUsd: 0.002,
  stopReason: input ? 'tool_use' : 'end_turn',
})

beforeEach(() => {
  seed()
  mockReads.length = 0
  mockWrites.length = 0
  mockRunAiRequest.mockReset()
  mockTemplateScreenIds.mockReset()
  mockTemplateScreenIds.mockResolvedValue(new Set(['tpl']))
})

afterEach(() => {
  // The whole contract of the step, asserted after every case.
  expect(mockWrites).toEqual([])
})

describe('a page’s listing', () => {
  const listing = {
    title: 'Dimmable brass desk lamps',
    description: 'Brass desk lamps, dimmable and finished by hand in Austin.',
    breadcrumb: 'Lamps',
  }

  it('asks the fast tier through the strict listing tool, with the rules cached and the page in the user turn', async () => {
    mockRunAiRequest.mockResolvedValue(answer(AI_SEO_FIELDS_TOOL_NAME, listing))
    await run({ inputs: { target: 'screen', screenId: 'lamps', versionId: 'lv', keywords: 'dimmable lamps' } })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request).toMatchObject({ model: aiModelForStep('job.seo'), maxTokens: AI_SEO_FIELDS_MAX_TOKENS, stream: false })
    expect(request.thinking).toBeUndefined()
    expect(request.tools.map((tool: { name: string; strict: boolean }) => [tool.name, tool.strict])).toEqual([
      [AI_SEO_FIELDS_TOOL_NAME, true],
    ])
    // No image on this listing, so the tool asks for no image description.
    expect(Object.keys(request.tools[0].inputSchema.properties)).toEqual(['title', 'description', 'breadcrumb'])
    const system = request.system as Array<{ text: string; cacheBreakpoint?: true; volatile?: true }>
    // The doctrine's cached block first, in its FIELD scope (AGL-2937): a
    // listing composes no document, so it is told the one rule it can break
    // and carries the acceptable-use rules whole, once.
    expect(system[0]).toEqual(aiDoctrineSystemBlock('fields'))
    expect(system[0]).not.toEqual(AI_DOCTRINE_SYSTEM_BLOCK)
    expect(system[0].text).toContain('13. Drafts only.')
    // Rule 14 would have a title publish "[city]" rather than say nothing;
    // the listing's own rules say to write only from the text it was given.
    expect(system[0].text).not.toContain('square brackets')
    expect(system.filter((block) => block.text.includes('Acceptable use'))).toHaveLength(1)
    // The fourth field is not asked for here, so its rule is not sent either.
    expect(system[1].text).not.toContain('image description')
    expect(system[system.length - 1].cacheBreakpoint).toBe(true)
    // A listing is written from its page, so no site inventory rides with it.
    expect(system.some((block) => block.volatile || block.text.startsWith('Site inventory'))).toBe(false)
    for (const block of system) {
      for (const siteByte of ['Acme', 'Austin', 'dimmable']) expect(block.text).not.toContain(siteByte)
    }
    const prompt = request.messages[0].content as string
    expect(prompt).toContain('Site: Acme Lamps')
    expect(prompt).toContain('Page: Lamps (/lamps)')
    expect(prompt).toContain('Target keywords: dimmable lamps')
    expect(prompt).toContain('- Acme Lamps — brass desk lamps')
    expect(prompt).toContain('- About Acme')
    expect(prompt).toContain('finished by hand in Austin')
  })

  it('hands back the listing as a proposal, with what it cost', async () => {
    mockRunAiRequest.mockResolvedValue(answer(AI_SEO_FIELDS_TOOL_NAME, listing))
    const outcome = await run({ inputs: { target: 'screen', screenId: 'lamps', keywords: 'dimmable' } })
    expect(outcome).toMatchObject({ usage: USAGE, estCostUsd: 0.002, stopReason: 'tool_use' })
    expect(outcome.failure).toBeUndefined()
    const [output] = outcome.outputs
    expect(output).toMatchObject({ resource: 'seo', id: 'fields:screen:lamps', hostId: HOST, label: 'SEO proposal · Lamps' })
    expect(readAiSeoProposal(output.proposal)).toEqual({
      kind: 'fields',
      subject: { kind: 'screen', id: 'lamps', name: 'Lamps', path: '/lamps' },
      values: listing,
      keywords: [{ keyword: 'dimmable', inTitle: true, inDescription: true, inH1: false, inBody: true }],
      notes: [],
    })
  })

  it('refuses a site of another org, and a page that is gone, before anything reaches the model', async () => {
    expect((await run({ hostId: 'host-2', inputs: { target: 'screen', screenId: 'lamps' } })).failure).toBe(AI_SEO_NO_SITE_COPY)
    mockDocs.set(`hosts/${HOST}/screens/lamps`, { versionId: 'lv', deletedAt: NOW })
    const gone = await run({ inputs: { target: 'screen', screenId: 'lamps' } })
    expect(gone).toMatchObject({ failure: AI_SEO_NO_PAGE_COPY, estCostUsd: 0 })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('asks again once in the doctrine’s shape, quoting only what broke, then gives up in its sentence with the whole spend', async () => {
    const tooLong = { ...listing, title: 'x'.repeat(SEO_LISTING_FIELDS.title.maxLength + 5) }
    mockRunAiRequest.mockResolvedValue(answer(AI_SEO_FIELDS_TOOL_NAME, tooLong))
    const outcome = await run({ inputs: { target: 'screen', screenId: 'lamps' } })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const first = mockRunAiRequest.mock.calls[0][0].messages as Array<{ role: string; content: string }>
    const again = mockRunAiRequest.mock.calls[1][0].messages as Array<{ role: string; content: string }>
    // The page's turn as it was sent, the answer that broke, then the rules it broke.
    expect(again.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(again[0]).toEqual(first[0])
    expect(again[2].content).toContain('breaks these building rules')
    expect(again[2].content).toContain(`"title":"${tooLong.title}"`)
    expect(again[2].content).not.toContain(`"description"`)
    const { violations } = checkAiSeoFields(tooLong, {
      fields: ['title', 'description', 'breadcrumb'],
      hasImage: false,
      keywords: [],
    })
    expect(violations).toHaveLength(1)
    expect(outcome).toMatchObject({ outputs: [], failure: aiDoctrineNeedsInputMessage(violations), estCostUsd: 0.004 })
    expect(outcome.usage).toEqual({ inputTokens: 2_000, outputTokens: 600, cacheReadTokens: 1_000, cacheWriteTokens: 0 })
  })

  it('passes a model refusal on as a refusal', async () => {
    mockRunAiRequest.mockResolvedValue({ kind: 'refusal', text: '', usage: USAGE, estCostUsd: 0.001, stopReason: 'refusal' })
    expect(await run({ inputs: { target: 'screen', screenId: 'lamps' } })).toMatchObject({ refused: true, outputs: [] })
  })
})

describe('a product’s listing', () => {
  it('writes from what the product editor handed over, and never reads a product', async () => {
    mockRunAiRequest.mockResolvedValue(
      answer(AI_SEO_FIELDS_TOOL_NAME, { title: 'Adjustable brass desk lamp', description: 'An adjustable brass desk lamp.' }),
    )
    const outcome = await run({
      inputs: { target: 'product', productId: 'p1', name: 'Desk lamp', text: 'An adjustable brass desk lamp.', fields: 'title,description' },
    })
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(Object.keys(request.tools[0].inputSchema.properties)).toEqual(['title', 'description'])
    expect(request.messages[0].content).toContain('Product: Desk lamp')
    expect(request.messages[0].content).toContain('Product description:')
    expect(outcome.outputs[0]).toMatchObject({ id: 'fields:product:p1', label: 'SEO proposal · Desk lamp' })
    expect(mockReads.some((path) => path.includes('product'))).toBe(false)
  })
})

describe('the site audit', () => {
  const site = {
    entityType: 'Organization',
    entityName: 'Acme',
    entityDescription: 'Acme Lamps makes brass desk lamps to order in Austin.',
    contactEmail: 'hello@acme.test',
    contactTelephone: '+1 512 555 0100',
    contactType: 'orders',
    whenToUse: 'Questions about brass desk lamps: finishes, dimming and lead times.',
    howToUse: null,
  }
  const fixes = {
    pages: [
      {
        screenId: 'lamps',
        title: 'Brass desk lamps',
        description: 'Brass desk lamps, dimmable and finished by hand.',
        h1: 'Brass desk lamps, made by hand',
        imageAlts: [{ nodeId: 'limg', alt: 'A brass desk lamp' }],
      },
      { screenId: 'about', title: null, description: 'Who makes Acme lamps, and where.', h1: 'About Acme Lamps', imageAlts: [] },
    ],
  }

  async function firstPass(keywords = '/lamps: dimmable lamps') {
    mockRunAiRequest.mockResolvedValueOnce(answer(AI_SEO_SITE_TOOL_NAME, site))
    return run({ inputs: { target: 'site', keywords } })
  }

  it('reads the pages the sitemap lists — not a template, a status page or a page that is not public', async () => {
    const outcome = await firstPass()
    const report = readAiSeoProposal(outcome.outputs[0].proposal) as AiSeoAuditReport
    expect(outcome.outputs[0]).toMatchObject({ resource: 'seo', id: 'audit:report', label: 'SEO audit · 3 pages · 9 findings' })
    expect(report.pages.map((page) => page.path)).toEqual(['/', '/about', '/lamps'])
    expect(mockTemplateScreenIds).toHaveBeenCalledWith({ hostId: HOST })
    expect(mockReads).not.toContain(`hosts/${HOST}/screens/tpl/versions/tv`)
    expect(mockReads).not.toContain(`hosts/${HOST}/screens/hidden/versions/xv`)
  })

  it('scores every page without a model, and links through shared layouts count', async () => {
    const outcome = await firstPass()
    const report = readAiSeoProposal(outcome.outputs[0].proposal) as AiSeoAuditReport
    const codes = (screenId: string) =>
      report.pages.find((page) => page.screenId === screenId)?.findings.map((entry) => entry.code)
    expect(codes('home')).toEqual([])
    expect(codes('lamps')).toEqual(['title-missing', 'description-missing', 'h1-missing', 'image-alt-missing', 'keyword-missing'])
    // Linked only from the site layout's navigation: not an orphan.
    expect(codes('about')).toEqual(['description-missing', 'h1-thin'])
    expect(report.site.map((entry) => entry.code)).toEqual(['entity-incomplete', 'llms-guidance-missing'])
    expect(report.queue).toEqual(['lamps', 'about'])
  })

  it('runs the first unit — the site proposal — in the same pass, and asks to continue', async () => {
    const outcome = await firstPass()
    expect(outcome.continue).toBe(true)
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    const request = mockRunAiRequest.mock.calls[0][0]
    expect(request).toMatchObject({ maxTokens: AI_SEO_SITE_MAX_TOKENS })
    expect(request.tools[0].name).toBe(AI_SEO_SITE_TOOL_NAME)
    expect(request.messages[0].content).toContain('hello@acme.test')
    expect(request.messages[0].content).not.toContain('seo.entity.name')

    expect(outcome.outputs[1]).toMatchObject({ id: 'audit:site', resource: 'seo' })
    const proposal = readAiSeoProposal(outcome.outputs[1].proposal)
    expect(proposal?.kind).toBe('site')
    const siteProposal = proposal?.kind === 'site' ? proposal.site : null
    // Only the fields the site has blank; the name it already has is left alone.
    expect(siteProposal?.values).toEqual({
      'seo.entity.type': '1',
      'seo.entity.description': site.entityDescription,
      'seo.entity.email': 'hello@acme.test',
      'seo.entity.telephone': '+1 512 555 0100',
      'seo.entity.contactType': 'orders',
      'seo.agent.whenToUse': site.whenToUse,
    })
    expect(siteProposal?.llmsPreview).toContain('# Acme Lamps')
    expect(siteProposal?.llmsPreview).toContain(site.whenToUse)
    expect(siteProposal?.llmsPreview).toContain('mailto:hello@acme.test')
  })

  it('runs the next unit on the next pass — a batch of fixes — and stops asking when nothing is left', async () => {
    const first = await firstPass()
    mockRunAiRequest.mockResolvedValueOnce(answer(AI_SEO_FIXES_TOOL_NAME, fixes))
    const second = await run({ inputs: { target: 'site' }, outputs: first.outputs })
    expect(second.continue).toBeUndefined()
    expect(second.outputs.map((output) => output.id)).toEqual(['audit:fixes:1'])
    const request = mockRunAiRequest.mock.calls[1][0]
    expect(request).toMatchObject({ maxTokens: AI_SEO_FIXES_MAX_TOKENS })
    expect(request.tools[0].inputSchema.properties.pages.items.properties.screenId.enum).toEqual(['lamps', 'about'])
    expect(request.messages[0].content).toContain('- limg: beside "Our lamps"')
    expect(request.messages[0].content).toContain('Titles other pages use:')

    const view = aiSeoAuditView([...first.outputs, ...second.outputs] as AiJobOutput[])
    expect(view?.complete).toBe(true)
    expect(view?.fixes['lamps']).toEqual({
      screenId: 'lamps',
      values: { title: 'Brass desk lamps', description: 'Brass desk lamps, dimmable and finished by hand.' },
      content: [
        { kind: 'image-alt', nodeId: 'limg', alt: 'A brass desk lamp' },
        // No main heading: the page's own heading is promoted rather than a new one added.
        { kind: 'h1-set', nodeId: 'lh', text: 'Brass desk lamps, made by hand' },
      ],
      guidance: [],
    })
    expect(view?.fixes['about']).toEqual({
      screenId: 'about',
      values: { description: 'Who makes Acme lamps, and where.' },
      content: [{ kind: 'h1-set', nodeId: 'ah', text: 'About Acme Lamps' }],
      guidance: [],
    })
  })

  it('records a unit the model declined with a note, and still moves on', async () => {
    mockRunAiRequest.mockResolvedValueOnce({ kind: 'refusal', text: '', usage: USAGE, estCostUsd: 0.001, stopReason: 'refusal' })
    const outcome = await run({ inputs: { target: 'site' } })
    expect(outcome.refused).toBeUndefined()
    expect(outcome.continue).toBe(true)
    const proposal = readAiSeoProposal(outcome.outputs[1].proposal)
    expect(proposal?.kind === 'site' ? proposal.site.notes : []).toEqual([
      'The AI declined to propose structured data for this site.',
    ])
  })

  it('asks again once for a site answer the check refuses, then keeps the doctrine’s sentence as the unit’s note', async () => {
    mockRunAiRequest.mockResolvedValue(answer(AI_SEO_SITE_TOOL_NAME, { ...site, entityDescription: 'x'.repeat(301) }))
    const outcome = await run({ inputs: { target: 'site' } })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const again = mockRunAiRequest.mock.calls[1][0].messages as Array<{ role: string; content: string }>
    expect(again.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(again[2].content).toContain('The entity description is 301 characters; the limit is 300.')
    expect(outcome.continue).toBe(true)
    const proposal = readAiSeoProposal(outcome.outputs[1].proposal)
    expect(proposal?.kind === 'site' ? proposal.site.notes : []).toEqual([
      aiDoctrineNeedsInputMessage([
        { rule: null, code: 'too-long', message: 'The entity description is 301 characters; the limit is 300.' },
      ]),
    ])
  })

  it('says which keyword lines named no audited page', async () => {
    const outcome = await firstPass('/nowhere: lamps')
    const report = readAiSeoProposal(outcome.outputs[0].proposal) as AiSeoAuditReport
    expect(report.notes).toEqual(['Keywords for /nowhere were not used: no audited page is published at that address.'])
  })
})

describe('measured budgets', () => {
  const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 3)

  it('fits the largest listing answer the tool accepts', () => {
    const largest = Object.fromEntries(
      Object.values(SEO_LISTING_FIELDS).map((field) => [field.key, 'x'.repeat(field.maxLength)]),
    )
    expect(tokens(largest) * 1.25).toBeLessThanOrEqual(AI_SEO_FIELDS_MAX_TOKENS)
  })

  it('fits the largest batch answer the check accepts', () => {
    const largest = {
      pages: Array.from({ length: AI_SEO_AUDIT_BATCH_SIZE }, (_, index) => ({
        screenId: `screen-${String(index).padStart(12, '0')}`,
        title: 'x'.repeat(SEO_LISTING_FIELDS.title.maxLength),
        description: 'x'.repeat(SEO_LISTING_FIELDS.description.maxLength),
        h1: 'x'.repeat(AI_TEXT_LIMITS.headline),
        imageAlts: Array.from({ length: AI_SEO_FIX_IMAGES_PER_PAGE }, (__, image) => ({
          nodeId: `node-${image}-xxxxxxxxxxxx`,
          alt: 'x'.repeat(AI_SEO_FIX_ALT_MAX_CHARS),
        })),
      })),
    }
    expect(tokens(largest) * 1.25).toBeLessThanOrEqual(AI_SEO_FIXES_MAX_TOKENS)
  })

  it('fits the largest site answer the check accepts', () => {
    const largest = {
      entityType: 'Organization',
      entityName: 'x'.repeat(200),
      entityDescription: 'x'.repeat(AI_SEO_ENTITY_DESCRIPTION_MAX_CHARS),
      contactEmail: `${'x'.repeat(60)}@example.test`,
      contactTelephone: '+1 512 555 0100 extension 12345',
      contactType: 'x'.repeat(100),
      whenToUse: 'x'.repeat(AI_SEO_AGENT_GUIDANCE_MAX_CHARS),
      howToUse: 'x'.repeat(AI_SEO_AGENT_GUIDANCE_MAX_CHARS),
    }
    expect(tokens(largest) * 1.25).toBeLessThanOrEqual(AI_SEO_SITE_MAX_TOKENS)
  })
})
