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

jest.mock('./ai-jobs-gate', () => ({ __esModule: true, aiJobsGate: jest.fn() }))

import { aiInsightAnswerReadable } from './ai-insight-answer'

/**
 * Who may read an insight answer (AGL-2915): the member who asked, a digest's
 * site members, and staff — never a collaborator of another site, and never
 * the asker once they no longer reach the site.
 */

const asked = { createdBy: 'asker', hostId: 'host-1', surface: 'analytics' as const }
const digest = { createdBy: 'asker', hostId: 'host-1', surface: 'digest' as const }

const owner = { role: 'owner' as const }
const siteOne = { role: 'editor' as const, allHosts: false, hostAccess: { 'host-1': 'editor' as const } }
const siteTwo = { role: 'editor' as const, allHosts: false, hostAccess: { 'host-2': 'editor' as const } }

describe('an insight answer is read by', () => {
  it('the member who asked, while they still reach its site', () => {
    expect(aiInsightAnswerReadable(asked, { uid: 'asker', staff: false, member: siteOne })).toBe(true)
    expect(aiInsightAnswerReadable(asked, { uid: 'asker', staff: false, member: siteTwo })).toBe(false)
  })

  it('no other member of the workspace, however wide their reach', () => {
    expect(aiInsightAnswerReadable(asked, { uid: 'someone', staff: false, member: owner })).toBe(false)
    expect(aiInsightAnswerReadable(asked, { uid: 'someone', staff: false, member: null })).toBe(false)
  })

  it('for a weekly digest, any member who reaches its site', () => {
    expect(aiInsightAnswerReadable(digest, { uid: 'someone', staff: false, member: siteOne })).toBe(true)
    expect(aiInsightAnswerReadable(digest, { uid: 'someone', staff: false, member: owner })).toBe(true)
    expect(aiInsightAnswerReadable(digest, { uid: 'someone', staff: false, member: siteTwo })).toBe(false)
  })

  it('staff', () => {
    expect(aiInsightAnswerReadable(asked, { uid: 'staff-1', staff: true, member: null })).toBe(true)
  })
})
