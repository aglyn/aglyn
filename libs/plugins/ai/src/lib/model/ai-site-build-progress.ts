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

import type { AiJobSummary } from './ai-jobs.types'

/**
 * What the "Building your site" page shows of a site job (AGL-3594): one row
 * a stage — planning the pages, then each page — with its state, the state
 * the whole job is in, and the job's one price.
 *
 * Read off the job summary every surface already follows: the plan step's
 * status, the plan's pages, and the pages the build has reported as outputs.
 * A scaffold builds its units in plan order and reports each page when it is
 * written, so the pages written so far are the first pages of the plan.
 *
 * Pure: no React, no request. The page and its spec read the same rows.
 */

export type AiSiteBuildRowState = 'done' | 'active' | 'waiting' | 'failed'

export interface AiSiteBuildRow {
  id: string
  label: string
  state: AiSiteBuildRowState
}

/** Where the whole job stands, as the page's header and actions read it. */
export type AiSiteBuildPhase = 'working' | 'done' | 'stopped' | 'failed' | 'canceled'

export function aiSiteBuildPhase(job: Pick<AiJobSummary, 'status'>): AiSiteBuildPhase {
  switch (job.status) {
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'needs_review':
    case 'needs_input':
      return 'stopped'
    default:
      return 'working'
  }
}

export function aiSiteBuildRows(
  job: Pick<AiJobSummary, 'status' | 'steps' | 'plan' | 'outputs' | 'review'>,
): AiSiteBuildRow[] {
  const phase = aiSiteBuildPhase(job)
  const planStep = job.steps.find((step) => step.name === 'plan')
  const planDone = planStep?.status === 'done' || Boolean(job.plan)
  const stoppedHere = (active: boolean) => (phase === 'failed' || phase === 'stopped') && active
  const planActive = !planDone
  const rows: AiSiteBuildRow[] = [
    {
      id: 'plan',
      label: 'Planning your pages',
      state: planDone ? 'done' : stoppedHere(planActive) ? 'failed' : phase === 'working' ? 'active' : 'waiting',
    },
  ]
  const pages = job.plan?.screens ?? []
  const written = job.outputs.filter((output) => output.resource === 'screen').length
  pages.forEach((page, index) => {
    const done = index < written || phase === 'done'
    const current = !done && index === written && planDone
    rows.push({
      id: `page-${index}`,
      label: `Writing page ${index + 1} of ${pages.length}: ${page.title}`,
      state: done ? 'done' : stoppedHere(current) ? 'failed' : current && phase === 'working' ? 'active' : 'waiting',
    })
  })
  return rows
}

/**
 * The job's one price (AGL-3594), never a plan's on its own: what it has used
 * so far while it works, what it used once done, and, on a failure we gave
 * back, that nothing was charged.
 */
export function aiSiteBuildCreditsLine(
  job: Pick<AiJobSummary, 'status' | 'creditsSpent' | 'refundedCredits'>,
): string | null {
  const spent = Math.max(0, job.creditsSpent ?? 0)
  const refunded = Math.max(0, job.refundedCredits ?? 0)
  const net = Math.max(0, spent - refunded)
  const phase = aiSiteBuildPhase(job)
  if (refunded > 0 && net === 0) return `Nothing was charged — we refunded ${refunded} credits.`
  if (phase === 'done') return `This site used ${net} credits.`
  if (phase === 'working') return `Credits used so far: ${net}`
  if (refunded > 0) return `This site used ${net} credits — we refunded ${refunded}.`
  return net > 0 ? `This site used ${net} credits.` : null
}
