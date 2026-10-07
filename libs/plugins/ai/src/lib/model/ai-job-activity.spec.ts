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
 * What a job is doing, in the words every AI surface shows (AGL-3593): one
 * reading of a job's phase, and one precedence for the indicator, the
 * launcher and the drawer's header — a plan waiting to be confirmed is never
 * counted as running.
 */

import {
  aiJobActivityCounts,
  aiJobActivityState,
  aiJobPhase,
  aiJobsActivity,
  aiJobsActivityLabel,
  aiJobsHeaderChips,
  aiJobsLauncherLabel,
  type AiJobPhaseSource,
} from './ai-job-activity'

const step = (name: string, status: 'pending' | 'running' | 'done' | 'failed') => ({ name, status })

function job(patch: Partial<AiJobPhaseSource> & { id?: string } = {}) {
  return {
    id: 'job',
    status: 'running' as const,
    review: null,
    steps: [step('plan', 'done'), step('generate', 'running')],
    ...patch,
  }
}

const planning = job({ id: 'planning', status: 'running', steps: [step('plan', 'running'), step('generate', 'pending')] })
const queued = job({ id: 'queued', status: 'queued', steps: [step('plan', 'pending'), step('generate', 'pending')] })
const building = job({ id: 'building' })
const planReady = job({
  id: 'plan-ready',
  status: 'needs_review',
  review: { reason: 'plan' },
  steps: [step('plan', 'done'), step('generate', 'pending')],
})
const refused = job({ id: 'refused', status: 'needs_review', review: { reason: 'doctrine' } })
const outOfCredits = job({ id: 'credits', status: 'needs_input' })
const done = job({ id: 'done', status: 'done' })
const failed = job({ id: 'failed', status: 'failed' })

describe('aiJobPhase', () => {
  it('reads planning, plan ready and building off the steps and the review', () => {
    expect(aiJobPhase(planning)).toBe('planning')
    // A planned kind's first step is its plan, so a queued planned job is planning next.
    expect(aiJobPhase(queued)).toBe('planning')
    expect(aiJobPhase(job({ status: 'queued', steps: [step('draft', 'pending')] }))).toBe('queued')
    expect(aiJobPhase(planReady)).toBe('plan-ready')
    expect(aiJobPhase(building)).toBe('building')
    expect(aiJobPhase(job({ status: 'queued', steps: [step('plan', 'done'), step('generate', 'pending')] }))).toBe(
      'building',
    )
  })

  it('reads a refused plan, a site at an allowance and a workspace out of credits as needing attention', () => {
    expect(aiJobPhase(refused)).toBe('attention')
    expect(aiJobPhase(job({ status: 'needs_review', review: { reason: 'limit' } }))).toBe('attention')
    expect(aiJobPhase(outOfCredits)).toBe('attention')
  })

  it('reads a settled job as its own status', () => {
    expect(aiJobPhase(done)).toBe('done')
    expect(aiJobPhase(failed)).toBe('failed')
    expect(aiJobPhase(job({ status: 'canceled' }))).toBe('canceled')
  })
})

describe('the activity a job counts as', () => {
  it('never counts a stopped job as running', () => {
    expect(aiJobActivityState(planReady)).toBe('needs-you')
    expect(aiJobActivityState(refused)).toBe('attention')
    expect(aiJobActivityState(outOfCredits)).toBe('attention')
    expect(aiJobActivityState(planning)).toBe('running')
    expect(aiJobActivityState(failed)).toBeNull()
    expect(aiJobActivityState(done)).toBeNull()
  })

  it('counts each state on its own in the drawer header', () => {
    const counts = aiJobActivityCounts([planReady, refused, building, planning, done])
    expect(counts).toEqual({ 'needs-you': 1, attention: 1, running: 2 })
    expect(aiJobsHeaderChips(counts).map((chip) => chip.label)).toEqual([
      '1 needs you',
      '1 needs attention',
      '2 running',
    ])
    // The bug this replaces: a refused plan read as "1 running".
    expect(aiJobsHeaderChips(aiJobActivityCounts([refused])).map((chip) => chip.label)).toEqual([
      '1 needs attention',
    ])
  })
})

describe('the indicator’s precedence', () => {
  it('shows nothing when nothing is moving or waiting', () => {
    expect(aiJobsActivity([])).toBeNull()
    expect(aiJobsActivity([done, failed])).toBeNull()
  })

  it('puts a plan waiting for the person above everything running', () => {
    const activity = aiJobsActivity([building, planReady, planning])
    expect(activity?.state).toBe('needs-you')
    expect(activity?.count).toBe(1)
    expect(activity?.job.id).toBe('plan-ready')
    expect(aiJobsActivityLabel(activity!)).toBe('AI · plan ready')
  })

  it('puts a job needing attention above running ones', () => {
    const activity = aiJobsActivity([building, refused])
    expect(activity?.state).toBe('attention')
    expect(aiJobsActivityLabel(activity!)).toBe('AI · needs attention')
  })

  it('says planning while every running job is still planning, and working once one builds', () => {
    expect(aiJobsActivityLabel(aiJobsActivity([planning])!)).toBe('AI · planning')
    expect(aiJobsActivityLabel(aiJobsActivity([planning, building])!)).toBe('AI · 2 working')
  })

  it('targets the oldest job in the winning state', () => {
    const newer = { ...planReady, id: 'newer' }
    // Lists arrive newest first.
    expect(aiJobsActivity([newer, planReady])?.job.id).toBe('plan-ready')
    expect(aiJobsActivityLabel(aiJobsActivity([newer, planReady])!)).toBe('AI · 2 plans ready')
  })
})

describe('the launcher’s accessible name', () => {
  it('names what waits inside', () => {
    expect(aiJobsLauncherLabel('Aglyn', null)).toBe('Open Aglyn Assist')
    expect(aiJobsLauncherLabel('Aglyn', aiJobsActivity([planReady]))).toBe(
      'Open Aglyn Assist, 1 AI job needs you',
    )
    expect(aiJobsLauncherLabel('Aglyn', aiJobsActivity([planning, building]))).toBe(
      'Open Aglyn Assist, 2 AI jobs running',
    )
    expect(aiJobsLauncherLabel('Aglyn', aiJobsActivity([refused]))).toBe(
      'Open Aglyn Assist, 1 AI job needs attention',
    )
  })
})
