/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * What the Assist chat is told about its workspace (AGL-4075): the plan by
 * name, and the open AI jobs with where each stands and what it waits for.
 * The read is one bounded query over a fixed list of fields, and a
 * teammate's brief never reaches the block.
 */

import {
  ASSIST_OPEN_JOBS_LIMIT,
  ASSIST_OPEN_JOB_FIELDS,
  assistJobsHere,
  assistOpenJobFrom,
  assistWorkspaceBlock,
  readAssistOpenJobs,
  type AssistOpenJob,
} from './assist-jobs-context'

const NOW = Date.parse('2026-10-28T12:00:00Z')
const HOURS = 3_600_000
const HERE = { orgSlug: 'acme', hostSegment: 'roofing', hostId: 'host-1' }

function job(overrides: Partial<AssistOpenJob> = {}): AssistOpenJob {
  return {
    id: 'job-1',
    kind: 'page',
    status: 'needs_review',
    hostId: 'host-1',
    own: true,
    updatedAtMs: NOW - 3 * HOURS,
    reviewReason: 'plan',
    asksInput: false,
    autoConfirm: false,
    steps: [{ name: 'plan', status: 'done' }, { name: 'generate', status: 'pending' }],
    brief: 'An about page with our team',
    ...overrides,
  }
}

describe('the workspace block', () => {
  it('names the plan for every workspace, Free included', () => {
    expect(assistWorkspaceBlock({ plan: 'Free', jobs: null, here: HERE, now: NOW })).toBe(
      'This workspace is on the Free plan.',
    )
    expect(assistWorkspaceBlock({ plan: 'Pro', jobs: null, here: HERE, now: NOW })).toContain('on the Pro plan')
  })

  it('says there are none when the read found no open job', () => {
    const block = assistWorkspaceBlock({ plan: 'Free', jobs: [], here: HERE, now: NOW })
    expect(block).toContain('No AI jobs are open in this workspace.')
  })

  it('a plan waiting for the asker: Plan ready, Confirm plan, and its page on this site', () => {
    const block = assistWorkspaceBlock({ plan: 'Free', jobs: [job()], here: HERE, now: NOW })
    expect(block).toContain('under AI jobs at the top of this Assist panel')
    expect(block).toContain(
      "- The user's page job \"An about page with our team\" on this site, updated 3 hours ago: " +
        'Plan ready: nothing is built until the user chooses Confirm plan on it. ' +
        'Its page: /acme/hosts/roofing/ai-jobs/job-1',
    )
  })

  it('a teammate’s job carries its kind and standing, never their brief', () => {
    const block = assistWorkspaceBlock({
      plan: 'Free',
      jobs: [job({ own: false, brief: null, hostId: 'host-2', kind: 'build', status: 'running', reviewReason: null, steps: [{ name: 'plan', status: 'done' }, { name: 'build', status: 'running' }] })],
      here: HERE,
      now: NOW,
    })
    expect(block).toContain("- A teammate's build job on another site, updated 3 hours ago: Building.")
    // Another site's job has no page link: the site's console segment is not known here.
    expect(block).not.toContain('/ai-jobs/')
  })

  it('says what a stopped job waits for, by why it stopped', () => {
    const lines = (overrides: Partial<AssistOpenJob>) =>
      assistWorkspaceBlock({ plan: 'Free', jobs: [job(overrides)], here: HERE, now: NOW })
    expect(lines({ reviewReason: 'doctrine' })).toContain('could not build this cleanly, so it stopped. Try again is on the job.')
    expect(lines({ status: 'needs_input', reviewReason: null, asksInput: true })).toContain(
      'it needs one detail from the user before it can build',
    )
    expect(lines({ status: 'needs_input', reviewReason: null })).toContain('Paused for AI credits or a cap. Nothing is lost')
    expect(lines({ status: 'queued', reviewReason: null, steps: [{ name: 'plan', status: 'pending' }] })).toContain(
      'Planning: working out what to build.',
    )
  })

  it('says when it lists only the newest', () => {
    const jobs = Array.from({ length: ASSIST_OPEN_JOBS_LIMIT }, (_, index) => job({ id: `job-${index}` }))
    expect(assistWorkspaceBlock({ plan: 'Free', jobs, here: HERE, now: NOW })).toContain(
      `Open AI jobs in this workspace (the newest ${ASSIST_OPEN_JOBS_LIMIT}), newest first.`,
    )
  })
})

describe('one stored job as the block reads it', () => {
  it('keeps the asker’s own brief, one line, quotes neutralised, cut short', () => {
    const own = assistOpenJobFrom(
      'job-1',
      { kind: 'page', status: 'needs_review', createdBy: 'me', brief: 'A "warm"\n\nabout page '.repeat(10) },
      'me',
    )
    expect(own.own).toBe(true)
    expect(own.brief).not.toMatch(/["\n]/)
    expect(own.brief?.length).toBeLessThanOrEqual(61)
    expect(own.brief?.endsWith('…')).toBe(true)
  })

  it('drops a teammate’s brief at the read, before anything composes a prompt', () => {
    const theirs = assistOpenJobFrom('job-2', { kind: 'page', status: 'queued', createdBy: 'them', brief: 'SECRET PLANS' }, 'me')
    expect(theirs.own).toBe(false)
    expect(theirs.brief).toBeNull()
    expect(JSON.stringify(theirs)).not.toContain('SECRET PLANS')
  })

  it('reads a Firestore timestamp, a Date or an ISO string as the same instant', () => {
    const at = NOW - HOURS
    for (const updatedAt of [{ toMillis: () => at }, new Date(at), new Date(at).toISOString()]) {
      expect(assistOpenJobFrom('j', { updatedAt }, 'me').updatedAtMs).toBe(at)
    }
  })
})

describe('the read', () => {
  it('is one query: the open statuses, newest first, bounded, over a fixed field list', async () => {
    const calls: unknown[][] = []
    const query = {
      where: (...args: unknown[]) => (calls.push(['where', ...args]), query),
      orderBy: (...args: unknown[]) => (calls.push(['orderBy', ...args]), query),
      limit: (...args: unknown[]) => (calls.push(['limit', ...args]), query),
      select: (...args: unknown[]) => (calls.push(['select', ...args]), query),
      get: async () => ({
        docs: [{ id: 'job-9', data: () => ({ kind: 'build', status: 'running', createdBy: 'them', brief: 'theirs' }) }],
      }),
    }
    const paths: string[] = []
    const firestore = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          collection: (sub: string) => (paths.push(`${name}/${id}/${sub}`), query),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore
    const jobs = await readAssistOpenJobs(firestore, { orgId: 'org-1', uid: 'me' })
    expect(paths).toEqual(['orgs/org-1/aiJobs'])
    expect(calls).toEqual([
      ['where', 'status', 'in', ['queued', 'running', 'needs_input', 'needs_review']],
      ['orderBy', 'createdAt', 'desc'],
      ['limit', ASSIST_OPEN_JOBS_LIMIT],
      ['select', ...ASSIST_OPEN_JOB_FIELDS],
    ])
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ id: 'job-9', own: false, brief: null })
  })
})

describe('where the person is', () => {
  it('takes the workspace and the site segment from a site path', () => {
    expect(assistJobsHere('/acme/hosts/roofing/screens', 'host-1', new Set(['admin', 'manage']))).toEqual(HERE)
  })

  it('has no workspace on an org-less path and no site off one', () => {
    expect(assistJobsHere('/admin/orgs', '', new Set(['admin', 'manage']))).toEqual({
      orgSlug: '',
      hostSegment: '',
      hostId: '',
    })
    expect(assistJobsHere('/acme/billing', '', new Set(['admin']))).toEqual({ orgSlug: 'acme', hostSegment: '', hostId: '' })
  })
})
