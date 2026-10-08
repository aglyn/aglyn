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

import { isFirstPublishedRoute } from '@aglyn/aglyn/app-utils/analytics-events'
import type { AiJob } from '../model/ai-jobs.types'
import { AI_JOB_AUTO_CONFIRM_INPUT, AI_SITE_INPUT_MAX_CHARS } from '../model/ai-site-job'

/**
 * A guided site start confirms its own plan (AGL-3594).
 *
 * Every planned job stops after its plan for a person to read and confirm it.
 * For the guided start on a new site that stop read as a step nobody knew they
 * had to take: a person who had just answered "what is your site?" was shown a
 * plan to approve, and a site nobody approved was a site never built. So the
 * guided start asks for its plan to be confirmed for it, with this input, and
 * the machine confirms it the moment the plan step keeps a plan — the same
 * confirmation the resume door makes, by the job's creator, with the same
 * hold on what the plan is estimated to cost.
 *
 * Honored only where it is safe to skip the read: a `site` job, on a site
 * that has published nothing of its own yet — the site the guided start is
 * offered on. Everywhere else the create door drops it, so a page, a form or
 * a site job on an established site still waits for a person. What bounds the
 * spend is unchanged: the plan step's own checks (the Free page cap and the
 * Free wall among them), the plan's admission, and the reservation each step
 * takes.
 */

/** The job input the guided start sets. */
export { AI_JOB_AUTO_CONFIRM_INPUT }

/** Whether a job's plan is confirmed for it when the plan step keeps one. */
export function aiJobAutoConfirms(job: Pick<AiJob, 'kind' | 'inputs'>): boolean {
  return job.kind === 'site' && (job.inputs ?? {})[AI_JOB_AUTO_CONFIRM_INPUT] === true
}

/**
 * A job's inputs as the create door stores them: `autoConfirm` kept only on a
 * `site` job for a site that publishes nothing of the owner's yet, and dropped
 * from every other request, which then waits for a person as it always has.
 *
 * A `site` job that names no business is given its site's own name
 * (AGL-3596). The guided start asks what the site is for, never what it is
 * called — the person named it when they created it — and a plan, a header
 * and a footer told no name invented one. Filled here, on the click, from the
 * one read of the site the confirmation already makes, so every door that
 * creates a site job carries it and nothing is read while the guided start
 * renders. A name the request gave — an agency batch's — is kept.
 */
export async function aiJobAdmittedInputs(
  firestore: FirebaseFirestore.Firestore,
  request: { kind: string; hostId: string | null; inputs: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const askedToConfirm = AI_JOB_AUTO_CONFIRM_INPUT in request.inputs
  const unnamedSite = request.kind === 'site' && !!request.hostId && !aiSiteJobNamed(request.inputs)
  if (!askedToConfirm && !unnamedSite) return request.inputs
  const { [AI_JOB_AUTO_CONFIRM_INPUT]: asked, ...rest } = request.inputs
  const mayConfirm = request.kind === 'site' && asked === true && !!request.hostId
  if (!mayConfirm && !unnamedSite) return rest
  const host = await firestore.collection('hosts').doc(request.hostId as string).get()
  const blank =
    mayConfirm &&
    host.exists &&
    isFirstPublishedRoute(
      host.get('screens') as Record<string, unknown> | undefined,
      host.get('defaultHomeScreenId') as string | undefined,
    )
  const name = unnamedSite && host.exists ? aiSiteJobNameOf(host.get('displayName')) : ''
  // A request that asked nothing of this door, for a site with no name to give, is passed through untouched.
  if (!askedToConfirm && !name) return request.inputs
  return {
    ...rest,
    ...(name ? { businessName: name } : {}),
    ...(blank ? { [AI_JOB_AUTO_CONFIRM_INPUT]: true } : {}),
  }
}

/** Whether a site job's inputs already name the business. */
function aiSiteJobNamed(inputs: Readonly<Record<string, unknown>>): boolean {
  const name = inputs['businessName']
  return typeof name === 'string' && name.trim() !== ''
}

/** A site's display name as a site job's `businessName`: one line, within what the job admits. */
function aiSiteJobNameOf(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, AI_SITE_INPUT_MAX_CHARS).trim()
}
