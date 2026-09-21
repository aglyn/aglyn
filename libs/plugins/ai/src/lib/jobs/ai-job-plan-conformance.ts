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

import type { AiBuildPlanScreen, AiBuildPlanSection } from '../model/ai-build-plan'
import type { AiJobPlan } from '../model/ai-jobs.types'
import {
  AI_LAYOUT_REGION_NAMES,
  aiBindsRepeatedItems,
  aiLayoutRegionOf,
  aiRepeatedItemCount,
  aiTreeLayoutRegions,
  walkTree,
  type AiDoctrineNode,
  type AiDoctrineTree,
  type AiDoctrineViolation,
  type AiLayoutRegion,
} from '../runtime/ai-doctrine-validators'
import { aiBindingTokensIn, type AiTemplateSubjectDefinition } from '../model/ai-template-subjects'
import { aiPlanCreation } from './ai-job-generation'

/**
 * The build held to the plan the member confirmed (AGL-3024).
 *
 * The doctrine validators ask whether an artifact was built the way a careful
 * author builds one. They do not ask whether it is the artifact the plan
 * PROMISED, and a build that quietly delivers less still reports `Done` —
 * which is the dangerous part, because `Done` is what tells the customer they
 * have no reason to re-read it. Measured on beta.139: a plan promising four
 * practice areas built three cards; a plan promising a layout with a sidebar
 * built a verbatim copy of the base layout, the word "sidebar" nowhere in it.
 *
 * ── Structured commitments, never prose ──────────────────────────────────
 *
 * A plan's rationale (`why`) is prose a model wrote, and matching English
 * against a node tree after the fact would be a second guess dressed as a
 * check. Only the plan's STRUCTURE is read here, and only the two shapes that
 * are already numbers or names in `ai-build-plan.ts`:
 *
 *  - **A count**: `screens[].sections[].items`, which the plan already
 *    carries and the section prompt already states as "It shows N items".
 *    Nothing read it back.
 *  - **A region**: `create[].fields` on a layout, which is that kind's own
 *    field for the regions it has (`AI_LAYOUT_REGIONS`). A layout has no
 *    properties, so the planner is asked there for the one thing about a
 *    layout worth promising and worth checking — a checkable assertion the
 *    planner emits beside its prose, rather than English parsed out of it.
 *  - **A token**: `create[].fields` on a template, from the subject's own
 *    closed catalog (`AI_TEMPLATE_SUBJECT_DEFINITIONS[subject].tokens`), which
 *    is the template's analogue of a layout's regions — the one thing about a
 *    template that differs per record, and therefore the one worth promising.
 *
 * The third was added after a measured miss (AGL-3024, 2026-09-21). A brief
 * asked for an attorney's bar admissions; the plan's `why` promised "a
 * bar-admissions block"; the built template had no such thing and reported
 * `Done`. Nothing had gone wrong in the build: `author` has six tokens —
 * name, bio, image, jobTitle, worksFor, url — and no catalog anywhere fills a
 * bar admission, so the promise was unkeepable when it was written. Read as a
 * token list the promise cannot even be MADE, which is a better place to stop
 * than after the document is paid for.
 *
 * ── It fails closed ──────────────────────────────────────────────────────
 *
 * Every function here answers "the plan is kept" only when it could look. A
 * layout the step never read is not a layout whose regions are present; the
 * layout door turns that into a stop for review rather than a `Done`. What it
 * will not do is guess: a count it cannot settle from the document — items a
 * collection fills at render — is not reported as short.
 *
 * The findings are ordinary `AiDoctrineViolation`s, so they ride the
 * mechanism every other rule rides: `runValidatedGeneration` re-asks the
 * model once with them, and a second answer that still breaks one stops the
 * job for a person with `aiDoctrineReview`. They carry `rule: null` on
 * purpose. The seventeen rules are how a document is BUILT; keeping the plan
 * is not one of them, and numbering these as rule 7 would print "Rule 7
 * (Reuse before creating)" over a finding about a count.
 */

/** A count below this is not a repeat, so a plan promising one promises nothing to count. */
export const AI_PLAN_ITEMS_MIN = 2

/**
 * The regions the confirmed plan's layout creation names, and the words it
 * named that no region answers to. A plan with no layout creation names none.
 */
export function aiPlannedLayoutRegions(plan: AiJobPlan | null): {
  regions: AiLayoutRegion[]
  unreadable: string[]
} {
  const regions = new Set<AiLayoutRegion>()
  const unreadable: string[] = []
  for (const field of aiPlanCreation(plan, 'layout')?.fields ?? []) {
    const region = aiLayoutRegionOf(field)
    if (region) regions.add(region)
    else unreadable.push(field)
  }
  return { regions: [...regions], unreadable }
}

/**
 * The plan's promised regions against a built layout: one finding naming
 * every region the plan lists that the layout does not carry, and one naming
 * a word the vocabulary could not read, which is a promise this check cannot
 * settle either way.
 */
export function aiPlanRegionViolations(
  plan: AiJobPlan | null,
  tree: AiDoctrineTree,
): AiDoctrineViolation[] {
  const { regions, unreadable } = aiPlannedLayoutRegions(plan)
  const built = aiTreeLayoutRegions(tree)
  const violations: AiDoctrineViolation[] = []
  const missing = regions.filter((region) => !built.has(region))
  if (missing.length) {
    const one = missing.length === 1
    violations.push({
      rule: null,
      code: 'plan-region-missing',
      message: `The confirmed plan gives this layout ${listed(
        missing,
      )}, and the layout has no ${one ? 'such region' : 'such regions'}. Build ${
        one ? 'it' : 'each of them'
      }: a sidebar is a Section whose element is aside, a header a Section whose element is header or an App Bar, a nav a Section whose element is nav, a footer a Section whose element is footer, and the main region the Layout Slot.`,
    })
  }
  if (unreadable.length) {
    violations.push({
      rule: null,
      code: 'plan-region-unreadable',
      message: `The confirmed plan gives this layout ${listed(
        unreadable,
      )}, which is no region this platform builds, so nothing can check the layout has ${
        unreadable.length === 1 ? 'it' : 'them'
      }. A layout's regions are ${AI_LAYOUT_REGION_NAMES.join(', ')}.`,
    })
  }
  return violations
}

/**
 * The plan's promised item count against a built section. Silent where there
 * is nothing to settle: a section promising fewer than `AI_PLAN_ITEMS_MIN`
 * promises no repeat, and one whose items a collection fills draws them from
 * data at render, where the document cannot be counted and rule 8 asked for
 * exactly that. Silent, too, when the section shows MORE than it promised:
 * the count is read generously (`aiRepeatedItemCount`), so a number above the
 * promise is as likely to be the reading as the section.
 */
export function aiPlanItemCountViolations(
  section: Pick<AiBuildPlanSection, 'name' | 'items'>,
  tree: AiDoctrineTree,
): AiDoctrineViolation[] {
  if (section.items < AI_PLAN_ITEMS_MIN) return []
  if (aiBindsRepeatedItems(tree)) return []
  const shown = aiRepeatedItemCount(tree)
  if (shown >= section.items) return []
  return [
    {
      rule: null,
      code: 'plan-items-short',
      message: `The confirmed plan says the "${section.name}" section shows ${section.items} items, and this section shows ${shown}. Build all ${section.items}.`,
    },
  ]
}

/**
 * The counts the plan's sections promised against a page a COPY produced
 * (AGL-3024), read over the whole page because a copy has no section of the
 * plan's in it to read one at a time.
 *
 * A copied screen carries the SOURCE's nodes under the source's ids: nothing
 * maps "the practice areas section" onto a subtree of it, so the per-section
 * reading `aiPlanItemCountViolations` does at a generation pass has nothing
 * to stand on here. What can still be settled is the weaker claim, and it is
 * the one that catches the measured shape: a plan promising a section of four
 * against a copy in which NO group of four repeated things exists anywhere is
 * a promise the copy did not keep, whichever section was meant to keep it.
 *
 * Weaker on purpose, and so quieter: a copy holding six of something else
 * reads as six and is let through. A screen carries no app bar and no footer
 * — those are its layout's — so what is counted is the page's own content.
 */
export function aiPlanCopiedPageViolations(
  screen: Pick<AiBuildPlanScreen, 'sections'>,
  tree: AiDoctrineTree,
): AiDoctrineViolation[] {
  const promised = screen.sections
    .filter((section) => section.items >= AI_PLAN_ITEMS_MIN)
    .sort((a, b) => b.items - a.items)[0]
  if (!promised) return []
  if (aiBindsRepeatedItems(tree)) return []
  const shown = aiRepeatedItemCount(tree)
  if (shown >= promised.items) return []
  return [
    {
      rule: null,
      code: 'plan-items-short',
      message: `The confirmed plan says the "${promised.name}" section shows ${promised.items} items, and this page is a copy that shows at most ${shown} of anything. Build the ${promised.items}.`,
    },
  ]
}

/** A token as the catalog spells it, for matching what a plan wrote against it. */
function tokenKey(value: string): string {
  return value.replace(/[{}\s]/g, '').toLowerCase()
}

/** Every binding token a built tree holds, spelled as the catalog spells them. */
export function aiTreeBoundTokens(tree: AiDoctrineTree): Set<string> {
  const bound = new Set<string>()
  const nodes = tree.nodes as unknown as Record<string, AiDoctrineNode>
  const strings = (value: unknown, out: string[]): string[] => {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) for (const inner of value) strings(inner, out)
    else if (value && typeof value === 'object') {
      for (const inner of Object.values(value as Record<string, unknown>)) strings(inner, out)
    }
    return out
  }
  for (const { node } of walkTree({ rootId: tree.rootId, nodes })) {
    for (const token of strings(node.props, []).flatMap(aiBindingTokensIn)) {
      bound.add(tokenKey(token))
    }
  }
  return bound
}

/**
 * The subject tokens the confirmed plan's template creation names, and the
 * words it named that the subject's catalog does not answer to. A plan with
 * no template creation names none.
 */
export function aiPlannedTemplateTokens(
  plan: AiJobPlan | null,
  definition: AiTemplateSubjectDefinition,
): { tokens: string[]; unreadable: string[] } {
  const catalog = new Map(definition.tokens.map((entry) => [tokenKey(entry.token), entry.token]))
  const tokens = new Set<string>()
  const unreadable: string[] = []
  for (const field of aiPlanCreation(plan, 'template')?.fields ?? []) {
    const token = catalog.get(tokenKey(field))
    if (token) tokens.add(token)
    else unreadable.push(field)
  }
  return { tokens: [...tokens], unreadable }
}

/**
 * The plan's promised tokens against a built template: one finding naming
 * every token the plan lists that the template does not bind, and one naming
 * a word the subject's catalog could not read — which is a promise this check
 * cannot settle either way, and, more usefully, one the page could never have
 * filled.
 */
export function aiPlanTemplateTokenViolations(
  plan: AiJobPlan | null,
  definition: AiTemplateSubjectDefinition,
  tree: AiDoctrineTree,
): AiDoctrineViolation[] {
  const { tokens, unreadable } = aiPlannedTemplateTokens(plan, definition)
  const violations: AiDoctrineViolation[] = []
  if (tokens.length) {
    const bound = aiTreeBoundTokens(tree)
    const missing = tokens.filter((token) => !bound.has(tokenKey(token)))
    if (missing.length) {
      const one = missing.length === 1
      violations.push({
        rule: null,
        code: 'plan-token-missing',
        message: `The confirmed plan says this template shows ${listed(missing)}, and it binds ${
          one ? 'no such token' : 'no such tokens'
        }. Put ${one ? 'it' : 'each of them'} on the page, so every ${
          definition.noun.replace(/^an? /, '')
        } shows their own.`,
      })
    }
  }
  if (unreadable.length) {
    violations.push({
      rule: null,
      code: 'plan-token-unreadable',
      message: `The confirmed plan says this template shows ${listed(
        unreadable,
      )}, which ${definition.noun}'s page does not fill, so nothing can check the template shows ${
        unreadable.length === 1 ? 'it' : 'them'
      }. Promise only what the page fills: ${definition.tokens
        .map((entry) => entry.token)
        .join(', ')}.`,
    })
  }
  return violations
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function listed(values: readonly string[]): string {
  const quoted = values.map((value) => `"${value}"`)
  return quoted.length <= 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}
