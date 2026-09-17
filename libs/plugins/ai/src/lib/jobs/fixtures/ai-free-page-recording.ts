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

import type { AiBuildPlan } from '../../model/ai-build-plan'
import type { AiEvalRecording } from '../../runtime/ai-eval'

/**
 * RECORDED, NOT GOLDEN: the first live recording of the Free page brief
 * (`page-free-law-firm-about`, 2026-09-16), kept as the shape it was written
 * in so the specs can hold the rules to it (AGL-3040). A recording file is
 * never committed; this is the one a spec needs, copied here by hand.
 *
 * Its plan created only the layout, then placed a consultation form it never
 * declared and listed the layout among the hero section's placements. No
 * plan rule refused either, so the plan was kept, and the page step's first
 * pass stopped before building anything: the recording metered the plan
 * alone, and still fit the 300-credit wall it could prove nothing about.
 */

/** The plan the plan step kept, exactly as recorded. */
export const AI_FREE_PAGE_RECORDED_PLAN: AiBuildPlan = {
  reuse: [],
  create: [
    {
      kind: 'layout',
      name: 'main-layout',
      why: 'Site has no layouts; header, nav and footer must live in a layout rather than on the page.',
      duplicateOf: null,
      fields: [
        'layoutSlot:slot',
        'header:region (logo, nav links)',
        'footer:region (firm name, address, phone, copyright)',
      ],
    },
  ],
  screens: [
    {
      title: 'About Us',
      slug: '/about',
      layout: 'new:main-layout',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About Brightwater Law | Our Firm & Practice Areas',
      seoDescription:
        'Meet Brightwater Law: our approach, the four areas we practice, how we work with clients, and how to request a consultation.',
      sections: [
        { name: 'hero', uses: ['new:main-layout'], items: 0 },
        { name: 'who we are', uses: [], items: 0 },
        { name: 'practice areas', uses: [], items: 4 },
        { name: 'how we work with clients', uses: [], items: 3 },
        { name: 'consultation request form', uses: ['new:consultation-form'], items: 0 },
      ],
    },
  ],
}

/** The whole recording, as the live run wrote it. */
export const AI_FREE_PAGE_STOPPED_RECORDING: AiEvalRecording = {
  caseId: 'page-free-law-firm-about',
  candidate: {
    source: 'recorded',
    scope: 'plan',
    step: 'job.page',
    model: 'claude-sonnet-5',
    effort: null,
    plan: AI_FREE_PAGE_RECORDED_PLAN,
    answer: null,
    usage: { inputTokens: 1_064, outputTokens: 1_388, cacheReadTokens: 4_264, cacheWriteTokens: 4_264 },
    steps: [
      {
        step: 'job.plan',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 1_064, outputTokens: 1_388, cacheReadTokens: 4_264, cacheWriteTokens: 4_264 },
        estCostUsd: 0.041281,
        credits: 42,
      },
      {
        step: 'job.layout',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        estCostUsd: 0,
        credits: 0,
      },
    ],
    note: 'stopped: This page needs what the site does not have yet. Create the component “consultation-form” on the Components page, then describe the page again.',
    rubric: {
      structure: 2,
      copy: 4,
      reuse: 2,
      grader: 'claude-opus-5',
      notes:
        'Structure: the consultation form is placed as "new:consultation-form" but never declared in the create list with fields and a rationale, so the brief\'s form is proposed without being created, and the hero section wrongly lists the layout among what it places (the layout already belongs at screen level). Reuse: the layout creation is justified, but the four repeating practice-area blocks and three how-we-work blocks are left as loose items instead of one reusable component each with typed props filled by instances.',
    },
  },
}
