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

import type { AiJobKind, AiJobPlan } from '../model/ai-jobs.types'

/**
 * What a job kind checks before a job of it runs (AGL-2909).
 *
 * The create door parses the body every kind shares — the org, the site, the
 * brief, scalar inputs — and nothing the machine knows says whether THIS kind
 * can finish: a layout needs a site to write to, a page template names the
 * collection it renders, and both write a document the site's plan counts.
 * A job that cannot finish should never start, because a planned kind spends
 * on its plan before it writes anything. So a kind registers one check, the
 * create door asks it after the gate ladder admitted the request and before
 * the job exists, and the resume door asks it again before a confirmed plan
 * runs, since an allowance free at creation may be used by now. Either way
 * a refusal hands the reservation back and spends nothing.
 *
 * The resume door also hands the check the plan being confirmed (AGL-2907),
 * so a kind that can build only some plans — a page job builds one screen
 * from what the site has — refuses the others when a member confirms them,
 * not a beat later from inside the step.
 *
 * The registry lives apart from the machine so the doors read it without the
 * generators, and a generator registers here beside its runner.
 */

export interface AiJobAdmissionContext {
  /** The Admin SDK handle the door runs on. */
  firestore: FirebaseFirestore.Firestore
  orgId: string
  hostId: string | null
  /** The job's kind-specific inputs, as the door parsed or the job stored them. */
  inputs: Readonly<Record<string, unknown>>
  /** The org document the gate ladder read; a check narrows it to the fields it reads. */
  org: object | null
  /**
   * The job's plan when the door is resuming a job that has one; absent at
   * creation, when no plan exists yet.
   */
  plan?: AiJobPlan | null
  /**
   * The member whose request spends: the creator at the create door, the
   * member confirming at the resume door. A kind whose draft another plugin
   * writes asks that plugin whether this member may create one.
   */
  uid?: string | null
}

export interface AiJobAdmissionRefusal {
  status: 400 | 403 | 404
  /** Customer-safe: the door answers with it as it stands. */
  error: string
}

export type AiJobAdmission = (
  context: AiJobAdmissionContext,
) => Promise<AiJobAdmissionRefusal | null>

const admissions = new Map<AiJobKind, AiJobAdmission>()

/** Idempotent per kind; the last registration wins, and `null` unregisters. */
export function registerAiJobAdmission(kind: AiJobKind, admission: AiJobAdmission | null): void {
  if (admission) admissions.set(kind, admission)
  else admissions.delete(kind)
}

/** The kind's refusal, or `null` when it admits the job or has nothing to check. */
export async function aiJobAdmissionRefusal(
  kind: AiJobKind,
  context: AiJobAdmissionContext,
): Promise<AiJobAdmissionRefusal | null> {
  const admission = admissions.get(kind)
  return admission ? admission(context) : null
}
