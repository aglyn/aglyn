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
  AI_BUILD_PLAN_CREATION_NOUNS,
  AI_BUILD_PLAN_EMBED_HOST_NAMES,
  isAiPlanNewRef,
  type AiBuildPlanEmbed,
} from './ai-build-plan'
import { aiBuildOpNoun } from './ai-build-progress'
import { aiBuildStorePagesAdded } from './ai-build-store-pages'
import type { AiJobPlanSummary } from './ai-jobs.types'

/**
 * A JOB'S PLAN AS THE LINES A PERSON READS BEFORE CONFIRMING IT (AGL-2935):
 * what it reuses from the site, what it creates and why, the pages it builds,
 * the items, the players it embeds, the store pages the platform adds, and
 * what the request asked for that a build leaves out (AGL-4087). The
 * console's plan card draws these, and the native apps' follow view sends them
 * (AGL-3854), so both say the same sentences.
 */

/** One line of a plan. */
export interface AiJobPlanLine {
  /** Stable within one plan, for a list's key. */
  key: string
  text: string
  /** Added by the platform rather than the model (a store's own pages, AGL-3676): it uses no AI credits. */
  platformAdded?: boolean
}

/** A reference as a person reads it: the record's name, or what the plan creates. */
export function aiPlanRefName(plan: Pick<AiJobPlanSummary, 'labels'> | null, ref: string | null): string {
  if (!ref) return ''
  return isAiPlanNewRef(ref) ? ref.slice('new:'.length) : (plan?.labels[ref] ?? ref)
}

/**
 * A third-party player the plan lists, with what it costs the page, read
 * before the member confirms it (rule 16, AGL-3433). The cost is the
 * platform's sentence, never the model's: the player is framed lazily, so its
 * host's code loads when a visitor reaches it, whether or not they press play.
 */
export function aiPlanEmbedLine(
  embed: AiBuildPlanEmbed,
  named: (ref: string) => string,
): string {
  const host = AI_BUILD_PLAN_EMBED_HOST_NAMES[embed.host]
  const where = isAiPlanNewRef(embed.where) ? `the component ${named(embed.where)}` : embed.where
  const link = embed.url ? ` playing ${embed.url}` : ', its link left for you to paste'
  return `Embeds a ${host} player on ${where}${link}, as you asked (“${embed.asked}”). It loads ${host}’s own code when a visitor reaches it, whether or not they press play.`
}

/** The plan's heading: whether it is still a proposal. */
export function aiJobPlanHeading(plan: Pick<AiJobPlanSummary, 'status'>): string {
  return plan.status === 'confirmed' ? 'Confirmed plan' : 'Proposed plan'
}

/** Every line of a plan, in the order the plan card lists them. */
export function aiJobPlanLines(plan: AiJobPlanSummary): AiJobPlanLine[] {
  const named = (ref: string | null) => aiPlanRefName(plan, ref)
  return [
    ...plan.reuse.map((entry, index) => ({
      key: `reuse-${index}`,
      text: `Reuses the ${entry.kind === 'screen' ? 'page' : entry.kind} ${named(entry.id)} — ${entry.purpose}`,
    })),
    ...plan.create.map((entry, index) => ({
      key: `create-${index}`,
      text:
        `Creates the ${AI_BUILD_PLAN_CREATION_NOUNS[entry.kind].noun} ${entry.name}` +
        `${entry.duplicateOf ? `, from a copy of ${named(entry.duplicateOf)}` : ''} — ${entry.why}`,
    })),
    ...plan.screens.map((screen, index) => ({
      key: `screen-${index}`,
      text:
        (screen.record
          ? `Builds the record template ${screen.title}, a page per record of ${named(screen.record.dataset)} at /${screen.record.base}/…`
          : `Builds the page ${screen.title} at ${screen.slug}`) +
        (screen.duplicateOf ? `, from a copy of ${named(screen.duplicateOf)}` : '') +
        (screen.layout ? ` in ${named(screen.layout)}` : '') +
        (screen.sections.length ? `: ${screen.sections.map((section) => section.name).join(', ')}` : ''),
    })),
    ...(plan.items ?? []).map((item) => ({
      key: `item-${item.slot}`,
      text: `Makes the ${aiBuildOpNoun(item.op).toLowerCase()} ${item.name}${item.why ? ` — ${item.why}` : ''}`,
    })),
    ...(plan.embeds ?? []).map((embed, index) => ({
      key: `embed-${index}`,
      text: aiPlanEmbedLine(embed, named),
    })),
    ...aiBuildStorePagesAdded(plan).map((page) => ({
      key: `store-${page.key}`,
      text: `Adds the page ${page.title} at ${page.href} — added for your store automatically, uses no AI credits`,
      platformAdded: true,
    })),
    // Read before Confirm, so nothing asked for is dropped without a word (AGL-4087).
    ...(plan.leftOut ?? []).map((entry, index) => ({
      key: `left-out-${index}`,
      text: `Leaves out ${entry.asked}${entry.why ? ` — ${entry.why}` : ''}`,
    })),
  ]
}
