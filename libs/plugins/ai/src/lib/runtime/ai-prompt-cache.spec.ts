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
import type { AiProvider, AiProviderRequest, AiResult, AiSystemBlock, AiTool } from '../providers/contract'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { AI_EVAL_GRADER_INSTRUCTIONS, AI_EVAL_RUBRIC_TOOL } from './ai-eval-live'
import {
  aiDoctrineScopeFor,
  aiDoctrineSystemBlock,
  aiDoctrineSystemBlocks,
  aiDoctrineTreeTool,
  runValidatedGeneration,
} from './ai-doctrine'
import { detectPublishIntent } from './ai-doctrine-validators'
import { AI_JOB_COMPONENT_INSTRUCTIONS } from '../jobs/ai-job-component-step'
import {
  AI_CRM_EMAIL_INSTRUCTIONS,
  AI_CRM_GENERATION_KINDS,
  AI_CRM_MAPPING_INSTRUCTIONS,
  aiCrmRecordInstructions,
} from '../jobs/ai-job-crm-step'
import { AI_JOB_EMAIL_INSTRUCTIONS, AI_JOB_EMAIL_TOOL } from '../jobs/ai-job-email-step'
import { AI_JOB_FORM_INSTRUCTIONS, AI_JOB_FORM_TOOL } from '../jobs/ai-job-form-step'
import { AI_JOB_EXPERIMENT_SYSTEM } from '../jobs/ai-job-experiment-step'
import { AI_JOB_LOGIC_INSTRUCTIONS } from '../jobs/ai-job-logic-step'
import { aiJobEditInstructions } from '../jobs/ai-job-edit-step'
import { assistEditTool } from '../server/assist-edit'
import { aiLogicFunctionTool, aiLogicVariableTool } from '../tools/ai-logic-tool'
import { AI_JOB_INSIGHT_SYSTEM } from '../jobs/ai-job-insight-step'
import { AI_JOB_LAYOUT_INSTRUCTIONS } from '../jobs/ai-job-layout-step'
import { AI_JOB_PAGE_INSTRUCTIONS, AI_PAGE_SECTION_TOOL } from '../jobs/ai-job-page-sections'
import { AI_JOB_PLAN_INSTRUCTIONS } from '../jobs/ai-job-plan-step'
import { AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS, AI_LAYOUT_FRAME_KIND } from '../jobs/ai-job-layout-language'
import { AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS, AI_LAYOUT_PAGE_KIND } from '../jobs/ai-job-page-language'
import { AI_LAYOUT_FRAME_TOOL, AI_LAYOUT_PAGE_TOOL } from '../layout-language/ai-layout-language'
import { buildAnthropicRequestBody } from '../providers/anthropic'
import { AI_JOB_TEMPLATE_INSTRUCTIONS } from '../jobs/ai-job-template-step'
import { AI_JOB_TEXT_SYSTEM } from '../jobs/ai-job-text-step'
import { AI_OVERLAY_SYSTEM } from '../jobs/ai-job-overlay-copy'
import { AI_OVERLAY_COPY_CEILINGS } from '../model/ai-overlay-copy'
import { aiOverlayTool } from '../tools/ai-overlay-tool'
import { AI_JOB_THEME_INSTRUCTIONS } from '../jobs/ai-job-theme-step'
import {
  AI_JOB_WORKFLOW_DRAFT_INSTRUCTIONS,
  AI_JOB_WORKFLOW_EXPLAIN_INSTRUCTIONS,
} from '../jobs/ai-job-workflow-step'
import { aiAutomationTool, aiWorkflowExplanationTool } from '../tools/ai-workflow-tool'
import { AI_SEO_FIXES_INSTRUCTIONS, AI_SEO_SITE_INSTRUCTIONS } from '../jobs/ai-job-seo-step'
import { AI_BUILD_PLAN_TOOL, aiBuildPlanToolFor } from '../model/ai-build-plan'
import { resolveBusinessProfile } from '@aglyn/aglyn/app-utils/business-profile'
import {
  AI_SITE_CONTEXT_MAX_CHARS,
  aiInstructionsWithSiteContext,
  aiSiteContextSystemBlock,
  type AiSiteContextInput,
} from '../model/ai-site-context'
import { aiComponentTool } from '../tools/ai-component-tool'
import { aiExperimentExplainTool, aiExperimentVariantsTool } from '../tools/ai-experiment-tool'
import { aiInsightAnswerTool, aiInsightReadTool } from '../tools/ai-insight-tool'
import { AI_CRM_EMAIL_TOOL, AI_CRM_MAPPING_TOOL, aiCrmRecordTool } from '../tools/ai-crm-tool'
import { AI_INVENTORY_LOOKUP_TOOL_NAME, aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'
import { AI_SEO_FIELDS_INSTRUCTIONS, aiSeoFieldsInstructions } from './seo-fields'
import {
  AI_CATALOG_INSTRUCTIONS,
  AI_CATEGORIES_INSTRUCTIONS,
  AI_PRODUCT_COPY_INSTRUCTIONS,
} from './ai-products-generation'
import { AI_BLOG_POST_INSTRUCTIONS } from './ai-blog-post-generation'
import { AI_BLOG_POST_TOOL } from '../tools/ai-blog-post-tool'
import { AI_DATASET_INSTRUCTIONS } from './ai-dataset-generation'
import { AI_DATASET_TOOL } from '../tools/ai-dataset-tool'
import {
  AI_CATALOG_TOOL,
  AI_CATEGORIES_TOOL,
  AI_PRODUCT_COPY_TOOL,
} from '../tools/ai-products-tool'
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
  aiConversationCacheFits,
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
    caches: true,
    why: "a listing's rules and tool, kept short while the fast tier could not cache them, over Claude Haiku 5.5's 512-token minimum since it became the fast default (AGL-3781); a page's listings are asked a minute apart, so each reads the one before",
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
  'jobs/ai-job-crm-step.ts': {
    step: 'job.crm',
    caches: true,
    why: "a record's, an email's and an import's rules and tool, kept short while the fast tier could not cache them, over Claude Haiku 5.5's 512-token minimum since AGL-3781",
  },
  'server/ai-media-svg.ts': {
    // An illustration in Media (AGL-3602) runs on the fast tier, the row
    // `copy.element` is served from.
    step: 'copy.element',
    caches: true,
    why: 'one short instruction block and the doctrine, about 2,100 tokens: over Claude Haiku 5.5’s 512-token minimum since AGL-3781, under Haiku 4.5’s 4,096 before',
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
  'jobs/ai-job-page-language.ts': {
    step: 'job.page',
    caches: true,
    why: 'the doctrine and the layout language; a whole page is one answer, and a site asks it once a page (AGL-3660)',
  },
  'jobs/ai-job-theme-step.ts': {
    step: 'job.theme',
    caches: true,
    why: 'the doctrine and the theme rules; a theme reads no site inventory',
  },
  'jobs/ai-job-seo-step.ts': {
    step: 'job.seo',
    caches: true,
    why: "the audit's site and fix passes, on the same fast tier as a listing; a fix batch's tool names its own pages, so only its re-ask reads its prefix",
  },
  'jobs/ai-job-workflow-step.ts': {
    step: 'job.workflow',
    caches: true,
    why: 'the doctrine and the automation vocabulary, or the explanation rules; no site inventory block',
  },
  'jobs/ai-job-logic-step.ts': {
    step: 'job.logic',
    caches: true,
    why: "one rules block — the grammar, a variable's stored forms and how to explain — so every tool's prefix clears the balanced tier's minimum; the site's variables and the request ride uncached",
  },
  'jobs/ai-job-edit-step.ts': {
    step: 'job.edit',
    caches: true,
    why: "the document doctrine, the job's own rules and the edit rung's protocol and catalog for the document's kind, one prefix a kind; the outline of the page and the request ride uncached (AGL-3616)",
  },
  'jobs/ai-job-experiment-step.ts': {
    step: 'job.experiment',
    caches: true,
    why: "the A/B test rules and the acceptable-use block, under 1,000 tokens: over Claude Sonnet 5.5's 512-token minimum since it became the balanced default (AGL-3660), under Sonnet 5's 1,024 before; the copy under test, or a test's arms with its verdict, is the request",
  },
  'jobs/ai-job-insight-step.ts': {
    step: 'job.insight',
    caches: true,
    why: "an insight's rules and the acceptable-use block, under 1,000 tokens: over Claude Sonnet 5.5's 512-token minimum since AGL-3660; the read call's catalog and the answer call's tables are the request",
  },
  'runtime/ai-products-generation.ts': {
    step: 'job.products',
    caches: true,
    why: "the doctrine, the rules and the tool of a product's copy, a catalog, or categories and discounts; the product, its photo and the brief ride uncached",
  },
  'runtime/ai-blog-post-generation.ts': {
    step: 'copy.blog',
    caches: true,
    why: "the doctrine's fields block, a post's rules and its tool (AGL-3676); the site's brief, the posts already written and which post this is ride uncached",
  },
  'runtime/ai-dataset-generation.ts': {
    step: 'job.products',
    caches: true,
    why: "the doctrine's fields block, a dataset's rules and its tool (AGL-3616); the site's brief, the dataset's plan entry and where it is listed ride uncached",
  },
  'jobs/ai-job-text-step.ts': {
    step: 'job.text',
    caches: false,
    why: 'one short rule block; the brief is the whole request',
  },
  'jobs/ai-job-overlay-copy.ts': {
    step: 'job.text',
    caches: true,
    why: "a text job asked for overlay copy (AGL-3603): the overlay rules and the acceptable-use block, over Claude Sonnet 5.5's 512-token minimum since AGL-3660; the brief, the triggers and the current copy are the request",
  },
  'server/plugin-text-generation.ts': {
    step: 'job.text',
    caches: false,
    why: "the core's text-generation seam (AGL-3324): the CALLER's standing block, sent as one prefix with a breakpoint, so a caller whose block clears the balanced tier's minimum would cache and one under it does not. The seam holds no prompt of its own to measure here; its one caller today, Sequences' curation, sends a rule block of a few hundred tokens, far under the minimum, and the person's record and the steps are the request",
  },
  'server/ai-assist.ts': {
    step: 'copy.element',
    caches: false,
    why: "the copy assistant's three mode prompts, each measured below; the section mode alone clears its model's minimum, since Claude Sonnet 5.5's is 512 (AGL-3660)",
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
  /** This request's verdict where it differs from its door's other requests. */
  caches?: boolean
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
  // A site's plan (AGL-3750): the same request with the site's language on
  // its tool, one schema for every brief.
  'site-plan': {
    door: 'jobs/ai-job-plan-step.ts',
    step: 'job.plan',
    blocks: (site) => aiDoctrineSystemBlocks(site, { instructions: AI_JOB_PLAN_INSTRUCTIONS }),
    tools: () => [aiBuildPlanToolFor('', { language: true }), aiInventoryLookupTool()],
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
    tools: () => [AI_JOB_FORM_TOOL, aiInventoryLookupTool()],
  },
  // One section pass of a page job. Its instructions carry the screen palette
  // themselves, and it is a custom kind, so the loop adds no catalog of its own.
  'page-section': {
    door: 'jobs/ai-job-page-step.ts',
    step: 'job.page',
    blocks: (site) => aiDoctrineSystemBlocks(site, { instructions: AI_JOB_PAGE_INSTRUCTIONS }),
    tools: () => [AI_PAGE_SECTION_TOOL, aiInventoryLookupTool()],
  },
  // The layout language (AGL-3660): a guided start's pages, one answer a
  // page, and its header and footer. Both carry the fields-scope doctrine and
  // the language; the site's inventory rides after the last breakpoint.
  'layout-page': {
    door: 'jobs/ai-job-page-language.ts',
    step: 'job.page',
    blocks: (site) =>
      aiDoctrineSystemBlocks(site, {
        instructions: AI_JOB_PAGE_LANGUAGE_INSTRUCTIONS,
        scope: aiDoctrineScopeFor(AI_LAYOUT_PAGE_KIND),
      }),
    tools: () => [AI_LAYOUT_PAGE_TOOL, aiInventoryLookupTool()],
  },
  'layout-frame': {
    door: 'jobs/ai-job-layout-step.ts',
    step: 'job.layout',
    blocks: (site) =>
      aiDoctrineSystemBlocks(site, {
        instructions: AI_JOB_LAYOUT_LANGUAGE_INSTRUCTIONS,
        scope: aiDoctrineScopeFor(AI_LAYOUT_FRAME_KIND),
      }),
    tools: () => [AI_LAYOUT_FRAME_TOOL, aiInventoryLookupTool()],
  },
  theme: {
    door: 'jobs/ai-job-theme-step.ts',
    step: 'job.theme',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_JOB_THEME_INSTRUCTIONS }),
    tools: () => [aiThemeTool()],
  },
  // An automation drafted from a description (AGL-2919): the site's forms and
  // datasets ride in the user turn, so the system blocks carry no inventory.
  'workflow-draft': {
    door: 'jobs/ai-job-workflow-step.ts',
    step: 'job.workflow',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_JOB_WORKFLOW_DRAFT_INSTRUCTIONS }),
    tools: () => [aiAutomationTool()],
  },
  'workflow-explain': {
    door: 'jobs/ai-job-workflow-step.ts',
    step: 'job.workflow',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_JOB_WORKFLOW_EXPLAIN_INSTRUCTIONS }),
    tools: () => [aiWorkflowExplanationTool()],
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
  // One product's copy (AGL-2916), the request a bulk job makes once a product.
  // A custom kind, so the loop adds no catalog, and no site inventory rides:
  // the product, its categories and its photo are the user turn.
  'product-copy': {
    door: 'runtime/ai-products-generation.ts',
    step: 'job.products',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_PRODUCT_COPY_INSTRUCTIONS }),
    tools: () => [AI_PRODUCT_COPY_TOOL],
  },
  catalog: {
    door: 'runtime/ai-products-generation.ts',
    step: 'job.products',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_CATALOG_INSTRUCTIONS }),
    tools: () => [AI_CATALOG_TOOL],
  },
  // A site's first post (AGL-3676): the brief and the posts written are the user turn.
  'blog-post': {
    door: 'runtime/ai-blog-post-generation.ts',
    step: 'copy.blog',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_BLOG_POST_INSTRUCTIONS, scope: 'fields' }),
    tools: () => [AI_BLOG_POST_TOOL],
  },
  // A site's dataset (AGL-3616): the brief, the dataset and where it is listed are the user turn.
  dataset: {
    door: 'runtime/ai-dataset-generation.ts',
    step: 'job.products',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_DATASET_INSTRUCTIONS, scope: 'fields' }),
    tools: () => [AI_DATASET_TOOL],
  },
  categories: {
    door: 'runtime/ai-products-generation.ts',
    step: 'job.products',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_CATEGORIES_INSTRUCTIONS }),
    tools: () => [AI_CATEGORIES_TOOL],
  },
  // CRM by AI (AGL-2917): the lightest record shape, a contact's, and the
  // heaviest, a deal's with its stage; an email draft; an import's columns.
  'crm-record-contact': {
    door: 'jobs/ai-job-crm-step.ts',
    step: 'job.crm',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: aiCrmRecordInstructions('contact'),
        scope: aiDoctrineScopeFor(AI_CRM_GENERATION_KINDS.record),
      }),
    tools: () => [aiCrmRecordTool('contact')],
  },
  'crm-record-deal': {
    door: 'jobs/ai-job-crm-step.ts',
    step: 'job.crm',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: aiCrmRecordInstructions('deal'),
        scope: aiDoctrineScopeFor(AI_CRM_GENERATION_KINDS.record),
      }),
    tools: () => [aiCrmRecordTool('deal')],
  },
  'crm-email': {
    door: 'jobs/ai-job-crm-step.ts',
    step: 'job.crm',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_CRM_EMAIL_INSTRUCTIONS,
        scope: aiDoctrineScopeFor(AI_CRM_GENERATION_KINDS.email),
      }),
    tools: () => [AI_CRM_EMAIL_TOOL],
  },
  'crm-mapping': {
    door: 'jobs/ai-job-crm-step.ts',
    step: 'job.crm',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_CRM_MAPPING_INSTRUCTIONS,
        scope: aiDoctrineScopeFor(AI_CRM_GENERATION_KINDS.mapping),
      }),
    tools: () => [AI_CRM_MAPPING_TOOL],
  },
  'eval-grade': {
    door: 'runtime/ai-eval-live.ts',
    step: 'job.plan',
    blocks: () => aiDoctrineSystemBlocks(undefined, { instructions: AI_EVAL_GRADER_INSTRUCTIONS }),
    tools: () => [AI_EVAL_RUBRIC_TOOL],
  },
  // An insight's two calls (AGL-2915): the same system block, each with its
  // own tool. The readers' catalog, the question and the tables are the user
  // turn, so no workspace's byte is in either prefix.
  'insight-read': {
    door: 'jobs/ai-job-insight-step.ts',
    step: 'job.insight',
    blocks: () => [...AI_JOB_INSIGHT_SYSTEM],
    tools: () => [aiInsightReadTool()],
  },
  'experiment-variants': {
    door: 'jobs/ai-job-experiment-step.ts',
    step: 'job.experiment',
    blocks: () => [...AI_JOB_EXPERIMENT_SYSTEM],
    tools: () => [aiExperimentVariantsTool('screen')],
  },
  // Logic by AI (AGL-3603): the fields scope, one rules block for all three
  // answers, and each answer's tool.
  'logic-function': {
    door: 'jobs/ai-job-logic-step.ts',
    step: 'job.logic',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_JOB_LOGIC_INSTRUCTIONS,
        scope: aiDoctrineScopeFor('logic'),
      }),
    tools: () => [aiLogicFunctionTool()],
  },
  'logic-variable': {
    door: 'jobs/ai-job-logic-step.ts',
    step: 'job.logic',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_JOB_LOGIC_INSTRUCTIONS,
        scope: aiDoctrineScopeFor('logic'),
      }),
    tools: () => [aiLogicVariableTool()],
  },
  'logic-explain': {
    door: 'jobs/ai-job-logic-step.ts',
    step: 'job.logic',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: AI_JOB_LOGIC_INSTRUCTIONS,
        scope: aiDoctrineScopeFor('logic'),
      }),
    tools: () => [aiWorkflowExplanationTool()],
  },
  // An edit to a page or a layout (AGL-3616): the rung's tool and catalog per
  // kind, a page's tool also offering its search fields.
  'edit-screen': {
    door: 'jobs/ai-job-edit-step.ts',
    step: 'job.edit',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: aiJobEditInstructions('screen'),
        scope: aiDoctrineScopeFor('edit'),
      }),
    tools: () => [assistEditTool('screen')],
  },
  'edit-layout': {
    door: 'jobs/ai-job-edit-step.ts',
    step: 'job.edit',
    blocks: () =>
      aiDoctrineSystemBlocks(undefined, {
        instructions: aiJobEditInstructions('layout'),
        scope: aiDoctrineScopeFor('edit'),
      }),
    tools: () => [assistEditTool('layout')],
  },
  'experiment-explain': {
    door: 'jobs/ai-job-experiment-step.ts',
    step: 'job.experiment',
    blocks: () => [...AI_JOB_EXPERIMENT_SYSTEM],
    tools: () => [aiExperimentExplainTool()],
  },
  'insight-answer': {
    door: 'jobs/ai-job-insight-step.ts',
    step: 'job.insight',
    blocks: () => [...AI_JOB_INSIGHT_SYSTEM],
    tools: () => [aiInsightAnswerTool()],
  },
  text: {
    door: 'jobs/ai-job-text-step.ts',
    step: 'job.text',
    blocks: () => [...AI_JOB_TEXT_SYSTEM],
    tools: () => [],
  },
  // Overlay copy (AGL-3603): a popup's tool is the larger of the two shapes.
  'overlay-popup': {
    door: 'jobs/ai-job-overlay-copy.ts',
    step: 'job.text',
    blocks: () => [...AI_OVERLAY_SYSTEM],
    tools: () => [aiOverlayTool('popup', AI_OVERLAY_COPY_CEILINGS, ['delay', 'scroll', 'exit'])],
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
    caches: true,
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

/**
 * The bytes a provider caches, as the Anthropic adapter puts them on the wire:
 * the tools, then every system block through the last `cache_control`. What a
 * cache entry is keyed on, so two requests that differ here never share one.
 */
function wirePrefix(name: string, site: AiSiteInventory, brief: string): string {
  const request = REQUESTS[name]
  const body = buildAnthropicRequestBody({
    model: aiModelForStep(request.step),
    maxTokens: 1_000,
    system: request.blocks(site),
    tools: request.tools(site),
    messages: [{ role: 'user', content: brief }],
    stream: false,
  })
  const system = (body['system'] ?? []) as Array<{ cache_control?: unknown }>
  const last = system.map((block) => Boolean(block.cache_control)).lastIndexOf(true)
  return JSON.stringify({ tools: body['tools'] ?? [], system: system.slice(0, last + 1) })
}

describe('a cached prefix is byte-stable across briefs, as it goes on the wire (AGL-3660)', () => {
  // The guided start's own requests, and every other door's: the brief is the
  // user turn and the site is the volatile block, so neither may move a byte
  // of what the provider caches. A timestamp, an id, a key order that follows
  // insertion or a tool list built per request would each fail here.
  it.each(Object.keys(REQUESTS).filter((name) => name !== 'seo-fixes'))(
    '%s sends the same cached bytes for two briefs on two sites',
    (name) => {
      const a = wirePrefix(name, SITE_A, 'A 2-page website for a dog groomer in Austin called Hillside.')
      const b = wirePrefix(name, SITE_B, 'A 5-page website for a bakery in Tulsa that sells cakes to order.')
      expect(a).toBe(b)
      expect(a).not.toContain('Hillside')
      expect(a).not.toContain('Acme Roofing')
    },
  )
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
      expect([name, row.caches]).toEqual([name, REQUESTS[name].caches ?? AI_DOORS[REQUESTS[name].door].caches])
    }
  })

  it('holds every request’s cached span to a measured size', () => {
    // These are the numbers AGL-2937 is measured by: a lever that cuts a
    // prompt moves one of them DOWN and says so in its commit, and a prompt
    // that grows without anyone meaning it to moves one UP and is red here.
    expect(measured()).toEqual({
      // Every request that carries the doctrine is down 4 at AGL-3596, whose
      // rule 3 no longer describes a form drawn on the page; the page section
      // is down 24, its instructions dropping the same.
      // Every request that carries the document doctrine is up 12 or 13 at
      // AGL-3475, whose rule 4 names a dataset's record template as the third
      // way similar pages share one template.
      // 2,945 before AGL-3024 told the planner what a layout's fields are:
      // the regions it has, which is what the build is then held to. Down 3
      // at AGL-3433, whose shorter rule 16 every document request below also
      // carries. A brief that asks for a video is offered the plan's list of
      // players on a tool of its own; this plain one is the same bytes.
      plan: { prefixTokens: 2_984, minimum: 512, caches: true, toolsStable: true },
      // A site's plan says the language its brief is in (AGL-3750): the plain
      // plan's prefix and one nullable field, up 54. Its photo words in
      // English (AGL-3760) took it up 55 more, and saying they are required
      // whenever the language is not English (AGL-3779) 15 more.
      'site-plan': { prefixTokens: 3_109, minimum: 512, caches: true, toolsStable: true },
      // The layout, template, component and section doors each grew 20 when
      // the palette learned the layout elements' Color scheme (AGL-3284).
      // All four then came DOWN 2 at AGL-3411: Tertiary
      // joined the Button and Screen Link colors, and the catalog stopped
      // printing a second identical `FAQ (muiStack)`, which more than paid
      // for it. AGL-3433 offered the library Video and took the catalog's
      // names that only spell an id again, a net cut on every surface; the
      // template's own line on third-party players and its video token puts it
      // up 38 where the others came down. The template's up 16 more at
      // AGL-3143 §16, which tells it copy never prints an address, a slug or
      // a timestamp: a live build printed all three on every article. All
      // four grew 6 at AGL-3588, the App Bar's shrink and hide switches, and
      // 4 at AGL-3717, the Image's and the Image List's lightbox switch, and
      // 10 at AGL-3886, the List Item Text's secondary text color, which the
      // page section's catalog carries too.
      layout: { prefixTokens: 4_428, minimum: 512, caches: true, toolsStable: true },
      template: { prefixTokens: 5_040, minimum: 512, caches: true, toolsStable: true },
      component: { prefixTokens: 5_040, minimum: 512, caches: true, toolsStable: true },
      // 2,901 before AGL-3287 gave the email palette its Header and Footer,
      // which the catalog names as blocks to imitate. Up 74 at AGL-3676, which
      // says plainly that a subject line and a preheader carry no merge token.
      // Up 5 at AGL-3897, whose email text offers the Eyebrow, Details and
      // Links styles.
      email: { prefixTokens: 2_975, minimum: 512, caches: true, toolsStable: true },
      // 2,728 while a form was the Form and its all-in-one Form Fields. Up 594
      // when the form job moved to MUI's separate form elements: the form
      // catalog lists each piece of a field, and the instructions say how a
      // field, a choice and a checkbox are put together. Most requests that
      // carry the document doctrine are up 1, from rule 17's larger form
      // budget, which the same fields now need. Up 139 at AGL-3825: the form
      // catalog lists the Date Picker and Time Picker with their settings, and
      // the instructions say a day and a time of day are answers a form takes.
      // Up 50 at AGL-3942: the instructions say a placeholder is an example
      // answer, never a note in square brackets.
      form: { prefixTokens: 3_554, minimum: 512, caches: true, toolsStable: true },
      'page-section': { prefixTokens: 4_598, minimum: 512, caches: true, toolsStable: true },
      // The layout language (AGL-3660). Read four characters a token these
      // err low: the token counting endpoint puts the page's cached span at
      // 2,872 tokens and the frame's at 3,471 on the balanced tier, tools
      // and their system prompt included. Both up 10 at AGL-3717, which says
      // an image block whose `to` is lightbox opens its picture large. Up 19
      // and 20 at AGL-3979, which names phone and email as where a link goes:
      // a call or write button reaches the number or address the brief gives.
      'layout-page': { prefixTokens: 1_860, minimum: 512, caches: true, toolsStable: true },
      'layout-frame': { prefixTokens: 2_232, minimum: 512, caches: true, toolsStable: true },
      // 3,326 before AGL-3403 widened the components a theme may style and
      // gave a component leaf its theme-aware `sx` target.
      theme: { prefixTokens: 3_518, minimum: 512, caches: true, toolsStable: true },
      // The automation tool carries a variant per step type, each with only its
      // own fields and none a `null` union: the bytes that keep a request
      // within a provider's union limit (AGL-3096). Up 84 at AGL-3538: a
      // task's priority and a logged call's direction, in the tool and in
      // the steps' field lists. Up 9 more at AGL-3458, which named the
      // `lead` event's keys — the form, the site, the name, the campaigns —
      // which the tool lists for the conditions it may write.
      // The automation draft is up 31 at AGL-3605: the funnels plugin's "Left a
      // funnel" trigger joins the host events the draft may start on.
      // Up 249 at AGL-3611, the order and return triggers the draft may start
      // on, and 7 for the two steps that ride a larger variant naming its
      // empty field.
      'workflow-draft': { prefixTokens: 5_001, minimum: 512, caches: true, toolsStable: true },
      'workflow-explain': { prefixTokens: 2_216, minimum: 512, caches: true, toolsStable: true },
      // The listing doors were under Claude Haiku 4.5's 4,096-token minimum
      // and are over Claude Haiku 5.5's 512 since it became the fast default
      // (AGL-3781), read four characters a token, which errs low; that model
      // counts the same text as about 30% more tokens.
      'seo-fields': { prefixTokens: 734, minimum: 512, caches: true, toolsStable: true },
      'seo-fields-full': { prefixTokens: 873, minimum: 512, caches: true, toolsStable: true },
      'seo-site': { prefixTokens: 951, minimum: 512, caches: true, toolsStable: true },
      // The fixes tool's schema enumerates the eight pages of THIS batch, so
      // its prefix is per-batch: only a batch's own re-ask reads it. The
      // enumeration is kept deliberately: a schema that refuses a page outside
      // the batch is worth more than a prefix shared across batches.
      'seo-fixes': { prefixTokens: 921, minimum: 512, caches: true, toolsStable: false },
      // The grader's copy criterion is up 44 at AGL-3827: a template placeholder
      // left where words belong grades a 1, and a bracketed fact is not filler.
      'eval-grade': { prefixTokens: 2_051, minimum: 512, caches: true, toolsStable: true },
      // An insight's rules are short on purpose: no model caches them, so every
      // byte is billed as input on both calls and on a re-ask.
      // A/B tests by AI (AGL-2914): the rules are one block, well under the
      // balanced tier's minimum, so nothing is cached and the copy under test
      // — or the arms and the verdict — is billed as the request.
      'experiment-variants': { prefixTokens: 987, minimum: 512, caches: true, toolsStable: true },
      'experiment-explain': { prefixTokens: 911, minimum: 512, caches: true, toolsStable: true },
      // Logic by AI (AGL-3603): one rules block on the fields scope, so a
      // function's, a variable's and an explanation's prefix each cache.
      'logic-function': { prefixTokens: 1_556, minimum: 512, caches: true, toolsStable: true },
      'logic-variable': { prefixTokens: 1_087, minimum: 512, caches: true, toolsStable: true },
      'logic-explain': { prefixTokens: 1_077, minimum: 512, caches: true, toolsStable: true },
      // An edit to a page or a layout (AGL-3616): the document doctrine, the
      // job's rules, and the edit rung's protocol and element catalog for the
      // kind, so a page's and a layout's prefix each cache.
      // The edit doors are up 4 at AGL-3717 for the palette's lightbox switch.
      // Both up 101 at AGL-3716: the edit protocol's own Music player line,
      // which is where the player is named now that the catalog leaves it off.
      // Both up 106 at AGL-3838: the protocol's Animation line, the
      // vocabulary's presets, triggers, easings and caps an updateProps may set.
      // Both up 9 at AGL-3886 for the List Item Text's secondary text color.
      'edit-screen': { prefixTokens: 6_178, minimum: 512, caches: true, toolsStable: true },
      'edit-layout': { prefixTokens: 6_166, minimum: 512, caches: true, toolsStable: true },
      // Both insight requests are up 60 or 61 at AGL-3663: a site's published
      // state comes only from its Site status table, never from its traffic.
      // Both up 25 at AGL-3834: so does which pages are published, never the
      // pages a views table lists.
      'insight-read': { prefixTokens: 969, minimum: 512, caches: true, toolsStable: true },
      'insight-answer': { prefixTokens: 1_008, minimum: 512, caches: true, toolsStable: true },
      // A product's copy, a catalog, and categories with discounts (AGL-2916):
      // the whole doctrine, each generation's rules and its tool, which clear
      // the balanced tier's minimum, so a bulk job reads the prefix once a
      // product after its first.
      'product-copy': { prefixTokens: 2_424, minimum: 512, caches: true, toolsStable: true },
      // The catalog is up 132 at AGL-3733 (Zach, 2026-10-12): each product's
      // suggested price, its field and the rule that prices it by kind.
      // Up 72 at AGL-4065: the rule that names each product as one thing a
      // shopper buys, never a kind with "Item" or "Order" after it.
      catalog: { prefixTokens: 2_654, minimum: 512, caches: true, toolsStable: true },
      categories: { prefixTokens: 2_349, minimum: 512, caches: true, toolsStable: true },
      // A site's first post (AGL-3676): the doctrine's fields block, its rules and its tool.
      'blog-post': { prefixTokens: 821, minimum: 512, caches: true, toolsStable: true },
      // A site's dataset (AGL-3616): the doctrine's fields block, its rules and its tool.
      // Up 195 at AGL-4065: the rule that a list the brief gives no entries for
      // starts with marked samples, and the tool's `sample` on each record.
      dataset: { prefixTokens: 1_225, minimum: 512, caches: true, toolsStable: true },
      // CRM by AI (AGL-2917), on the fast tier: each prompt is only the field
      // rules, the kind's own and its tool, which no shape took past Claude
      // Haiku 4.5's minimum and every shape takes past Claude Haiku 5.5's
      // (AGL-3781).
      'crm-record-contact': { prefixTokens: 768, minimum: 512, caches: true, toolsStable: true },
      'crm-record-deal': { prefixTokens: 913, minimum: 512, caches: true, toolsStable: true },
      'crm-email': { prefixTokens: 650, minimum: 512, caches: true, toolsStable: true },
      'crm-mapping': { prefixTokens: 680, minimum: 512, caches: true, toolsStable: true },
      // The text step marks a breakpoint its prompt is far too short to fill.
      // It costs nothing and it caches nothing; the brief is the request.
      text: { prefixTokens: 128, minimum: 512, caches: false, toolsStable: true },
      'overlay-popup': { prefixTokens: 866, minimum: 512, caches: true, toolsStable: true },
      // Under even Claude Haiku 5.5's 512-token minimum (AGL-3781).
      'copy.element': { prefixTokens: 339, minimum: 512, caches: false, toolsStable: true },
      'copy.blog': { prefixTokens: 340, minimum: 512, caches: false, toolsStable: true },
      // Up 8 at AGL-3825: its element list names the Date and Time Pickers.
      'copy.section': { prefixTokens: 744, minimum: 512, caches: true, toolsStable: true },
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
    // One-sided, as the title says: a step whose prompt caches and whose
    // nominal claims no read quotes high, which is safe; claiming a read the
    // prompt cannot get quotes low. The steps the balanced default's lower
    // minimum let cache (AGL-3660) still quote as they did.
    for (const [name, row] of Object.entries(measured())) {
      const nominal = AI_STEP_NOMINAL_USAGE[REQUESTS[name].step]
      if (nominal.cacheReadTokens > 0) expect([name, row.caches]).toEqual([name, true])
    }
  })

  it('knows a minimum for every catalog model, and errs dear for an unknown id', () => {
    expect(aiModelCacheMinTokens('not-a-model')).toBe(4_096)
    for (const step of Object.keys(AI_ROUTING_TABLE) as AiStepKind[]) {
      expect([step, aiModelCacheMinTokens(aiModelForStep(step)) > 0]).toEqual([step, true])
    }
  })
})

/**
 * THE PER-SITE BLOCK (AGL-3661). A site's business profile, status and
 * remembered preferences ride as one cached block AFTER every platform-wide
 * block, so the doors that read it hold two cache entries: the platform's,
 * shared by every workspace and measured in the ledger above, and the
 * site's, read by every request of a job on that site. Each row below is a
 * ledger row's request with the context added the way its door adds it.
 */
describe('a site’s context block extends the shared prefix, never enters it (AGL-3661)', () => {
  const context = (name: string, email: string): AiSiteContextInput => ({
    profile: resolveBusinessProfile({
      host: { displayName: name, business: { supportEmail: email } },
      site: { services: ['Repairs', 'Inspections'], tone: 'friendly', sources: { services: 'owner', tone: 'owner' } },
    }),
    preferences: ['Prefers short, concise copy'],
  })
  const CONTEXT_A = context('Acme Roofing', 'hello@acme.test')
  const CONTEXT_B = context('Bakery', 'orders@bakery.test')
  const SITE_REQUESTS: Record<string, { base: string; blocks: (site: AiSiteInventory, ctx: AiSiteContextInput | null) => AiSystemBlock[] }> = {
    plan: {
      base: 'plan',
      blocks: (site, ctx) =>
        aiDoctrineSystemBlocks(site, { instructions: aiInstructionsWithSiteContext(AI_JOB_PLAN_INSTRUCTIONS, ctx) }),
    },
    'insight-answer': {
      base: 'insight-answer',
      blocks: (_site, ctx) => [...aiInstructionsWithSiteContext(AI_JOB_INSIGHT_SYSTEM, ctx)],
    },
  }
  /** Every block through the last breakpoint that is NOT a site's: what every workspace shares. */
  const platformPrefix = (blocks: readonly AiSystemBlock[]) =>
    cachedPrefix(blocks.filter((block) => !block.site))

  it.each(Object.keys(SITE_REQUESTS))('%s shares its platform prefix byte for byte across two sites', (name) => {
    const row = SITE_REQUESTS[name]
    const a = row.blocks(SITE_A, CONTEXT_A)
    const b = row.blocks(SITE_B, CONTEXT_B)
    expect(platformPrefix(a)).toBe(platformPrefix(b))
    expect(platformPrefix(a)).not.toContain('Acme Roofing')
    expect(platformPrefix(a)).toBe(cachedPrefix(REQUESTS[row.base].blocks(SITE_A)))
    expect(() => validateAiSystemBlocks(a)).not.toThrow()
    expect(() => validateAiSystemBlocks(b)).not.toThrow()
  })

  it.each(Object.keys(SITE_REQUESTS))('%s caches the site block last, at most 400 tokens, and only the site’s', (name) => {
    const blocks = SITE_REQUESTS[name].blocks(SITE_A, CONTEXT_A)
    const last = blocks.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
    const site = blocks.filter((block) => block.site)
    expect(site).toHaveLength(1)
    expect(blocks[last]).toBe(site[0])
    expect(site[0].text).toContain('Acme Roofing')
    expect(site[0].text).toContain('hello@acme.test')
    expect(site[0].text.length).toBeLessThanOrEqual(AI_SITE_CONTEXT_MAX_CHARS)
    expect(blocks.slice(last + 1).filter((block) => !block.volatile)).toEqual([])
  })

  it.each(Object.keys(SITE_REQUESTS))('%s is byte-identical to its ledger row for a site with no context', (name) => {
    const row = SITE_REQUESTS[name]
    expect(row.blocks(SITE_A, null)).toEqual(REQUESTS[row.base].blocks(SITE_A))
  })
})


/**
 * A GENERATION THAT CONTINUES READS ITS OWN CONVERSATION (AGL-3809).
 *
 * A lookup round and a re-ask re-send the whole first turn — the brief and
 * what the door put beside it — and the site's inventory, which without a
 * breakpoint after them is billed at the full input rate on every
 * continuation. A door that turns `cacheConversation` on pays a cache write
 * on its first call's tail, which pays back only where most generations
 * continue, so the doors that may are listed with their measurement
 * (`docs/AI_CACHE_AUDIT_2026-10.md`): a new one is red here until measured.
 */
const AI_CONVERSATION_CACHE_DOORS: Record<string, string> = {
  'jobs/ai-job-plan-step.ts':
    'plans continue more often than not: 27 lookup rounds to 42 answers on Claude Sonnet 5.5 in the golden replay store, and two or three calls in about half of production plan steps',
}

/** A provider that answers from a queue and keeps every request it was sent. */
function recording(answers: AiResult[]): { fake: AiProvider; requests: AiProviderRequest[] } {
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

const answer = (toolUse: Array<{ name: string; input: Record<string, unknown> }>): AiResult => ({
  kind: 'completion',
  text: toolUse.length ? '' : 'A plan in prose.',
  toolUse,
  usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0,
  stopReason: toolUse.length ? 'tool_use' : 'end_turn',
})

describe('a generation that continues reads its own conversation (AGL-3809)', () => {
  it('is turned on only by the doors measured to continue', () => {
    const turnedOn = sourceFiles(LIB_ROOT)
      .filter((path) => /\bcacheConversation:\s*true\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(LIB_ROOT.length + 1))
      .sort()
    expect(turnedOn).toEqual(Object.keys(AI_CONVERSATION_CACHE_DOORS).sort())
  })

  /** The wire body with every cache marker taken out: what the cache matches on. */
  const unmarked = (request: AiProviderRequest) =>
    JSON.parse(
      JSON.stringify(buildAnthropicRequestBody({ ...request, stream: false }), (key, value) =>
        key === 'cache_control' ? undefined : value,
      ),
    ) as { tools: unknown; system: unknown; messages: unknown[] }

  const markers = (request: AiProviderRequest) =>
    (JSON.stringify(buildAnthropicRequestBody({ ...request, stream: false })).match(/"cache_control"/g) ?? []).length

  async function planGeneration(): Promise<AiProviderRequest[]> {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    // A lookup round, then two answers the check cannot read: three calls, as
    // far as a plan's conversation grows before it gives up.
    const { fake, requests } = recording([
      answer([{ name: AI_INVENTORY_LOOKUP_TOOL_NAME, input: { kind: 'components', query: 'card' } }]),
      answer([]),
      answer([]),
    ])
    await runValidatedGeneration('plan', {
      step: 'job.plan',
      model: 'claude-sonnet-5-5',
      provider: fake,
      // The plan with its site block: three system breakpoints, so the
      // conversation's is the fourth and last the provider caches.
      instructions: aiInstructionsWithSiteContext(AI_JOB_PLAN_INSTRUCTIONS, {
        profile: resolveBusinessProfile({ host: { displayName: 'Acme Roofing' }, site: {} }),
        preferences: [],
      }),
      inventory: SITE_A,
      messages: [{ role: 'user', content: 'Kind of job: site\nBrief: a roofer in Springfield' }],
      tool: aiBuildPlanToolFor('', { language: true }),
      cacheConversation: true,
    })
    warn.mockRestore()
    return requests
  }

  it('asks every call of the generation to cache its conversation, within the four markers', async () => {
    const requests = await planGeneration()
    expect(requests).toHaveLength(3)
    for (const request of requests) {
      expect(request.cacheConversation).toBe(true)
      expect(markers(request)).toBe(4)
    }
  })

  it('sends each call’s cached bytes as the exact prefix of the next call’s', async () => {
    const requests = await planGeneration()
    for (let index = 1; index < requests.length; index++) {
      const before = unmarked(requests[index - 1])
      const after = unmarked(requests[index])
      expect(after.tools).toEqual(before.tools)
      expect(after.system).toEqual(before.system)
      // Everything the earlier call marked, its whole conversation, opens the later one unchanged.
      expect(after.messages.slice(0, before.messages.length)).toEqual(before.messages)
      expect(after.messages.length).toBeGreaterThan(before.messages.length)
    }
  })

  it('drops the conversation’s breakpoint, never a system one, where the system holds all four', async () => {
    const { fake, requests } = recording([answer([{ name: 'submit', input: {} }])])
    await runValidatedGeneration('four-breakpoints', {
      model: 'claude-sonnet-5-5',
      provider: fake,
      // The doctrine's own breakpoint and these three.
      instructions: [1, 2, 3].map((n) => ({ text: `rules ${n}`, cacheBreakpoint: true })),
      messages: [{ role: 'user', content: 'brief' }],
      tool: { name: 'submit', description: 'Submit.', strict: true, inputSchema: { type: 'object', properties: {} } },
      cacheConversation: true,
      check: () => ({ value: {}, violations: [] }),
    })
    expect(requests[0].cacheConversation).toBeUndefined()
    expect(markers(requests[0])).toBe(4)
  })
})

describe('a site job’s routes keep their prefix for the hour, in production too (AGL-3830)', () => {
  /** Every step a guided start runs: the plan, the look, the frame, the pages, their listings, the creations, posts, products and the welcome email. */
  const SITE_JOB_STEPS: readonly AiStepKind[] = [
    'copy.blog',
    'job.component',
    'job.email',
    'job.form',
    'job.layout',
    'job.page',
    'job.plan',
    'job.products',
    'job.seo',
    'job.template',
    'job.theme',
  ]

  it('asks for the hour on exactly the routing rows a site job runs', () => {
    const hourly = (Object.keys(AI_ROUTING_TABLE) as AiStepKind[])
      .filter((step) => AI_ROUTING_TABLE[step].cacheTtl === '1h')
      .sort()
    expect(hourly).toEqual([...SITE_JOB_STEPS].sort())
  })

  async function generationOn(step: AiStepKind | undefined): Promise<AiProviderRequest> {
    const { fake, requests } = recording([answer([{ name: 'submit', input: {} }])])
    await runValidatedGeneration('route', {
      ...(step ? { step } : {}),
      model: 'claude-sonnet-5-5',
      provider: fake,
      instructions: [{ text: 'rules' }],
      messages: [{ role: 'user', content: 'brief' }],
      tool: { name: 'submit', description: 'Submit.', strict: true, inputSchema: { type: 'object', properties: {} } },
      check: () => ({ value: {}, violations: [] }),
    })
    return requests[0]
  }

  it('sends the route’s hour on every shared breakpoint of a deployed server’s request, and five minutes elsewhere', async () => {
    const saved = process.env['NODE_ENV']
    ;(process.env as Record<string, string>)['NODE_ENV'] = 'production'
    try {
      for (const step of SITE_JOB_STEPS) {
        const request = await generationOn(step)
        expect([step, request.cacheTtl]).toEqual([step, '1h'])
        const body = JSON.stringify(buildAnthropicRequestBody({ ...request, stream: false }))
        const marks = body.match(/"cache_control":\{[^}]*\}/g) ?? []
        expect(marks.length).toBeGreaterThan(0)
        expect(new Set(marks)).toEqual(new Set(['"cache_control":{"type":"ephemeral","ttl":"1h"}']))
      }
      for (const step of ['job.crm', 'job.insight', 'job.edit', 'assist.chat'] as const) {
        expect([step, (await generationOn(step)).cacheTtl]).toEqual([step, undefined])
      }
      expect((await generationOn(undefined)).cacheTtl).toBeUndefined()
    } finally {
      ;(process.env as Record<string, string | undefined>)['NODE_ENV'] = saved
    }
  })
})

/**
 * EACH JOB'S OWN MARKERS KEEP FIVE MINUTES (AGL-4050).
 *
 * The hour a site job's route asks for pays back only on bytes the NEXT job
 * reads: the tools, the doctrine and the door's rules. A site's block and a
 * plan's own conversation are read by one job, within minutes, so at the hour
 * their 2x write is never earned back. The route's lifetime goes on the shared
 * markers, five minutes on the job's, and the API's rule that no hour-long
 * entry follow a five-minute one holds on every request.
 */
describe('each job’s own markers keep five minutes, the shared prompt the hour (AGL-4050)', () => {
  /** A wire body's markers in the API's prefix order: tools, system, then the turns' blocks. */
  const markersOf = (body: Record<string, unknown>): string[] => {
    const system = (body['system'] ?? []) as Array<Record<string, unknown>>
    const turns = body['messages'] as Array<{ content: unknown }>
    const blocks = turns.flatMap((turn) => (Array.isArray(turn.content) ? (turn.content as Array<Record<string, unknown>>) : []))
    return [...((body['tools'] ?? []) as Array<Record<string, unknown>>), ...system, ...blocks]
      .map((block) => block['cache_control'] as { ttl?: string } | undefined)
      .filter((mark): mark is { ttl?: string } => Boolean(mark))
      .map((mark) => mark.ttl ?? '5m')
  }
  /** Where a body carries a marker: each system block's index, and `m<turn>.<block>` for a turn's. */
  const markerPlaces = (body: Record<string, unknown>): string[] => [
    ...((body['system'] ?? []) as Array<Record<string, unknown>>).flatMap((block, index) =>
      block['cache_control'] ? [String(index)] : [],
    ),
    ...(body['messages'] as Array<{ content: unknown }>).flatMap((turn, index) =>
      Array.isArray(turn.content)
        ? (turn.content as Array<Record<string, unknown>>).flatMap((block, at) => (block['cache_control'] ? [`m${index}.${at}`] : []))
        : [],
    ),
  ]
  const strip = (body: Record<string, unknown>) =>
    JSON.stringify(body, (key, value) => (key === 'cache_control' ? undefined : value))

  const CONTEXT = { profile: resolveBusinessProfile({ host: { displayName: 'Acme Roofing' }, site: {} }), preferences: [] }
  const TURNS = [
    { role: 'user' as const, content: 'Kind of job: site\nBrief: a roofer in Springfield' },
    { role: 'assistant' as const, content: `Called ${AI_INVENTORY_LOOKUP_TOOL_NAME}.` },
    { role: 'user' as const, content: 'the lookup answer' },
  ]
  /** A site plan (with its site block and conversation), a page step and an SEO listing, as their doors build them. */
  const CASES: Record<string, Omit<AiProviderRequest, 'apiKey'>> = {
    'site plan': {
      model: aiModelForStep('job.plan'),
      maxTokens: 1_000,
      system: aiDoctrineSystemBlocks(SITE_A, { instructions: aiInstructionsWithSiteContext(AI_JOB_PLAN_INSTRUCTIONS, CONTEXT) }),
      tools: REQUESTS['site-plan'].tools(SITE_A),
      messages: TURNS,
      cacheConversation: true,
    },
    'page step': {
      model: aiModelForStep('job.page'),
      maxTokens: 1_000,
      system: REQUESTS['layout-page'].blocks(SITE_A),
      tools: REQUESTS['layout-page'].tools(SITE_A),
      messages: TURNS.slice(0, 1),
    },
    'SEO listing': {
      model: aiModelForStep('job.seo'),
      maxTokens: 1_000,
      system: REQUESTS['seo-fields'].blocks(SITE_A),
      tools: REQUESTS['seo-fields'].tools(SITE_A),
      messages: TURNS.slice(0, 1),
    },
  }
  const STEP: Record<string, AiStepKind> = { 'site plan': 'job.plan', 'page step': 'job.page', 'SEO listing': 'job.seo' }
  const wire = (name: string, hour: boolean) =>
    buildAnthropicRequestBody({ ...CASES[name], ...(hour ? { cacheTtl: '1h' as const } : {}), stream: false })

  it.each(Object.keys(CASES))('the %s sends the same prompt bytes, and markers in the same places, at its route’s hour as at five minutes', (name) => {
    expect(AI_ROUTING_TABLE[STEP[name]].cacheTtl).toBe('1h')
    const hour = wire(name, true)
    const fiveMinutes = wire(name, false)
    // Five minutes everywhere is the body every request sent before AGL-3830,
    // cache_control included; the hour may change nothing else.
    expect(strip(hour)).toBe(strip(fiveMinutes))
    expect(markerPlaces(hour)).toEqual(markerPlaces(fiveMinutes))
    expect(markersOf(fiveMinutes).every((ttl) => ttl === '5m')).toBe(true)
  })

  it('gives the site plan’s shared markers the hour, its site block and conversation five minutes', () => {
    const system = CASES['site plan'].system
    const siteAt = system.findIndex((block) => block.site)
    expect(siteAt).toBeGreaterThan(0)
    const marks = markersOf(wire('site plan', true))
    const shared = system.slice(0, siteAt).filter((block) => block.cacheBreakpoint).length
    expect(shared).toBeGreaterThan(0)
    expect(marks).toEqual([...Array(shared).fill('1h'), '5m', '5m'])
  })

  it.each(['page step', 'SEO listing'])('keeps every marker of the %s at the hour: it has no marker of its own job', (name) => {
    expect(CASES[name].system.some((block) => block.site)).toBe(false)
    const marks = markersOf(wire(name, true))
    expect(marks.length).toBeGreaterThan(0)
    expect(new Set(marks)).toEqual(new Set(['1h']))
  })

  it('never sends an hour-long marker after a five-minute one on any ledger request, with or without a site block and conversation', () => {
    for (const [name, row] of Object.entries(REQUESTS)) {
      for (const context of [null, CONTEXT]) {
        // The site's block goes where a door puts it: right after the last
        // breakpoint, where the runtime's guard accepts it.
        const blocks = row.blocks(SITE_A)
        const last = blocks.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
        const site = context && aiConversationCacheFits(blocks) ? aiSiteContextSystemBlock(context) : []
        const system = [...blocks.slice(0, last + 1), ...site, ...blocks.slice(last + 1)]
        expect(() => validateAiSystemBlocks(system)).not.toThrow()
        const cacheConversation = aiConversationCacheFits(system)
        const marks = markersOf(
          buildAnthropicRequestBody({
            model: aiModelForStep(row.step),
            maxTokens: 1_000,
            system: [...system],
            tools: row.tools(SITE_A),
            messages: TURNS,
            cacheTtl: '1h',
            ...(cacheConversation ? { cacheConversation } : {}),
            stream: false,
          }),
        )
        const firstShort = marks.indexOf('5m')
        expect([name, Boolean(context), firstShort < 0 ? [] : marks.slice(firstShort).filter((ttl) => ttl === '1h')]).toEqual([
          name,
          Boolean(context),
          [],
        ])
      }
    }
  })

  it('sends a deployed plan generation’s hour on its shared markers alone, on every call', async () => {
    const saved = process.env['NODE_ENV']
    ;(process.env as Record<string, string>)['NODE_ENV'] = 'production'
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { fake, requests } = recording([
        answer([{ name: AI_INVENTORY_LOOKUP_TOOL_NAME, input: { kind: 'components', query: 'card' } }]),
        answer([]),
        answer([]),
      ])
      await runValidatedGeneration('plan', {
        step: 'job.plan',
        model: 'claude-sonnet-5-5',
        provider: fake,
        instructions: aiInstructionsWithSiteContext(AI_JOB_PLAN_INSTRUCTIONS, CONTEXT),
        inventory: SITE_A,
        messages: [TURNS[0]],
        tool: aiBuildPlanToolFor('', { language: true }),
        cacheConversation: true,
      })
      expect(requests).toHaveLength(3)
      for (const request of requests) {
        expect(request.cacheTtl).toBe('1h')
        expect(markersOf(buildAnthropicRequestBody({ ...request, stream: false }))).toEqual(['1h', '1h', '5m', '5m'])
      }
    } finally {
      warn.mockRestore()
      ;(process.env as Record<string, string | undefined>)['NODE_ENV'] = saved
    }
  })
})
