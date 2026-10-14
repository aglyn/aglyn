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

import { isFormArchived } from '@aglyn/aglyn/app-utils/forms'
import type { AiJob } from '../model/ai-jobs.types'
import { aiOriginJobId } from './ai-job-draft-ids'
import { aiDraftInstantMs, aiSiteSubdomain, type AiDraftRecord } from './ai-job-drafts'
import { listAiJobs } from './ai-jobs'

/**
 * A FORM ANOTHER BUILD JUST MADE, PLACED INSTEAD OF REFUSED (AGL-3765).
 *
 * Two page jobs started from one brief on a Free site, minutes apart, were
 * each planned while the site had no form, and each planned a new one. The
 * first to reach its form step made the site's one Free form; the second
 * reached its own ten seconds later, was refused at the band, and stopped
 * without the page it was asked for. A third job, planned after the form
 * existed, placed it by id and was built.
 *
 * So a form UNIT — the form a page, a guided start or a build makes before
 * the page that places it — that the band refuses looks for a form another AI
 * job made on the same site, and reports that form as what the unit built.
 * The page then binds it by id, exactly as it binds a form the site always
 * had. Another job's form qualifies when the site holds it now, in use, and it
 * was made in the last {@link AI_FORM_REUSE_WINDOW_MS}, or by a job of the
 * same brief. Which job made it is read from what the jobs record: the
 * form's id is the id a job's plan minted for its form creation before the
 * write (`AiBuildPlanCreate.id`), and the output the job recorded after it.
 *
 * A job the member asked for a form by itself never borrows one: it was asked
 * for a new form, not for a page that needs one.
 */

/** How recently another job must have made a form for a refused unit to place it. */
export const AI_FORM_REUSE_WINDOW_MS = 15 * 60_000

/** What the unit's output says when it placed another build's form. */
export const AI_FORM_REUSED_NOTE = 'Reused the form another build just made.'

/** How many of the site's newest jobs are read for the form's maker. */
export const AI_FORM_REUSE_JOBS_READ = 20

/** The fields of a job this module reads. */
export type AiFormReuseJob = Pick<AiJob, '$id' | 'hostId' | 'brief' | 'outputs' | 'plan'>

/** A brief as two jobs of the same brief share it: case and spacing aside. */
function briefKey(brief: string | null | undefined): string {
  return (brief ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The forms other jobs on this site made or were about to make, each with
 * whether its job had the same brief as the job the member started. Read off
 * each job's recorded outputs and its plan's minted form ids; the job the
 * member started is never another job.
 */
export function aiSiblingJobFormIds(
  jobs: readonly AiFormReuseJob[],
  input: { hostId: string; originJobId: string },
): Map<string, { sameBrief: boolean }> {
  const origin = jobs.find((job) => job.$id === input.originJobId)
  const brief = origin ? briefKey(origin.brief) : ''
  const found = new Map<string, { sameBrief: boolean }>()
  for (const job of jobs) {
    if (job.$id === input.originJobId || job.hostId !== input.hostId) continue
    const sameBrief = Boolean(brief) && briefKey(job.brief) === brief
    const ids = [
      ...(job.outputs ?? [])
        .filter((output) => output.resource === 'form' && (output.hostId ?? input.hostId) === input.hostId)
        .map((output) => output.id),
      ...(job.plan?.create ?? []).filter((entry) => entry.kind === 'form').map((entry) => entry.id),
    ]
    for (const id of ids) {
      if (!id) continue
      found.set(id, { sameBrief: sameBrief || (found.get(id)?.sameBrief ?? false) })
    }
  }
  return found
}

export interface AiSiblingJobFormDeps {
  /** The site's newest jobs; the machine's list otherwise. */
  listJobs?: (
    firestore: FirebaseFirestore.Firestore,
    orgId: string,
    options: { hostId: string; limit: number },
  ) => Promise<readonly AiFormReuseJob[]>
}

/**
 * The form another AI job made on this site that a refused form unit places
 * instead (AGL-3765), as the draft record the unit reports; `null` when the
 * job is not a unit, or no other job's form qualifies. The newest qualifying
 * form wins.
 */
export async function aiSiblingJobForm(
  firestore: FirebaseFirestore.Firestore,
  input: { job: Pick<AiJob, '$id' | 'orgId' | 'hostId' | 'inputs'>; now: Date },
  deps: AiSiblingJobFormDeps = {},
): Promise<AiDraftRecord | null> {
  const { job } = input
  const hostId = job.hostId
  const originJobId = aiOriginJobId(job)
  // Only a unit of a job that places the form; a form job builds its own.
  if (!hostId || originJobId === job.$id) return null
  const listJobs = deps.listJobs ?? listAiJobs
  const jobs = await listJobs(firestore, job.orgId, { hostId, limit: AI_FORM_REUSE_JOBS_READ })
  const candidates = aiSiblingJobFormIds(jobs, { hostId, originJobId })
  candidates.delete(job.$id)
  if (!candidates.size) return null
  const forms = firestore.collection('hosts').doc(hostId).collection('forms')
  const read = await Promise.all(
    [...candidates.entries()].map(async ([id, { sameBrief }]) => ({ id, sameBrief, doc: await forms.doc(id).get() })),
  )
  const now = input.now.getTime()
  const qualifying = read
    .filter(({ doc }) => doc.exists && !isFormArchived({ archivedAt: doc.get('archivedAt') }))
    .map(({ id, sameBrief, doc }) => ({
      id,
      sameBrief,
      name: String(doc.get('displayName') ?? ''),
      createdAt: aiDraftInstantMs(doc.get('createdAt')),
    }))
    .filter(
      (form) =>
        form.sameBrief || (form.createdAt !== null && now - form.createdAt <= AI_FORM_REUSE_WINDOW_MS),
    )
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const [form] = qualifying
  if (!form) return null
  return {
    id: form.id,
    versionId: null,
    name: form.name,
    hostSubdomain: await aiSiteSubdomain(firestore, hostId),
  }
}
