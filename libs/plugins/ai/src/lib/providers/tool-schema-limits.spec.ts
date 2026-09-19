/**
 * @jest-environment node
 */
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

// Seams a step module reaches through on its way to Firestore or the tenant
// runtime. Nothing here sends a request; they are stubbed so the modules that
// build the tools can be loaded without a server.
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
import { join, resolve } from 'node:path'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { SEO_LISTING_FIELDS, type SeoListingFieldKey } from '@aglyn/aglyn/app-utils/seo-listing-fields'
import { AI_JOB_EMAIL_TOOL } from '../jobs/ai-job-email-step'
import { AI_JOB_FORM_TOOL } from '../jobs/ai-job-form-step'
import { AI_PAGE_SECTION_TOOL } from '../jobs/ai-job-page-sections'
import { AI_BUILD_PLAN_TOOL } from '../model/ai-build-plan'
import { AI_CRM_RECORD_KINDS } from '../model/ai-crm'
import { ASSIST_EDIT_DOCUMENT_KINDS } from '../model/assist-edit'
import { aiDoctrineTreeTool } from '../runtime/ai-doctrine'
import { AI_EVAL_RUBRIC_TOOL } from '../runtime/ai-eval-live'
import { AI_OUTPUT_KINDS } from '../runtime/ai-palette'
import { assistSectionTool } from '../server/ai-assist-prompts'
import { aiComponentSelectionTool } from '../server/ai-generate-component'
import { assistEditTool } from '../server/assist-edit'
import { aiComponentTool } from '../tools/ai-component-tool'
import { AI_CRM_EMAIL_TOOL, AI_CRM_MAPPING_TOOL, aiCrmRecordTool } from '../tools/ai-crm-tool'
import { aiInsightAnswerTool, aiInsightReadTool } from '../tools/ai-insight-tool'
import { aiInventoryLookupTool } from '../tools/ai-inventory-lookup-tool'
import { AI_CATALOG_TOOL, AI_CATEGORIES_TOOL, AI_PRODUCT_COPY_TOOL } from '../tools/ai-products-tool'
import { aiSeoFieldsTool, aiSeoFixesTool, aiSeoSiteTool } from '../tools/ai-seo-tool'
import { aiThemeTool } from '../tools/ai-theme-tool'
import { aiAutomationTool, aiWorkflowExplanationTool } from '../tools/ai-workflow-tool'
import { ANTHROPIC_TOOL_SCHEMA_LIMITS, anthropicProvider } from './anthropic'
import { aiToolSchemaBreaches, aiToolSchemaCounts, type AiTool } from './contract'
import { OPENAI_COMPATIBLE_TOOL_SCHEMA_LIMITS, openAiCompatibleProvider } from './openai-compatible'
import { listAiProviders } from './registry'

/**
 * TOOL-SCHEMA LIMITS (AGL-3096).
 *
 * A provider that constrains decoding to a strict tool's schema compiles
 * every strict schema of a request together, before the model runs, and
 * refuses a request past its bounds with a 400 that no retry clears: the
 * schema is the same every time. A mocked provider accepts any schema, so
 * nothing offline sees that refusal unless the schema itself is counted — a
 * `null` union on every field an automation step did not use came to 23
 * union-typed parameters against a bound of 16.
 *
 * So this spec holds three things:
 *
 *  1. the TOOL SETS: every tool set each door sends, one request at a time,
 *     in a table checked against the source the way the cache ledger checks
 *     its doors, so a new door cannot send a set nobody counted;
 *  2. the GUARD: every one of those sets within every registered provider's
 *     declared `toolSchemaLimits` — any provider may serve any step, so a set
 *     has to fit all of them;
 *  3. the CONTROL: the automation tool with a `null` union on every field a
 *     step does not use, kept as a fixture, counts the 23 the provider
 *     reported and is red, so the guard is known to count the way the
 *     provider does and to fail when it should.
 */

const LIB_ROOT = join(__dirname, '..')

/** Every source file under `src/lib`, specs excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.includes('.spec.')) return []
    return [path]
  })
}

/** A file that asks a provider for an answer: the pattern the cache ledger's door table is held to. */
const CALLS_A_MODEL = /\b(?:runAiRequest|runValidatedGeneration)\s*(?:<[^<>()]*>)?\(/

/** The largest listing a page's SEO card asks for: every field, the heaviest schema. */
const EVERY_LISTING_FIELD = Object.keys(SEO_LISTING_FIELDS) as SeoListingFieldKey[]

/** A fixes batch: the eight pages one pass enumerates. */
const A_FIXES_BATCH = Array.from({ length: 8 }, (_, index) => `scr-${index + 1}`)

/**
 * Every tool set each door sends in one request. A door that reads a site is
 * offered the lookup tool beside its own on every request (the doctrine's
 * loop), so its set is both tools, counted together.
 */
const TOOL_SETS: Record<string, Readonly<Record<string, () => AiTool[]>>> = {
  // The loop sends the tool a door passes. The tree tools are its own, and a
  // door that reads a site gets the lookup tool beside one.
  'runtime/ai-doctrine.ts': Object.fromEntries(
    AI_OUTPUT_KINDS.map((kind) => [`${kind} tree`, () => [aiDoctrineTreeTool(kind), aiInventoryLookupTool()]]),
  ),
  // The recorders send the doors' own generations; the grader is its own.
  'runtime/ai-eval-live.ts': { grade: () => [AI_EVAL_RUBRIC_TOOL] },
  'runtime/seo-fields.ts': { listing: () => [aiSeoFieldsTool(EVERY_LISTING_FIELD)] },
  'runtime/ai-products-generation.ts': {
    'product copy': () => [AI_PRODUCT_COPY_TOOL],
    catalog: () => [AI_CATALOG_TOOL],
    categories: () => [AI_CATEGORIES_TOOL],
  },
  'jobs/ai-job-plan-step.ts': { plan: () => [AI_BUILD_PLAN_TOOL, aiInventoryLookupTool()] },
  'jobs/ai-job-layout-step.ts': { layout: () => [aiDoctrineTreeTool('layout'), aiInventoryLookupTool()] },
  'jobs/ai-job-template-step.ts': {
    template: () => [aiDoctrineTreeTool('template'), aiInventoryLookupTool()],
  },
  'jobs/ai-job-email-step.ts': { email: () => [AI_JOB_EMAIL_TOOL, aiInventoryLookupTool()] },
  'jobs/ai-job-form-step.ts': { form: () => [AI_JOB_FORM_TOOL, aiInventoryLookupTool()] },
  'jobs/ai-job-component-step.ts': { component: () => [aiComponentTool(), aiInventoryLookupTool()] },
  'jobs/ai-job-page-step.ts': { section: () => [AI_PAGE_SECTION_TOOL, aiInventoryLookupTool()] },
  'jobs/ai-job-crm-step.ts': {
    ...Object.fromEntries(AI_CRM_RECORD_KINDS.map((kind) => [`${kind} record`, () => [aiCrmRecordTool(kind)]])),
    email: () => [AI_CRM_EMAIL_TOOL],
    mapping: () => [AI_CRM_MAPPING_TOOL],
  },
  'server/ai-generate-component.ts': { selection: () => [aiComponentSelectionTool()] },
  'jobs/ai-job-theme-step.ts': { theme: () => [aiThemeTool()] },
  'jobs/ai-job-seo-step.ts': {
    site: () => [aiSeoSiteTool()],
    fixes: () => [aiSeoFixesTool(A_FIXES_BATCH)],
  },
  'jobs/ai-job-workflow-step.ts': {
    draft: () => [aiAutomationTool()],
    explain: () => [aiWorkflowExplanationTool()],
  },
  'jobs/ai-job-insight-step.ts': { read: () => [aiInsightReadTool()], answer: () => [aiInsightAnswerTool()] },
  'jobs/ai-job-text-step.ts': { text: () => [] },
  'server/ai-assist.ts': { element: () => [], blog: () => [], section: () => [assistSectionTool()] },
  'server/assist-chat.ts': {
    chat: () => [],
    ...Object.fromEntries(ASSIST_EDIT_DOCUMENT_KINDS.map((kind) => [`${kind} edit`, () => [assistEditTool(kind)]])),
  },
}

/** The automation tool with a `null` union on every field a step does not use: the shape the provider refused. */
const NULL_UNION_AUTOMATION_TOOL = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures', 'tool-submit-automation-null-unions.json'), 'utf8'),
) as AiTool

/** A strict tool around a schema, for the counting cases. */
const tool = (properties: Record<string, unknown>, required = Object.keys(properties)): AiTool => ({
  name: 'probe',
  description: 'A probe.',
  strict: true,
  inputSchema: { type: 'object', additionalProperties: false, required, properties },
})

beforeEach(() => {
  resetPluginServicesForTests()
})

describe('what each adapter declares', () => {
  it('the Messages API adapter states the bounds its structured-outputs documentation gives', () => {
    expect(anthropicProvider.toolSchemaLimits).toBe(ANTHROPIC_TOOL_SCHEMA_LIMITS)
    expect(ANTHROPIC_TOOL_SCHEMA_LIMITS).toEqual({ strictTools: 20, optionalParameters: 24, unionParameters: 16 })
  })

  it('the OpenAI-compatible adapter states only what its strict function shape requires: no optional parameter', () => {
    expect(openAiCompatibleProvider.toolSchemaLimits).toBe(OPENAI_COMPATIBLE_TOOL_SCHEMA_LIMITS)
    expect(OPENAI_COMPATIBLE_TOOL_SCHEMA_LIMITS).toEqual({ optionalParameters: 0 })
  })
})

describe('counting one request’s strict schemas', () => {
  it('counts a union wherever it is written: a list of types, an anyOf, in items and in another union’s branch', () => {
    const counted = aiToolSchemaCounts([
      tool({
        name: { type: ['string', 'null'] },
        steps: {
          type: 'array',
          items: {
            anyOf: [
              tool({ when: { anyOf: [{ type: 'string' }, { type: 'null' }] } }).inputSchema,
              tool({ note: { type: 'string' } }).inputSchema,
            ],
          },
        },
        plain: { type: 'string', enum: ['a', 'b'] },
      }),
    ])
    // `name`, the items' anyOf, and the `when` inside its first branch.
    expect(counted).toEqual({ strictTools: 1, optionalParameters: 0, unionParameters: 3 })
  })

  it('counts every property left out of its object’s required, inside branches too', () => {
    const counted = aiToolSchemaCounts([
      tool(
        {
          kept: { type: 'string' },
          left: { type: 'string' },
          nested: { anyOf: [tool({ inner: { type: 'string' } }, []).inputSchema, { type: 'null' }] },
        },
        ['kept', 'nested'],
      ),
    ])
    expect(counted).toEqual({ strictTools: 1, optionalParameters: 2, unionParameters: 1 })
  })

  it('counts a local $ref where it is used, once for every use, and a definition nothing uses not at all', () => {
    const referring = tool({ a: { $ref: '#/$defs/maybe' }, b: { type: 'array', items: { $ref: '#/$defs/maybe' } } })
    referring.inputSchema['$defs'] = { maybe: { type: ['string', 'null'] }, unused: { type: ['string', 'null'] } }
    expect(aiToolSchemaCounts([referring]).unionParameters).toBe(2)
    // A schema that refers to itself is counted once around, not forever.
    const recursive = tool({ node: { $ref: '#/$defs/node' } })
    recursive.inputSchema['$defs'] = {
      node: { type: 'object', properties: { next: { anyOf: [{ $ref: '#/$defs/node' }, { type: 'null' }] } } },
    }
    expect(aiToolSchemaCounts([recursive])).toEqual({ strictTools: 1, optionalParameters: 1, unionParameters: 1 })
  })

  it('totals every tool of the request, because each bound is per request and not per tool', () => {
    const nine = tool(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, { type: ['string', 'null'] }])))
    expect(aiToolSchemaBreaches([nine], ANTHROPIC_TOOL_SCHEMA_LIMITS)).toEqual([])
    expect(aiToolSchemaCounts([nine, nine])).toEqual({ strictTools: 2, optionalParameters: 0, unionParameters: 18 })
    expect(aiToolSchemaBreaches([nine, nine], ANTHROPIC_TOOL_SCHEMA_LIMITS)).toEqual([
      '18 union-typed parameters in one request, over the 16 the provider compiles',
    ])
    const many = Array.from({ length: 21 }, () => tool({ f: { type: 'string' } }))
    expect(aiToolSchemaBreaches(many, ANTHROPIC_TOOL_SCHEMA_LIMITS)).toEqual([
      '21 strict tools in one request, over the 20 the provider compiles',
    ])
  })

  it('holds a request to no bound a provider does not state', () => {
    const optional = tool({ f: { type: 'string' } }, [])
    expect(aiToolSchemaBreaches([optional], undefined)).toEqual([])
    expect(aiToolSchemaBreaches([optional], { unionParameters: 0 })).toEqual([])
    expect(aiToolSchemaBreaches([optional], OPENAI_COMPATIBLE_TOOL_SCHEMA_LIMITS)).toEqual([
      '1 optional parameter in one request, over the 0 the provider compiles',
    ])
  })
})

describe('the control: the automation tool with a null union on every unused field', () => {
  it('counts the 23 union-typed parameters the provider refused, and is red', () => {
    expect(NULL_UNION_AUTOMATION_TOOL.name).toBe('submit_automation')
    expect(aiToolSchemaCounts([NULL_UNION_AUTOMATION_TOOL])).toEqual({
      strictTools: 1,
      optionalParameters: 0,
      unionParameters: 23,
    })
    expect(aiToolSchemaBreaches([NULL_UNION_AUTOMATION_TOOL], anthropicProvider.toolSchemaLimits)).toEqual([
      '23 union-typed parameters in one request, over the 16 the provider compiles',
    ])
  })

  it('while a variant per step type fits, by a wide margin, without an optional parameter', () => {
    expect(aiToolSchemaCounts([aiAutomationTool()])).toEqual({
      strictTools: 1,
      optionalParameters: 0,
      unionParameters: 2,
    })
  })
})

describe('every tool set a door sends', () => {
  it('names every file that asks a provider for an answer', () => {
    const found = sourceFiles(LIB_ROOT)
      .filter((path) => CALLS_A_MODEL.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(LIB_ROOT.length + 1))
      // The runtime is the callee, not a door: it is where `runAiRequest` is declared.
      .filter((path) => path !== 'runtime/ai-runtime.ts')
      .sort()
    expect(found).toEqual(Object.keys(TOOL_SETS).sort())
  })

  it('fits within the declared limits of every registered provider, which may serve any step', () => {
    const providers = listAiProviders()
    // Both first-party adapters, and at least one bound to hold a set to.
    expect(providers.map((provider) => provider.id).sort()).toEqual(['anthropic', 'openai-compatible'])
    const breaches = Object.entries(TOOL_SETS).flatMap(([door, sets]) =>
      Object.entries(sets).flatMap(([set, tools]) =>
        providers.flatMap((provider) =>
          aiToolSchemaBreaches(tools(), provider.toolSchemaLimits).map((breach) => ({
            door,
            set,
            provider: provider.id,
            breach,
          })),
        ),
      ),
    )
    expect(breaches).toEqual([])
  })
})
