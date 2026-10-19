/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The workspace's AI jobs (AGL-3966), so the Aglyn app's AI jobs screens
 * (the workspace's and the site's, both read through `/api/ai/jobs`) list
 * work rather than an empty state.
 *
 * `orgs/{orgId}/aiJobs/{id}` in the `AiJob` shape (ai-jobs.types.ts). Every
 * job is SETTLED (done, failed or canceled): nothing here is queued, running
 * or waiting on a person, so no runner ever picks one up and no AI call is
 * made on its behalf.
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export async function seedAiJobs({ put, uid, orgId, hostId, now: date }) {
  const now = date.getTime()
  const site = { hostId, hostSubdomain: 'juniper-street' }
  const jobs = [
    {
      id: 'seed-ai-job-catering',
      kind: 'page',
      status: 'done',
      brief: 'A catering page with our office lunch boxes and a quote form.',
      days: 1,
      credits: 18,
      steps: ['plan', 'generate'],
      outputs: [{ resource: 'screen', id: 'page-seo', label: 'Catering', ...site }],
    },
    {
      id: 'seed-ai-job-seo',
      kind: 'seo',
      status: 'done',
      brief: 'Write page titles and descriptions for every published page.',
      days: 3,
      credits: 6,
      steps: ['generate'],
      outputs: [{ resource: 'seo', id: 'page-pricing', label: 'Pricing', ...site }],
    },
    {
      id: 'seed-ai-job-email',
      kind: 'email',
      status: 'failed',
      brief: 'A welcome email for new newsletter subscribers.',
      days: 5,
      credits: 2,
      steps: ['generate'],
      outputs: [],
      error: 'The email could not be finished. Your credits for it were returned.',
    },
    {
      id: 'seed-ai-job-products',
      kind: 'products',
      status: 'canceled',
      brief: 'Descriptions for the holiday cookie tin and the cake.',
      days: 8,
      credits: 0,
      steps: ['generate'],
      outputs: [],
    },
  ]
  for (const job of jobs) {
    const createdAtMs = now - job.days * DAY
    const endedAtMs = createdAtMs + 4 * MINUTE
    const failed = job.status === 'failed'
    const canceled = job.status === 'canceled'
    await put(`orgs/${orgId}/aiJobs/${job.id}`, {
      orgId,
      hostId,
      kind: job.kind,
      status: job.status,
      brief: job.brief,
      inputs: {},
      model: null,
      steps: job.steps.map((name, index) => {
        const last = index === job.steps.length - 1
        return {
          name,
          status: last && failed ? 'failed' : last && canceled ? 'pending' : 'done',
          startedAt: canceled && last ? null : new Date(createdAtMs + index * MINUTE),
          endedAt: canceled && last ? null : new Date(endedAtMs),
          creditsSpent: last ? job.credits : 0,
          error: last && failed ? job.error : null,
        }
      }),
      outputs: job.outputs,
      creditsReserved: job.credits + (failed ? 10 : 0),
      creditsSpent: job.credits,
      ...(failed ? { refundedCredits: 10, refundReason: 'step-failure', refunds: 1 } : {}),
      createdBy: uid,
      createdAt: new Date(createdAtMs),
      updatedAt: new Date(endedAtMs),
      expiresAt: new Date(createdAtMs + 30 * DAY),
      error: failed ? job.error : null,
      ...(canceled ? { cancelRequested: { at: new Date(createdAtMs + MINUTE), by: uid } } : {}),
    })
  }
  return `${jobs.length} settled AI jobs`
}
