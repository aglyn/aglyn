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

import type { BusinessProfileValues } from '@aglyn/aglyn/app-utils/business-profile'
import type { AiJob } from '../model/ai-jobs.types'
import { prefillAiBusinessProfile } from '../runtime/site-context'
import type { AiJobTransitionListener } from './ai-jobs'

/**
 * A site job fills in the site's business profile (AGL-3661), so the next job
 * — and the owner, on Setup → Business profile — starts from what the guided
 * start was told rather than from nothing.
 *
 * Two sources, each recorded as itself:
 * - `start`: the answers the owner gave the guided start — what the business
 *   is, who it is for, its city. Their words, given in another place.
 * - `ai`: what the plan wrote for the home page's search description, used
 *   only where the start said nothing about what the business does.
 *
 * Neither ever replaces what the owner typed into the profile; the merge in
 * `@aglyn/aglyn/app-utils/business-profile` decides that, not this file.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** "a local dog groomer" reads as a line once its first letter is a capital. */
const sentence = (value: string): string => (value ? value[0].toUpperCase() + value.slice(1) : value)

/** The guided start's answers, as profile values; `null` when it gave none. */
export function aiBusinessProfileStartValues(job: Pick<AiJob, 'kind' | 'inputs'>): BusinessProfileValues | null {
  if (job.kind !== 'site') return null
  const inputs = job.inputs ?? {}
  const values: BusinessProfileValues = {}
  const businessType = text(inputs['businessType'])
  const audience = text(inputs['audience'])
  const city = text(inputs['city'])
  if (businessType) values.whatYouDo = sentence(businessType)
  if (audience) values.audience = audience
  if (city) values.serviceArea = city
  return Object.keys(values).length ? values : null
}

/** The plan's home page description, as a line about the business; `null` when it has none. */
export function aiBusinessProfilePlanValues(job: Pick<AiJob, 'kind' | 'plan'>): BusinessProfileValues | null {
  if (job.kind !== 'site') return null
  const screens = job.plan?.screens ?? []
  const home = screens.find((screen) => ['', '/', 'home', 'index'].includes(text(screen.slug).replace(/^\/+|\/+$/g, '')))
  const description = text(home?.seoDescription)
  return description ? { whatYouDo: description } : null
}

/**
 * The transition listener's half that prefills (AGL-3661): on a site job's
 * plan and on its finish, the start's answers and then the plan's guess, each
 * a no-op once written. A failure is logged and never fails the job.
 */
export function aiBusinessProfilePrefiller(
  firestoreOf: () => FirebaseFirestore.Firestore,
): AiJobTransitionListener {
  return async ({ job, to }) => {
    if (job.kind !== 'site' || !job.hostId || to === 'failed') return
    const start = aiBusinessProfileStartValues(job)
    const plan = aiBusinessProfilePlanValues(job)
    if (!start && !plan) return
    try {
      const firestore = firestoreOf()
      if (start) await prefillAiBusinessProfile(firestore, job.hostId, start, 'start')
      if (plan) await prefillAiBusinessProfile(firestore, job.hostId, plan, 'ai')
    } catch (error) {
      console.warn('ai business profile prefill failed', { orgId: job.orgId, jobId: job.$id, error })
    }
  }
}
