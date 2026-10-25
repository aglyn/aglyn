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
 * The AI activity codes and the words a reader sees for them (AGL-2929, AGL-3660), apart from the registration in
 * `ai-activity-actions.ts` so the native apps read the same words from the contracts: this file imports only the
 * platform's brand name (AGL-4011).
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'

/** The action code each AI writer stores. */
export const AI_ACTIVITY_ACTIONS = {
  jobCreated: 'ai.job.created',
  jobOutput: 'ai.job.output',
  jobCanceled: 'ai.job.canceled',
  jobNeedsInput: 'ai.job.needs_input',
  editApplied: 'ai.edit.applied',
  seoApplied: 'ai.seo.applied',
  assistSection: 'ai.assist.section',
  overageHardCap: 'ai.overage.hardCap',
  overageCap: 'ai.overage.cap',
  allotmentChanged: 'ai.allotment.changed',
  permissionChanged: 'ai.permission.changed',
  addonPurchased: 'ai.addon.purchased',
  addonRemoved: 'ai.addon.removed',
} as const

export type AiActivityAction =
  (typeof AI_ACTIVITY_ACTIONS)[keyof typeof AI_ACTIVITY_ACTIONS]

/** What a person reads for each code, in the feed and the actor table. */
export const AI_ACTIVITY_ACTION_LABELS: Record<AiActivityAction, string> = {
  'ai.job.created': 'Started an AI generation',
  'ai.job.output': 'AI generated',
  'ai.job.canceled': 'Canceled an AI generation',
  'ai.job.needs_input': 'AI generation paused for input',
  'ai.edit.applied': 'Applied AI edits',
  'ai.seo.applied': 'Applied AI SEO fixes as drafts',
  'ai.assist.section': 'AI generated a section',
  'ai.overage.hardCap': 'AI stop-at-band switch',
  'ai.overage.cap': 'AI overage ceiling',
  'ai.allotment.changed': 'AI allotment changed',
  'ai.permission.changed': 'AI permission changed',
  'ai.addon.purchased': 'Added the AI add-on',
  'ai.addon.removed': 'Removed the AI add-on',
}

/**
 * The codes whose row reads as a sentence about its target (AGL-3660):
 * `{target}` is the target's noun and name, so an output row reads
 * `Created page Home with Aglyn AI` rather than `AI generated` beside a
 * Target cell that had to finish the thought.
 */
export const AI_ACTIVITY_ACTION_SENTENCES: Partial<Record<AiActivityAction, string>> = {
  'ai.job.output': `Created {target} with ${PLATFORM_BRAND_NAME} AI`,
  'ai.edit.applied': `Applied ${PLATFORM_BRAND_NAME} AI edits to {target}`,
  'ai.seo.applied': `Applied ${PLATFORM_BRAND_NAME} AI search fixes to {target}`,
  'ai.assist.section': `Added a section to {target} with ${PLATFORM_BRAND_NAME} AI`,
}
