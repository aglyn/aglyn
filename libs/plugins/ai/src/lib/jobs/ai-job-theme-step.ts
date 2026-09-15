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

import {
  hostThemeSource,
  resolveSiteTheme,
  type HostThemeSource,
  type ThemeHostDocument,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import {
  INHERITED_BORDER_RADIUS,
  INHERITED_FONT_FAMILY,
  INHERITED_SPACING,
  INHERITED_TOOLBAR_HEIGHTS,
  inheritedThemeColor,
} from '@aglyn/shared-ui-theme/util/theme-editor-defaults'
import {
  readDarkScheme,
  readFontFamily,
  readThemeColor,
  readToolbarHeight,
  SYSTEM_FONT_VALUE,
  THEME_COLOR_FIELDS,
  THEME_EDITOR_MEDIA_QUERIES,
} from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import {
  buildAiThemeProposal,
  type AiThemeProposal,
  type AiThemeProposalMode,
} from '../model/ai-theme-proposal'
import type { AiStepKind } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import {
  AI_ACCEPTABLE_USE_BLOCK,
  runAiRequest,
  type AiMessage,
  type AiSystemBlock,
  type AiThinking,
  type AiTool,
  type AiUsage,
} from '../runtime/ai-runtime'
import {
  AI_THEME_TOOL_NAME,
  aiThemeTool,
  parseAiThemeToolInput,
  type AiThemeToolParse,
} from '../tools/ai-theme-tool'
import {
  AI_JOB_BRIEF_MAX_CHARS,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import {
  AI_THEME_BRAND_SOURCE_WORDS,
  gatherAiThemeBrandInputs,
  type AiThemeBrandColor,
} from './ai-theme-brand-inputs'

/**
 * The `theme` step (AGL-2938): a brief and a site's current theme in, a theme
 * proposal out — every control the theme editor exposes, and nothing else.
 *
 * The step writes nothing to the site. A site's theme is fields on its host
 * document, and writing those is the save the Theme section's editor
 * performs; the step's output is the proposal, which a person puts in the
 * editor, previews against the current theme, and saves or discards.
 *
 * The request is shaped for the cache: the rules and the tool are static and
 * sit in the cached prefix, and everything about this site — its theme, its
 * brand colors, the brief — rides in the user turn. The model answers through
 * one strict tool derived from the editor's own catalog, and the answer is
 * held to that catalog and to the doctrine (a targeted diff, dark values,
 * contrast) before it becomes a proposal.
 */

/**
 * The routing table's answer for `job.theme`: the model the theme step runs on
 * when the machine hands it no `modelFor`.
 */
export function aiJobThemeModel(): string {
  return aiModelForStep('job.theme')
}

/**
 * The output budget. The largest answer the tool accepts — every color in
 * both schemes, the full run of component leaves, the longest summary — is
 * about 2,500 tokens of JSON (`ai-job-theme-step.spec.ts` measures it), and
 * the rest is room for the model to think before it answers.
 */
export const AI_JOB_THEME_MAX_TOKENS = 8_000

/** How many of a site's own component override leaves the prompt lists. */
export const AI_JOB_THEME_INVENTORY_LEAVES = 40

/** The customer-safe sentences a failed theme step leaves on the job. */
export const AI_JOB_THEME_NO_SITE_COPY =
  'This theme job names a site this workspace does not have.'
export const AI_JOB_THEME_NO_ANSWER_COPY =
  'The AI could not produce a theme proposal from this brief. Try describing the change differently.'

/**
 * The theme step's own instructions, byte-identical on every request so they
 * cache. The acceptable-use rules are not in them: they belong to the block
 * every generator shares, which the generation call puts ahead of these.
 */
export const AI_JOB_THEME_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You change the theme of a website built with a site builder. You are given the ' +
      "site's current theme — every control its theme editor has, with the value the site " +
      'set or the default it inherits — any brand colors that belong to the site, and a ' +
      'brief from the person who owns it.\n\n' +
      `Answer by calling ${AI_THEME_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      '- In modify mode, name only the controls the brief is about. Every control you leave ' +
      'out keeps its current value. "Warmer" is about color, not about fonts or corners.\n' +
      '- In create mode, design a complete theme: the primary, secondary and tertiary ' +
      'accents, the page background and paper, the text colors, and their dark values.\n' +
      "- Colors are hex values on the theme's own tokens. A component style never carries a " +
      'literal color; color belongs to the palette.\n' +
      '- Give every color you change a dark value beside its light value unless the dark ' +
      'scheme is off. A dark value keeps the hue and reads on a dark background.\n' +
      '- Keep text readable: body text needs 4.5:1 against the background and the paper, and ' +
      'the primary color 3:1 against the background.\n' +
      '- A hex color written in the brief is used exactly as written. When the brief asks to ' +
      'match the brand, build on the brand colors you are given.\n' +
      '- Fonts come from the list the tool offers, and numbers stay inside the ranges it ' +
      'states.\n' +
      '- Write the summary in the language of the brief.',
    cacheBreakpoint: true,
  },
]

const ZERO_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** `create` when the job asked for a whole design; `modify` otherwise. */
export function aiJobThemeMode(inputs: AiJob['inputs'] | undefined): AiThemeProposalMode {
  return inputs?.['mode'] === 'create' ? 'create' : 'modify'
}

const SOURCE_WORDS: Record<HostThemeSource, string> = {
  installed:
    "an installed marketplace theme; a change is stored as the site's own edits on top of it",
  custom: "the site's own theme",
  default: "the platform's default theme; a change stores only the values it sets",
}

/** One value as the inventory shows it: the site's own, or the default it inherits. */
const shown = (own: string | number | null | undefined, inherited: string | number | undefined) =>
  own === null || own === undefined ? `${inherited ?? 'unset'} (default)` : `${own} (set)`

/** The site's own component overrides, one bounded line a leaf. */
function overrideLeaves(theme: HostTheme | undefined): string[] {
  const leaves: string[] = []
  const media = Object.fromEntries(
    Object.entries(THEME_EDITOR_MEDIA_QUERIES).map(([name, query]) => [query, name]),
  )
  const text = (value: unknown) => JSON.stringify(value)?.slice(0, 60) ?? ''
  for (const [component, override] of Object.entries(theme?.components ?? {})) {
    for (const [prop, value] of Object.entries(override?.defaultProps ?? {})) {
      leaves.push(`${component} default ${prop} = ${text(value)}`)
    }
    for (const [slot, styles] of Object.entries(override?.styleOverrides ?? {})) {
      if (!styles || typeof styles !== 'object') continue
      for (const [property, value] of Object.entries(styles as Record<string, unknown>)) {
        if (value && typeof value === 'object') {
          for (const [nested, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            leaves.push(
              `${component} ${slot} ${nested} = ${text(nestedValue)} (${media[property] ?? property})`,
            )
          }
        } else {
          leaves.push(`${component} ${slot} ${property} = ${text(value)}`)
        }
      }
    }
  }
  return leaves
}

/**
 * The site's theme as the model reads it: compact, one control a line, each
 * value marked as the site's own or the default it inherits, so "make the
 * background warmer" starts from the color the visitor actually sees.
 */
export function aiJobThemeInventory(theme: HostTheme | undefined, source: HostThemeSource): string {
  const lines = [`Source: ${SOURCE_WORDS[source]}.`, `Dark scheme: ${readDarkScheme(theme)}.`]
  lines.push('Colors, light | dark:')
  for (const { token } of THEME_COLOR_FIELDS) {
    const value = (scheme: HostThemeScheme) =>
      shown(readThemeColor(theme, scheme, token), inheritedThemeColor(scheme, token))
    lines.push(`- ${token}: ${value('light')} | ${value('dark')}`)
  }
  const font = readFontFamily(theme)
  lines.push(`Font family: ${shown(font === SYSTEM_FONT_VALUE ? null : font, INHERITED_FONT_FAMILY)}`)
  lines.push(`Border radius: ${shown(theme?.shape?.borderRadius, INHERITED_BORDER_RADIUS)}`)
  lines.push(`Spacing unit: ${shown(theme?.spacing, INHERITED_SPACING)}`)
  lines.push(
    `Nav height: mobile ${shown(theme && readToolbarHeight(theme, 'xs'), INHERITED_TOOLBAR_HEIGHTS.xs)}, ` +
      `desktop ${shown(theme && readToolbarHeight(theme, 'sm'), INHERITED_TOOLBAR_HEIGHTS.sm)}`,
  )
  const leaves = overrideLeaves(theme)
  if (!leaves.length) {
    lines.push('Component overrides: none.')
  } else {
    lines.push('Component overrides:')
    for (const leaf of leaves.slice(0, AI_JOB_THEME_INVENTORY_LEAVES)) lines.push(`- ${leaf}`)
    if (leaves.length > AI_JOB_THEME_INVENTORY_LEAVES) {
      lines.push(`- and ${leaves.length - AI_JOB_THEME_INVENTORY_LEAVES} more`)
    }
  }
  return lines.join('\n')
}

/** The user turn: the mode, the site's theme, its brand colors, and the brief. */
export function aiJobThemePrompt(input: {
  brief: string
  mode: AiThemeProposalMode
  theme: HostTheme | undefined
  source: HostThemeSource
  brand: readonly AiThemeBrandColor[]
}): string {
  const sections = [
    input.mode === 'create'
      ? 'Mode: create. Design a complete theme over every control.'
      : 'Mode: modify. Change only what the brief is about.',
    `Current theme:\n${aiJobThemeInventory(input.theme, input.source)}`,
  ]
  if (input.brand.length) {
    sections.push(
      `Brand colors:\n${input.brand
        .map((color) => `- ${color.hex} (${AI_THEME_BRAND_SOURCE_WORDS[color.source]})`)
        .join('\n')}`,
    )
  }
  sections.push(`Brief: ${input.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`)
  return sections.join('\n\n')
}

/* ------------------------------------------------------------------------ *
 * The generation call, in the building doctrine's shape (AGL-2935)
 * ------------------------------------------------------------------------ */

/** One refused rule or value, as the doctrine names it. */
interface AiDoctrineViolation {
  rule: number | null
  code: string
  message: string
}

interface AiGenerationSpend {
  attempts: number
  /** Summed over every call. */
  usage: AiUsage
  estCostUsd: number
  model: string
  stopReason: string | null
}

type AiValidatedGeneration<T> =
  | (AiGenerationSpend & { status: 'ok'; value: T })
  | (AiGenerationSpend & { status: 'needs_input'; violations: AiDoctrineViolation[]; message: string })
  | (AiGenerationSpend & { status: 'refused' })

interface AiCustomGenerationInput<T> {
  step: AiStepKind
  model?: string
  /** This door's static text, cached after the shared block. */
  instructions: readonly AiSystemBlock[]
  /** A theme builds from the site's theme, not from the site's pages. */
  inventory: null
  messages: readonly AiMessage[]
  tool: AiTool
  maxTokens?: number
  thinking?: AiThinking
  signal?: AbortSignal
  check: (answer: Record<string, unknown>) => {
    value: T | null
    violations: AiDoctrineViolation[]
  }
}

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

/**
 * STAND-IN: becomes `runValidatedGeneration('theme', …)` — the third, custom
 * overload the building doctrine (AGL-2935) posted — once that lands. The
 * signature and the result are that function's, so the swap is the import
 * and the removal of this function; the theme's own validation stays in
 * `check`, and the shared acceptable-use block below becomes the doctrine's
 * block, which already carries it.
 *
 * Until then it behaves as the doctrine does: one call through the strict
 * tool; one re-ask that names only what was wrong — no tool call, or nothing
 * `check` could use; then `needs_input` with a customer-safe sentence. Usage
 * from every call is summed, because every call was spent. It throws only
 * what `runAiRequest` throws, so the machine's retry and failure paths stay
 * the machine's.
 */
async function runValidatedGenerationStandIn<T>(
  _kind: 'theme',
  input: AiCustomGenerationInput<T>,
): Promise<AiValidatedGeneration<T>> {
  const model = input.model ?? aiModelForStep(input.step)
  const system: AiSystemBlock[] = [{ text: AI_ACCEPTABLE_USE_BLOCK }, ...input.instructions]
  let spend: AiGenerationSpend = {
    attempts: 0,
    usage: ZERO_USAGE,
    estCostUsd: 0,
    model,
    stopReason: null,
  }
  let violations: AiDoctrineViolation[] = []
  let reask: string | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const last = input.messages.length - 1
    const messages = input.messages.map((message, index) =>
      reask && index === last ? { ...message, content: `${message.content}\n\n${reask}` } : message,
    )
    const result = await runAiRequest({
      model,
      system,
      messages,
      tools: [input.tool],
      maxTokens: input.maxTokens ?? AI_JOB_THEME_MAX_TOKENS,
      ...(input.thinking ? { thinking: input.thinking } : {}),
      stream: false,
      ...(input.signal ? { signal: input.signal } : {}),
    })
    spend = {
      attempts: attempt + 1,
      usage: addUsage(spend.usage, result.usage),
      estCostUsd: Math.round((spend.estCostUsd + result.estCostUsd) * 1_000_000) / 1_000_000,
      model,
      stopReason: result.stopReason,
    }
    if (result.kind === 'refusal') return { ...spend, status: 'refused' }
    const call = result.toolUse.find((use) => use.name === input.tool.name)
    if (!call) {
      violations = [
        { rule: null, code: 'no-tool-call', message: `Your last reply did not call ${input.tool.name}.` },
      ]
      reask = `${violations[0].message} Answer by calling it.`
      continue
    }
    const checked = input.check(call.input)
    if (checked.value !== null) return { ...spend, status: 'ok', value: checked.value }
    violations = checked.violations
    reask =
      `Nothing in your last call to ${input.tool.name} could be used:\n` +
      violations.map((violation) => `- ${violation.message}`).join('\n') +
      '\nCall it again with values the tool accepts.'
  }
  return { ...spend, status: 'needs_input', violations, message: AI_JOB_THEME_NO_ANSWER_COPY }
}

/**
 * The theme tool's answer held to the editor. Usable when anything in it
 * survives; refused, naming what was refused, when nothing does. A call that
 * proposes no change and refuses nothing is a real answer — the theme
 * already does what the brief asks.
 */
function checkThemeAnswer(answer: Record<string, unknown>): {
  value: AiThemeToolParse | null
  violations: AiDoctrineViolation[]
} {
  const parse = parseAiThemeToolInput(answer)
  const nothingUsable =
    !parse.changes.length && !parse.components.length && !parse.resetComponents
  if (!nothingUsable || !parse.dropped.length) return { value: parse, violations: [] }
  return {
    value: null,
    violations: parse.dropped.map((message) => ({ rule: null, code: 'theme-control', message })),
  }
}

/** The site a theme job changes, read and checked against the job's org. */
async function loadThemeSite(
  firestore: FirebaseFirestore.Firestore,
  job: AiJob,
): Promise<
  | { host: ThemeHostDocument & Record<string, unknown>; theme: HostTheme | undefined; source: HostThemeSource }
  | { failure: string }
> {
  if (!job.hostId) return { failure: AI_JOB_THEME_NO_SITE_COPY }
  const snapshot = await firestore.collection('hosts').doc(job.hostId).get()
  const host = snapshot.exists
    ? (snapshot.data() as ThemeHostDocument & Record<string, unknown>)
    : null
  // The route checks the caller's membership of the org the job is metered
  // against, not that the site it named belongs to that org. A site of some
  // other org is refused here, before anything about it reaches a prompt.
  if (!host || host['orgId'] !== job.orgId) return { failure: AI_JOB_THEME_NO_SITE_COPY }
  return { host, theme: resolveSiteTheme(host), source: hostThemeSource(host) }
}

/** How many edits a proposal makes, for its label. */
function proposalSize(proposal: AiThemeProposal): number {
  return proposal.changes.length + proposal.components.length + (proposal.resetComponents ? 1 : 0)
}

export const runAiJobThemeStep: AiJobStepRunner = async ({
  job,
  signal,
  firestore,
  org,
  modelFor,
}) => {
  if (!firestore) {
    // The machine always hands one in; a runner called without it is a
    // wiring fault, not a customer path.
    throw new Error('the theme step reads the site it changes and was given no Firestore')
  }
  // The model switch's answer for this job (AGL-2942): the creator's pick
  // where the plan, the org restriction and the allotment allowlists allow
  // it, and Auto held to those same lists otherwise. Only a runner called
  // without a resolver asks the routing table directly.
  const model = modelFor?.('job.theme') ?? aiJobThemeModel()
  const site = await loadThemeSite(firestore, job)
  if ('failure' in site) {
    return {
      outputs: [],
      usage: ZERO_USAGE,
      estCostUsd: 0,
      model,
      stopReason: null,
      failure: site.failure,
    }
  }
  const mode = aiJobThemeMode(job.inputs)
  const brand = await gatherAiThemeBrandInputs({
    firestore,
    org: org ?? null,
    hostId: job.hostId as string,
    host: site.host,
    brief: job.brief,
    signal,
  })
  const generation = await runValidatedGenerationStandIn('theme', {
    step: 'job.theme',
    model,
    instructions: AI_JOB_THEME_INSTRUCTIONS,
    inventory: null,
    messages: [
      {
        role: 'user',
        content: aiJobThemePrompt({
          brief: job.brief,
          mode,
          theme: site.theme,
          source: site.source,
          brand: brand.colors,
        }),
      },
    ],
    tool: aiThemeTool(),
    maxTokens: AI_JOB_THEME_MAX_TOKENS,
    thinking: 'adaptive',
    signal,
    check: checkThemeAnswer,
  })
  const spent: Pick<AiJobStepOutcome, 'usage' | 'estCostUsd' | 'model' | 'stopReason'> = {
    usage: generation.usage,
    estCostUsd: generation.estCostUsd,
    model: generation.model,
    stopReason: generation.stopReason,
  }
  if (generation.status === 'refused') return { outputs: [], ...spent, refused: true }
  if (generation.status === 'needs_input') {
    return { outputs: [], ...spent, failure: generation.message }
  }

  const answer = generation.value
  const proposal = buildAiThemeProposal({
    base: site.theme,
    source: site.source,
    mode,
    brief: job.brief,
    summary: answer.summary,
    changes: answer.changes,
    components: answer.components,
    resetComponents: answer.resetComponents,
    dropped: answer.dropped,
    notes: [...brand.notes, ...answer.notes],
  })
  const size = proposalSize(proposal)
  const output: AiJobOutput = {
    resource: 'theme',
    // A proposal has no document of its own; the id names what it is within
    // the job, as a text output's `draft` does.
    id: 'proposal',
    hostId: job.hostId ?? null,
    hostSubdomain: typeof site.host['subdomain'] === 'string' ? site.host['subdomain'] : null,
    label: `Theme proposal · ${size} ${size === 1 ? 'change' : 'changes'}`,
    // Through JSON so no `undefined` reaches the document write.
    proposal: JSON.parse(JSON.stringify(proposal)) as Record<string, unknown>,
  }
  return { outputs: [output], ...spent }
}
