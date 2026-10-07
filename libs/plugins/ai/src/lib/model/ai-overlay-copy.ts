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
 * Overlay copy by AI (AGL-3603): what a `text` job asked for an announcement
 * bar's or a popup's copy answers, in the shape the step writes and the
 * console reads. Pure data, so the widgets and the step share one reading.
 *
 * The overlay is the marketing plugin's, and neither plugin imports the other:
 * the limits and the trigger catalog are handed to the widget by the zone,
 * and the widget passes them on as the job's inputs. The step then holds the
 * answer to the TIGHTER of those and its own ceilings below, so a job started
 * by anything else is still bounded, and drops a trigger the caller did not
 * name rather than inventing one.
 */

/** The `text` job's `inputs.task` that asks for overlay copy. */
export const AI_OVERLAY_COPY_TASK = 'overlay'

/** What the copy is for. */
export type AiOverlayKind = 'bar' | 'popup'

/** The fields an answer fills. */
export type AiOverlayCopyField = 'name' | 'text' | 'headline' | 'body' | 'ctaLabel'

/** The step's own ceilings: no zone may widen a field past these. */
export const AI_OVERLAY_COPY_CEILINGS: Readonly<Record<AiOverlayCopyField, number>> = {
  name: 80,
  text: 200,
  headline: 120,
  body: 600,
  ctaLabel: 60,
}

/** The triggers a popup may be proposed to open on, as the site runtime names them. */
export const AI_OVERLAY_TRIGGERS = ['delay', 'scroll', 'exit'] as const
export type AiOverlayTrigger = (typeof AI_OVERLAY_TRIGGERS)[number]

/** One trigger as the zone hands it over: its id and the range of its value. */
export interface AiOverlayTriggerRule {
  id: string
  label: string
  unit: 'seconds' | 'percent' | null
  min: number
  max: number
}

/** The longest description of the current copy a job sends. */
export const AI_OVERLAY_CURRENT_MAX_CHARS = 1_200

/** What a checked answer proposes. Absent fields propose nothing. */
export interface AiOverlayCopyProposal {
  kind: AiOverlayKind
  name: string
  text: string
  headline: string
  body: string
  ctaLabel: string
  trigger: AiOverlayTrigger | null
  triggerValue: number | null
  /** One sentence on what the copy leans on; shown, never written. */
  rationale: string
}

/** What the model answered, before the check. */
export interface AiOverlayCopyAnswer {
  name: string
  text: string
  headline: string
  body: string
  ctaLabel: string
  trigger: string
  triggerValue: number | null
  rationale: string
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The kind a job's inputs name, or `null`. */
export function aiOverlayKind(inputs: Readonly<Record<string, unknown>> | null | undefined): AiOverlayKind | null {
  const kind = inputs?.['overlayKind']
  return kind === 'bar' || kind === 'popup' ? kind : null
}

/** Whether a `text` job's inputs ask for overlay copy. */
export function aiOverlayCopyRequested(inputs: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return inputs?.['task'] === AI_OVERLAY_COPY_TASK
}

/**
 * The limit each field is held to: the caller's, where it named one, never
 * past the step's ceiling. Inputs carry them as `limit_<field>`.
 */
export function aiOverlayLimits(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): Record<AiOverlayCopyField, number> {
  const limits = { ...AI_OVERLAY_COPY_CEILINGS }
  for (const field of Object.keys(limits) as AiOverlayCopyField[]) {
    const asked = Number(inputs?.[`limit_${field}`])
    if (Number.isFinite(asked) && asked > 0) limits[field] = Math.min(limits[field], Math.floor(asked))
  }
  return limits
}

/**
 * The triggers the caller allows, with their ranges. Inputs carry them as
 * `triggers` (`delay:0-120,scroll:1-100,exit`); an id the runtime does not
 * know is dropped, and with no list a popup is proposed no trigger at all.
 */
export function aiOverlayTriggerRanges(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): Map<AiOverlayTrigger, { min: number; max: number } | null> {
  const ranges = new Map<AiOverlayTrigger, { min: number; max: number } | null>()
  for (const part of str(inputs?.['triggers']).split(',')) {
    const [id, range] = part.trim().split(':')
    if (!(AI_OVERLAY_TRIGGERS as readonly string[]).includes(id)) continue
    const [min, max] = String(range ?? '').split('-').map(Number)
    ranges.set(
      id as AiOverlayTrigger,
      Number.isFinite(min) && Number.isFinite(max) && max >= min ? { min, max } : null,
    )
  }
  return ranges
}

/** The zone's trigger catalog as the job's `triggers` input. */
export function aiOverlayTriggersInput(rules: readonly AiOverlayTriggerRule[]): string {
  return rules
    .filter((rule) => (AI_OVERLAY_TRIGGERS as readonly string[]).includes(rule.id))
    .map((rule) => (rule.unit ? `${rule.id}:${rule.min}-${rule.max}` : rule.id))
    .join(',')
}

/** The zone's limits as the job's `limit_<field>` inputs. */
export function aiOverlayLimitInputs(
  limits: Readonly<Partial<Record<AiOverlayCopyField, number>>>,
): Record<string, number> {
  const inputs: Record<string, number> = {}
  for (const field of Object.keys(AI_OVERLAY_COPY_CEILINGS) as AiOverlayCopyField[]) {
    const limit = limits[field]
    if (typeof limit === 'number' && limit > 0) inputs[`limit_${field}`] = limit
  }
  return inputs
}

/** One field on one line, or a body with its paragraphs, cut to its limit. */
function fit(value: string, limit: number, multiline = false): string {
  const folded = multiline
    ? value.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    : value.replace(/\s+/g, ' ')
  return folded.trim().slice(0, limit).trim()
}

/** Markup, a fence or a link: things a bar or a popup shows as typed. */
const MARKUP = /<\/?[a-z][^>]*>|```|\[[^\]]*\]\([^)]*\)|https?:\/\//i

export interface AiOverlayCopyCheck {
  proposal: AiOverlayCopyProposal
  /** What was cut or dropped, for the log. */
  findings: string[]
}

/**
 * An answer held to the overlay's rules, or `null` when nothing usable is
 * left: a bar with no text, a popup with no body, or copy carrying markup or
 * a link. A field over its limit is cut rather than refused, and a trigger
 * outside the caller's catalog is dropped, with each recorded as a finding.
 */
export function checkAiOverlayCopy(
  answer: AiOverlayCopyAnswer | null,
  kind: AiOverlayKind,
  limits: Readonly<Record<AiOverlayCopyField, number>>,
  triggers: ReadonlyMap<AiOverlayTrigger, { min: number; max: number } | null>,
): AiOverlayCopyCheck | null {
  if (!answer) return null
  const findings: string[] = []
  const field = (name: AiOverlayCopyField, multiline = false): string => {
    const raw = answer[name]
    const value = fit(raw, limits[name], multiline)
    if (fit(raw, Number.MAX_SAFE_INTEGER, multiline).length > limits[name]) {
      findings.push(`${name} cut to ${limits[name]} characters`)
    }
    return value
  }
  const proposal: AiOverlayCopyProposal = {
    kind,
    name: field('name'),
    text: kind === 'bar' ? field('text') : '',
    headline: kind === 'popup' ? field('headline') : '',
    body: kind === 'popup' ? field('body', true) : '',
    ctaLabel: kind === 'popup' ? field('ctaLabel') : '',
    trigger: null,
    triggerValue: null,
    rationale: fit(answer.rationale, 200),
  }
  if ([proposal.text, proposal.headline, proposal.body, proposal.ctaLabel].some((value) => MARKUP.test(value))) {
    return null
  }
  if (kind === 'bar' ? !proposal.text : !proposal.body) return null
  if (kind === 'popup' && answer.trigger) {
    const trigger = answer.trigger as AiOverlayTrigger
    if (triggers.has(trigger)) {
      proposal.trigger = trigger
      const range = triggers.get(trigger) ?? null
      if (range && answer.triggerValue !== null && Number.isFinite(answer.triggerValue)) {
        proposal.triggerValue = Math.min(range.max, Math.max(range.min, Math.round(answer.triggerValue)))
      }
    } else if (answer.trigger !== 'none') {
      findings.push(`trigger "${answer.trigger}" is not one the site offers`)
    }
  }
  return { proposal, findings }
}

/** The proposal a finished overlay job's output carries, or `null` for anything else. */
export function readAiOverlayCopy(proposal: Record<string, unknown> | null | undefined): AiOverlayCopyProposal | null {
  if (!proposal || proposal['task'] !== AI_OVERLAY_COPY_TASK) return null
  const kind = proposal['kind']
  if (kind !== 'bar' && kind !== 'popup') return null
  const trigger = proposal['trigger']
  const value = proposal['triggerValue']
  return {
    kind,
    name: str(proposal['name']),
    text: str(proposal['text']),
    headline: str(proposal['headline']),
    body: str(proposal['body']),
    ctaLabel: str(proposal['ctaLabel']),
    trigger: (AI_OVERLAY_TRIGGERS as readonly unknown[]).includes(trigger) ? (trigger as AiOverlayTrigger) : null,
    triggerValue: typeof value === 'number' && Number.isFinite(value) ? value : null,
    rationale: str(proposal['rationale']),
  }
}

/** A proposal as the plain text a `text` output shows on the AI jobs page. */
export function aiOverlayCopyText(proposal: AiOverlayCopyProposal): string {
  if (proposal.kind === 'bar') return proposal.text
  return [
    proposal.headline,
    proposal.body,
    proposal.ctaLabel ? `Button: ${proposal.ctaLabel}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
