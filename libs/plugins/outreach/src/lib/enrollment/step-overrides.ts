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
 * WHAT A REQUEST MAY STORE AS ONE PERSON'S COPY OF A STEP (AGL-3324).
 *
 * The enroll route, the preview route and the curate-save route all take
 * the console's `OutreachStepOverrideRequest`, and all three read it the
 * same way: a step index that names an EMAIL step of the sequence, a body,
 * a subject only where the email starts a thread, and the validator's
 * verdict on each. A request that names a task step, a step the sequence
 * does not have, or the same step twice is refused whole — nothing here is
 * guessed, because what is read here is what gets sent.
 *
 * The prompt and the model ride through untouched, for the audit log; who
 * confirmed and when are the route's to stamp, never the request's to
 * claim.
 */

import { CRM_EMAIL_BODY_MAX } from '@aglyn/aglyn/app-utils/crm'
import {
  hasOutreachValidationErrors,
  isInThreadEmailStep,
  validateOutreachCuratedStep,
  type OutreachValidationIssue,
} from '../engine/sequence-validation'
import type { OutreachStepOverrideRequest } from '../model/outreach-api'
import {
  OUTREACH_STEP_OVERRIDE_SOURCES,
  type OutreachSequenceStep,
  type OutreachStepOverride,
  type OutreachStepOverrides,
} from '../model/outreach.types'

/** The most of a prompt an override keeps for the audit log. */
export const OUTREACH_OVERRIDE_PROMPT_MAX = 12_000

export interface OutreachStepOverrideRead {
  /** The overrides as they would be stored, keyed by step index, stamped by the caller. */
  overrides: OutreachStepOverrides
  /** Every issue, each path prefixed `stepOverrides.<index>`. */
  issues: OutreachValidationIssue[]
  /** Why the request could not be read at all, in a sentence; `null` when it could. */
  refusal: string | null
}

/**
 * One override request as a stored override, before the caller's stamp.
 * `null` when the request is not one.
 */
export function readOutreachStepOverrideRequest(
  raw: unknown,
  steps: readonly OutreachSequenceStep[],
): { stepIndex: number; override: Omit<OutreachStepOverride, 'draftedAtMs' | 'draftedByUid'>; issues: OutreachValidationIssue[] } | { refusal: string } {
  if (!raw || typeof raw !== 'object') return { refusal: 'A curated step is an object.' }
  const entry = raw as Record<string, unknown>
  const stepIndex = Number(entry['stepIndex'])
  const step = Number.isInteger(stepIndex) && stepIndex >= 0 ? steps[stepIndex] : undefined
  if (step?.kind !== 'email') {
    return { refusal: 'A curated step names one of the sequence’s email steps.' }
  }
  const startsThread = !isInThreadEmailStep(steps, stepIndex)
  const body = typeof entry['body'] === 'string' ? entry['body'].replace(/\r\n?/g, '\n') : ''
  const subject = startsThread && typeof entry['subject'] === 'string' ? entry['subject'] : undefined
  const source = entry['source']
  if (!(OUTREACH_STEP_OVERRIDE_SOURCES as readonly unknown[]).includes(source)) {
    return { refusal: 'A curated step says who wrote it: the AI, or the member.' }
  }
  const issues = validateOutreachCuratedStep({ subject, body, startsThread }, `stepOverrides.${stepIndex}`)
  const prompt = typeof entry['prompt'] === 'string' ? entry['prompt'].slice(0, OUTREACH_OVERRIDE_PROMPT_MAX) : ''
  const model = typeof entry['model'] === 'string' ? entry['model'].trim().slice(0, 200) : ''
  return {
    stepIndex,
    issues,
    override: {
      ...(subject !== undefined ? { subject: subject.replace(/\s+/g, ' ').trim() } : {}),
      body: body.slice(0, CRM_EMAIL_BODY_MAX),
      source: source as OutreachStepOverride['source'],
      ...(source === 'ai' && entry['edited'] === true ? { edited: true } : {}),
      ...(source === 'ai' && prompt ? { prompt } : {}),
      ...(source === 'ai' && model ? { model } : {}),
    },
  }
}

/**
 * Every override a request carries, read and validated, and stamped with
 * who confirmed them and when. An empty or absent list reads as no
 * overrides and no issues.
 */
export function readOutreachStepOverrideRequests(
  raw: unknown,
  steps: readonly OutreachSequenceStep[],
  stamp: { uid: string; nowMs: number },
): OutreachStepOverrideRead {
  const list = Array.isArray(raw) ? (raw as unknown[]) : []
  const overrides: OutreachStepOverrides = {}
  const issues: OutreachValidationIssue[] = []
  for (const entry of list) {
    const read = readOutreachStepOverrideRequest(entry, steps)
    if ('refusal' in read) return { overrides: {}, issues: [], refusal: read.refusal }
    if (overrides[String(read.stepIndex)]) {
      return { overrides: {}, issues: [], refusal: 'A step is curated once per person.' }
    }
    issues.push(...read.issues)
    overrides[String(read.stepIndex)] = {
      ...read.override,
      draftedAtMs: stamp.nowMs,
      draftedByUid: stamp.uid,
    }
  }
  return { overrides, issues, refusal: null }
}

/** Whether a read carries an error that keeps its overrides from being stored. */
export function outreachStepOverridesRefused(read: OutreachStepOverrideRead): boolean {
  return read.refusal !== null || hasOutreachValidationErrors(read.issues)
}

/** The requests' shape, for a caller that builds one from stored overrides. */
export function outreachStepOverrideRequests(
  overrides: OutreachStepOverrides | null | undefined,
): OutreachStepOverrideRequest[] {
  return Object.entries(overrides ?? {})
    .map(([key, override]) => ({
      stepIndex: Number(key),
      ...(typeof override.subject === 'string' ? { subject: override.subject } : {}),
      body: override.body ?? '',
      source: override.source,
      ...(override.edited ? { edited: true } : {}),
      ...(override.prompt ? { prompt: override.prompt } : {}),
      ...(override.model ? { model: override.model } : {}),
    }))
    .sort((a, b) => a.stepIndex - b.stepIndex)
}
