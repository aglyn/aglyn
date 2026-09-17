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

import type { AiEvalRecording } from '../../runtime/ai-eval'

/**
 * RECORDED, NOT GOLDEN: the live recording of the Free page brief
 * (`page-free-law-firm-about`, 2026-09-17) that built the page end to end, on
 * `claude-sonnet-5` at 254 metered credits. A recording file is never
 * committed; this is the part a spec needs, copied from it.
 *
 * Trimmed to the page's first section: the root lists only that section, and
 * every node kept is as the draft stored it. The plan, the metered steps and
 * the grade are whole. The grader was shown the tree alone, and its notes mark
 * the page down for a layout, a main landmark and a listing the page had: the
 * plan created `main-layout`, a layout pass built it, and the screen carried
 * `/about` with a search title and description.
 */
export const AI_FREE_PAGE_BUILT_RECORDING: AiEvalRecording = {
  caseId: 'page-free-law-firm-about',
  candidate: {
    source: 'recorded',
    scope: 'full',
    step: 'job.page',
    model: 'claude-sonnet-5',
    effort: null,
    plan: {
      reuse: [],
      create: [
        {
          kind: 'layout',
          name: 'main-layout',
          why: 'Site has no layout yet; header, navigation and footer must live in a layout rather than on the page.',
          duplicateOf: null,
          fields: [
            'header: logo + nav links (Home, About, Practice Areas, Contact)',
            'footer: firm name, address, phone, copyright',
          ],
        },
      ],
      screens: [
        {
          title: 'About Brightwater Law',
          slug: '/about',
          layout: 'new:main-layout',
          template: null,
          duplicateOf: null,
          nav: true,
          seoTitle: 'About Brightwater Law | Our Firm & Practice Areas',
          seoDescription: 'Learn who Brightwater Law is, the four areas we practice, how we work with clients, and request a consultation.',
          sections: [
            { name: 'hero', uses: [], items: 0 },
            { name: 'who we are', uses: [], items: 0 },
            { name: 'practice area: business & corporate law', uses: [], items: 1 },
            { name: 'practice area: real estate law', uses: [], items: 1 },
            { name: 'practice area: family law', uses: [], items: 1 },
            { name: 'practice area: estate planning', uses: [], items: 1 },
            { name: 'how we work with clients', uses: [], items: 3 },
            { name: 'request a consultation form', uses: [], items: 0 },
          ],
        },
      ],
    },
    answer: {
      tree: {
        rootId: '_@_',
        nodes: {
          '_@_': { $id: '_@_', componentId: 'div', parentId: null, nodes: ['ai-eval-page-fr-section-1'] },
          'ai-eval-page-fr-section-1': {
            $id: 'ai-eval-page-fr-section-1',
            type: 'node',
            componentId: 'section',
            pluginId: 'mui',
            parentId: '_@_',
            nodes: ['kUk5o1Ekv0'],
            props: { element: 'section', ariaLabel: 'Hero' },
          },
          kUk5o1Ekv0: {
            $id: 'kUk5o1Ekv0',
            type: 'node',
            componentId: 'muiStack',
            pluginId: 'mui',
            parentId: 'ai-eval-page-fr-section-1',
            nodes: ['ggok0RX2Xx', 'Nh44I1DEPm', 'IxdLHxS6ds', 'Jgquy_nSMC'],
            props: { direction: 'column', alignItems: 'flex-start', justifyContent: 'center' },
            sx: { py: 8, gap: 2 },
          },
          ggok0RX2Xx: {
            $id: 'ggok0RX2Xx',
            type: 'node',
            componentId: 'muiTypography',
            pluginId: 'mui',
            parentId: 'kUk5o1Ekv0',
            nodes: [],
            props: { children: 'Brightwater Law', variant: 'subtitle1', component: 'p' },
            sx: { color: 'secondary.main' },
          },
          Nh44I1DEPm: {
            $id: 'Nh44I1DEPm',
            type: 'node',
            componentId: 'muiTypography',
            pluginId: 'mui',
            parentId: 'kUk5o1Ekv0',
            nodes: [],
            props: { children: 'About Brightwater Law', variant: 'h1', component: 'h1' },
          },
          IxdLHxS6ds: {
            $id: 'IxdLHxS6ds',
            type: 'node',
            componentId: 'muiTypography',
            pluginId: 'mui',
            parentId: 'kUk5o1Ekv0',
            nodes: [],
            props: {
              children: 'We are a client-focused law firm guiding individuals, families and businesses through the moments that matter most, with',
              variant: 'h5',
              component: 'p',
            },
            sx: { color: 'text.secondary', maxWidth: 'sm' },
          },
          Jgquy_nSMC: {
            $id: 'Jgquy_nSMC',
            type: 'node',
            componentId: 'muiButton',
            pluginId: 'mui',
            parentId: 'kUk5o1Ekv0',
            nodes: [],
            props: {
              children: 'Request a Consultation',
              color: 'primary',
              variant: 'contained',
              size: 'large',
              target: '_self',
            },
          },
        },
      },
    },
    usage: { inputTokens: 11_889, outputTokens: 8_973, cacheReadTokens: 67_194, cacheWriteTokens: 18_103 },
    steps: [
      {
        step: 'job.plan',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 1_064, outputTokens: 1_320, cacheReadTokens: 4_293, cacheWriteTokens: 4_293 },
        estCostUsd: 0.040379,
        credits: 41,
      },
      {
        step: 'job.layout',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 987, outputTokens: 1_113, cacheReadTokens: 6_797, cacheWriteTokens: 6_797 },
        estCostUsd: 0.047184,
        credits: 48,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 590, outputTokens: 525, cacheReadTokens: 0, cacheWriteTokens: 7_013 },
        estCostUsd: 0.035944,
        credits: 36,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 597, outputTokens: 520, cacheReadTokens: 7_013, cacheWriteTokens: 0 },
        estCostUsd: 0.011695,
        credits: 12,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 703, outputTokens: 935, cacheReadTokens: 7_013, cacheWriteTokens: 0 },
        estCostUsd: 0.018238,
        credits: 19,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 715, outputTokens: 924, cacheReadTokens: 7_013, cacheWriteTokens: 0 },
        estCostUsd: 0.018109,
        credits: 19,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 725, outputTokens: 511, cacheReadTokens: 7_013, cacheWriteTokens: 0 },
        estCostUsd: 0.011944,
        credits: 12,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 737, outputTokens: 1_014, cacheReadTokens: 7_013, cacheWriteTokens: 0 },
        estCostUsd: 0.019525,
        credits: 20,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 747, outputTokens: 931, cacheReadTokens: 7_013, cacheWriteTokens: 0 },
        estCostUsd: 0.01831,
        credits: 19,
      },
      {
        step: 'job.page',
        model: 'claude-sonnet-5',
        usage: { inputTokens: 1_363, outputTokens: 968, cacheReadTokens: 14_026, cacheWriteTokens: 0 },
        estCostUsd: 0.022817,
        credits: 23,
      },
      {
        step: 'job.seo',
        model: 'claude-haiku-4-5',
        usage: { inputTokens: 3_661, outputTokens: 212, cacheReadTokens: 0, cacheWriteTokens: 0 },
        estCostUsd: 0.004721,
        credits: 5,
      },
    ],
    rubric: {
      structure: 2,
      copy: 3,
      reuse: 4,
      grader: 'claude-opus-5',
      notes: 'Structure is the weakest: no layout is declared or created (the job allows one, and the site has none, so the page ships with no header/nav/footer), there is no `main` landmark, and no slug, search title/description or nav entry travels with the screen. Inside the tree the four practice sections are built three different ways (plain list, primary/secondary list, bare paragraph), and one ListItemText is left completely empty. Copy is otherwise in the right professional register, but the hero subhead is cut off mid-sentence ("...the moments that matter most, with"), and the hero button has no destination.',
    },
  },
}
