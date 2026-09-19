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
 * What a plan may create on one site (AGL-3030): the lines the plan step's
 * user turn states, and the narrowing to what a job builds itself. The
 * workspace half — its plan and its counts — is `readAiPlanCapabilities`,
 * held in `jobs/ai-job-drafts.spec.ts` against the draft writer's arithmetic.
 */

import { AI_BUILD_PLAN_CREATE_KINDS } from './ai-build-plan'
import {
  AI_PLAN_INLINE_SENTENCE,
  aiCreationNoun,
  aiPlanCapabilitiesForJob,
  aiPlanCapabilityLines,
  aiPlanUncreatableKind,
  aiUnrestrictedPlanCapabilities,
  type AiPlanCapabilities,
} from './ai-plan-capabilities'

const FREE: AiPlanCapabilities = {
  reusableComponents: false,
  create: {
    ...aiUnrestrictedPlanCapabilities().create,
    component: { allowed: false, left: 0, reason: "this workspace's plan does not include reusable components" },
    layout: { allowed: true, left: 1, reason: null },
  },
}

describe('what a plan may create', () => {
  it('restricts nothing where no workspace was read', () => {
    const unrestricted = aiUnrestrictedPlanCapabilities()
    expect(unrestricted.reusableComponents).toBe(true)
    expect(Object.keys(unrestricted.create).sort()).toEqual([...AI_BUILD_PLAN_CREATE_KINDS].sort())
    for (const kind of AI_BUILD_PLAN_CREATE_KINDS) {
      expect([kind, unrestricted.create[kind]]).toEqual([kind, { allowed: true, left: null, reason: null }])
    }
  })

  it('states one line a kind, the room left where it is counted, and the inline sentence where the workspace needs it', () => {
    expect(aiPlanCapabilityLines(FREE)).toEqual([
      'What this job may create on this site:',
      "- component: no, because this workspace's plan does not include reusable components",
      '- layout: yes, 1 more',
      '- template: yes',
      '- form: yes',
      '- theme change: yes',
      '- dataset: yes',
      '- email design: yes',
      AI_PLAN_INLINE_SENTENCE,
    ])
    expect(aiPlanCapabilityLines(aiUnrestrictedPlanCapabilities())).not.toContain(AI_PLAN_INLINE_SENTENCE)
  })

  it('narrows to what a job builds, keeping the workspace’s own reason where the workspace refuses first', () => {
    const page = aiPlanCapabilitiesForJob(FREE, { noun: 'a page job', creates: ['layout', 'component'] })
    // The workspace's refusal is the one a member can act on.
    expect(page.create.component.reason).toBe("this workspace's plan does not include reusable components")
    expect(page.create.layout).toEqual({ allowed: true, left: 1, reason: null })
    expect(page.create.template).toEqual({ allowed: false, left: null, reason: 'a page job does not build one' })
    expect(page.reusableComponents).toBe(false)
    expect(aiPlanCapabilitiesForJob(FREE, null)).toBe(FREE)
  })

  it('names a creation with its article', () => {
    expect(aiCreationNoun('layout')).toBe('a layout')
    expect(aiCreationNoun('email')).toBe('an email design')
    expect(aiCreationNoun('theme-change')).toBe('a theme change')
  })

  it('says whether a plan could add one more of a kind, counted past the ones it already creates (AGL-3040)', () => {
    const layout = { kind: 'layout' as const, name: 'Site frame', why: 'The site has none.', duplicateOf: null, fields: [] }
    // Room for one more, and the plan has not used it.
    expect(aiPlanUncreatableKind({ create: [] }, 'layout', FREE)).toBeNull()
    // The plan's own layout takes the room, so another would be refused next.
    expect(aiPlanUncreatableKind({ create: [layout] }, 'layout', FREE)).toEqual({
      reason: 'this site has room for 1 more',
      instead: 'Put the page in a layout the site already has.',
    })
    // What the workspace keeps no reusable components for is drawn on the page.
    expect(aiPlanUncreatableKind({ create: [] }, 'component', FREE)).toEqual({
      reason: "this workspace's plan does not include reusable components",
      instead: "Draw a list's repeated items in one section instead.",
    })
    expect(aiPlanUncreatableKind({ create: [layout] }, 'layout', aiUnrestrictedPlanCapabilities())).toBeNull()
  })
})
