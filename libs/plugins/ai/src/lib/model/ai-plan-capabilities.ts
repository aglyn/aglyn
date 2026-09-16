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
  AI_BUILD_PLAN_CREATE_KINDS,
  AI_BUILD_PLAN_CREATION_NOUNS,
  type AiBuildPlan,
  type AiBuildPlanCreateKind,
} from './ai-build-plan'

/**
 * What a plan may create on one site (AGL-3030): the workspace's plan and the
 * site's counts against its limits, narrowed to what the job itself builds.
 *
 * A plan that names a creation nothing can make is a dead end the member pays
 * for twice: once for the plan, and again for the plan they describe after
 * being told to make the creation by hand — which, on a workspace whose plan
 * does not include it, they cannot. So the plan step is TOLD what may be
 * created before it answers, and the plan rules refuse a creation outside it
 * with the one re-ask every other rule gets.
 *
 * ── Where the doctrine builds inline ─────────────────────────────────────
 *
 * The building doctrine makes a repeat a reusable component and a form a
 * saved form placed by id. A workspace whose plan keeps no reusable
 * components can do neither: the create route refuses a component and a
 * saved form on that entitlement. There, and only there, the doctrine builds
 * inline instead — a form is a Form element the page carries with its fields
 * inside it, which the site's submit route collects like any other, and a
 * repeated item is drawn in its own section. `reusableComponents` is the one
 * flag every validator reads for that.
 *
 * ── Kept out of the cached prefix ────────────────────────────────────────
 *
 * The capabilities are per workspace and per site, so they ride the plan's
 * USER turn, never a system block: the doctrine's cached prefix stays one
 * entry for the platform. The doctrine states the rule once — create only
 * what the request says may be created, and build inline where it says the
 * workspace keeps no reusable components — and the request states the facts.
 *
 * This module imports nothing at runtime beyond the plan's own model, so the
 * validators, the plan step, the doors and their specs read one vocabulary.
 * What a workspace's plan and counts come to is read by
 * `readAiPlanCapabilities` in `jobs/ai-job-drafts.ts`, beside the band
 * arithmetic the create route and the draft writer share.
 */

/** One creation kind, as a job on this site may make it or not. */
export interface AiPlanCreation {
  allowed: boolean
  /** How many more the site may hold; `null` when the plan counts none. */
  left: number | null
  /**
   * Why not, as a clause a sentence completes: "this workspace's plan does
   * not include reusable components". `null` when allowed.
   */
  reason: string | null
}

export interface AiPlanCapabilities {
  /**
   * Whether the workspace keeps reusable components and saved forms. Where
   * it does not, the doctrine builds inline: a form is a Form element holding
   * its fields, and a repeated item is drawn in its own section.
   */
  reusableComponents: boolean
  /** Every creation kind a plan may name, and whether this job may make one here. */
  create: Readonly<Record<AiBuildPlanCreateKind, AiPlanCreation>>
}

/** What a job of one kind builds from its own plan, where it builds only some creations. */
export interface AiPlanJobScope {
  /** The job as a refusal names it: "a page job". */
  noun: string
  /** The creation kinds the job builds itself; any other is refused before the plan is kept. */
  creates: readonly AiBuildPlanCreateKind[]
}

const ALLOWED: AiPlanCreation = { allowed: true, left: null, reason: null }

/**
 * Capabilities that restrict nothing: what a plan is held to when no
 * workspace was read — an org-level job, an eval, a spec about something
 * else. The doctrine applies whole.
 */
export function aiUnrestrictedPlanCapabilities(): AiPlanCapabilities {
  return {
    reusableComponents: true,
    create: Object.fromEntries(
      AI_BUILD_PLAN_CREATE_KINDS.map((kind) => [kind, ALLOWED]),
    ) as Record<AiBuildPlanCreateKind, AiPlanCreation>,
  }
}

/**
 * The workspace's capabilities narrowed to what a job of one kind builds.
 * A creation the workspace itself cannot make keeps the workspace's reason,
 * which is the one a member can act on; one the job does not build says so.
 */
export function aiPlanCapabilitiesForJob(
  capabilities: AiPlanCapabilities,
  scope: AiPlanJobScope | null | undefined,
): AiPlanCapabilities {
  if (!scope) return capabilities
  const create = { ...capabilities.create }
  for (const kind of AI_BUILD_PLAN_CREATE_KINDS) {
    if (!create[kind].allowed || scope.creates.includes(kind)) continue
    create[kind] = { allowed: false, left: null, reason: `${scope.noun} does not build one` }
  }
  return { ...capabilities, create }
}

/** "a layout", "an email design": a creation kind with its article. */
export function aiCreationNoun(kind: AiBuildPlanCreateKind): string {
  const noun = AI_BUILD_PLAN_CREATION_NOUNS[kind].noun
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`
}

/** The sentence a request states when the workspace keeps no reusable components. */
export const AI_PLAN_INLINE_SENTENCE =
  'This workspace keeps no reusable components or saved forms: draw a repeated item in its own section, and a form as a Form element holding its Form Fields.'

/**
 * What the plan step's user turn says the job may create here: one line a
 * kind, and the inline sentence where the workspace keeps no reusable
 * components. Per workspace and per site, so it is never a system block.
 */
export function aiPlanCapabilityLines(capabilities: AiPlanCapabilities): string[] {
  const lines = ['What this job may create on this site:']
  for (const kind of AI_BUILD_PLAN_CREATE_KINDS) {
    const entry = capabilities.create[kind]
    const noun = AI_BUILD_PLAN_CREATION_NOUNS[kind].noun
    if (entry.allowed) {
      lines.push(`- ${noun}: yes${entry.left === null ? '' : `, ${entry.left} more`}`)
    } else {
      lines.push(`- ${noun}: no, because ${entry.reason ?? 'it cannot be made here'}`)
    }
  }
  if (!capabilities.reusableComponents) lines.push(AI_PLAN_INLINE_SENTENCE)
  return lines
}

/** What to do instead of a creation the job may not make, for the re-ask and the review. */
function insteadOf(kind: AiBuildPlanCreateKind, capabilities: AiPlanCapabilities): string {
  switch (kind) {
    case 'component':
      return capabilities.reusableComponents
        ? 'Place a component the site already has.'
        : 'Draw the item in its own section instead.'
    case 'form':
      return capabilities.reusableComponents
        ? 'Place a form the site already has.'
        : 'Draw the form on the page instead, as a Form element holding its Form Fields.'
    case 'layout':
      return 'Put the page in a layout the site already has.'
    case 'template':
      return 'Build the page without a template.'
    case 'theme-change':
      return "Use the colors the theme already has."
    case 'dataset':
      return 'Bind a dataset or collection the site already has, or keep the list short enough to write out.'
    case 'email':
      return 'Leave the email out of this job.'
  }
}

/** One creation a plan names that this job may not make here. */
export interface AiPlanUncreatable {
  kind: AiBuildPlanCreateKind
  name: string
  /** The plan path of the creation: `create[2]`. */
  path: string
  /** Why not, as a clause: "this site has room for 1 more". */
  reason: string
  /** One customer-safe sentence: what was refused, why, and what to do instead. */
  message: string
}

/** The creations a plan names that the capabilities refuse, in plan order. */
export function aiPlanUncreatable(
  plan: Pick<AiBuildPlan, 'create'>,
  capabilities: AiPlanCapabilities,
): AiPlanUncreatable[] {
  const refused: AiPlanUncreatable[] = []
  const counted = new Map<AiBuildPlanCreateKind, number>()
  plan.create.forEach((entry, index) => {
    const capability = capabilities.create[entry.kind]
    const nth = (counted.get(entry.kind) ?? 0) + 1
    counted.set(entry.kind, nth)
    // A kind the site may make only so many more of refuses the ones past
    // that count, not the first of them.
    const overCount = capability.allowed && capability.left !== null && nth > capability.left
    if (capability.allowed && !overCount) return
    const reason = overCount
      ? `this site has room for ${capability.left} more`
      : (capability.reason ?? 'it cannot be made here')
    refused.push({
      kind: entry.kind,
      name: entry.name,
      path: `create[${index}]`,
      reason,
      message: `The plan creates ${aiCreationNoun(entry.kind)} named "${entry.name}", and ${reason}. ${insteadOf(entry.kind, capabilities)}`,
    })
  })
  return refused
}
