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

import { aiJobKindNoun } from './ai-job-activity'
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
  job: Pick<AiJobSummary, 'status' | 'creditsSpent' | 'refundedCredits'> & Partial<Pick<AiJobSummary, 'kind'>>,
): string | null {
  const spent = Math.max(0, job.creditsSpent ?? 0)
  const refunded = Math.max(0, job.refundedCredits ?? 0)
  const net = Math.max(0, spent - refunded)
  const phase = aiSiteBuildPhase(job)
  // What the job made, by its kind; a job that names none is a site's.
  const subject = !job.kind || job.kind === 'site' ? 'This site' : aiJobKindNoun(job.kind) === 'AI job' ? 'This AI job' : `This ${aiJobKindNoun(job.kind)}`
  if (refunded > 0 && net === 0) return `Nothing was charged — we refunded ${refunded} credits.`
  if (phase === 'done') return `${subject} used ${net} credits.`
  if (phase === 'working') return `Credits used so far: ${net}`
  if (refunded > 0) return `${subject} used ${net} credits — we refunded ${refunded}.`
  return net > 0 ? `${subject} used ${net} credits.` : null
}

/** The heading and the sentence under it, for one job's page in its current phase. */
export interface AiJobPageCopy {
  heading: string
  lede: string
}

/**
 * What one job's page says at the top (AGL-3594, AGL-3596). A site job reads
 * as "Building your site"; any other kind names what it makes — "Building
 * your page" — or, for a kind with no noun, the job itself.
 *
 * A guided site start publishes its pages when it finishes, and says so
 * (`sitePublish`): with a page live the heading is "Your site is live". A
 * done site job without that record — an older job, or one that was not a
 * guided start — built drafts, and says that instead.
 */
export function aiJobPageCopy(
  job: Pick<AiJobSummary, 'kind' | 'status' | 'review' | 'error'> & Partial<Pick<AiJobSummary, 'sitePublish'>>,
  brand: string,
): AiJobPageCopy {
  const phase = aiSiteBuildPhase(job)
  const noun = job.kind === 'site' ? 'site' : aiJobKindNoun(job.kind)
  const generic = noun === 'AI job'
  // `products` is the one plural noun.
  const isAre = noun.endsWith('s') ? 'are' : 'is'
  const why = job.review?.message ?? job.error ?? null
  if (phase === 'working') {
    return {
      heading: generic ? 'Your AI job is running' : `Building your ${noun}`,
      lede:
        job.kind === 'site'
          ? `${brand} AI is planning your pages and writing each one. You can leave this page; it keeps going.`
          : `${brand} AI is working on it. You can leave this page; it keeps going.`,
    }
  }
  if (phase === 'done') {
    const published = job.sitePublish?.published.length ?? 0
    if (job.kind === 'site' && published > 0) {
      return {
        heading: 'Your site is live',
        lede: job.sitePublish?.drafts.length
          ? 'Your pages are published, except the ones listed below, which stayed drafts.'
          : 'Your pages are published, and anyone can visit your site now.',
      }
    }
    if (job.kind === 'site' && job.sitePublish) {
      return {
        heading: 'Your site is ready',
        lede: 'None of your new pages could be published, so they are drafts. The reasons are below.',
      }
    }
    return {
      heading: generic ? 'Your AI job finished' : `Your ${noun} ${isAre} ready`,
      lede:
        job.kind === 'site'
          ? 'Your new pages are drafts. Publish them when you’re happy.'
          : 'Everything it built is an unpublished draft until you publish it.',
    }
  }
  if (phase === 'canceled') {
    return { heading: generic ? 'Your AI job was canceled' : `Your ${noun} was not built`, lede: 'The job was canceled.' }
  }
  return {
    heading: generic ? 'Your AI job stopped' : `Your ${noun} ${noun.endsWith('s') ? 'were' : 'was'} not built`,
    lede: why ?? (generic ? 'Something went wrong running this job.' : `Something went wrong building your ${noun}.`),
  }
}
