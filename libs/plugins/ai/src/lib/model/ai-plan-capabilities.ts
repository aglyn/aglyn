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
 * components draws a list's repeated items in one section instead
 * (AGL-3071); `reusableComponents` is the one flag every validator reads for
 * that.
 *
 * A form is never drawn inline (AGL-3596): it is a saved form, counted
 * against the site's form allowance like one a member makes. Where the site
 * has none to place and may create none, the page places no form at all.
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
   * Whether the workspace keeps reusable components. Where it does not, a
   * list's repeated items are drawn in one section. Forms are not read off
   * it: whether one may be created is `create.form` (AGL-3596).
   */
  reusableComponents: boolean
  /** Every creation kind a plan may name, and whether this job may make one here. */
  create: Readonly<Record<AiBuildPlanCreateKind, AiPlanCreation>>
  /**
   * Whether the workspace spends the Free taste, whose monthly credits are a
   * wall (AGL-2925): a plan is then held to the sections the wall's worst
   * case pays for (AGL-3070). Absent is `false`.
   */
  freeTaste?: boolean
  /**
   * A Free workspace's site scaffold (AGL-3594): the most pages its plan may
   * build, which the plan step sets for a `site` job on the Free taste. The
   * Free wall then holds the plan to that many pages and to the sections a
   * SITE plan's worst case leaves room for. Absent for every other job.
   */
  freeSitePages?: number
  /**
   * Whether this job's pages are written in the compact layout language
   * (AGL-3660), whose compiler draws a section's repeated items itself: as
   * instances of a component the plan places there, or, with none, in their
   * compact form, a title over its text, which is smaller than a block rule 1
   * calls a repeat. A plan is then not asked for a component for a section's
   * repeated items (AGL-3616); a section two pages share still is one. The
   * plan step sets it for a `build` job. Absent is `false`.
   */
  repeatsCompiled?: boolean
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

/**
 * The sentence a request states when the workspace keeps no reusable
 * components. It says a list's repeated items go in one section (AGL-3071):
 * "a repeated item in its own section" reads just as well as a section for
 * each item, which is how a live About page's four practice areas came to be
 * planned as four sections of one item.
 */
export const AI_PLAN_INLINE_SENTENCE =
  "This workspace keeps no reusable components: draw a list's repeated items in one section."

/**
 * The sentence a build's request states (AGL-3616): its pages are written in
 * the layout language, which draws a section's repeated items itself, so the
 * plan counts them in the section's `items` and needs no component for them.
 */
export const AI_PLAN_COMPILED_REPEATS_SENTENCE =
  "A section's repeated items need no component here: count them in its items and the page draws them. A section two pages share is still one component."

/**
 * The sentence a request states when the site has no saved form and this job
 * may create none (AGL-3596): the plan places no form, rather than one drawn
 * on the page with no saved form behind it.
 */
export const AI_PLAN_NO_FORM_SENTENCE =
  'This site has no saved form and may create none: plan no form, and no section that collects answers.'

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

/**
 * Whether a plan on this site can place a saved form at all (AGL-3596): the
 * site has one, or the job may create one. Absent capabilities restrict
 * nothing, as everywhere else.
 */
export function aiPlanCanPlaceForm(
  inventory: { forms: readonly unknown[] } | null,
  capabilities: Pick<AiPlanCapabilities, 'create'> | null,
): boolean {
  if (inventory?.forms.length) return true
  return capabilities?.create.form.allowed !== false
}

/** What to do instead of a creation the job may not make, for the re-ask and the review. */
function insteadOf(kind: AiBuildPlanCreateKind, capabilities: AiPlanCapabilities): string {
  switch (kind) {
    case 'component':
      return capabilities.reusableComponents
        ? 'Place a component the site already has.'
        : "Draw a list's repeated items in one section instead."
    case 'form':
      return 'Place a form the site already has, or leave the form off the page.'
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

/**
 * Why the nth creation of a kind may not be made here, as a clause; `null`
 * when it may. A kind the site may make only so many more of refuses the ones
 * past that count, not the first of them.
 */
function refusedReason(capability: AiPlanCreation, nth: number): string | null {
  const overCount = capability.allowed && capability.left !== null && nth > capability.left
  if (capability.allowed && !overCount) return null
  return overCount
    ? `this site has room for ${capability.left} more`
    : (capability.reason ?? 'it cannot be made here')
}

/** The creations a plan names that the capabilities refuse, in plan order. */
export function aiPlanUncreatable(
  plan: Pick<AiBuildPlan, 'create'>,
  capabilities: AiPlanCapabilities,
): AiPlanUncreatable[] {
  const refused: AiPlanUncreatable[] = []
  const counted = new Map<AiBuildPlanCreateKind, number>()
  plan.create.forEach((entry, index) => {
    const nth = (counted.get(entry.kind) ?? 0) + 1
    counted.set(entry.kind, nth)
    const reason = refusedReason(capabilities.create[entry.kind], nth)
    if (reason === null) return
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

/**
 * Why the plan could not add one more creation of a kind here, and what to
 * do instead; `null` when it could (AGL-3040). Counted past the creations of
 * that kind the plan already names, as `aiPlanUncreatable` counts them, so a
 * plan told to declare a creation is never told to declare one the next
 * answer is refused for.
 */
export function aiPlanUncreatableKind(
  plan: Pick<AiBuildPlan, 'create'>,
  kind: AiBuildPlanCreateKind,
  capabilities: AiPlanCapabilities,
): { reason: string; instead: string } | null {
  const planned = plan.create.filter((entry) => entry.kind === kind).length
  const reason = refusedReason(capabilities.create[kind], planned + 1)
  return reason === null ? null : { reason, instead: insteadOf(kind, capabilities) }
}
