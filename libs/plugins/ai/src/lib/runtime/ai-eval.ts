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

import type { HostTheme } from '@aglyn/shared-data-types'
import { validateHostAction, type HostAction } from '@aglyn/aglyn/app-utils/actions'
import type { HostThemeSource } from '@aglyn/aglyn/app-utils/marketplace-theme'
import {
  aiAutomationDraft,
  emptyAiAutomationRecords,
  type AiAutomationRecords,
} from '../model/ai-automation-draft'
import type { ConsoleImportColumn } from '@aglyn/aglyn/plugin-manager/record-zone-props'
import { AI_BUILD_PLAN_CREATE_KINDS, type AiBuildPlanCreateKind } from '../model/ai-build-plan'
import {
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
  type AiPlanCreation,
} from '../model/ai-plan-capabilities'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import type { AiAutomationCapabilities } from '../model/ai-workflow-job'
import type { AiStepKind } from '../providers/catalog'
import type { AiEffort, AiUsage } from '../providers/contract'
import { aiComponentCheck } from '../jobs/ai-job-component-checks'
import {
  aiProductMerchantWords,
  type AiProductCategory,
  type AiProductFacts,
  type AiProductPhotoRead,
} from '../model/ai-products'
import type { AiRunRecord } from '../model/ai-automation-outline'
import { checkAiCatalog, checkAiCategories, checkAiProductCopy } from '../tools/ai-products-tool'
import type { AiCrmRecordKind, AiCrmTask } from '../model/ai-crm'
import {
  aiCrmEmailMergeFields,
  aiCrmImportFields,
  aiCrmRecordCheckContext,
  checkAiCrmEmail,
  checkAiCrmMapping,
  checkAiCrmRecord,
} from '../tools/ai-crm-tool'
import { parseAiThemeToolInput } from '../tools/ai-theme-tool'
import {
  AI_AUTOMATION_OVERSIZE_CODES,
  AI_AUTOMATION_UNREADABLE_CODES,
  readAiAutomationAnswer,
  readAiWorkflowExplanation,
} from '../tools/ai-workflow-tool'
import type { AiInsightTable } from '../model/ai-insight'
import { parseAiInsightAnswer } from '../tools/ai-insight-tool'
import { checkAiInsightAnswer } from './ai-insight-check'
import { aiDeviceAuditFindings, type AiDeviceAudit } from './ai-device-audit'
import {
  aiAnswerTree,
  aiDoctrinePlanCheck,
  aiDoctrineTreeCheck,
  aiDoctrineTreeContext,
  type AiGenerationCheckResult,
  type AiValidatedTree,
} from './ai-doctrine'
import {
  AI_SEO_DESCRIPTION_MAX,
  AI_SEO_TITLE_MAX,
  detectOffVoiceCopy,
  detectPublishIntent,
  type AiAssetFacts,
  type AiCopyFraming,
  type AiDoctrineViolation,
} from './ai-doctrine-validators'
import { AI_TEXT_LIMITS, type AiOutputKind } from './ai-palette'
import { expandAiRepeatedItems } from './ai-repeated-items'

/**
 * THE EVAL HARNESS (AGL-2937): the measure that gates every token lever.
 *
 * A token saved on a page the customer then has to fix costs more than the
 * token. So no lever ships on its token figure alone: each golden brief is
 * held to the same checks the doctrine holds a live answer to, and a kind's
 * pass rate and mean score must stay at or above its floor.
 *
 * A case is a golden brief for one output kind — the site it is built for,
 * the plan shape a good answer has, reference answers, and controls that
 * must fail. Every answer is scored on four checks:
 *
 *  - **readable** — it reads as its kind: `validateAiNodeTree` admits the
 *    tree, the plan parses, the fields and the copy are there;
 *  - **rules** — no doctrine rule is broken (`ai-doctrine-validators.ts`),
 *    nor any rule of the kind's own (a link to a page the answer was not
 *    given, a title line on a blog body);
 *  - **budget** — within the kind's measured budget: rule 17 for a document,
 *    the length ceiling for copy;
 *  - **rubric** — a grade against the brief for structure, copy fit and
 *    reuse decisions, recorded from a stronger model on a live run.
 *
 * A document of a kind a site renders is also held to **responsive** (AGL-3020):
 * rendered at every device of the besigner's switcher, nothing runs past the
 * screen and no band keeps its desktop columns on a phone. It is measured in a
 * browser by `tools/scripts/record-ai-page-axe.mts` and read back from that
 * recording, so it gates a pass without moving a score: a page that only works
 * on desktop does not pass, whatever its checks and grade average to.
 *
 * A planned kind's answer also carries the plan, held to the plan rules and
 * to the case's expected shape.
 *
 * Offline is the default and the only mode CI runs: answers and grades are
 * read from the fixtures under `tools/ai-eval/cases`, so a run costs nothing
 * and asserts the same verdicts every time. An answer marked `authored` was
 * written by hand as a reference and is graded by hand; one marked
 * `recorded` came from a live run. A live run spends real money and is
 * refused unless `AI_EVAL_LIVE=1` names it.
 */

/** The output kinds the harness holds golden briefs for. */
export type AiEvalKind =
  | 'page'
  | 'template'
  | 'component'
  | 'layout'
  | 'form'
  | 'email'
  | 'section'
  | 'seo'
  | 'product'
  | 'catalog'
  | 'categories'
  | 'theme'
  | 'element'
  | 'blog'
  | 'text'
  | 'chat'
  | 'workflow'
  | 'insight'
  | 'crm'

export const AI_EVAL_KINDS: readonly AiEvalKind[] = [
  'page',
  'template',
  'component',
  'layout',
  'form',
  'email',
  'section',
  'seo',
  'product',
  'catalog',
  'categories',
  'theme',
  'element',
  'blog',
  'text',
  'chat',
  'workflow',
  'insight',
  'crm',
]

/** The document kind a tree kind is held to; a section rewrite is one reusable block. */
export const AI_EVAL_TREE_OUTPUT: Partial<Record<AiEvalKind, AiOutputKind>> = {
  page: 'page',
  template: 'template',
  component: 'component',
  layout: 'layout',
  form: 'form',
  email: 'email',
  section: 'component',
}

/**
 * Whether a kind's answer is a document a site renders, and so is held to
 * every device width (AGL-3020). An email is not: its column is fixed at 600px
 * by the medium, which rule 12 exempts it for.
 */
export function aiEvalRendersAtDeviceWidths(kind: AiEvalKind): boolean {
  const output = AI_EVAL_TREE_OUTPUT[kind]
  return output !== undefined && output !== 'email'
}

/**
 * The recorded device audit of an answer, or `null` when none was recorded
 * from it. The spec that scores the cases reads the recordings and answers
 * this; a scorer given none holds nothing to its widths.
 */
export type AiEvalAudits = (evalCase: AiEvalCase, answer: unknown) => AiDeviceAudit | null

/** The checks an answer is scored on, beside its rubric. */
export type AiEvalCheck = 'readable' | 'rules' | 'budget' | 'plan' | 'responsive' | 'rubric'

/** A grade against the brief, each criterion from 1 (fails) to 5 (excellent). */
export interface AiEvalRubric {
  /** Organized the way the brief needs, nothing missing, nothing extra. */
  structure: number
  /** The words fit the brief, the site and its audience, with no filler. */
  copy: number
  /** Reuses what the site lists before creating; `null` for a kind that places nothing. */
  reuse: number | null
  /** The model that graded it, or `authored` for a grade given by hand. */
  grader: string
  notes?: string
}

/** A plan's expected shape: what a good plan for the brief has. */
export interface AiEvalPlanShape {
  /** Screens planned, as `[min, max]`. */
  screens: [number, number]
  /** Inventory ids the plan must reuse. */
  reuse?: string[]
  /** The layout every planned screen renders inside. */
  layout?: string
  /** The most creations a good plan needs. */
  maxCreate?: number
  /** The kinds a creation may be. */
  createKinds?: AiBuildPlanCreateKind[]
}

export interface AiEvalCandidate {
  /** `authored` for a reference written by hand; `recorded` for one a live run captured. */
  source: 'authored' | 'recorded'
  /**
   * `full` for an answer to the whole brief, the default; `plan` for the plan
   * alone, which a live run records for a planned kind whose generator has
   * not landed. A plan answer is held to the plan checks and its rubric, and
   * counts toward the plan step's score rather than the kind's floor.
   */
  scope?: 'full' | 'plan'
  /** The routing step and model a recorded answer came from; `null` for an authored one. */
  step: AiStepKind | null
  model: string | null
  effort: AiEffort | null
  /** The plan the plan step answered with, for a planned kind. */
  plan: unknown
  /**
   * The output as the kind's door answers: a tree tool's input (or the node
   * map itself), the copy as text, `{ title, description }` for search
   * fields, or the theme tool's input.
   */
  answer: unknown
  /** What a recorded answer spent; `null` for an authored one. */
  usage: AiUsage | null
  /**
   * A recorded answer's spend, one entry per metered exchange in the order
   * the job ran them — the plan, then every pass of its generation — with
   * the credits each came to as the machine meters a step (AGL-3030).
   * Absent on an authored answer, and on a recording that keeps its tokens
   * alone.
   */
  steps?: AiEvalRecordedStep[]
  /**
   * What a recorded product copy answer was written with of its product's
   * photo, as the products step reports it (AGL-3074): `read` when the
   * picture rode the request.
   */
  photo?: AiProductPhotoRead
  /**
   * What a recorded page was built as beside its tree (AGL-3073): its
   * screen's address and listing, and the layout it renders inside. Absent
   * on an authored answer, and on a recording made before it was kept.
   */
  screen?: AiEvalRecordedScreen
  rubric: AiEvalRubric
  note?: string
}

/** One metered exchange of a recorded job. */
export interface AiEvalRecordedStep {
  step: AiStepKind
  model: string
  usage: AiUsage
  estCostUsd: number
  /** What the machine meters it as: the billed cost in credits, rounded up per exchange. */
  credits: number
}

/**
 * A recorded page's screen, as the page step stored its draft. None of it is
 * a node of the page's tree: the address and the listing are fields of the
 * screen, the navigation entry is a proposal beside it, and the header, the
 * footer and the main landmark belong to the layout it renders inside.
 */
export interface AiEvalRecordedScreen {
  /** The draft's one-segment address, as the draft writer stored it. */
  slug: string
  /** The search title and description the draft holds; `null` where it holds none. */
  seoTitle: string | null
  seoDescription: string | null
  /** Whether a navigation entry for the page travels with it as a proposal. */
  nav: boolean
  /** The layout the draft renders inside; `null` for a page that renders inside none. */
  layout: AiEvalRecordedLayout | null
}

/** The layout a recorded page renders inside. */
export interface AiEvalRecordedLayout {
  id: string
  name: string
  /** `true` for a layout the job built before the page; `false` for one the site already had. */
  built: boolean
  /** Its tree as stored; `null` for a layout the case's site lists by name alone. */
  tree: { rootId: string; nodes: Record<string, unknown> } | null
}

/** An answer that must fail, and the checks it must fail. */
export interface AiEvalControl {
  why: string
  answer: unknown
  plan?: unknown
  fails: AiEvalCheck[]
}

export interface AiEvalCase {
  id: string
  kind: AiEvalKind
  brief: string
  framing: AiCopyFraming
  /** The site the answer is built for; `null` for a brief that builds from none. */
  inventory: AiSiteInventory | null
  /**
   * The site's name as its visitors read it, where the case gives one
   * (AGL-3077): a recorded page's listing names the site by it. A case that
   * gives none is recorded on an untitled site.
   */
  siteName?: string
  /** Media library facts the image budget reads, by media id. */
  assets?: Record<string, AiAssetFacts>
  /** The documentation URLs a chat answer was grounded in; it may link only these. */
  docsUrls?: string[]
  /** Copy ceilings the brief sets, beside the kind's own. */
  maxChars?: number
  maxWords?: number
  /**
   * For an insight brief (AGL-2915): the tables the readers returned, which
   * every insight an answer writes is traced against.
   */
  tables?: AiInsightTable[]
  /**
   * For a product copy brief (AGL-2916): the product as its editor handed it
   * over, and the site's categories the request lists.
   */
  product?: { facts: AiProductFacts; categories: AiProductCategory[] }
  /** For a categories brief: the names of the categories the store already has. */
  existingCategoryNames?: string[]
  /** For a theme brief: the site's current theme and where it comes from. */
  siteTheme?: HostTheme
  themeSource?: HostThemeSource
  /**
   * For an automation brief (AGL-2919): what the workspace can run, and the
   * site's records the answer's words are looked up among. Absent, the
   * workspace runs everything and the site holds nothing.
   */
  automationCapabilities?: AiAutomationCapabilities
  automationRecords?: AiAutomationRecords
  /**
   * For an automation brief about a saved automation (AGL-3074): the action
   * as the site stores it, and for a run's diagnosis, what the run history
   * recorded of the failed run. Absent, the brief asks for a draft.
   */
  automation?: AiEvalAutomation
  /**
   * The media library assets of the case's site a recording reads
   * (AGL-3074), by media id: each the path of the file under
   * `tools/ai-eval/fixtures` that holds its bytes. A product's photo is
   * `media:<site id>/<media id>`, where the site is the inventory's, or
   * `AI_EVAL_SITE_ID` for a case that describes none.
   */
  media?: Record<string, string>
  /**
   * For a CRM brief (AGL-2917): what the job was asked, about which kind of
   * record, the facts the CRM reported for it, and a mapping's columns.
   */
  crm?: AiEvalCrmContext
  /**
   * What the workspace may create on the case's site (AGL-3030): a brief
   * for a workspace that keeps no reusable components is held to the inline
   * doctrine, and its plan to what the workspace may create. Absent, the
   * doctrine applies whole.
   */
  capabilities?: AiPlanCapabilities
  expected?: { plan?: AiEvalPlanShape }
  candidates: AiEvalCandidate[]
  controls: AiEvalControl[]
}

/** The site a case's job runs on when the case describes no inventory. */
export const AI_EVAL_SITE_ID = 'eval-site'

/** What an automation brief's workspace can run when the case does not say: everything. */
export const AI_EVAL_AUTOMATION_CAPABILITIES: AiAutomationCapabilities = { crm: true, webhooks: true, bookings: true }

/** A saved automation an automation brief asks about, as the workflow step reads one. */
export interface AiEvalAutomation {
  /** The action as `hosts/{hostId}/actions/{id}` holds it. */
  action: HostAction
  /** A failed run of it; given, the brief asks why that run failed. */
  run?: AiRunRecord
}

/** A fixture file a case's media names: a relative path to a picture, never out of its folder. */
const AI_EVAL_MEDIA_FILE = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:jpe?g|png|webp|gif|avif)$/

/** What a CRM brief's answer is checked against, as the `crm` step checks it. */
export interface AiEvalCrmContext {
  task: AiCrmTask
  /** The record a `record` or `email` brief is about. */
  record?: AiCrmRecordKind
  /** The facts the CRM's reader reported: a record's, or an import's field catalog. */
  facts?: Record<string, unknown>
  /** A mapping brief's columns: each header and its shape. */
  columns?: ConsoleImportColumn[]
}

/** A kind's floor: the pass rate and the mean score its candidates may not fall below. */
export interface AiEvalFloor {
  passRate: number
  meanScore: number
}

/**
 * The floors, per kind. Every reference answer must pass, because each was
 * written to; the mean floor leaves room for a rubric grade of four on an
 * answer that passes every mechanical check. Recorded answers are held to
 * the same floors, and a lever that lowers a kind below its floor does not
 * ship.
 */
export const AI_EVAL_FLOORS: Readonly<Record<AiEvalKind, AiEvalFloor>> = {
  page: { passRate: 1, meanScore: 0.9 },
  template: { passRate: 1, meanScore: 0.9 },
  component: { passRate: 1, meanScore: 0.9 },
  layout: { passRate: 1, meanScore: 0.9 },
  form: { passRate: 1, meanScore: 0.9 },
  email: { passRate: 1, meanScore: 0.9 },
  section: { passRate: 1, meanScore: 0.9 },
  seo: { passRate: 1, meanScore: 0.9 },
  product: { passRate: 1, meanScore: 0.9 },
  catalog: { passRate: 1, meanScore: 0.9 },
  categories: { passRate: 1, meanScore: 0.9 },
  theme: { passRate: 1, meanScore: 0.9 },
  element: { passRate: 1, meanScore: 0.9 },
  blog: { passRate: 1, meanScore: 0.9 },
  text: { passRate: 1, meanScore: 0.9 },
  chat: { passRate: 1, meanScore: 0.9 },
  workflow: { passRate: 1, meanScore: 0.9 },
  insight: { passRate: 1, meanScore: 0.9 },
  crm: { passRate: 1, meanScore: 0.9 },
}

/** A rubric passes at this mean, with no criterion below three. */
export const AI_EVAL_RUBRIC_PASS_MEAN = 3.5

/** How long a blog body may run: the blog mode's output ceiling, at four characters a token. */
export const AI_EVAL_BLOG_MAX_CHARS = 8_000

/** How long a job's copy may run when the brief implies no length: the text step's own rule. */
export const AI_EVAL_TEXT_MAX_WORDS = 150

/** How long a chat answer may run: the chat door's output ceiling, at four characters a token. */
export const AI_EVAL_CHAT_MAX_CHARS = 4_000

export interface AiEvalScore {
  caseId: string
  kind: AiEvalKind
  source: AiEvalCandidate['source']
  scope: NonNullable<AiEvalCandidate['scope']>
  model: string | null
  /** A check that does not apply to the answer — the plan of an unplanned kind, the document of a plan answer — is `null`. */
  checks: Record<'rubric', boolean> & Record<Exclude<AiEvalCheck, 'rubric'>, boolean | null>
  /** The rubric's mean, from 0 (every criterion 1) to 1 (every criterion 5). */
  rubricScore: number
  /** The checks and the rubric, averaged: from 0 to 1. */
  score: number
  pass: boolean
  /** Why a check failed: violation codes and the kind's own findings. */
  findings: string[]
}

interface Checked {
  readable: boolean
  rules: boolean
  budget: boolean
  findings: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const codes = (violations: readonly AiDoctrineViolation[]) =>
  violations.map((violation) => violation.code)

// ── The kinds ─────────────────────────────────────────────────────────────

interface ReadTree {
  /** The answer as the check reads it: a page's repeated items drawn. */
  input: Record<string, unknown>
  declaresProps: boolean
  /** Why a page's repeated item could not be drawn; the tree is not read then. */
  undrawn: AiDoctrineViolation[] | null
  result: AiGenerationCheckResult<AiValidatedTree> | null
}

function readTree(evalCase: AiEvalCase, outputKind: AiOutputKind, answer: unknown): ReadTree {
  const inline = evalCase.capabilities?.reusableComponents === false
  let input = isRecord(answer) ? answer : { tree: answer }
  // A component answer that declares its properties binds them in its tree,
  // and is held to the component step's own checks as that step holds it
  // (AGL-3054).
  const declaresProps = evalCase.kind === 'component' && Array.isArray(input['props'])
  const check = aiDoctrineTreeCheck(
    outputKind,
    aiDoctrineTreeContext(evalCase.inventory, {
      ...(evalCase.assets ? { assets: evalCase.assets } : {}),
      framing: evalCase.framing,
      ...(inline ? { reusableComponents: false } : {}),
      ...(declaresProps ? { definesComponent: true } : {}),
    }),
  )
  // A page's repeated item written once is drawn into its copies first, as the
  // page step draws it, and refused as the page step refuses it (AGL-3053).
  if (evalCase.kind === 'page') {
    const drawn = expandAiRepeatedItems(aiAnswerTree(input), { inline, noun: 'page' })
    if (drawn.ok === false) return { input, declaresProps, undrawn: drawn.violations, result: null }
    if (drawn.items) input = { tree: drawn.tree }
  }
  return { input, declaresProps, undrawn: null, result: check(input) }
}

/**
 * The tree an answer of a tree kind is checked as — a page's repeated items
 * drawn into their copies — or `null` when it cannot be read as one. The
 * device audit renders exactly this tree (AGL-3020).
 */
export function aiEvalAnswerTree(evalCase: AiEvalCase, answer: unknown): AiValidatedTree | null {
  const outputKind = AI_EVAL_TREE_OUTPUT[evalCase.kind]
  return outputKind ? (readTree(evalCase, outputKind, answer).result?.value ?? null) : null
}

function checkTree(evalCase: AiEvalCase, outputKind: AiOutputKind, answer: unknown): Checked {
  const { input, declaresProps, undrawn, result } = readTree(evalCase, outputKind, answer)
  if (undrawn || !result) {
    return { readable: false, rules: false, budget: false, findings: codes(undrawn ?? []) }
  }
  const violations = [
    ...result.violations,
    ...(declaresProps && result.value
      ? aiComponentCheck({ inventory: evalCase.inventory, plan: null, onProps: () => undefined })(result.value, input)
      : []),
  ]
  const budget = violations.filter((violation) => violation.rule === 17)
  const rules = violations.filter((violation) => violation.rule !== 17)
  return {
    readable: result.value !== null,
    rules: result.value !== null && rules.length === 0,
    budget: result.value !== null && budget.length === 0,
    findings: codes(violations),
  }
}

const FENCE = /```/
const PREAMBLE = /^\s*(?:sure|certainly|of course|here(?:'s| is| are))\b/i
const QUOTED = /^\s*["“'].*["”']\s*$/s
const MARKUP = /<\/?[a-z][^>]*>/i

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Copy answered as text: there, unwrapped, in the site's voice, within its ceiling. */
function checkCopy(
  evalCase: AiEvalCase,
  answer: unknown,
  limits: { maxChars?: number; maxWords?: number },
  own: (text: string) => string[] = () => [],
): Checked {
  if (typeof answer !== 'string' || !answer.trim()) {
    return { readable: false, rules: false, budget: false, findings: ['copy-missing'] }
  }
  const text = answer.trim()
  const unreadable = [
    ...(FENCE.test(text) ? ['copy-fenced'] : []),
    ...(PREAMBLE.test(text) ? ['copy-preamble'] : []),
    ...(QUOTED.test(text) ? ['copy-quoted'] : []),
  ]
  const broken = [
    ...codes(detectOffVoiceCopy([{ at: 'answer', text }], evalCase.framing)),
    ...(MARKUP.test(text) ? ['copy-markup'] : []),
    ...own(text),
  ]
  const maxChars = evalCase.maxChars ?? limits.maxChars
  const maxWords = evalCase.maxWords ?? limits.maxWords
  const over = [
    ...(maxChars !== undefined && text.length > maxChars ? ['copy-over-chars'] : []),
    ...(maxWords !== undefined && words(text) > maxWords ? ['copy-over-words'] : []),
  ]
  return {
    readable: unreadable.length === 0,
    rules: broken.length === 0,
    budget: over.length === 0,
    findings: [...unreadable, ...broken, ...over],
  }
}

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g

/** A chat answer links only the documentation it was given and console paths. */
function chatLinks(evalCase: AiEvalCase): (text: string) => string[] {
  const allowed = new Set(evalCase.docsUrls ?? [])
  return (text) =>
    [...text.matchAll(MARKDOWN_LINK)]
      .map((match) => match[1])
      .filter((url) => !url.startsWith('/') && !allowed.has(url))
      .map((url) => `chat-link-not-given:${url}`)
}

function checkBlog(evalCase: AiEvalCase, answer: unknown): Checked {
  const checked = checkCopy(evalCase, answer, { maxChars: AI_EVAL_BLOG_MAX_CHARS })
  if (typeof answer !== 'string') return checked
  const head = answer.trimStart()
  const extra = [
    ...(head.startsWith('---') ? ['blog-front-matter'] : []),
    ...(/^#\s/.test(head) ? ['blog-title-line'] : []),
  ]
  return extra.length
    ? { ...checked, readable: false, findings: [...checked.findings, ...extra] }
    : checked
}

function checkSeo(evalCase: AiEvalCase, answer: unknown): Checked {
  const title = isRecord(answer) && typeof answer['title'] === 'string' ? answer['title'].trim() : ''
  const description =
    isRecord(answer) && typeof answer['description'] === 'string' ? answer['description'].trim() : ''
  if (!title || !description) {
    return { readable: false, rules: false, budget: false, findings: ['seo-field-missing'] }
  }
  const broken = [
    ...codes(detectPublishIntent(answer)),
    ...codes(
      detectOffVoiceCopy(
        [
          { at: 'title', text: title },
          { at: 'description', text: description },
        ],
        evalCase.framing,
      ),
    ),
    ...(MARKUP.test(title) || MARKUP.test(description) ? ['seo-markup'] : []),
  ]
  const over = [
    ...(title.length > AI_SEO_TITLE_MAX ? ['seo-title-over'] : []),
    ...(description.length > AI_SEO_DESCRIPTION_MAX ? ['seo-description-over'] : []),
  ]
  return {
    readable: true,
    rules: broken.length === 0,
    budget: over.length === 0,
    findings: [...broken, ...over],
  }
}

/** What a products check refuses an answer for, by the check it fails. */
const PRODUCTS_UNREADABLE = new Set(['type', 'missing', 'option-count'])
const PRODUCTS_OVER_BUDGET = new Set(['too-long', 'too-many', 'product-count'])

/**
 * A products answer (AGL-2916), held by the check its generation is held by:
 * a product's copy, a catalog, or categories with discounts. A finding about
 * the answer's shape makes it unreadable, one about a length or a count is
 * over its budget, and every other one — a claim, a price, markup, a category
 * the request did not list — breaks a rule.
 */
function checkProducts(evalCase: AiEvalCase, answer: unknown): Checked {
  if (!isRecord(answer)) {
    return { readable: false, rules: false, budget: false, findings: ['products-not-a-call'] }
  }
  const result =
    evalCase.kind === 'product'
      ? checkAiProductCopy(answer, {
          categoryIds: (evalCase.product?.categories ?? []).map((category) => category.id),
          optionCount: evalCase.product?.facts.options.length ?? 0,
          merchantWords: evalCase.product ? aiProductMerchantWords(evalCase.product.facts) : evalCase.brief,
        })
      : evalCase.kind === 'catalog'
        ? checkAiCatalog(answer, { merchantWords: evalCase.brief })
        : checkAiCategories(answer, {
            existingCategoryNames: evalCase.existingCategoryNames ?? [],
            merchantWords: evalCase.brief,
          })
  const found = [...codes(result.violations), ...codes(detectPublishIntent(answer))]
  return {
    readable: !found.some((code) => PRODUCTS_UNREADABLE.has(code)),
    rules: !found.some((code) => !PRODUCTS_UNREADABLE.has(code) && !PRODUCTS_OVER_BUDGET.has(code)),
    budget: !found.some((code) => PRODUCTS_OVER_BUDGET.has(code)),
    findings: found,
  }
}

function checkTheme(evalCase: AiEvalCase, answer: unknown): Checked {
  if (!isRecord(answer)) {
    return { readable: false, rules: false, budget: false, findings: ['theme-not-a-call'] }
  }
  const parse = parseAiThemeToolInput(answer)
  const changes = parse.changes.length + parse.components.length + (parse.resetComponents ? 1 : 0)
  const broken = [
    ...codes(detectPublishIntent(answer)),
    ...codes(detectOffVoiceCopy([{ at: 'summary', text: parse.summary }], evalCase.framing)),
  ]
  return {
    readable: changes > 0 && parse.dropped.length === 0,
    rules: broken.length === 0,
    budget: true,
    findings: [...parse.dropped.map((reason) => `theme-dropped:${reason}`), ...broken],
  }
}

/**
 * An automation (AGL-2919), or an explanation of one: read through the tool's
 * own reader, and an automation also made into the document the workflows
 * plugin stores and held to the Actions editor's validator.
 */
function checkWorkflow(evalCase: AiEvalCase, answer: unknown): Checked {
  if (!isRecord(answer)) {
    return { readable: false, rules: false, budget: false, findings: ['workflow-not-a-call'] }
  }
  const publish = codes(detectPublishIntent(answer))
  if ('summary' in answer) {
    const read = readAiWorkflowExplanation(answer)
    const lines = [
      String(answer['summary'] ?? ''),
      ...(Array.isArray(answer['points']) ? answer['points'] : []),
      ...(Array.isArray(answer['suggestions']) ? answer['suggestions'] : []),
    ].map(String)
    const offVoice = codes(
      detectOffVoiceCopy(lines.map((text, index) => ({ at: `line[${index}]`, text })), evalCase.framing),
    )
    const found = codes(read.violations)
    return {
      readable: !found.includes('explanation-shape'),
      rules: read.value !== null && publish.length === 0 && offVoice.length === 0,
      budget: true,
      findings: [...found, ...publish, ...offVoice],
    }
  }
  const capabilities = evalCase.automationCapabilities ?? AI_EVAL_AUTOMATION_CAPABILITIES
  const read = readAiAutomationAnswer(answer, capabilities)
  const found = codes(read.violations)
  const unreadable = found.filter((code) => AI_AUTOMATION_UNREADABLE_CODES.includes(code))
  const oversize = found.filter((code) => AI_AUTOMATION_OVERSIZE_CODES.includes(code))
  const broken = found.filter((code) => !unreadable.includes(code) && !oversize.includes(code))
  const invalid =
    read.value && !read.value.unsupported
      ? validateHostAction(aiAutomationDraft(read.value, evalCase.automationRecords ?? emptyAiAutomationRecords()).action)
      : null
  return {
    readable: unreadable.length === 0,
    rules: broken.length === 0 && publish.length === 0 && invalid === null,
    budget: oversize.length === 0,
    findings: [...found, ...publish, ...(invalid ? [`workflow-invalid:${invalid}`] : [])],
  }
}

/**
 * An insight answer held to the trace (AGL-2915): readable when it is a
 * `submit_insights` call that keeps an insight, within the rules when no
 * insight is left out for its numbers, its citations or its words, and within
 * the budget when no insight runs long and there are no more than five.
 */
function checkInsight(evalCase: AiEvalCase, answer: unknown): Checked {
  const parsed = parseAiInsightAnswer(answer)
  if (!parsed || !parsed.insights.length) {
    return { readable: false, rules: false, budget: false, findings: ['insight-no-answer'] }
  }
  const check = checkAiInsightAnswer(parsed, evalCase.tables ?? [])
  const findings = check.findings.map((finding) => finding.split(':')[0])
  const over = findings.filter((code) => code === 'insight-too-long' || code === 'insight-too-many')
  return {
    readable: check.kept.length > 0,
    rules: findings.length === over.length,
    budget: over.length === 0,
    findings: check.findings,
  }
}

/** The CRM findings that mean the answer could not be read as one, and the ones over a length. */
const CRM_UNREADABLE = new Set(['type', 'missing'])
const CRM_OVER = new Set(['too-long'])

/**
 * A CRM answer, held by the checks the `crm` step holds it to (AGL-2917),
 * with rule 13 and the site's voice on everything a person reads.
 */
function checkCrm(evalCase: AiEvalCase, answer: unknown): Checked {
  const context = evalCase.crm
  if (!context || !isRecord(answer)) {
    return { readable: false, rules: false, budget: false, findings: ['crm-not-a-call'] }
  }
  const facts = context.facts ?? {}
  const kind = context.record ?? 'contact'
  const result =
    context.task === 'mapping'
      ? checkAiCrmMapping(answer, { columns: context.columns ?? [], fields: aiCrmImportFields(facts) })
      : context.task === 'email'
        ? checkAiCrmEmail(answer, { mergeFields: aiCrmEmailMergeFields(kind) })
        : checkAiCrmRecord(answer, aiCrmRecordCheckContext(kind, facts))
  const own = codes(result.violations)
  const read = (path: string[]): string => {
    let value: unknown = answer
    for (const key of path) value = isRecord(value) ? value[key] : undefined
    return typeof value === 'string' ? value : ''
  }
  const samples = [
    ['summary'],
    ['standing'],
    ['nextStep', 'title'],
    ['nextStep', 'reason'],
    ['stage', 'reason'],
    ['subject'],
    ['body'],
  ]
    .map((path) => ({ at: path.join('.'), text: read(path) }))
    .filter((sample) => sample.text)
  const broken = [
    ...codes(detectPublishIntent(answer)),
    ...codes(detectOffVoiceCopy(samples, evalCase.framing)),
    ...own.filter((code) => !CRM_UNREADABLE.has(code) && !CRM_OVER.has(code)),
  ]
  return {
    readable: !own.some((code) => CRM_UNREADABLE.has(code)),
    rules: broken.length === 0,
    budget: !own.some((code) => CRM_OVER.has(code)),
    findings: [...new Set([...own, ...broken])],
  }
}

function checkAnswer(evalCase: AiEvalCase, answer: unknown): Checked {
  const outputKind = AI_EVAL_TREE_OUTPUT[evalCase.kind]
  if (outputKind) return checkTree(evalCase, outputKind, answer)
  switch (evalCase.kind) {
    case 'seo':
      return checkSeo(evalCase, answer)
    case 'product':
    case 'catalog':
    case 'categories':
      return checkProducts(evalCase, answer)
    case 'theme':
      return checkTheme(evalCase, answer)
    case 'element':
      return checkCopy(evalCase, answer, { maxChars: AI_TEXT_LIMITS.body })
    case 'blog':
      return checkBlog(evalCase, answer)
    case 'text':
      return checkCopy(evalCase, answer, { maxWords: AI_EVAL_TEXT_MAX_WORDS })
    case 'chat':
      return checkCopy(evalCase, answer, { maxChars: AI_EVAL_CHAT_MAX_CHARS }, chatLinks(evalCase))
    case 'workflow':
      return checkWorkflow(evalCase, answer)
    case 'insight':
      return checkInsight(evalCase, answer)
    case 'crm':
      return checkCrm(evalCase, answer)
    default:
      return { readable: false, rules: false, budget: false, findings: ['kind-unknown'] }
  }
}

/** The plan held to the plan rules, then to the shape the case expects. */
export function checkAiEvalPlan(
  evalCase: AiEvalCase,
  plan: unknown,
): { pass: boolean; findings: string[] } {
  const shape = evalCase.expected?.plan
  if (!shape) return { pass: true, findings: [] }
  const result = aiDoctrinePlanCheck(evalCase.inventory, evalCase.framing, evalCase.capabilities ?? null)(
    isRecord(plan) ? plan : {},
  )
  if (!result.value) return { pass: false, findings: ['plan-unreadable', ...codes(result.violations)] }
  const value = result.value
  const shapeFindings = [
    ...(value.screens.length < shape.screens[0] || value.screens.length > shape.screens[1]
      ? [`plan-screens:${value.screens.length}`]
      : []),
    ...(shape.reuse ?? [])
      .filter((id) => !value.reuse.some((entry) => entry.id === id))
      .map((id) => `plan-reuse-missing:${id}`),
    ...(shape.layout
      ? value.screens
          .filter((screen) => screen.layout !== shape.layout)
          .map((screen) => `plan-layout:${screen.slug}`)
      : []),
    ...(shape.maxCreate !== undefined && value.create.length > shape.maxCreate
      ? [`plan-create:${value.create.length}`]
      : []),
    ...(shape.createKinds
      ? value.create
          .filter((entry) => !shape.createKinds?.includes(entry.kind))
          .map((entry) => `plan-create-kind:${entry.kind}`)
      : []),
  ]
  const findings = [...codes(result.violations), ...shapeFindings]
  return { pass: findings.length === 0, findings }
}

const clampGrade = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : null
}

/** A rubric's mean and whether it passes: the mean at `AI_EVAL_RUBRIC_PASS_MEAN`, nothing under three. */
export function aiEvalRubricVerdict(rubric: AiEvalRubric | null | undefined): {
  mean: number
  pass: boolean
} {
  const grades = [rubric?.structure, rubric?.copy, rubric?.reuse]
    .map(clampGrade)
    .filter((grade): grade is number => grade !== null)
  if (!grades.length) return { mean: 1, pass: false }
  const mean = grades.reduce((sum, grade) => sum + grade, 0) / grades.length
  return { mean, pass: mean >= AI_EVAL_RUBRIC_PASS_MEAN && Math.min(...grades) >= 3 }
}

/**
 * The widths a readable document of a rendered kind is held to, from its
 * recorded device audit: `null` when the answer is not such a document or no
 * audits were given; failing, with `widths-unrecorded`, when none was recorded
 * from this answer.
 */
function checkWidths(
  evalCase: AiEvalCase,
  answer: unknown,
  checked: Checked | null,
  audits: AiEvalAudits | undefined,
): { pass: boolean; findings: string[] } | null {
  if (!audits || !checked?.readable || !aiEvalRendersAtDeviceWidths(evalCase.kind)) return null
  const audit = audits(evalCase, answer)
  if (!audit) return { pass: false, findings: ['widths-unrecorded'] }
  const findings = aiDeviceAuditFindings(audit)
  return { pass: findings.length === 0, findings }
}

/** One answer to one golden brief, scored. */
export function scoreAiEvalCandidate(
  evalCase: AiEvalCase,
  candidate: AiEvalCandidate,
  audits?: AiEvalAudits,
): AiEvalScore {
  const scope = candidate.scope ?? 'full'
  const checked = scope === 'full' ? checkAnswer(evalCase, candidate.answer) : null
  const widths = checkWidths(evalCase, candidate.answer, checked, audits)
  const plan = evalCase.expected?.plan ? checkAiEvalPlan(evalCase, candidate.plan) : null
  const rubric = aiEvalRubricVerdict(candidate.rubric)
  const rubricScore = (rubric.mean - 1) / 4
  const parts = [
    ...(checked ? [checked.readable ? 1 : 0, checked.rules ? 1 : 0, checked.budget ? 1 : 0] : []),
    ...(plan ? [plan.pass ? 1 : 0] : []),
    rubricScore,
  ]
  const score = Math.round((parts.reduce((sum, part) => sum + part, 0) / parts.length) * 10_000) / 10_000
  const documentPasses = checked ? checked.readable && checked.rules && checked.budget : true
  return {
    caseId: evalCase.id,
    kind: evalCase.kind,
    source: candidate.source,
    scope,
    model: candidate.model,
    checks: {
      readable: checked ? checked.readable : null,
      rules: checked ? checked.rules : null,
      budget: checked ? checked.budget : null,
      plan: plan ? plan.pass : null,
      responsive: widths ? widths.pass : null,
      rubric: rubric.pass,
    },
    rubricScore: Math.round(rubricScore * 10_000) / 10_000,
    score,
    // A plan answer to a brief with no expected plan has nothing to pass.
    pass: documentPasses && (widths?.pass ?? true) && (plan?.pass ?? scope === 'full') && rubric.pass,
    findings: [...(checked?.findings ?? []), ...(widths?.findings ?? []), ...(plan?.findings ?? [])],
  }
}

/**
 * The checks a control failed; the harness requires every one it names. A
 * control whose widths were never recorded fails none of them.
 */
export function scoreAiEvalControl(
  evalCase: AiEvalCase,
  control: AiEvalControl,
  audits?: AiEvalAudits,
): AiEvalCheck[] {
  const checked = checkAnswer(evalCase, control.answer)
  const widths = audits?.(evalCase, control.answer) ? checkWidths(evalCase, control.answer, checked, audits) : null
  const plan =
    control.plan !== undefined && evalCase.expected?.plan
      ? checkAiEvalPlan(evalCase, control.plan)
      : null
  return [
    ...(checked.readable ? [] : (['readable'] as const)),
    ...(checked.rules ? [] : (['rules'] as const)),
    ...(checked.budget ? [] : (['budget'] as const)),
    ...(plan && !plan.pass ? (['plan'] as const) : []),
    ...(widths && !widths.pass ? (['responsive'] as const) : []),
  ]
}

export interface AiEvalKindSummary {
  kind: AiEvalKind
  candidates: number
  passed: number
  /** Passed over candidates; `null` with none, which is below every floor. */
  passRate: number | null
  meanScore: number | null
  floor: AiEvalFloor
  belowFloor: boolean
}

/** Every kind's pass rate and mean score against its floor; a kind with no candidate is below it. */
export function summarizeAiEval(scores: readonly AiEvalScore[]): AiEvalKindSummary[] {
  return AI_EVAL_KINDS.map((kind) => {
    const own = scores.filter((score) => score.kind === kind && score.scope === 'full')
    const passed = own.filter((score) => score.pass).length
    const passRate = own.length ? passed / own.length : null
    const meanScore = own.length
      ? Math.round((own.reduce((sum, score) => sum + score.score, 0) / own.length) * 10_000) / 10_000
      : null
    const floor = AI_EVAL_FLOORS[kind]
    return {
      kind,
      candidates: own.length,
      passed,
      passRate,
      meanScore,
      floor,
      belowFloor:
        passRate === null ||
        meanScore === null ||
        passRate < floor.passRate ||
        meanScore < floor.meanScore,
    }
  })
}

/** How the plans a planned kind's answers carry score, across every brief. */
export interface AiEvalPlanSummary {
  plans: number
  passed: number
  passRate: number | null
}

/**
 * The plan step's own score: every answer that carried a plan checked
 * against its brief's expected shape, whole answers and plan answers alike.
 */
export function summarizeAiEvalPlans(scores: readonly AiEvalScore[]): AiEvalPlanSummary {
  const plans = scores.filter((score) => score.checks.plan !== null)
  const passed = plans.filter((score) => score.checks.plan && score.checks.rubric).length
  return { plans: plans.length, passed, passRate: plans.length ? passed / plans.length : null }
}

/** A recording a live run wrote: the brief it answers, and the answer. */
export interface AiEvalRecording {
  caseId: string
  candidate: AiEvalCandidate
}

/** A recording file read and checked for shape; throws naming the field at fault. */
export function readAiEvalRecording(raw: unknown, file: string): AiEvalRecording {
  if (!isRecord(raw) || typeof raw['caseId'] !== 'string' || !isRecord(raw['candidate'])) {
    throw new Error(`${file}: a recording holds a caseId and a candidate`)
  }
  const candidate = raw['candidate'] as Record<string, unknown>
  if (candidate['source'] !== 'recorded' || !isRecord(candidate['rubric'])) {
    throw new Error(`${file}: a recording's candidate is recorded and graded`)
  }
  return raw as unknown as AiEvalRecording
}

// ── Reading a case file ───────────────────────────────────────────────────

/** A case file read and checked for shape; throws naming the field at fault. */
export function readAiEvalCase(raw: unknown, file: string): AiEvalCase {
  const fail = (why: string): never => {
    throw new Error(`${file}: ${why}`)
  }
  if (!isRecord(raw)) return fail('not an object')
  const kind = raw['kind']
  if (typeof raw['id'] !== 'string' || !raw['id']) fail('no id')
  if (typeof kind !== 'string' || !(AI_EVAL_KINDS as readonly string[]).includes(kind)) {
    fail(`kind "${String(kind)}" is not one of ${AI_EVAL_KINDS.join(', ')}`)
  }
  if (typeof raw['brief'] !== 'string' || !raw['brief'].trim()) fail('no brief')
  if (raw['siteName'] !== undefined && (typeof raw['siteName'] !== 'string' || !raw['siteName'].trim())) {
    fail('siteName, where given, is the site’s name')
  }
  const automation = raw['automation']
  if (automation !== undefined) {
    const action = isRecord(automation) ? automation['action'] : undefined
    const problem = isRecord(action) ? validateHostAction(action as unknown as HostAction) : 'it holds no action'
    if (problem) fail(`automation.action is not an action the Actions editor would save: ${problem}`)
    if (isRecord(automation) && automation['run'] !== undefined && !isRecord(automation['run'])) {
      fail('automation.run, where given, is what the run history recorded')
    }
  }
  const media = raw['media']
  if (media !== undefined) {
    if (!isRecord(media) || !Object.keys(media).length) fail('media, where given, names at least one asset')
    for (const [mediaId, file] of Object.entries(media as Record<string, unknown>)) {
      if (typeof file !== 'string' || !AI_EVAL_MEDIA_FILE.test(file)) {
        fail(`media.${mediaId} is not a picture's path under tools/ai-eval/fixtures`)
      }
    }
  }
  const candidates = raw['candidates']
  const controls = raw['controls']
  if (!Array.isArray(candidates) || !candidates.length) fail('no candidates')
  if (!Array.isArray(controls) || !controls.length) fail('no controls: every case proves it can fail')
  for (const [index, candidate] of (candidates as unknown[]).entries()) {
    if (!isRecord(candidate)) fail(`candidates[${index}] is not an object`)
    const source = (candidate as Record<string, unknown>)['source']
    if (source !== 'authored' && source !== 'recorded') {
      fail(`candidates[${index}].source is neither authored nor recorded`)
    }
    if (!isRecord((candidate as Record<string, unknown>)['rubric'])) {
      fail(`candidates[${index}] has no rubric`)
    }
  }
  for (const [index, control] of (controls as unknown[]).entries()) {
    const fails = isRecord(control) ? control['fails'] : undefined
    if (!Array.isArray(fails) || !fails.length) fail(`controls[${index}] names no check it fails`)
  }
  const capabilities =
    raw['capabilities'] === undefined ? undefined : readAiEvalCapabilities(raw['capabilities'], fail)
  return {
    framing: null,
    inventory: null,
    ...(raw as object),
    ...(capabilities ? { capabilities } : {}),
  } as AiEvalCase
}

/**
 * A case's capabilities read and checked for shape. A creation kind the case
 * leaves out may be created, so a case names only what its workspace lacks;
 * a Free workspace's case says so with `freeTaste`, which holds its plan to
 * the sections the Free wall pays for (AGL-3070).
 */
function readAiEvalCapabilities(raw: unknown, fail: (why: string) => never): AiPlanCapabilities {
  if (!isRecord(raw) || typeof raw['reusableComponents'] !== 'boolean') {
    return fail('capabilities.reusableComponents is not true or false')
  }
  const create = isRecord(raw['create']) ? raw['create'] : {}
  const unrestricted = aiUnrestrictedPlanCapabilities()
  const entries: Array<[AiBuildPlanCreateKind, AiPlanCreation]> = AI_BUILD_PLAN_CREATE_KINDS.map((kind) => {
    const entry = create[kind]
    if (entry === undefined) return [kind, unrestricted.create[kind]]
    if (!isRecord(entry) || typeof entry['allowed'] !== 'boolean') {
      return fail(`capabilities.create.${kind}.allowed is not true or false`)
    }
    const left = entry['left']
    const reason = entry['reason']
    return [
      kind,
      {
        allowed: entry['allowed'],
        left: typeof left === 'number' ? left : null,
        reason: typeof reason === 'string' ? reason : null,
      },
    ]
  })
  for (const kind of Object.keys(create)) {
    if (!(AI_BUILD_PLAN_CREATE_KINDS as readonly string[]).includes(kind)) {
      fail(`capabilities.create.${kind} is not a creation kind`)
    }
  }
  if (raw['freeTaste'] !== undefined && typeof raw['freeTaste'] !== 'boolean') {
    return fail('capabilities.freeTaste is not true or false')
  }
  return {
    reusableComponents: raw['reusableComponents'],
    create: Object.fromEntries(entries) as AiPlanCapabilities['create'],
    ...(raw['freeTaste'] === true ? { freeTaste: true } : {}),
  }
}
