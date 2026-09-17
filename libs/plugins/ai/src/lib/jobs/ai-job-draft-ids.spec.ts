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

import { RESOURCE_ID_LENGTH } from '@aglyn/aglyn/foundation/constants/app'
import type { AiBuildPlan } from '../model/ai-build-plan'
import { AI_JOB_KINDS, type AiJob } from '../model/ai-jobs.types'
import {
  AI_JOB_DRAFT_SLOTS,
  aiJobDraftId,
  aiMintJobDraftIds,
  aiPlanWithDraftIds,
  aiRecordedJobDraftId,
} from './ai-job-draft-ids'

/** A console resource id: `createResourceUid()`'s nanoid. */
const RESOURCE_ID = new RegExp(`^[A-Za-z0-9_-]{${RESOURCE_ID_LENGTH}}$`)

const PLAN: AiBuildPlan = {
  reuse: [],
  create: [
    { kind: 'component', name: 'Price tier', why: 'No card lists a price.', duplicateOf: null, fields: [] },
    { kind: 'layout', name: 'Site frame', why: 'The site has no layout.', duplicateOf: null, fields: [] },
    { kind: 'form', name: 'Quote request', why: 'No form asks for a quote.', duplicateOf: null, fields: [] },
    { kind: 'theme-change', name: 'Warmer palette', why: 'The brief asks for warmth.', duplicateOf: null, fields: [] },
  ],
  screens: [
    {
      title: 'Pricing',
      slug: '/pricing',
      layout: 'new:Site frame',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Pricing',
      seoDescription: 'What each plan costs.',
      sections: [{ name: 'tiers', uses: ['new:Price tier'], items: 3 }],
    },
    {
      title: 'Contact',
      slug: '/contact',
      layout: 'new:Site frame',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Contact',
      seoDescription: 'Ask for a quote.',
      sections: [{ name: 'form', uses: ['new:Quote request'], items: 0 }],
    },
  ],
}

function job(patch: Partial<AiJob> = {}): Pick<AiJob, '$id' | 'steps'> {
  return { $id: 'job-1', steps: [], ...patch }
}

describe('the ids a job names its drafts by (AGL-3079)', () => {
  it('mints a console resource id for every draft a kind always writes, and none for a kind that writes none', () => {
    for (const kind of AI_JOB_KINDS) {
      const ids = aiMintJobDraftIds(kind)
      const slots = AI_JOB_DRAFT_SLOTS[kind] ?? []
      if (!slots.length) {
        expect([kind, ids]).toEqual([kind, null])
        continue
      }
      expect([kind, Object.keys(ids ?? {})]).toEqual([kind, slots])
      for (const id of Object.values(ids ?? {})) expect([kind, id]).toEqual([kind, expect.stringMatching(RESOURCE_ID)])
    }
    // A campaign writes two drafts, each named by an id of its own.
    const campaign = aiMintJobDraftIds('campaign')
    expect(campaign?.email).not.toEqual(campaign?.campaign)
    // Minted fresh for every job.
    expect(aiMintJobDraftIds('layout')?.layout).not.toEqual(aiMintJobDraftIds('layout')?.layout)
  })

  it('reads the id recorded on the step that writes the draft, whichever step records it', () => {
    const recorded = job({
      steps: [
        { name: 'plan', status: 'done', creditsSpent: 1 },
        { name: 'generate', status: 'running', creditsSpent: 0, draftIds: { email: 'mailDraft1', campaign: 'campDraft1' } },
      ],
    })
    expect(aiJobDraftId(recorded, 'email')).toBe('mailDraft1')
    expect(aiJobDraftId(recorded, 'campaign')).toBe('campDraft1')
    expect(aiRecordedJobDraftId(recorded, 'campaign')).toBe('campDraft1')
  })

  it('names the draft by the job itself where no step records an id: a unit’s job, which is named by its draft', () => {
    expect(aiRecordedJobDraftId(job(), 'layout')).toBeNull()
    expect(aiJobDraftId(job({ $id: 'unitDraft1' }), 'layout')).toBe('unitDraft1')
    // A record of another draft is not this draft's.
    const other = job({ steps: [{ name: 'generate', status: 'running', creditsSpent: 0, draftIds: { screen: 'scrDraft01' } }] })
    expect(aiJobDraftId(other, 'form')).toBe('job-1')
  })
})

describe('the ids a plan names its drafts by (AGL-3079)', () => {
  it('names each creation a page job builds, and leaves the page itself to the job’s own record', () => {
    const plan = aiPlanWithDraftIds('page', PLAN)
    const ids = plan.create.map((entry) => entry.id)
    expect(ids.slice(0, 3)).toEqual([
      expect.stringMatching(RESOURCE_ID),
      expect.stringMatching(RESOURCE_ID),
      expect.stringMatching(RESOURCE_ID),
    ])
    expect(new Set(ids.slice(0, 3)).size).toBe(3)
    // A palette change is a proposal, never a document.
    expect(plan.create[3]).toEqual(PLAN.create[3])
    expect(plan.screens).toEqual(PLAN.screens)
    // Everything the model answered is kept as it was.
    expect(plan.create).toEqual(PLAN.create.map((entry, index) => ({ ...entry, ...(index < 3 ? { id: ids[index] } : {}) })))
  })

  it('names every creation and every page a scaffold builds', () => {
    const plan = aiPlanWithDraftIds('site', PLAN)
    expect(plan.screens.map((screen) => screen.id)).toEqual([
      expect.stringMatching(RESOURCE_ID),
      expect.stringMatching(RESOURCE_ID),
    ])
    expect(plan.create.slice(0, 3).every((entry) => RESOURCE_ID.test(entry.id ?? ''))).toBe(true)
    expect(plan.create[3].id).toBeUndefined()
  })

  it('renames the drafts of a plan reused from another job, so the two jobs never share a draft', () => {
    const earlier = aiPlanWithDraftIds('page', PLAN)
    const reused = aiPlanWithDraftIds('page', earlier)
    for (const [index, entry] of reused.create.slice(0, 3).entries()) {
      expect(entry.id).toMatch(RESOURCE_ID)
      expect(entry.id).not.toEqual(earlier.create[index].id)
    }
  })

  it('keeps any other kind’s plan as it is: its own draft is named on its step', () => {
    for (const kind of ['layout', 'template', 'form', 'component', 'email'] as const) {
      expect(aiPlanWithDraftIds(kind, PLAN)).toBe(PLAN)
    }
  })
})
