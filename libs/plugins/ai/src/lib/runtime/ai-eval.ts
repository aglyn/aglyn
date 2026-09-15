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

import type { AiBuildPlanCreateKind } from '../model/ai-build-plan'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import type { AiStepKind } from '../providers/catalog'
import type { AiEffort, AiUsage } from '../providers/contract'
import { parseAiThemeToolInput } from '../tools/ai-theme-tool'
import { aiDoctrinePlanCheck, aiDoctrineTreeCheck, aiDoctrineTreeContext } from './ai-doctrine'
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
  | 'theme'
  | 'element'
  | 'blog'
  | 'text'
  | 'chat'

export const AI_EVAL_KINDS: readonly AiEvalKind[] = [
  'page',
  'template',
  'component',
  'layout',
  'form',
  'email',
  'section',
  'seo',
  'theme',
  'element',
  'blog',
  'text',
  'chat',
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

/** The checks an answer is scored on, beside its rubric. */
export type AiEvalCheck = 'readable' | 'rules' | 'budget' | 'plan' | 'rubric'

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
  rubric: AiEvalRubric
  note?: string
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
  /** Media library facts the image budget reads, by media id. */
  assets?: Record<string, AiAssetFacts>
  /** The documentation URLs a chat answer was grounded in; it may link only these. */
  docsUrls?: string[]
  /** Copy ceilings the brief sets, beside the kind's own. */
  maxChars?: number
  maxWords?: number
  expected?: { plan?: AiEvalPlanShape }
  candidates: AiEvalCandidate[]
  controls: AiEvalControl[]
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
  theme: { passRate: 1, meanScore: 0.9 },
  element: { passRate: 1, meanScore: 0.9 },
  blog: { passRate: 1, meanScore: 0.9 },
  text: { passRate: 1, meanScore: 0.9 },
  chat: { passRate: 1, meanScore: 0.9 },
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
  model: string | null
  checks: Record<Exclude<AiEvalCheck, 'plan'>, boolean> & { plan: boolean | null }
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

function checkTree(evalCase: AiEvalCase, outputKind: AiOutputKind, answer: unknown): Checked {
  const check = aiDoctrineTreeCheck(
    outputKind,
    aiDoctrineTreeContext(evalCase.inventory, {
      ...(evalCase.assets ? { assets: evalCase.assets } : {}),
      framing: evalCase.framing,
    }),
  )
  const result = check(isRecord(answer) ? answer : { tree: answer })
  const budget = result.violations.filter((violation) => violation.rule === 17)
  const rules = result.violations.filter((violation) => violation.rule !== 17)
  return {
    readable: result.value !== null,
    rules: result.value !== null && rules.length === 0,
    budget: result.value !== null && budget.length === 0,
    findings: codes(result.violations),
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

function checkAnswer(evalCase: AiEvalCase, answer: unknown): Checked {
  const outputKind = AI_EVAL_TREE_OUTPUT[evalCase.kind]
  if (outputKind) return checkTree(evalCase, outputKind, answer)
  switch (evalCase.kind) {
    case 'seo':
      return checkSeo(evalCase, answer)
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
  const result = aiDoctrinePlanCheck(evalCase.inventory, evalCase.framing)(
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

/** One answer to one golden brief, scored. */
export function scoreAiEvalCandidate(evalCase: AiEvalCase, candidate: AiEvalCandidate): AiEvalScore {
  const checked = checkAnswer(evalCase, candidate.answer)
  const plan = evalCase.expected?.plan ? checkAiEvalPlan(evalCase, candidate.plan) : null
  const rubric = aiEvalRubricVerdict(candidate.rubric)
  const rubricScore = (rubric.mean - 1) / 4
  const parts = [
    checked.readable ? 1 : 0,
    checked.rules ? 1 : 0,
    checked.budget ? 1 : 0,
    ...(plan ? [plan.pass ? 1 : 0] : []),
    rubricScore,
  ]
  const score = Math.round((parts.reduce((sum, part) => sum + part, 0) / parts.length) * 10_000) / 10_000
  return {
    caseId: evalCase.id,
    kind: evalCase.kind,
    source: candidate.source,
    model: candidate.model,
    checks: {
      readable: checked.readable,
      rules: checked.rules,
      budget: checked.budget,
      plan: plan ? plan.pass : null,
      rubric: rubric.pass,
    },
    rubricScore: Math.round(rubricScore * 10_000) / 10_000,
    score,
    pass: checked.readable && checked.rules && checked.budget && (plan?.pass ?? true) && rubric.pass,
    findings: [...checked.findings, ...(plan?.findings ?? [])],
  }
}

/** The checks a control failed; the harness requires every one it names. */
export function scoreAiEvalControl(evalCase: AiEvalCase, control: AiEvalControl): AiEvalCheck[] {
  const checked = checkAnswer(evalCase, control.answer)
  const plan =
    control.plan !== undefined && evalCase.expected?.plan
      ? checkAiEvalPlan(evalCase, control.plan)
      : null
  return [
    ...(checked.readable ? [] : (['readable'] as const)),
    ...(checked.rules ? [] : (['rules'] as const)),
    ...(checked.budget ? [] : (['budget'] as const)),
    ...(plan && !plan.pass ? (['plan'] as const) : []),
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
    const own = scores.filter((score) => score.kind === kind)
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
  return {
    framing: null,
    inventory: null,
    ...(raw as object),
  } as AiEvalCase
}
