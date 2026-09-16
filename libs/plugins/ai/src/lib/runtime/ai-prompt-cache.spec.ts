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

// The three seams a step module reaches through on its way to Firestore or
// the tenant runtime. Nothing here composes a prompt; they are mocked so the
// prompt assembly can be measured without a server.
jest.mock('@aglyn/tenant-data-admin/server/duplicate-resource', () => ({
  duplicateResource: jest.fn(),
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  getOrgBrandingProfile: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  getTemplateScreenIds: jest.fn(() => []),
}))

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { emptyAiSiteInventory, type AiSiteInventory } from '../model/ai-site-inventory'
import { aiModelCacheMinTokens } from '../providers/catalog'
import { AI_STEP_NOMINAL_USAGE } from '../providers/model-choice'
import type { AiStepKind } from '../providers/catalog'
import type { AiSystemBlock, AiTool } from '../providers/contract'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { AI_EVAL_GRADER_INSTRUCTIONS } from './ai-eval-live'
import {
  aiDoctrineScopeFor,
  aiDoctrineSystemBlock,
  aiDoctrineSystemBlocks,
  aiDoctrineTreeTool,
} from './ai-doctrine'
import { detectPublishIntent } from './ai-doctrine-validators'
import { AI_JOB_COMPONENT_INSTRUCTIONS } from '../jobs/ai-job-component-step'
import { AI_JOB_EMAIL_INSTRUCTIONS, AI_JOB_EMAIL_TOOL } from '../jobs/ai-job-email-step'
import { AI_JOB_FORM_INSTRUCTIONS } from '../jobs/ai-job-form-step'
import { AI_JOB_LAYOUT_INSTRUCTIONS } from '../jobs/ai-job-layout-step'
import { AI_JOB_PAGE_INSTRUCTIONS, AI_PAGE_SECTION_TOOL } from '../jobs/ai-job-page-sections'
import { AI_JOB_PLAN_INSTRUCTIONS } from '../jobs/ai-job-plan-step'
import { AI_JOB_TEMPLATE_INSTRUCTIONS } from '../jobs/ai-job-template-step'
import { AI_JOB_TEXT_SYSTEM } from '../jobs/ai-job-text-step'
import { AI_JOB_THEME_INSTRUCTIONS } from '../jobs/ai-job-theme-step'
import { AI_SEO_FIXES_INSTRUCTIONS, AI_SEO_SITE_INSTRUCTIONS } from '../jobs/ai-job-seo-step'
import { AI_BUILD_PLAN_TOOL } from '../model/ai-build-plan'
import { aiComponentTool } from '../tools/ai-component-tool'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'
import { AI_SEO_FIELDS_INSTRUCTIONS, aiSeoFieldsInstructions } from './seo-fields'
import {
  aiSeoFieldsTool,
  aiSeoFixesTool,
  aiSeoSiteTool,
  checkAiSeoFields,
} from '../tools/ai-seo-tool'
import { aiThemeTool } from '../tools/ai-theme-tool'
import { aiTemplateExamplesSystemBlock } from './ai-template-examples'
import { assistModeSystemBlocks, assistSectionTool } from '../server/ai-assist-prompts'
import {
  AI_CACHE_PREFIX_TOKEN_CHARS,
  aiCachedPrefixCaches,
  aiCachedPrefixChars,
  validateAiSystemBlocks,
} from './ai-runtime'

/**
 * THE CACHE LEDGER (AGL-2937).
 *
 * Every AI door composes a system prompt whose leading blocks are static and
 * whose trailing blocks are the customer's. Two separate things can go wrong
 * with that, and only one of them has ever had a guard:
 *
 *  - **A per-tenant byte inside the cached span.** The runtime refuses it
 *    (`validateAiSystemBlocks`), and the doctrine's own spec pins the shape
 *    for the doors that go through it. What nothing covered was the doors
 *    that compose their own prompt, and the question of whether two
 *    *workspaces* on the same door really do send the same bytes.
 *  - **A cached span too short for the model to cache at all.** A provider
 *    will not cache a prefix under its model's minimum: it honors the
 *    markers, caches nothing, and reports a usage row that reads exactly
 *    like a permanent miss. Nothing warns. A prompt can be written, grown
 *    and reasoned about for months around a cache it never had — which is
 *    what the SEO step's first doctrine swap ran into, on a fast-tier model
 *    whose minimum is four times the balanced tier's.
 *
 * So this spec holds three things at once:
 *
 *  1. the DOOR TABLE, enforced by scanning the source, so a new door cannot
 *     be added without saying what its prompt caches;
 *  2. the SHAPE: a cached span is a function of the request's shape and
 *     never of the tenant, nothing static is stranded after the last
 *     breakpoint, and the runtime's own guard passes;
 *  3. the LEDGER: each door's measured cached span beside its model's
 *     minimum, so a prompt change that silently stops a door caching — or
 *     that grows a door which cannot cache — is red here with a number
 *     rather than invisible on the bill.
 */

const LIB_ROOT = join(__dirname, '..')

/** Every source file under `src/lib`, specs and generated palettes excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.includes('.spec.')) return []
    return [path]
  })
}

/**
 * A file that asks a provider for an answer, however it composes the prompt.
 * The optional type argument matters: `runValidatedGeneration<AiPageSection>(`
 * is the same door as `runValidatedGeneration(`, and a pattern that missed it
 * let the page step into the plugin without a ledger row (AGL-2937).
 */
const CALLS_A_MODEL = /\b(?:runAiRequest|runValidatedGeneration)\s*(?:<[^<>()]*>)?\(/

/**
 * Every door, and what its prompt does about caching. `step` is the routing
 * row it runs on, which decides the model and therefore the minimum; `caches`
 * is what this door's static span is expected to do on that model.
 *
 * A door whose `caches` is false is not a defect by itself — a short prompt
 * on a fast-tier model is a deliberate trade. It is a fact that has to be
 * written down, because it inverts the usual advice: on a door that cannot
 * cache, every static byte is billed at full input rate on every request and
 * on every re-ask, so the prompt is worth shortening rather than enriching.
 */
const AI_DOORS: Record<string, { step: AiStepKind; caches: boolean; why: string }> = {
  'runtime/ai-doctrine.ts': {
    step: 'job.plan',
    caches: true,
    why: 'the generation loop every generator runs through; its blocks are measured per door below',
  },
  'runtime/ai-eval-live.ts': {
    step: 'job.plan',
    caches: true,
    why: "the eval harness's live run and its grader, which never run in CI or on a deployment",
  },
  'runtime/seo-fields.ts': {
    step: 'job.seo',
    caches: false,
    why: "a listing's rules are far under the fast tier's minimum; the prompt is kept short instead",
  },
  'jobs/ai-job-plan-step.ts': { step: 'job.plan', caches: true, why: 'the doctrine and the plan rules' },
  'jobs/ai-job-layout-step.ts': {
    step: 'job.layout',
    caches: true,
    why: 'the doctrine, the layout rules and the layout palette',
  },
  'jobs/ai-job-template-step.ts': {
    step: 'job.template',
    caches: true,
    why: "the doctrine, the template rules, the platform's starter pages and the screen palette",
  },
  'jobs/ai-job-email-step.ts': {
    step: 'job.email',
    caches: true,
    why: 'the doctrine, the email rules and the email palette; a campaign job generates through this same step',
  },
  'jobs/ai-job-form-step.ts': {
    step: 'job.form',
    caches: true,
    why: 'the doctrine, the form rules and the form palette',
  },
  'jobs/ai-job-component-step.ts': {
    step: 'job.component',
    caches: true,
    why: 'the doctrine, the component rules and the component palette',
  },
  'server/ai-generate-component.ts': {
    step: 'job.component',
    caches: false,
    why: 'one instruction block over a selected subtree, under the balanced tier’s minimum',
  },
  'jobs/ai-job-page-step.ts': {
    step: 'job.page',
    caches: true,
    why: "the doctrine, the page rules and the screen palette; one section a pass, so the prefix is read many times over one page",
  },
  'jobs/ai-job-theme-step.ts': {
    step: 'job.theme',
    caches: true,
    why: 'the doctrine and the theme rules; a theme reads no site inventory',
  },
  'jobs/ai-job-seo-step.ts': {
    step: 'job.seo',
    caches: false,
    why: "the audit's site and fix passes, on the same fast tier as a listing",
  },
  'jobs/ai-job-text-step.ts': {
    step: 'job.text',
    caches: false,
    why: 'one short rule block; the brief is the whole request',
  },
  'server/ai-assist.ts': {
    step: 'copy.element',
    caches: false,
    why: "the copy assistant's three mode prompts, each measured below",
  },
  'server/assist-chat.ts': {
    step: 'assist.chat',
    caches: true,
    why: 'the console assistant’s five-block prefix, measured in its own spec',
  },
}

const SITE_A: AiSiteInventory = {
  ...emptyAiSiteInventory('host-a'),
  components: [{ id: 'cmp-card', name: 'Service card', props: { title: 'text', image: 'image' } }],
  layouts: [{ id: 'lay-site', name: 'Acme Roofing layout', parentId: null }],
  screens: [{ id: 'scr-home', name: 'Home', slug: '/', layoutId: 'lay-site', template: false }],
  theme: { summary: ['Light scheme only'], colors: { 'primary.main': '#b33a3a' }, fonts: ['Inter'] },
}

const SITE_B: AiSiteInventory = {
  ...emptyAiSiteInventory('host-b'),
  layouts: [{ id: 'lay-bakery', name: 'Bakery layout', parentId: null }],
  screens: [{ id: 'scr-menu', name: 'Menu', slug: '/menu', layoutId: 'lay-bakery', template: false }],
}

/**
 * One request's prompt as a door composes it, for a named site. `tools` takes
 * the site too: a schema built from per-request ids is itself a per-request
 * byte, and it renders AHEAD of the system blocks, so it belongs in this
 * measurement rather than beside it.
 */
interface Composed {
  /** The door table row this request belongs to. */
  door: keyof typeof AI_DOORS
  step: AiStepKind
  blocks: (site: AiSiteInventory | null | undefined) => AiSystemBlock[]
  tools: (site: AiSiteInventory) => AiTool[]
}

const SEO_LISTING_FIELDS = ['title', 'description', 'breadcrumb'] as const

/**
 * Every doctrine-family request, composed the way its door composes it. The
 * doors themselves pull their org from Firestore, so what is exercised here
 * is the prompt assembly they all share — the part a cache entry is keyed on.
 */
const REQUESTS: Record<string, Composed> = {
  plan: {
    door: 'jobs/ai-job-plan-step.ts',
    step: 'job.plan',
    blocks: (site) => aiDoctrineSystemBlocks(site, { instructions: AI_JOB_PLAN_INSTRUCTIONS }),
    tools: () => [AI_BUILD_PLAN_TOOL, aiInventoryLookupTool()],
  },
  layout: {
    door: 'jobs/ai-job-layout-step.ts',
    step: 'job.layout',
    blocks: (site) =>
      aiDoctrineSystemBlocks(site, {
        instructions: AI_JOB_LAYOUT_INSTRUCTIONS,
        surface: 'layout',
      }),
    tools: () => [aiDoctrineTreeTool('layout'), aiInventoryLookupTool()],
  },
  template: {
    door: 'jobs/ai-job-template-step.ts',
    step: 'job.template',
    blocks: (site) =>
      aiDoctrineSystemBlocks(site, {
        instructions: [...AI_JOB_TEMPLATE_INSTRUCTIONS, aiTemplateExamplesSystemBlock()],
        surface: 'screen',
      }),
    tools: () => [aiDoctrineTreeTool('template'), aiInventoryLookupTool()],
  },
  component: {
    door: 'jobs/ai-job-component-step.ts',
    step: 'job.component',
    blocks: (site) =>
      aiDoctrineSystemBlocks(site, {
        instructions: AI_JOB_COMPONENT_INSTRUCTIONS,
        surface: 'component',
      }),
    tools: () => [aiComponentTool(), aiInventoryLookupTool()],
  },
  email: {
    door: 'jobs/ai-job-email-step.ts',
    step: 'job.email',
    blocks: (site) =>
      aiDoctrineSystemBlocks(site, { instructions: AI_JOB_EMAIL_INSTRUCTIONS, surface: 'email' }),
    tools: () => [AI_JOB_EMAIL_TOOL, aiInventoryLookupTool()],
  },
  form: {
    door: 'jobs/ai-job-form-step.ts',
    step: 'job.form',
    blocks: (site) =>
      aiDoctrineSystemBlocks(site, { instructions: AI_JOB_FORM_INSTRUCTIONS, surface: 'form' }),
    tools: () => [aiDoctrineTreeTool('form'), aiInventoryLookupTool()],
  },
  // One section pass of a page job. Its instructions carry the screen palette
  // themselves, and it is a custom kind, so the loop adds no catalog of its own.
  'page-section': {
    door: 'jobs/ai-job-page-step.ts',
    step: 'job.page',
    blocks: (site) => aiDoctrineSystemBlocks(site, { instructions: AI_JOB_PAGE_INSTRUCTIONS }),
    tools: () => [AI_PAGE_SECTION_TOOL, aiInventoryLookupTool()],
  },
  theme: {
    door: 'jobs/ai-job-theme-step.ts',
    step: 'job.theme',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_JOB_THEME_INSTRUCTIONS }),
    tools: () => [aiThemeTool()],
  },
  // The default listing shape: the three fields a page's SEO card asks for,
  // with no share image, no target keywords and no other titles to avoid.
  'seo-fields': {
    door: 'runtime/seo-fields.ts',
    step: 'job.seo',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_SEO_FIELDS_INSTRUCTIONS,
        scope: aiDoctrineScopeFor('seo-fields'),
      }),
    tools: () => [aiSeoFieldsTool(SEO_LISTING_FIELDS)],
  },
  // The heaviest listing shape: every field, keywords and other titles. It is
  // the one to watch, because it is the one a busy site asks for.
  'seo-fields-full': {
    door: 'runtime/seo-fields.ts',
    step: 'job.seo',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: aiSeoFieldsInstructions({
          fields: ['title', 'description', 'breadcrumb', 'imageAlt'],
          keywords: true,
          otherTitles: true,
        }),
        scope: aiDoctrineScopeFor('seo-fields'),
      }),
    tools: () => [aiSeoFieldsTool(['title', 'description', 'breadcrumb', 'imageAlt'])],
  },
  'seo-site': {
    door: 'jobs/ai-job-seo-step.ts',
    step: 'job.seo',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_SEO_SITE_INSTRUCTIONS,
        scope: aiDoctrineScopeFor('seo-site'),
      }),
    tools: () => [aiSeoSiteTool()],
  },
  'seo-fixes': {
    door: 'jobs/ai-job-seo-step.ts',
    step: 'job.seo',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_SEO_FIXES_INSTRUCTIONS,
        scope: aiDoctrineScopeFor('seo-fixes'),
      }),
    tools: (site) => [aiSeoFixesTool(site.screens.map((screen) => screen.id))],
  },
  'eval-grade': {
    door: 'runtime/ai-eval-live.ts',
    step: 'job.plan',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_EVAL_GRADER_INSTRUCTIONS }),
    tools: () => [],
  },
  text: {
    door: 'jobs/ai-job-text-step.ts',
    step: 'job.text',
    blocks: () => [...AI_JOB_TEXT_SYSTEM],
    tools: () => [],
  },
  // The copy assistant's three modes. Their prompts are short and two of the
  // three run on a model whose minimum they cannot reach, so the breakpoints
  // they carry are a statement about the blocks rather than a saving — which
  // is exactly the kind of claim this ledger exists to settle.
  'copy.element': {
    door: 'server/ai-assist.ts',
    step: 'copy.element',
    blocks: () => assistModeSystemBlocks('element'),
    tools: () => [],
  },
  'copy.blog': {
    door: 'server/ai-assist.ts',
    step: 'copy.blog',
    blocks: () => assistModeSystemBlocks('blog'),
    tools: () => [],
  },
  'copy.section': {
    door: 'server/ai-assist.ts',
    step: 'copy.section',
    blocks: () => assistModeSystemBlocks('section'),
    tools: () => [assistSectionTool()],
  },
}

/** Every block through the last breakpoint: the bytes a cache entry is keyed on. */
function cachedPrefix(blocks: readonly AiSystemBlock[]): string {
  const last = blocks.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
  return blocks
    .slice(0, last + 1)
    .map((block) => block.text)
    .join('\u0000')
}

describe('the door table', () => {
  it('names every file that asks a provider for an answer', () => {
    const found = sourceFiles(LIB_ROOT)
      .filter((path) => CALLS_A_MODEL.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(LIB_ROOT.length + 1))
      // The runtime is the callee, not a door: it is where `runAiRequest`
      // is declared.
      .filter((path) => path !== 'runtime/ai-runtime.ts')
      .sort()
    expect(found).toEqual(Object.keys(AI_DOORS).sort())
  })
})

describe('a cached span is keyed on the request, never on the tenant', () => {
  it.each(Object.keys(REQUESTS))('%s sends two workspaces the same cached bytes', (name) => {
    const request = REQUESTS[name]
    const a = request.blocks(SITE_A)
    const b = request.blocks(SITE_B)
    expect(cachedPrefix(a)).toBe(cachedPrefix(b))
    expect(cachedPrefix(a)).not.toContain('Acme Roofing')
    expect(cachedPrefix(b)).not.toContain('Bakery')
    expect(() => validateAiSystemBlocks(a)).not.toThrow()
    expect(() => validateAiSystemBlocks(b)).not.toThrow()
  })

  it.each(Object.keys(REQUESTS))('%s strands no static block after the last breakpoint', (name) => {
    const blocks = REQUESTS[name].blocks(SITE_A)
    const last = blocks.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
    // Anything after the last breakpoint is paid for at full input rate on
    // every request, so a block out there has to be one that genuinely
    // differs per request.
    expect(blocks.slice(last + 1).filter((block) => !block.volatile)).toEqual([])
  })
})

describe('the ledger: what each request caches, against its model’s minimum', () => {
  const measured = () =>
    Object.fromEntries(
      Object.entries(REQUESTS).map(([name, request]) => {
        const model = aiModelForStep(request.step)
        const tools = request.tools(SITE_A)
        return [
          name,
          {
            prefixTokens: Math.round(
              aiCachedPrefixChars(request.blocks(SITE_A), tools) / AI_CACHE_PREFIX_TOKEN_CHARS,
            ),
            minimum: aiModelCacheMinTokens(model),
            caches: aiCachedPrefixCaches(model, request.blocks(SITE_A), tools),
            // A schema built from the ids of THIS request names them ahead of
            // every system block, so the prefix it fronts is never reused.
            toolsStable:
              JSON.stringify(tools) === JSON.stringify(request.tools(SITE_B)),
          },
        ]
      }),
    )

  it('reports the same verdict its door table row claims', () => {
    for (const [name, row] of Object.entries(measured())) {
      expect([name, row.caches]).toEqual([name, AI_DOORS[REQUESTS[name].door].caches])
    }
  })

  it('holds every request’s cached span to a measured size', () => {
    // These are the numbers AGL-2937 is measured by: a lever that cuts a
    // prompt moves one of them DOWN and says so in its commit, and a prompt
    // that grows without anyone meaning it to moves one UP and is red here.
    expect(measured()).toEqual({
      plan: { prefixTokens: 2_740, minimum: 1_024, caches: true, toolsStable: true },
      layout: { prefixTokens: 4_273, minimum: 1_024, caches: true, toolsStable: true },
      template: { prefixTokens: 4_847, minimum: 1_024, caches: true, toolsStable: true },
      component: { prefixTokens: 4_802, minimum: 1_024, caches: true, toolsStable: true },
      email: { prefixTokens: 2_760, minimum: 1_024, caches: true, toolsStable: true },
      form: { prefixTokens: 2_389, minimum: 1_024, caches: true, toolsStable: true },
      'page-section': { prefixTokens: 4_356, minimum: 1_024, caches: true, toolsStable: true },
      theme: { prefixTokens: 3_186, minimum: 1_024, caches: true, toolsStable: true },
      'seo-fields': { prefixTokens: 734, minimum: 4_096, caches: false, toolsStable: true },
      'seo-fields-full': { prefixTokens: 873, minimum: 4_096, caches: false, toolsStable: true },
      'seo-site': { prefixTokens: 951, minimum: 4_096, caches: false, toolsStable: true },
      // The fixes tool's schema enumerates the eight pages of THIS batch, so
      // its prefix is per-batch as well as too short. The enumeration is kept
      // deliberately: on a door that cannot cache either way, a schema that
      // refuses a page outside the batch is worth more than a stable prefix.
      'seo-fixes': { prefixTokens: 921, minimum: 4_096, caches: false, toolsStable: false },
      'eval-grade': { prefixTokens: 1_661, minimum: 1_024, caches: true, toolsStable: true },
      // The text step marks a breakpoint its prompt is far too short to fill.
      // It costs nothing and it caches nothing; the brief is the request.
      text: { prefixTokens: 128, minimum: 1_024, caches: false, toolsStable: true },
      'copy.element': { prefixTokens: 339, minimum: 4_096, caches: false, toolsStable: true },
      'copy.blog': { prefixTokens: 340, minimum: 1_024, caches: false, toolsStable: true },
      'copy.section': { prefixTokens: 694, minimum: 1_024, caches: false, toolsStable: true },
    })
  })

  it('never drops a rule the scope’s own doors can still refuse an answer for', () => {
    // The quality half of the ledger. An offline harness scores answers, not
    // prompts, so it cannot see a rule leave a prompt — but the loop can
    // still REFUSE an answer for a rule, and refusing one for a rule the
    // model was never told is the failure a cheaper prompt would cause. So:
    // whatever a scope's doors can cite, that scope has to state.
    const publishing = { title: 'Roof repair', description: 'Fast work.', publish: true }
    const cited = [
      ...checkAiSeoFields(publishing, { fields: ['title', 'description'], hasImage: false, keywords: [] })
        .violations,
      ...detectPublishIntent(publishing),
    ]
      .map((violation) => violation.rule)
      .filter((rule): rule is NonNullable<typeof rule> => rule !== null)
    expect(cited).toContain(13)
    const fields = aiDoctrineSystemBlock('fields').text
    for (const rule of new Set(cited)) {
      expect([rule, fields.includes(`\n${rule}. `)]).toEqual([rule, true])
    }
  })

  it('states, somewhere in a listing request, every rule its own check refuses for', () => {
    // The listing's rules were cut back to what the tool's schema does not
    // already say (AGL-2937), which is sound only while the PAIR still covers
    // the checks. `checkAiSeoFields` refuses an answer for a wrong type, a
    // missing field, a length, a repeated word, a stuffed keyword and a
    // borrowed title; a requirement the request never states is a refusal the
    // model could not have avoided, which is the failure a cheaper prompt
    // causes. So the assertion is on the whole request — the blocks and the
    // schema together — rather than on either half of it.
    const composed = REQUESTS['seo-fields-full']
    const request = [
      ...composed.blocks(SITE_A).map((block) => block.text),
      JSON.stringify(composed.tools(SITE_A)),
    ].join('\n')
    const fields = ['title', 'description', 'breadcrumb', 'imageAlt'] as const
    const context = {
      fields,
      hasImage: true,
      keywords: ['roof repair'],
      otherTitles: ['Taken already'],
    }
    const listing = (over: Record<string, unknown>) => ({
      title: 'Roof repair in Leeds',
      description: 'What a roof repair costs, and how long one takes.',
      breadcrumb: 'Repairs',
      imageAlt: 'A slate roof under repair.',
      ...over,
    })
    // Each refusal, the answer that earns it, and the sentence the request
    // has to carry for it — in a block or in the schema, whichever says it.
    const refusals = [
      { code: 'type', answer: listing({ title: 12 }), states: '{"type":"string"}' },
      { code: 'missing', answer: listing({ title: '  ' }), states: 'Every field is required' },
      { code: 'too-long', answer: listing({ title: 'Roof '.repeat(20) }), states: 'At most 60 characters' },
      {
        code: 'repetition',
        answer: listing({ description: 'Slate slate slate work.' }),
        states: 'Never repeat the same word three times in one field.',
      },
      {
        code: 'keyword-stuffing',
        answer: listing({ title: 'Roof repair and roof repair' }),
        states: 'at most once in the title and once in the description',
      },
      {
        code: 'duplicate-title',
        answer: listing({ title: 'Taken already' }),
        states: 'Do not reuse a title another page of the site already uses.',
      },
    ]
    for (const refusal of refusals) {
      const codes = checkAiSeoFields(refusal.answer, context).violations.map(
        (violation) => violation.code,
      )
      // The answer really does earn the refusal it is here for: without this
      // the table could drift into asserting sentences nothing can refuse on.
      expect([refusal.code, codes]).toEqual([refusal.code, expect.arrayContaining([refusal.code])])
      expect([refusal.code, request.includes(refusal.states)]).toEqual([refusal.code, true])
    }
    // Every code the check can produce is in the table above.
    expect(new Set(refusals.map((refusal) => refusal.code))).toEqual(
      new Set(['type', 'missing', 'too-long', 'repetition', 'keyword-stuffing', 'duplicate-title']),
    )
  })

  it('lets no step price a cache read it will never get', () => {
    // `AI_STEP_NOMINAL_USAGE` is what the model picker quotes before a
    // workspace has measured anything, and a cache read is priced at a tenth
    // of an input token. A step whose prefix cannot cache and still claims
    // cache reads quotes roughly a tenth of what it will actually cost.
    for (const [name, row] of Object.entries(measured())) {
      const nominal = AI_STEP_NOMINAL_USAGE[REQUESTS[name].step]
      expect([name, nominal.cacheReadTokens > 0]).toEqual([name, row.caches])
    }
  })

  it('knows a minimum for every catalog model, and errs dear for an unknown id', () => {
    expect(aiModelCacheMinTokens('not-a-model')).toBe(4_096)
    for (const step of Object.keys(AI_ROUTING_TABLE) as AiStepKind[]) {
      expect([step, aiModelCacheMinTokens(aiModelForStep(step)) > 0]).toEqual([step, true])
    }
  })
})
