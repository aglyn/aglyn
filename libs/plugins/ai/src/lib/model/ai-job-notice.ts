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

import type { AglynNotification } from '@aglyn/aglyn/app-utils/notifications'
import { aiBuildOutcomeLine, aiSitePartialCopy } from './ai-build-progress'
import { aiJobKindNoun } from './ai-job-activity'
import { aiCustomerSafeCopy, aiJobRefundCopy } from './ai-job-failure-copy'
import type { AiJobItemLedger, AiJobKind, AiJobOutput, AiJobReviewReason, AiJobSitePublish } from './ai-jobs.types'

/** The besigner segment each versioned resource lives under. */
export const AI_JOB_BESIGNER_SEGMENT: Partial<Record<AiJobOutput['resource'], string>> = {
  screen: 'screens',
  reusableComponent: 'components',
  layout: 'layouts',
  template: 'templates',
  // An email design is a screen: it opens in the screen besigner, as the
  // Emails page's own Edit design does.
  emailScreen: 'screens',
}

/**
 * The query parameter a console address carries to open AI jobs on one job
 * (AGL-3593): the Assist panel reads it on arrival.
 */
export const AI_JOB_LINK_PARAM = 'aiJob'

/** Where a site's "Building your site" page lives, under the site (AGL-3594). */
export const AI_SITE_BUILD_HREF = '/ai-jobs'

/** A change the person who started a job is told about. */
export type AiJobNoticeTransition = 'needs-review' | 'done' | 'failed'

/** The fields of a stored job a notice is written from. */
export interface AiJobNoticeSource {
  $id: string
  orgId: string
  hostId?: string | null
  kind: AiJobKind
  review?: { reason: AiJobReviewReason; message?: string | null } | null
  outputs?: readonly AiJobOutput[] | null
  error?: string | null
  /** What a guided site start put live (AGL-3596); absent on every other job. */
  sitePublish?: Pick<AiJobSitePublish, 'published' | 'drafts'> | null
  /** What the job spent, and gave back for a failure on our side (AGL-3596). */
  creditsSpent?: number
  refundedCredits?: number
  /** A build's or a guided start's items (AGL-3616), so a finished one says what was not built. */
  items?: AiJobItemLedger[] | null
}

/** A stopped job's sentence with what became of its credits, from the job's recorded give-back (AGL-3596). */
function withRefund(job: AiJobNoticeSource, text: string, status: 'failed' | 'needs_review'): string {
  const refund = aiJobRefundCopy({ status, refundedCredits: job.refundedCredits, creditsSpent: job.creditsSpent })
  return refund ? `${text} ${refund}` : text
}

export type AiJobNotice = Pick<
  AglynNotification,
  'type' | 'title' | 'body' | 'link' | 'orgId' | 'hostId' | 'level'
>

/**
 * Where a notice's link goes, in the stored form the console rewrites when it
 * is followed (`normalizeNotificationLink`): `/{hostId}/…` for the job's site,
 * `/org…` for a job of the workspace's.
 *
 * A job that is done leads to what it built (AGL-3593): several pages of the
 * job's site open that site's Pages list, one versioned output opens in the
 * editor on the version the job wrote. Everything else — a plan to confirm, a
 * job that stopped, a done job with nothing of its own to open — opens AI
 * jobs on the job.
 */
export function aiJobNoticeLink(job: AiJobNoticeSource, to: AiJobNoticeTransition): string {
  const base = job.hostId ? `/${job.hostId}` : '/org'
  // A site job's every notice opens its "Building your site" page (AGL-3594),
  // which leads with the next step whatever the job's state.
  if (job.kind === 'site' && job.hostId) return `${base}${AI_SITE_BUILD_HREF}/${encodeURIComponent(job.$id)}`
  if (to === 'done' && job.hostId) {
    const own = (job.outputs ?? []).filter((output) => output.hostId === job.hostId)
    const screens = own.filter((output) => output.resource === 'screen')
    if (screens.length > 1) return `${base}/screens`
    const versioned = own.find(
      (output) => AI_JOB_BESIGNER_SEGMENT[output.resource] && output.versionId,
    )
    if (own.length === 1 && versioned) {
      const segment = AI_JOB_BESIGNER_SEGMENT[versioned.resource]
      return `${base}/${segment}/${versioned.id}/versions/${versioned.versionId}/besigner`
    }
  }
  return `${base}?${AI_JOB_LINK_PARAM}=${encodeURIComponent(job.$id)}`
}

/**
 * The in-app notification for one change of one job (AGL-3593), for the
 * person who created it. Customer-safe throughout: a stopped job's sentence is
 * the job's own `error`, which the machine writes as a fixed sentence.
 */
export function aiJobNotice(job: AiJobNoticeSource, to: AiJobNoticeTransition): AiJobNotice {
  const noun = aiJobKindNoun(job.kind)
  const scope = { orgId: job.orgId, ...(job.hostId ? { hostId: job.hostId } : {}) }
  const link = aiJobNoticeLink(job, to)
  if (to === 'needs-review') {
    if (job.review?.reason === 'plan') {
      return {
        type: 'content.aiJobNeedsYou',
        level: 'warning',
        title:
          noun === 'AI job'
            ? 'Your plan is ready: confirm it to build'
            : `Your ${noun} plan is ready: confirm it to build`,
        body: 'Nothing is built until you confirm the plan. It waits in AI jobs.',
        link,
        ...scope,
      }
    }
    return {
      type: 'content.aiJobNeedsYou',
      level: 'warning',
      title: `Your ${noun === 'AI job' ? 'AI job' : `${noun} job`} needs you`,
      // The doctrine's own words never reach a customer (AGL-3596).
      body: withRefund(
        job,
        aiCustomerSafeCopy(job.review?.message || job.error || 'It stopped for your decision. It waits in AI jobs.', { page: job.kind === 'page' }),
        'needs_review',
      ),
      link,
      ...scope,
    }
  }
  if (to === 'done') {
    // A job that finished with part of it unbuilt (AGL-3596) says so in the
    // words its page uses, as a warning: "done" alone hid a page that failed.
    const items = job.items ?? []
    const unbuilt = items.some((row) => row.status === 'failed' || row.status === 'skipped')
    const level = unbuilt ? 'warning' : 'success'
    const partial =
      job.kind === 'site'
        ? aiSitePartialCopy({ items, status: 'done' })
        : unbuilt
          ? aiBuildOutcomeLine({ items, status: 'done' })
          : null
    // A guided site start publishes its pages when it finishes (AGL-3596):
    // with one live, the site is, and the build page lists any that stayed
    // drafts with the reason for each.
    const live = job.kind === 'site' ? (job.sitePublish?.published.length ?? 0) : 0
    if (live > 0) {
      const drafts = job.sitePublish?.drafts.length ?? 0
      const stayed = drafts === 1 ? 'one that stayed a draft' : `${drafts} that stayed drafts`
      return {
        type: 'content.aiJobDone',
        level,
        title: partial ? 'Your site is live, but part of it wasn’t built' : 'Your site is live',
        body: partial
          ? `${partial} ${drafts > 0 ? `What was built is published, except ${stayed}.` : 'What was built is published.'}`
          : drafts > 0
            ? `Your pages are published, except ${stayed}. Open it to see why.`
            : 'Your pages are published. Open it to view your site or edit your pages.',
        link,
        ...scope,
      }
    }
    const pages = (job.outputs ?? []).filter((output) => output.resource === 'screen').length
    const title =
      job.kind === 'site' || pages > 1
        ? 'Your site’s draft pages are ready'
        : job.kind === 'page'
          ? 'Your draft page is ready'
          : noun === 'AI job'
            ? 'Your AI job finished'
            : `Your ${noun} is ready`
    return {
      type: 'content.aiJobDone',
      level,
      title,
      body:
        job.kind === 'insight' || job.kind === 'text'
          ? 'Open AI jobs to read it.'
          : [partial, 'Everything it built is an unpublished draft until you publish it.'].filter(Boolean).join(' '),
      link,
      ...scope,
    }
  }
  return {
    type: 'content.aiJobFailed',
    level: 'warning',
    title: `Your ${noun === 'AI job' ? 'AI job' : `${noun} job`} stopped`,
    body: withRefund(job, aiCustomerSafeCopy(job.error || 'It stopped before it finished.', { page: job.kind === 'page' }), 'failed'),
    link,
    ...scope,
  }
}
