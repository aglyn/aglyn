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
 * A plugin's share of a CONSENT GROUP CHANGE (AGL-3320).
 *
 * The executor in `libs/tenant/data/admin` carries the refusals the platform
 * stores per site — the suppression list, the topic opt-outs, the pace — and
 * flips the declaration. A plugin that keeps its own per-site refusals, or
 * records keyed by a consent group's id, registers a participant here, and
 * every change runs it at three points:
 *
 *  - `carry`, BEFORE the flip: copy the plugin's refusals onto the sites the
 *    plan's carries name, so no site stops honoring an opt-out it was reading
 *    across its group. Run twice — once, and again as the catch-up.
 *  - `rehome`, AFTER the flip: move the records keyed by the plan's holder
 *    flows. After, because every writer keys by the declaration in force, so
 *    new writes land on the final key while the move folds the old one in.
 *  - `sweep`, once the sweep delay has passed: the whole job again,
 *    idempotently, for anything a long job wrote under the old declaration.
 *
 * ## NOT ISOLATED, on purpose
 *
 * The erasure seams log a throw and go on (`plugin-person-erasure.ts`), because
 * a partial erasure is better than none. Here the opposite holds: a skipped
 * carry is a refusal nobody honors once the flip happens. So a participant's
 * throw propagates, the executor records it against the job, and the change
 * does not flip until the participant succeeds — five failures in a row mark
 * the job stalled, and it keeps retrying.
 *
 * The PREVIEW is the exception, because it decides nothing: a participant
 * whose preview throws shows `null` lines and the review step says so.
 *
 * ## The contract a `run` keeps
 *
 * Resumable and idempotent. The executor hands back the `cursor` the last
 * call returned (`null` to start), and stops calling once `done` is true. A
 * run must return before `deadlineMs`, keep every write create-if-absent or a
 * restrictive merge, and write nothing on `dryRun`. A second full run over a
 * finished change must write nothing, because the catch-up and the sweep ARE
 * second runs.
 *
 * Registered from a plugin's declarations, like the erasure seams, so the
 * participant is in place in a process that never loaded the plugin's API.
 */

import type {
  ConsentGroupChangePlan,
  ConsentGroupChangePreviewLine,
} from '../app-utils/consent-group-change'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'

/** Which point of the change a `run` is called for. */
export type ConsentGroupChangeParticipantPhase = 'carry' | 'rehome' | 'sweep'

export interface ConsentGroupChangePreviewRequest {
  orgId: string
  plan: ConsentGroupChangePlan
}

export interface ConsentGroupChangeRunRequest {
  orgId: string
  changeId: string
  plan: ConsentGroupChangePlan
  phase: ConsentGroupChangeParticipantPhase
  /** Where the previous call stopped, or `null` to start the phase. */
  cursor: string | null
  /** Return by this instant; the executor calls again from the cursor. */
  deadlineMs: number
  /** Count, write nothing. */
  dryRun: boolean
}

export interface ConsentGroupChangeRunResult {
  done: boolean
  cursor: string | null
  /** What THIS call did — the executor adds them up across calls. */
  counts: Record<string, number>
}

export interface ConsentGroupChangeParticipant {
  preview(request: ConsentGroupChangePreviewRequest): Promise<ConsentGroupChangePreviewLine[]>
  run(request: ConsentGroupChangeRunRequest): Promise<ConsentGroupChangeRunResult>
  /**
   * The participant's clause of the "Finished a consent group change" line,
   * from its counts totaled over the whole change, or `null` to add nothing.
   */
  summarize?(counts: Readonly<Record<string, number>>): string | null
}

interface Registration {
  pluginId: string
  participant: ConsentGroupChangeParticipant
}

const registrations: Registration[] = []

/**
 * Registers a plugin's participant. Owner = the loader's marker inside a
 * register fn, else `options.pluginId`; a participant with neither throws.
 * One per plugin: registering again replaces it in place, so a module
 * evaluated twice does not run twice.
 */
export function registerPluginConsentGroupParticipant(
  participant: ConsentGroupChangeParticipant,
  options?: { pluginId?: string },
): void {
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(
      'a consent group participant was registered with no owner: pass ' +
        '{ pluginId } when registering outside a plugin register fn',
    )
  }
  const index = registrations.findIndex((entry) => entry.pluginId === pluginId)
  if (index >= 0) registrations[index] = { pluginId, participant }
  else registrations.push({ pluginId, participant })
}

/** Every participant, in registration order — the order they run in. */
export function listPluginConsentGroupParticipants(): Array<{
  pluginId: string
  participant: ConsentGroupChangeParticipant
}> {
  return registrations.map(({ pluginId, participant }) => ({ pluginId, participant }))
}

/**
 * Every participant's preview, by plugin id, in registration order: its
 * lines, or `null` for one that threw. Never throws.
 */
export async function previewPluginConsentGroupChange(
  request: ConsentGroupChangePreviewRequest,
): Promise<Array<{ pluginId: string; lines: ConsentGroupChangePreviewLine[] | null }>> {
  const out: Array<{ pluginId: string; lines: ConsentGroupChangePreviewLine[] | null }> = []
  for (const { pluginId, participant } of [...registrations]) {
    try {
      out.push({ pluginId, lines: await participant.preview(request) })
    } catch (error) {
      out.push({ pluginId, lines: null })
      console.error(
        `[plugins] ${pluginId} failed to preview a consent group change in org ${request.orgId}`,
        error,
      )
    }
  }
  return out
}

/** Test seam: forget every participant. */
export function resetPluginConsentGroupParticipantsForTests(): void {
  registrations.length = 0
}
