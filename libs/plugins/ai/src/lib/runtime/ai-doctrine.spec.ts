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

import { createHash } from 'node:crypto'
import { formatMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import { ESTIMATED_PAGE_TRANSFER_BYTES } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_BUILD_PLAN_LIMITS, AI_BUILD_PLAN_TOOL, type AiBuildPlan } from '../model/ai-build-plan'
import {
  AI_SITE_INVENTORY_LISTED_PER_KIND,
  AI_SITE_INVENTORY_MAX_CHARS,
  emptyAiSiteInventory,
  type AiSiteInventory,
} from '../model/ai-site-inventory'
import type {
  AiCompletion,
  AiProvider,
  AiProviderRequest,
  AiResult,
  AiSystemBlock,
  AiTool,
} from '../providers/contract'
import {
  AI_BUILDING_DOCTRINE,
  AI_DOCTRINE_SYSTEM_BLOCK,
  AI_GENERATION_MAX_TOKENS,
  aiDoctrineCatalog,
  aiDoctrineScopeFor,
  aiDoctrineSystemBlock,
  aiDoctrineSystemBlocks,
  aiDoctrineTreeTool,
  aiNodeTreeContextFromInventory,
  aiSiteInventoryBlock,
  runValidatedGeneration,
  validateStreamedGeneration,
  type AiGenerationCheck,
} from './ai-doctrine'
import {
  AI_INVENTORY_LOOKUP_MAX_ROUNDS,
  AI_INVENTORY_LOOKUP_TOOL_NAME,
  aiInventoryLookupTool,
} from '../tools/ai-inventory-lookup-tool'
import {
  AI_DOCTRINE_RULES,
  AI_REPEAT_MIN_COUNT,
  AI_SEO_DESCRIPTION_MAX,
  AI_SEO_TITLE_MAX,
  AI_SIMILAR_PAGES_MIN,
} from './ai-doctrine-validators'
import { AI_SURFACE_NAMES } from './ai-palette'
import { AI_PALETTE, AI_PALETTE_CATALOG, AI_SURFACES } from './ai-palette.generated'
import {
  AI_ACCEPTABLE_USE_BLOCK,
  AI_MAX_CACHE_BREAKPOINTS,
  validateAiSystemBlocks,
} from './ai-runtime'

/**
 * The building doctrine's prompt and its loop (AGL-2935).
 *
 *  - THE CACHE KEY. The doctrine block is the same bytes for every org and
 *    every site, so the platform pays one cache entry for it; only the
 *    inventory differs per site, and it is volatile and last. The doctrine's
 *    text is pinned by hash, so a change to what every generator is told is
 *    a deliberate cache break rather than an accident.
 *  - THE INVENTORY CAP. However large the site, the block stays inside its
 *    ceiling and says which kinds were cut.
 *  - THE RE-ASK. One answer, one re-ask naming the broken rules and quoting
 *    only the parts at fault, then `needs_input` — with both answers billed.
 */

const SITE_A: AiSiteInventory = {
  ...emptyAiSiteInventory('host-a'),
  components: [{ id: 'cmp-card', name: 'Service card', props: { title: 'text', image: 'image' } }],
  layouts: [{ id: 'lay-site', name: 'Acme Roofing layout', parentId: null }],
  forms: [{ id: 'frm-contact', name: 'Contact', fields: ['name', 'email'] }],
  screens: [{ id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false }],
  theme: { summary: ['Light scheme only'], colors: { 'primary.main': '#b33a3a' }, fonts: ['Inter'] },
}

const SITE_B: AiSiteInventory = {
  ...emptyAiSiteInventory('host-b'),
  layouts: [{ id: 'lay-bakery', name: 'Bakery layout', parentId: null }],
  screens: [{ id: 'scr-menu', name: 'Menu', slug: '/menu', layoutId: 'lay-bakery', template: false }],
}

/** Every block through the last breakpoint: the bytes a cache entry is keyed on. */
function cachedPrefix(blocks: readonly AiSystemBlock[]): string {
  const last = blocks.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
  return blocks
    .slice(0, last + 1)
    .map((block) => block.text)
    .join('\u0000')
}

describe('the doctrine block', () => {
  it('states all seventeen rules, with the acceptable-use rules, as one cached block', () => {
    for (let rule = 1; rule <= 17; rule += 1) {
      expect([rule, AI_BUILDING_DOCTRINE.includes(`\n${rule}. `)]).toEqual([rule, true])
    }
    expect(AI_BUILDING_DOCTRINE).not.toContain('\n18. ')
    expect(AI_DOCTRINE_SYSTEM_BLOCK).toEqual({
      text: `${AI_BUILDING_DOCTRINE}\n\n${AI_ACCEPTABLE_USE_BLOCK}`,
      cacheBreakpoint: true,
    })
  })

  it('keeps one cached prefix for every org and site: only the inventory differs, volatile and last', () => {
    const instructions = [{ text: 'Plan the job.' }]
    const a = aiDoctrineSystemBlocks(SITE_A, { instructions, surface: 'screen' })
    const b = aiDoctrineSystemBlocks(SITE_B, { instructions, surface: 'screen' })
    expect(cachedPrefix(a)).toBe(cachedPrefix(b))
    expect(a[a.length - 1]).toEqual({ text: aiSiteInventoryBlock(SITE_A), volatile: true })
    expect(a[a.length - 1].text).not.toBe(b[b.length - 1].text)
    expect(cachedPrefix(a)).not.toContain('Acme Roofing')
    expect(() => validateAiSystemBlocks(a)).not.toThrow()
    expect(a.filter((block) => block.cacheBreakpoint).length).toBeLessThanOrEqual(
      AI_MAX_CACHE_BREAKPOINTS,
    )
  })

  it('states the counts its validators enforce, so a rule cannot ask for what it then refuses (AGL-3022)', () => {
    // The first live run planned a template for two similar pages and cited
    // rule 4 for it, because rule 4's text named no count while
    // `detectUntemplatedSimilarPages` wants three. A threshold a generator is
    // not told is a threshold it cannot hold to.
    expect(AI_BUILDING_DOCTRINE).toContain(`When ${AI_SIMILAR_PAGES_MIN} or more pages share one structure`)
    expect(AI_BUILDING_DOCTRINE).toContain(`appearing ${AI_REPEAT_MIN_COUNT} or more times`)
    // Rule 10 refuses a plan's search title and description well inside the
    // ceilings `parseAiBuildPlan` cuts them at, so the rule's numbers are the
    // ones a generator is told, and the plan tool's schema leaves them to it.
    expect(AI_BUILDING_DOCTRINE).toContain(
      `a search title of at most ${AI_SEO_TITLE_MAX} characters, a search description of at most ${AI_SEO_DESCRIPTION_MAX}`,
    )
    expect(AI_SEO_TITLE_MAX).toBeLessThan(AI_BUILD_PLAN_LIMITS.text)
    expect(AI_SEO_DESCRIPTION_MAX).toBeLessThan(AI_BUILD_PLAN_LIMITS.seoDescription)
  })

  it('says, beside the forms rule, that a search is an element a generator can place and never a form (AGL-3022)', () => {
    // A generator told nothing about search plans a form with one query field
    // for "a menu search across the top". A form collects submissions; the
    // platform's searches are elements, and naming them is worth its bytes
    // only while every surface a search is built on can place them.
    const rule3 = AI_BUILDING_DOCTRINE.split('\n').find((line) => line.startsWith('3. ')) ?? ''
    expect(rule3).toContain('never a form')
    for (const id of ['searchBox', 'collectionSearch']) {
      expect([id, rule3.includes(`"${id}"`), AI_PALETTE[id]?.kind]).toEqual([id, true, 'element'])
      for (const surface of ['screen', 'layout', 'component'] as const) {
        expect([id, surface, AI_SURFACES[surface].allow.includes(id)]).toEqual([id, surface, true])
      }
    }
  })

  it('pins the doctrine’s bytes, so changing what every generator is told is a deliberate cache break', () => {
    expect(createHash('sha256').update(AI_DOCTRINE_SYSTEM_BLOCK.text).digest('hex')).toBe(
      '72d97070a3c405b1fe61ff0a315fcbee8a93c1fe89ff2e955752faf0e296e1f8',
    )
  })

  it('tells a kind that writes values only the rules it can break, with the abuse rules whole', () => {
    const fields = aiDoctrineSystemBlock('fields')
    // Rule 13 is the one the loop holds every custom kind to, through
    // `detectPublishIntent`, so it is the one rule that has to be stated: an
    // answer may not be refused for a rule it was never told.
    expect(fields.text).toContain('13. Drafts only.')
    for (const rule of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17]) {
      expect([rule, fields.text.includes(`\n${rule}. `)]).toEqual([rule, false])
    }
    // The acceptable-use rules are an abuse guard, not a building rule: a
    // published title can carry a scam claim as easily as a page can, so
    // every scope carries them whole.
    expect(fields.text).toContain(AI_ACCEPTABLE_USE_BLOCK)
    expect(fields.cacheBreakpoint).toBe(true)
    expect(fields.text.length).toBeLessThan(AI_DOCTRINE_SYSTEM_BLOCK.text.length / 3)
    // Built once, so two requests share one cache entry rather than two
    // equal-looking objects.
    expect(aiDoctrineSystemBlock('fields')).toBe(fields)
    expect(aiDoctrineSystemBlock('documents')).toBe(AI_DOCTRINE_SYSTEM_BLOCK)
  })

  it('sends the field scope to the kinds that write values, and the document scope to the rest', () => {
    expect(['seo-fields', 'seo-site', 'seo-fixes'].map(aiDoctrineScopeFor)).toEqual([
      'fields',
      'fields',
      'fields',
    ])
    expect(['plan', 'page', 'theme', 'eval-grade', 'edit'].map(aiDoctrineScopeFor)).toEqual([
      'documents',
      'documents',
      'documents',
      'documents',
      'documents',
    ])
    expect(
      aiDoctrineSystemBlocks(undefined, {
        instructions: [{ text: 'Write the listing.' }],
        scope: 'fields',
      })[0],
    ).toBe(aiDoctrineSystemBlock('fields'))
  })

  it('caches a door’s instructions behind the palette catalog, or on their own last block', () => {
    const withCatalog = aiDoctrineSystemBlocks(null, {
      instructions: [{ text: 'Write the email.' }],
      surface: 'email',
    })
    expect(withCatalog).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      { text: 'Write the email.' },
      { text: AI_PALETTE_CATALOG.email, cacheBreakpoint: true },
      { text: aiSiteInventoryBlock(null), volatile: true },
    ])
    const withoutCatalog = aiDoctrineSystemBlocks(null, {
      instructions: [{ text: 'One.' }, { text: 'Two.' }],
    })
    expect(withoutCatalog.map((block) => Boolean(block.cacheBreakpoint))).toEqual([
      true,
      false,
      true,
      false,
    ])
  })

  it('lets the runtime refuse a door that slips a per-request block inside the cached prefix', () => {
    const blocks = aiDoctrineSystemBlocks(null, {
      instructions: [{ text: 'For Acme Roofing.', volatile: true }],
      surface: 'screen',
    })
    expect(() => validateAiSystemBlocks(blocks)).toThrow('volatile')
  })
})

describe('the inventory block', () => {
  it('lists each kind compactly — ids, names, prop and field names — with the brand', () => {
    const block = aiSiteInventoryBlock(SITE_A)
    expect(block).toContain('- cmp-card · Service card · title:text, image:image')
    expect(block).toContain('- frm-contact · Contact · name, email')
    expect(block).toContain('Brand colors (light scheme): primary.main=#b33a3a')
    expect(block).toContain('Brand fonts: Inter')
    expect(block).not.toContain('More exist')
  })

  it('holds a large site inside its ceiling, cutting the longest kind and naming every cut', () => {
    const many = <T>(make: (index: number) => T) => Array.from({ length: 40 }, (_, index) => make(index))
    const large: AiSiteInventory = {
      ...emptyAiSiteInventory('host-large'),
      components: many((i) => ({ id: `cmp-${i}`, name: `Component with a long descriptive name ${i}`, props: { title: 'text', body: 'text', image: 'image', link: 'href' } })),
      screens: many((i) => ({ id: `scr-${i}`, name: `A screen with a long title ${i}`, slug: `/a/long/path/${i}`, layoutId: null, template: false })),
      forms: many((i) => ({ id: `frm-${i}`, name: `Form ${i}`, fields: ['name', 'email', 'phone', 'message', 'company'] })),
      datasets: many((i) => ({ id: `ds-${i}`, name: `Dataset ${i}`, fields: ['title', 'price', 'sku', 'category'] })),
      truncated: ['layouts'],
    }
    const block = aiSiteInventoryBlock(large)
    expect(block.length).toBeLessThanOrEqual(AI_SITE_INVENTORY_MAX_CHARS)
    const cut = /More exist than are listed for: (.*)\. Do not assume/.exec(block)?.[1] ?? ''
    expect(cut.split(', ')).toEqual(expect.arrayContaining(['components', 'layouts']))
  })

  it('lists only the first records of a kind, and points the rest at the lookup', () => {
    // The window the reader holds is wider than the block lists (AGL-2937):
    // the block is billed on every attempt, and the rest are found by asking.
    const wide: AiSiteInventory = {
      ...emptyAiSiteInventory('host-wide'),
      components: Array.from({ length: AI_SITE_INVENTORY_LISTED_PER_KIND + 12 }, (_, index) => ({
        id: `cmp-${index}`,
        name: `Block ${index}`,
        props: {},
      })),
    }
    const block = aiSiteInventoryBlock(wide)
    expect(block).toContain(`- cmp-${AI_SITE_INVENTORY_LISTED_PER_KIND - 1} ·`)
    expect(block).not.toContain(`- cmp-${AI_SITE_INVENTORY_LISTED_PER_KIND} ·`)
    expect(block).toContain('More exist than are listed for: components')
    expect(block).toContain(AI_INVENTORY_LOOKUP_TOOL_NAME)
  })

  it('tells the model when no inventory was read, so it reuses nothing by id', () => {
    expect(aiSiteInventoryBlock(null)).toContain('none was read')
  })

  it('grounds a tree in what the inventory lists', () => {
    expect(aiNodeTreeContextFromInventory(SITE_A)).toEqual({
      screenIds: ['scr-home'],
      componentIds: ['cmp-card'],
      componentProps: { 'cmp-card': { title: 'text', image: 'image' } },
      formIds: ['frm-contact'],
      datasetIds: [],
    })
    expect(aiNodeTreeContextFromInventory(null)).toEqual({})
  })
})

// ── The loop ─────────────────────────────────────────────────────────────

const usage = (tokens: number) => ({
  inputTokens: tokens,
  outputTokens: tokens / 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

function toolAnswer(name: string, input: object, tokens = 1_000): AiCompletion {
  return {
    kind: 'completion',
    text: '',
    toolUse: [{ name, input: input as Record<string, unknown> }],
    usage: usage(tokens),
    estCostUsd: 0.01,
    stopReason: 'tool_use',
  }
}

function textAnswer(text: string, stopReason = 'end_turn'): AiCompletion {
  return { kind: 'completion', text, toolUse: [], usage: usage(500), estCostUsd: 0.005, stopReason }
}

/** A provider that answers from a queue and keeps every request it was sent. */
function provider(answers: AiResult[]): { fake: AiProvider; requests: AiProviderRequest[] } {
  const requests: AiProviderRequest[] = []
  const fake: AiProvider = {
    id: 'fake',
    label: 'Fake',
    apiKeyEnv: 'FAKE_AI_KEY',
    endpointHost: 'ai.test',
    readApiKey: () => 'key',
    models: () => [],
    complete: async (request) => {
      requests.push(request)
      const next = answers.shift()
      if (!next) throw new Error('no answer armed')
      return next
    },
    stream: async () => {
      throw new Error('the doctrine loop never streams')
    },
  }
  return { fake, requests }
}

const CLEAN_PLAN: AiBuildPlan = {
  reuse: [{ kind: 'layout', id: 'lay-site', purpose: 'the site chrome' }],
  create: [],
  screens: [
    {
      title: 'Roof repair',
      slug: '/services/roof-repair',
      layout: 'lay-site',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Roof repair in Springfield',
      seoDescription: 'SEO_DESCRIPTION_MARKER: same-week roof repair from a local crew.',
      sections: [{ name: 'hero', uses: [], items: 0 }],
    },
  ],
}

const UNLAID_PLAN: AiBuildPlan = {
  ...CLEAN_PLAN,
  screens: [{ ...CLEAN_PLAN.screens[0], layout: null }],
}

function planInput(fake: AiProvider) {
  return {
    step: 'job.plan' as const,
    model: 'test-model',
    provider: fake,
    instructions: [{ text: 'Plan the job.' }],
    inventory: SITE_A,
    messages: [{ role: 'user' as const, content: 'Brief: a roof repair page' }],
    tool: AI_BUILD_PLAN_TOOL,
  }
}

describe('runValidatedGeneration — a plan', () => {
  it('keeps a first answer that holds to every rule, in one call, under the doctrine prompt', async () => {
    const { fake, requests } = provider([toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN)])
    const result = await runValidatedGeneration('plan', planInput(fake))
    expect(result).toMatchObject({ status: 'ok', value: CLEAN_PLAN, attempts: 1, model: 'test-model' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'test-model',
      // The lookup tool rides beside the door's own on every request that
      // carries an inventory (AGL-2937), so the tool list is one shape.
      tools: [AI_BUILD_PLAN_TOOL, aiInventoryLookupTool()],
      maxTokens: AI_GENERATION_MAX_TOKENS.plan,
      messages: [{ role: 'user', content: 'Brief: a roof repair page' }],
    })
    expect(requests[0].system).toEqual(
      aiDoctrineSystemBlocks(SITE_A, { instructions: [{ text: 'Plan the job.' }] }),
    )
  })

  it('answers a lookup from memory, asks again, and does not spend an answer attempt on it', async () => {
    // The site the prompt was built for lists one component; the window holds
    // a second the block never listed, which is the whole point of the tool.
    const wide: AiSiteInventory = {
      ...SITE_A,
      components: [
        ...SITE_A.components,
        { id: 'cmp-price', name: 'Pricing card', props: { plan: 'text' } },
      ],
      truncated: ['components'],
    }
    const { fake, requests } = provider([
      toolAnswer(AI_INVENTORY_LOOKUP_TOOL_NAME, { kind: 'components', query: 'pricing' }, 200),
      toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN),
    ])
    const result = await runValidatedGeneration('plan', { ...planInput(fake), inventory: wide })
    expect(result).toMatchObject({ status: 'ok', value: CLEAN_PLAN })
    // Two model calls, both billed; one answer attempt, so the re-ask is
    // still there to be spent on a broken rule.
    expect(result.attempts).toBe(2)
    expect(result.usage.inputTokens).toBe(1_200)
    expect(requests).toHaveLength(2)
    // The rows came back in the turn, in the same shape the block lists them,
    // and the request the model saw was never rebuilt around them.
    expect(requests[1].messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(requests[1].messages[2].content).toContain('cmp-price · Pricing card · plan:text')
    expect(requests[1].system).toEqual(requests[0].system)
  })

  it('stops answering lookups after its bound, and says so before it does', async () => {
    const { fake, requests } = provider([
      toolAnswer(AI_INVENTORY_LOOKUP_TOOL_NAME, { kind: 'components', query: 'a' }, 200),
      toolAnswer(AI_INVENTORY_LOOKUP_TOOL_NAME, { kind: 'forms', query: 'b' }, 200),
      toolAnswer(AI_INVENTORY_LOOKUP_TOOL_NAME, { kind: 'screens', query: 'c' }, 200),
      toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN),
    ])
    const result = await runValidatedGeneration('plan', planInput(fake))
    // The bound is two, so the second answer tells the model it is the last;
    // the third lookup is read as no answer at all and costs the re-ask.
    expect(AI_INVENTORY_LOOKUP_MAX_ROUNDS).toBe(2)
    expect(requests[2].messages[4].content).toContain('That was the last lookup')
    expect(requests).toHaveLength(4)
    expect(result).toMatchObject({ status: 'ok', attempts: 4 })
    expect(requests[3].messages.at(-1)?.content).toContain('did not come through')
  })

  it('asks every call — a lookup round as much as an answer — for no more than is left of one answer and its re-ask (AGL-3036)', async () => {
    const spending = (answer: AiCompletion, outputTokens: number): AiCompletion => ({
      ...answer,
      usage: { ...answer.usage, outputTokens },
    })
    const ceiling = AI_GENERATION_MAX_TOKENS.plan
    const { fake, requests } = provider([
      spending(toolAnswer(AI_INVENTORY_LOOKUP_TOOL_NAME, { kind: 'components', query: 'price' }), 1_000),
      spending(toolAnswer(AI_BUILD_PLAN_TOOL.name, UNLAID_PLAN), ceiling),
      spending(toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN), 2_000),
    ])
    const result = await runValidatedGeneration('plan', planInput(fake))
    expect(result).toMatchObject({ status: 'ok', value: CLEAN_PLAN, attempts: 3 })
    // The lookup and the first answer spent a ceiling and a thousand tokens of
    // the two ceilings the generation has, so the re-ask is asked for the rest.
    expect(requests.map((request) => request.maxTokens)).toEqual([ceiling, ceiling, ceiling - 1_000])
  })

  it('stops once lookup rounds have spent the whole allowance, rather than asking with nothing left (AGL-3036)', async () => {
    const ceiling = AI_GENERATION_MAX_TOKENS.plan
    const lookup = (): AiCompletion => ({
      ...toolAnswer(AI_INVENTORY_LOOKUP_TOOL_NAME, { kind: 'components', query: 'price' }),
      usage: { inputTokens: 1_000, outputTokens: ceiling, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    const { fake, requests } = provider([lookup(), lookup(), toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN)])
    const result = await runValidatedGeneration('plan', planInput(fake))
    expect(requests).toHaveLength(AI_INVENTORY_LOOKUP_MAX_ROUNDS)
    expect(result).toMatchObject({ status: 'needs_input', attempts: 2, usage: { outputTokens: 2 * ceiling } })
    if (result.status !== 'needs_input') return
    expect(result.violations.map((violation) => violation.code)).toEqual(['answer-cut-off'])
  })

  it('offers no lookup to a kind that builds from no site at all', async () => {
    const { fake, requests } = provider([toolAnswer('submit_theme', { ok: true })])
    await runValidatedGeneration('theme-ish', {
      model: 'test-model',
      provider: fake,
      instructions: [{ text: 'Change the theme.' }],
      messages: [{ role: 'user' as const, content: 'Brief' }],
      tool: { name: 'submit_theme', description: 'x', strict: true, inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
      check: (answer: Record<string, unknown>) => ({ value: answer, violations: [] }),
    })
    expect(requests[0].tools?.map((tool) => tool.name)).toEqual(['submit_theme'])
  })

  it('re-asks once with the broken rule named and only the offending part quoted, and keeps the fix', async () => {
    const { fake, requests } = provider([
      toolAnswer(AI_BUILD_PLAN_TOOL.name, UNLAID_PLAN, 1_000),
      toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN, 2_000),
    ])
    const result = await runValidatedGeneration('plan', planInput(fake))
    expect(result).toMatchObject({ status: 'ok', value: CLEAN_PLAN, attempts: 2 })
    expect(result.usage).toEqual({ inputTokens: 3_000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(result.estCostUsd).toBe(0.02)

    const [first, second] = requests
    // The cached prefix is untouched on the re-ask; only the turns grow.
    expect(second.system).toEqual(first.system)
    expect(second.messages.slice(0, 1)).toEqual(first.messages)
    expect(second.messages[1]).toEqual({
      role: 'assistant',
      content: 'Submitted the plan with submit_build_plan.',
    })
    const reask = second.messages[2]
    expect(reask.role).toBe('user')
    expect(reask.content).toContain(`Rule 2 (${AI_DOCTRINE_RULES[2]})`)
    expect(reask.content).toContain('(at screens[0].layout)')
    expect(reask.content).toContain('{"screens[0].layout":null}')
    expect(reask.content).not.toContain('SEO_DESCRIPTION_MARKER')
  })

  it('gives up with needs_input when the re-ask still breaks a rule, and bills both answers', async () => {
    const { fake, requests } = provider([
      toolAnswer(AI_BUILD_PLAN_TOOL.name, UNLAID_PLAN),
      toolAnswer(AI_BUILD_PLAN_TOOL.name, UNLAID_PLAN),
    ])
    const result = await runValidatedGeneration('plan', planInput(fake))
    expect(requests).toHaveLength(2)
    expect(result).toMatchObject({ status: 'needs_input', attempts: 2, usage: { inputTokens: 2_000 } })
    if (result.status !== 'needs_input') return
    expect(result.violations.map((violation) => violation.code)).toEqual(['plan-screen-without-layout'])
    expect(result.message).toBe(
      `This could not be built within the building rules. Rule 2 (${AI_DOCTRINE_RULES[2]}): A screen names no layout the site has or the plan creates. Put every screen in the site's layout, or plan one.`,
    )
  })

  it('returns a decline as refused, with its tokens, and asks nothing more', async () => {
    const { fake, requests } = provider([
      { kind: 'refusal', text: '', usage: usage(300), estCostUsd: 0.003, stopReason: 'refusal' },
    ])
    const result = await runValidatedGeneration('plan', planInput(fake))
    expect(result).toMatchObject({ status: 'refused', attempts: 1, estCostUsd: 0.003 })
    expect(requests).toHaveLength(1)
  })

  it('asks again when the answer skipped the tool, and reads an answer written as JSON text', async () => {
    const { fake, requests } = provider([
      textAnswer('Here is my thinking about the plan.'),
      textAnswer(`\`\`\`json\n${JSON.stringify(CLEAN_PLAN)}\n\`\`\``),
    ])
    const result = await runValidatedGeneration('plan', planInput(fake))
    expect(result).toMatchObject({ status: 'ok', attempts: 2, value: CLEAN_PLAN })
    expect(requests[1].messages[2].content).toContain('The answer did not come through submit_build_plan.')
  })

  it('tells an answer cut off at its token ceiling to build something smaller', async () => {
    const { fake, requests } = provider([
      textAnswer('{"reuse": [', 'max_tokens'),
      toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN),
    ])
    await runValidatedGeneration('plan', planInput(fake))
    expect(requests[1].messages[2].content).toContain('ran past the size one answer may have')
  })

  it('runs a door’s own checks beside the doctrine’s, never instead of them', async () => {
    const { fake, requests } = provider([
      toolAnswer(AI_BUILD_PLAN_TOOL.name, UNLAID_PLAN),
      toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN),
      toolAnswer(AI_BUILD_PLAN_TOOL.name, CLEAN_PLAN),
    ])
    const result = await runValidatedGeneration('plan', {
      ...planInput(fake),
      extend: (plan) =>
        plan.screens.some((entry) => entry.nav)
          ? [{ rule: 10, code: 'door-no-nav', message: 'Leave this page out of the navigation.' }]
          : [],
    })
    expect(result.status).toBe('needs_input')
    expect(requests).toHaveLength(2)
    expect(requests[1].messages[2].content).toContain(`Rule 2 (${AI_DOCTRINE_RULES[2]})`)
    expect(requests[1].messages[2].content).toContain('Leave this page out of the navigation.')
  })
})

describe('runValidatedGeneration — a tree', () => {
  const IMAGE = formatMediaRef('host-a', 'asset-1') as string
  const pageTree = (headingSx: Record<string, unknown>) => ({
    rootId: CANVAS_ROOT_ELEMENT_ID,
    nodes: {
      [CANVAS_ROOT_ELEMENT_ID]: { componentId: 'div', nodes: ['sec'] },
      sec: { componentId: 'section', props: { element: 'section' }, nodes: ['title', 'body', 'art'] },
      title: { componentId: 'muiTypography', props: { variant: 'h1', component: 'h1', children: 'Roof repair' }, sx: headingSx },
      body: { componentId: 'muiTypography', props: { variant: 'body1', children: 'BODY_COPY_MARKER from a local crew.' } },
      art: { componentId: 'image', props: { src: IMAGE, alt: 'A crew on a roof' } },
    },
  })
  const tool: AiTool = aiDoctrineTreeTool('page')

  it('quotes the offending node by the id the model wrote, and never the rest of the page', async () => {
    const { fake, requests } = provider([
      toolAnswer(tool.name, { tree: JSON.stringify(pageTree({ color: '#ff0000' })) }),
      toolAnswer(tool.name, { tree: JSON.stringify(pageTree({ color: 'primary.main' })) }),
    ])
    const result = await runValidatedGeneration('page', {
      step: 'generate.section',
      model: 'test-model',
      provider: fake,
      instructions: [{ text: 'Build the page.' }],
      inventory: SITE_A,
      messages: [{ role: 'user', content: 'Brief: roof repair' }],
      tool,
    })
    expect(requests[0].system.map((block) => block.text)).toContain(AI_PALETTE_CATALOG.screen)
    expect(requests[0].maxTokens).toBe(AI_GENERATION_MAX_TOKENS.page)
    const reask = requests[1].messages[2].content
    expect(reask).toContain(`Rule 5 (${AI_DOCTRINE_RULES[5]})`)
    expect(reask).toContain('(nodes title)')
    expect(reask).toContain('"title":{"componentId":"muiTypography"')
    expect(reask).not.toContain('BODY_COPY_MARKER')

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.rootId).toBe(CANVAS_ROOT_ELEMENT_ID)
    expect(Object.values(result.value.sourceIds).sort()).toEqual([CANVAS_ROOT_ELEMENT_ID, 'art', 'body', 'sec', 'title'])
    expect(result.value.load?.pageBytes).toBe(ESTIMATED_PAGE_TRANSFER_BYTES)
  })
})

describe('runValidatedGeneration — a kind the doctrine has no reader for', () => {
  const themeTool: AiTool = {
    name: 'submit_theme_change',
    description: 'Submit the theme change.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['primary'],
      properties: { primary: { type: 'string' } },
    },
  }

  it('reads it through the door’s own check, and still holds rule 13', async () => {
    const { fake, requests } = provider([
      toolAnswer(themeTool.name, { primary: 'primary.main', publish: true }),
      toolAnswer(themeTool.name, { primary: 'primary.main' }),
    ])
    const result = await runValidatedGeneration('theme', {
      step: 'job.plan',
      model: 'test-model',
      provider: fake,
      instructions: [{ text: 'Change the theme.' }],
      inventory: null,
      messages: [{ role: 'user', content: 'Match our brand red.' }],
      tool: themeTool,
      check: (answer) => ({ value: { primary: String(answer['primary']) }, violations: [] }),
    })
    expect(result).toMatchObject({ status: 'ok', attempts: 2, value: { primary: 'primary.main' } })
    expect(requests[1].messages[2].content).toContain(`Rule 13 (${AI_DOCTRINE_RULES[13]})`)
  })

  it('refuses to run without a check, before any request', async () => {
    const { fake, requests } = provider([])
    await expect(
      runValidatedGeneration('theme', {
        step: 'job.plan',
        model: 'test-model',
        provider: fake,
        instructions: [],
        inventory: null,
        messages: [{ role: 'user', content: 'x' }],
        tool: themeTool,
      } as never),
    ).rejects.toThrow('pass check')
    expect(requests).toHaveLength(0)
  })
})

describe('a kind built from no site structure, and an answer that streamed', () => {
  const proposeTool: AiTool = {
    name: 'propose_change',
    description: 'Propose the change.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['change'],
      properties: { change: { type: 'string' } },
    },
  }
  const keepChange: AiGenerationCheck<string> = (answer) =>
    typeof answer['change'] === 'string' && answer['change']
      ? { value: answer['change'], violations: [] }
      : { value: null, violations: [{ rule: null, code: 'door-empty', message: 'Nothing to change.' }] }

  it('sends no inventory block for a kind that leaves the inventory out', async () => {
    expect(aiDoctrineSystemBlocks(undefined, { instructions: [{ text: 'Change the theme.' }] })).toEqual([
      AI_DOCTRINE_SYSTEM_BLOCK,
      { text: 'Change the theme.', cacheBreakpoint: true },
    ])
    const { fake, requests } = provider([toolAnswer(proposeTool.name, { change: 'warmer' })])
    const result = await runValidatedGeneration('theme', {
      step: 'job.theme',
      model: 'test-model',
      provider: fake,
      instructions: [{ text: 'Change the theme.' }],
      messages: [{ role: 'user', content: 'Make it warmer.' }],
      tool: proposeTool,
      check: keepChange,
    })
    expect(result).toMatchObject({ status: 'ok', value: 'warmer', attempts: 1 })
    expect(requests[0].system.some((block) => block.volatile)).toBe(false)
    expect(requests[0].system[requests[0].system.length - 1].cacheBreakpoint).toBe(true)
  })

  it('shows a door that composes its own prompt the catalog the loop shows the surface', () => {
    for (const surface of AI_SURFACE_NAMES) {
      expect(aiDoctrineCatalog(surface)).toBe(AI_PALETTE_CATALOG[surface])
    }
  })

  it('keeps a streamed value with the door’s findings beside it, and needs input without one', () => {
    const leftOut = { rule: null, code: 'door-left-out', message: 'The font was left out.' }
    expect(
      validateStreamedGeneration('edit', {
        answer: { change: 'warmer' },
        check: (answer) => ({ value: String(answer['change']), violations: [leftOut] }),
      }),
    ).toEqual({ status: 'ok', value: 'warmer', violations: [leftOut] })
    expect(validateStreamedGeneration('edit', { answer: { change: '' }, check: keepChange })).toMatchObject({
      status: 'needs_input',
      violations: [{ code: 'door-empty' }],
    })
  })

  it('holds rule 13 on a streamed answer, whatever its value', () => {
    const result = validateStreamedGeneration('edit', {
      answer: { change: 'warmer', publish: true },
      check: keepChange,
    })
    expect(result.status).toBe('needs_input')
    expect(result.violations.map((violation) => violation.rule)).toEqual([13])
  })

  it('refuses a plan or a palette kind, which the loop reads and re-asks', () => {
    for (const kind of ['plan', 'page', 'email']) {
      expect(() => validateStreamedGeneration(kind, { answer: {}, check: keepChange })).toThrow(
        'runValidatedGeneration',
      )
    }
  })
})
