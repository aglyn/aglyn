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

import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { diffOverride, overrideWriteValue } from '@aglyn/aglyn/app-utils/artifact-overrides'
import { themeArtifactContent, type ThemeHostDocument } from '@aglyn/aglyn/app-utils/site-theme'
import { readThemeSelection, SITE_THEME_ENTRY_ID } from '@aglyn/aglyn/app-utils/theme-library'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { listServerThemePresets } from '@aglyn/aglyn/plugin-manager/plugin-theme-presets'
import type { HostTheme } from '@aglyn/shared-data-types'
import { runThemeLibraryAction } from '@aglyn/tenant-data-admin/server/theme-library-write'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import { AI_SITE_FONT_PAIRINGS, aiSiteKindFor, aiSiteKindOfInputs, type AiSiteBase, type AiSiteKind } from '../model/ai-site-kinds'
import {
  AI_SITE_LOOK_TOOL,
  AI_SITE_LOOK_TOOL_NAME,
  aiReadSiteLook,
  aiSiteSeed,
  aiSiteStyleFor,
  aiSiteTheme,
  type AiSiteLookAnswer,
  type AiSiteStyle,
} from '../model/ai-site-look'
import { aiCatalogEntry, aiDefaultModelFor } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import { runValidatedGeneration, type AiGenerationCheck } from '../runtime/ai-doctrine'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { aiJobStepBudget } from './ai-job-budget'
import { aiGenerationSpent, aiUnspentOutcome } from './ai-job-generation'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobStepContext, type AiJobStepOutcome } from './ai-job-text-step'

/**
 * A site's look, designed first (AGL-3660): the scaffold's theme unit.
 *
 * One short answer from the fast tier — the base theme, two hues, a ground,
 * a font pairing and the building blocks' styles, chosen for this business
 * within its kind — then code builds the theme (`ai-site-look.ts`) and saves
 * it the way Setup → Theme saves a pick and its edits: the base theme
 * selected, the site's own look as the override over it, and the style
 * tokens on the site for later edits to keep. The header, the footer and
 * every page are built after it, so they render in it from their first draft.
 *
 * The look never fails a site. An answer that could not be read leaves the
 * kind and the seed to choose; a site whose owner already changed its theme
 * keeps it.
 */

/** The answer is a dozen short values; the ceiling leaves room for a re-ask's worth of care. */
export const AI_SITE_LOOK_MAX_TOKENS = 400

/** A look pass's time, on the fast tier the look is asked on. */
export const AI_SITE_LOOK_BUDGET = aiJobStepBudget({ tier: 'fast', maxTokens: AI_SITE_LOOK_MAX_TOKENS })

/** The generation kind a look is asked under. */
export const AI_SITE_LOOK_KIND = 'theme'

/** The base themes as the model reads them; `starter` is the one a new site is born with. */
const STARTER_WORDS = 'Aglyn starter: a soft neutral ground, rounder corners and calm buttons'

/** The look door's cached instructions. */
export const AI_SITE_LOOK_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      "You choose the look of a new small-business website: the platform's base theme it starts from, and the choices that make it this business's own.",
      `Answer by calling ${AI_SITE_LOOK_TOOL_NAME} exactly once.`,
      '- Choose for this business, its audience and its kind of site, never a default: a roofer and a florist should not share a color, a law firm and a yoga studio should not share a typeface.',
      '- Prefer a base theme, font pairing and corners from the lists the request gives for this kind of site.',
      '- hue is the brand color and accent sits beside it; pick colors people would expect of this business, and let the design seed tip a close call.',
      '- A hex color written in the brief is the brand color: put it in brand. Otherwise brand is null.',
      '- Choose the building blocks to suit the kind: quiet, flat cards and small eyebrows for minimal sites; raised cards and capitals for bold ones; soft tinted cards for calm ones.',
    ].join('\n'),
    cacheBreakpoint: true,
  },
]

/** The look's user turn: the site, its kind and what suits it, and the seed. */
export function aiSiteLookPrompt(input: {
  job: Pick<AiJob, 'brief' | '$id' | 'inputs'>
  kind: AiSiteKind
  bases: ReadonlyArray<{ base: AiSiteBase; words: string }>
}): string {
  const { job, kind } = input
  const text = (key: string) => (typeof job.inputs?.[key] === 'string' ? (job.inputs[key] as string).trim() : '')
  const pairings = AI_SITE_FONT_PAIRINGS.filter((pairing) => kind.look.fonts.includes(pairing.id))
  return [
    `Kind of site: ${kind.label}. ${kind.design}`,
    text('businessName') ? `Business name: ${text('businessName')}` : '',
    text('businessType') ? `Business: ${text('businessType')}` : '',
    text('audience') ? `For: ${text('audience')}` : '',
    text('brand') ? `Brand: ${text('brand')}` : '',
    `Brief: ${job.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`,
    `Base themes that suit it, best first: ${input.bases.map((entry) => `${entry.base} (${entry.words})`).join('; ')}.`,
    `Font pairings that suit it: ${pairings.map((pairing) => `${pairing.id} (${pairing.feel})`).join('; ')}.`,
    `Corners that suit it: ${kind.look.corners.join(', ')}. Its palette runs ${kind.look.chroma === 'neutral' ? 'neutral, ink and paper with one accent color' : kind.look.chroma}.`,
    `Design seed: ${job.$id.slice(-6)}.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The answer, read leniently; a call with nothing usable is still an answer, and the seed fills it. */
export const aiSiteLookCheck: AiGenerationCheck<AiSiteLookAnswer> = (answer) => ({
  value: aiReadSiteLook(answer),
  violations: [],
})

/** The model a look is asked on: the fast tier of the job's provider, unless the creator picked a model. */
export function aiSiteLookModel(job: Pick<AiJob, 'model'>, resolved: string | undefined): string {
  const fallback = resolved ?? aiModelForStep('job.theme')
  const picked = typeof job.model === 'string' ? job.model.trim() : ''
  if (picked && picked !== 'auto') return fallback
  const entry = aiCatalogEntry(fallback)
  return (entry ? aiDefaultModelFor(entry.provider, 'fast') : undefined) ?? fallback
}

/** The preset id a base names. */
export const aiSiteBasePresetId = (base: AiSiteBase) => `theme-presets.${base}`

/** The bases a kind suits that this deployment has, best first, with what each looks like. */
export function aiSiteLookBases(kind: AiSiteKind): Array<{ base: AiSiteBase; words: string }> {
  const presets = listServerThemePresets()
  return kind.look.bases.flatMap((base): Array<{ base: AiSiteBase; words: string }> => {
    if (base === 'starter') return [{ base, words: STARTER_WORDS }]
    const preset = presets.find((entry) => entry.id === aiSiteBasePresetId(base))
    return preset ? [{ base, words: preset.description ?? preset.name }] : []
  })
}

/** Plain JSON, deep-sorted, for comparing two themes as stored. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )
}

/**
 * Whether a site still has the theme it was born with (AGL-3497), or none:
 * the only theme a look may replace. A site whose owner picked a theme, edited
 * one, or installed one keeps it.
 */
export function aiSiteThemeUntouched(host: ThemeHostDocument & Record<string, unknown>): boolean {
  if (host.themeOverride) return false
  const selection = readThemeSelection(host)
  if (selection.kind === 'default') return true
  if (selection.kind !== 'custom' || selection.id !== SITE_THEME_ENTRY_ID) return false
  return stable(themeArtifactContent(host.theme)) === stable(themeArtifactContent(DEFAULT_SITE_THEME))
}

export type AiSiteThemeWrite = 'applied' | 'kept' | 'missing'

/**
 * Saves a look on its site in one transaction: the base theme picked through
 * the theme library (so the site's starter theme is filed in its library, as
 * a person's switch files it), the look as the override over the base, and
 * the style tokens. Again for the same job is a no-op.
 */
export async function aiSaveSiteTheme(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; jobId: string; style: AiSiteStyle },
): Promise<{ write: AiSiteThemeWrite; baseName: string }> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const preset =
    input.style.base === 'starter'
      ? null
      : (listServerThemePresets().find((entry) => entry.id === aiSiteBasePresetId(input.style.base)) ?? null)
  const base: HostTheme = preset ? themeArtifactContent(preset.theme) : DEFAULT_SITE_THEME
  const baseName = preset?.name ?? 'Site theme'
  const edited = aiSiteTheme({ ...input.style, base: preset ? input.style.base : 'starter' }, base)
  const override = overrideWriteValue(diffOverride(base, edited), null)
  const siteStyle = { ...input.style, base: preset ? input.style.base : 'starter', jobId: input.jobId }
  const write = await firestore.runTransaction(async (tx): Promise<AiSiteThemeWrite> => {
    const snapshot = await tx.get(hostRef)
    if (!snapshot.exists) return 'missing'
    const host = snapshot.data() as ThemeHostDocument & Record<string, unknown>
    const stored = host['siteStyle'] as { jobId?: unknown } | undefined
    if (stored?.jobId === input.jobId) return 'applied'
    if (!aiSiteThemeUntouched(host)) return 'kept'
    const extra = { themeOverride: override, siteStyle }
    if (preset) {
      const plan = await runThemeLibraryAction(
        tx,
        hostRef,
        { action: 'select', target: { kind: 'preset', id: preset.id, name: preset.name, theme: base } },
        extra,
      )
      if (plan.ok === false) throw new Error(`the site's base theme could not be picked: ${plan.error}`)
    } else {
      tx.update(hostRef, { theme: DEFAULT_SITE_THEME, ...extra })
    }
    return 'applied'
  })
  if (write === 'applied') {
    // The theme is live the moment it is written; cached pages go now.
    await dropPluginSiteCache({ hostIds: [input.hostId], reason: 'ai site look' })
  }
  return { write, baseName }
}

/** The sentence a look's row and output carry. */
function lookLabel(style: AiSiteStyle, baseName: string): string {
  const pairing = AI_SITE_FONT_PAIRINGS.find((entry) => entry.id === style.fonts)
  return `Your look: ${baseName} base, ${pairing ? `${pairing.heading.family} type` : 'its own type'}, ${style.cards} cards`
}

export interface AiSiteLookDeps {
  save?: typeof aiSaveSiteTheme
  generate?: typeof runValidatedGeneration
}

/**
 * The theme unit's pass: ask for the look, build it, save it. `job` is the
 * unit's derived job, carrying the scaffold's inputs and its origin job id,
 * which is what the seed is drawn from — so a resumed pass draws the same.
 */
export async function aiRunSiteLook(
  context: AiJobStepContext,
  job: AiJob,
  deps: AiSiteLookDeps = {},
): Promise<AiJobStepOutcome> {
  const save = deps.save ?? aiSaveSiteTheme
  const generate = deps.generate ?? runValidatedGeneration
  const model = aiSiteLookModel(job, context.modelFor?.('job.theme'))
  if (!job.hostId) return { ...aiUnspentOutcome(model), failure: 'This site job names no site.' }
  const kind = aiSiteKindOfInputs(job.inputs) ?? aiSiteKindFor(job.brief)
  const origin = typeof job.inputs?.['originJobId'] === 'string' ? (job.inputs['originJobId'] as string) : job.$id
  const result = await generate<AiSiteLookAnswer>(AI_SITE_LOOK_KIND, {
    step: 'job.theme',
    model,
    instructions: AI_SITE_LOOK_INSTRUCTIONS as AiSystemBlock[],
    messages: [{ role: 'user', content: aiSiteLookPrompt({ job: { ...job, $id: origin }, kind, bases: aiSiteLookBases(kind) }) }],
    tool: AI_SITE_LOOK_TOOL,
    maxTokens: AI_SITE_LOOK_BUDGET.maxTokens(model),
    thinking: 'off',
    check: aiSiteLookCheck,
    ...(context.signal ? { signal: context.signal } : {}),
  })
  const spent = aiGenerationSpent(result)
  if (result.status === 'refused') return { ...spent, refused: true }
  // An answer that could not be used leaves the kind and the seed to choose.
  const answer = result.status === 'ok' ? result.value : {}
  const brand = typeof job.inputs?.['brand'] === 'string' ? (job.inputs['brand'] as string) : null
  const style = aiSiteStyleFor({ kind, answer, seed: aiSiteSeed(origin), brand })
  const saved = await save(context.firestore, { hostId: job.hostId, jobId: origin, style })
  if (saved.write === 'missing') throw new Error(`site ${job.hostId} vanished while its look was chosen`)
  const output: AiJobOutput = {
    resource: 'theme',
    id: 'look',
    hostId: job.hostId,
    label:
      saved.write === 'kept'
        ? 'Kept the theme you chose for this site'
        : lookLabel(style, saved.baseName),
    proposal: JSON.parse(JSON.stringify({ style, write: saved.write })) as Record<string, unknown>,
  }
  return { ...spent, outputs: [output] }
}
