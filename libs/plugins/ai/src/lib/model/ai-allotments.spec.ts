/**
 * @jest-environment node
 */
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
 * AI allotments, the pure half (AGL-2942): a subject id round-trips, a hard
 * allotment refuses at its line and a soft one never does, a site allotment
 * refuses one collaborator for what the others spent, the narrowest spent
 * allotment is the one a refusal names, and the words name who can raise it
 * without quoting a figure that goes stale when someone does.
 */

import {
  aiAllotmentAdmits,
  aiAllotmentAlertCopy,
  aiAllotmentFrom,
  aiAllotmentModelsAllowed,
  aiAllotmentRefusalText,
  aiAllotmentState,
  aiAllotmentSubjectId,
  aiAllotmentThreshold,
  aiAllotmentVerdict,
  parseAiAllotmentSubject,
  type AiAllotmentStanding,
} from './ai-allotments'

const standing = (overrides: Partial<AiAllotmentStanding> = {}): AiAllotmentStanding => ({
  subject: 'member:u1',
  scope: 'member',
  uid: 'u1',
  hostId: null,
  credits: 1000,
  used: 0,
  mode: 'hard',
  ...overrides,
})

const site = (overrides: Partial<AiAllotmentStanding> = {}) =>
  standing({ subject: 'host:h1', scope: 'host', uid: null, hostId: 'h1', ...overrides })

describe('subjects', () => {
  it('round-trips every scope', () => {
    const inputs = [
      { scope: 'member', uid: 'u1' },
      { scope: 'collab', hostId: 'h1', uid: 'u1' },
      { scope: 'host', hostId: 'h1' },
      { scope: 'org' },
    ] as const
    for (const input of inputs) {
      const id = aiAllotmentSubjectId(input)
      expect(parseAiAllotmentSubject(id)).toMatchObject({ id, scope: input.scope })
    }
    expect(parseAiAllotmentSubject('collab:h1:u1')).toEqual({
      id: 'collab:h1:u1',
      scope: 'collab',
      uid: 'u1',
      hostId: 'h1',
    })
  })

  it('refuses anything that is not a subject, and will not build one from a bad segment', () => {
    for (const bad of ['', 'member', 'member:', 'member:a:b', 'collab:h1', 'host:h/1', 'user:u1', 'org:x', 42, null]) {
      expect(parseAiAllotmentSubject(bad)).toBeNull()
    }
    expect(() => aiAllotmentSubjectId({ scope: 'member', uid: 'a:b' })).toThrow()
  })
})

describe('a stored allotment', () => {
  it('reads who it is for off the ID, never off its fields', () => {
    expect(
      aiAllotmentFrom({ scope: 'org', uid: 'someone-else', credits: 500 }, 'member:u1'),
    ).toMatchObject({ scope: 'member', uid: 'u1', hostId: null, credits: 500 })
  })

  it('defaults to hard, carries no credits on the restriction, and reads an empty list as none', () => {
    expect(aiAllotmentFrom({ credits: 10, mode: 'SOFT' }, 'host:h1')?.mode).toBe('hard')
    expect(aiAllotmentFrom({ credits: 10, models: ['m1'] }, 'org')).toMatchObject({
      credits: null,
      models: ['m1'],
    })
    expect(aiAllotmentFrom({ credits: 10, models: [] }, 'member:u1')?.models).toBeNull()
    expect(aiAllotmentFrom({ credits: 'lots' }, 'member:u1')?.credits).toBeNull()
    expect(aiAllotmentFrom({ credits: 10 }, 'not-a-subject')).toBeNull()
  })
})

describe('the line', () => {
  it('a HARD allotment admits below its line and refuses at and past it', () => {
    expect(aiAllotmentAdmits(standing({ used: 999 }))).toBe(true)
    expect(aiAllotmentAdmits(standing({ used: 1000 }))).toBe(false)
    expect(aiAllotmentAdmits(standing({ used: 1400 }))).toBe(false)
  })

  it('a SOFT allotment admits past its line', () => {
    expect(aiAllotmentAdmits(standing({ used: 5000, mode: 'soft' }))).toBe(true)
  })

  it('an estimate made before a job starts is admitted while it still fits', () => {
    expect(aiAllotmentAdmits(standing({ used: 0, credits: 100 }), 100)).toBe(true)
    expect(aiAllotmentAdmits(standing({ used: 1, credits: 100 }), 100)).toBe(false)
  })

  it('warns from 80% and is reached at 100%', () => {
    expect(aiAllotmentState(799, 1000)).toBe('ok')
    expect(aiAllotmentState(800, 1000)).toBe('warn')
    expect(aiAllotmentState(1000, 1000)).toBe('reached')
    expect(aiAllotmentThreshold(799, 1000)).toBeNull()
    expect(aiAllotmentThreshold(850, 1000)).toBe(80)
    expect(aiAllotmentThreshold(1200, 1000)).toBe(100)
  })
})

describe('the verdict over every allotment that applies to one request', () => {
  it('names the narrowest spent allotment: the collaborator on the site, then the member, then the site', () => {
    const spentSite = site({ used: 5000, credits: 5000 })
    const spentMember = standing({ used: 1000 })
    const spentCollab = standing({ subject: 'collab:h1:u1', scope: 'collab', hostId: 'h1', used: 300, credits: 300 })
    expect(aiAllotmentVerdict([spentSite, spentMember, spentCollab]).refusal?.scope).toBe('collab')
    expect(aiAllotmentVerdict([spentSite, spentMember]).refusal?.scope).toBe('member')
    expect(aiAllotmentVerdict([spentSite]).refusal?.scope).toBe('host')
  })

  it('a site allotment refuses a collaborator whose own share is untouched, for what the others spent', () => {
    const spentByOthers = site({ used: 900, credits: 900 })
    const own = standing({ subject: 'collab:h1:u2', scope: 'collab', uid: 'u2', hostId: 'h1', used: 0, credits: 500 })
    expect(aiAllotmentVerdict([own, spentByOthers]).refusal?.subject).toBe('host:h1')
  })

  it('binds the strip to the allotment with the least left', () => {
    const member = standing({ used: 100, credits: 1000 })
    const nearlySpentSite = site({ used: 4900, credits: 5000 })
    expect(aiAllotmentVerdict([member, nearlySpentSite]).binding?.subject).toBe('host:h1')
    expect(aiAllotmentVerdict([]).binding).toBeNull()
  })

  it('announces a SOFT allotment at a threshold, and never a hard one', () => {
    const soft = standing({ mode: 'soft', used: 850 })
    const hard = site({ used: 950, credits: 1000 })
    const verdict = aiAllotmentVerdict([soft, hard])
    expect(verdict.refusal).toBeNull()
    expect(verdict.alerts).toEqual([{ standing: soft, threshold: 80 }])
  })
})

describe('allowlists', () => {
  it('intersects the lists that apply, and answers null when none names one', () => {
    expect(aiAllotmentModelsAllowed([null, { models: null }])).toBeNull()
    expect(aiAllotmentModelsAllowed([{ models: ['a', 'b'] }, { models: ['b', 'c'] }, null])).toEqual(['b'])
    expect(aiAllotmentModelsAllowed([{ models: ['a'] }, { models: ['c'] }])).toEqual([])
  })
})

describe('the words', () => {
  it('each refusal names who can raise it and where, and quotes no figure', () => {
    for (const scope of ['member', 'collab', 'host', null] as const) {
      const text = aiAllotmentRefusalText(scope)
      expect(text).toMatch(/Manage billing/)
      expect(text).not.toMatch(/\d/)
    }
    expect(aiAllotmentRefusalText('collab')).toMatch(/site's admin/)
    expect(aiAllotmentRefusalText('collab')).toMatch(/Users card/)
    expect(aiAllotmentRefusalText('host')).toMatch(/^This site/)
    expect(aiAllotmentRefusalText('member')).toMatch(/Billing → Usage/)
  })

  it('one alert copy for both channels, naming the subject, in credits and never dollars', () => {
    const reached = aiAllotmentAlertCopy({ scope: 'host', threshold: 100, used: 1200, credits: 1000, name: 'Acme' })
    expect(reached.title).toMatch(/The Acme site/)
    expect(reached.body).toMatch(/1,200 of 1,000 credits/)
    expect(`${reached.title} ${reached.body}`).not.toMatch(/\$/)
    const warned = aiAllotmentAlertCopy({ scope: 'member', threshold: 80, used: 820, credits: 1000, name: 'Sam' })
    expect(warned.title).toMatch(/Sam is past 80% of their AI allotment/)
  })
})
