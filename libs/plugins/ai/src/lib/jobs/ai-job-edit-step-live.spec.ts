/**
 * @jest-environment node
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
 * An `edit` job's change, made by the REAL model (AGL-3616). The step's own
 * spec feeds hand-written tool calls; this one sends two requests through
 * the real edit step — the real prompt, provider, re-ask and the canvas's own
 * guards — against a page and a layout held in memory, and holds each to a
 * change that landed where no visitor sees it and that did what was asked.
 *
 * It calls the provider and costs real money (a few cents a request), so it
 * runs only when asked: `AGLYN_LIVE_AI=1` with `ANTHROPIC_API_KEY` set, under
 * the replay cache and, for a round, `AGLYN_LIVE_AI_BATCH=1`. See the ladder
 * in `ai-job-site-plan-live.spec.ts`.
 */

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async (hostId: string) => (hostId === 'host-live' ? 'org-live' : null),
}))
jest.mock('./ai-jobs', () => ({ __esModule: true, registerAiJobStep: jest.fn() }))

import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiJob } from '../model/ai-jobs.types'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { aiEvalMemoryFirestore } from '../runtime/ai-eval-memory-firestore'
import { createAiJobEditStep } from './ai-job-edit-step'

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])
const NOW = new Date()
const ROOT = CANVAS_ROOT_ELEMENT_ID
const HEADLINE = 'Brightside Plumbing: friendly, fast, fairly priced plumbing repairs for every home in the valley'
const FOOTER = '© 2026 Brightside Plumbing. All rights reserved.'

const PAGE_NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', parentId: ROOT, props: {}, nodes: ['hero', 'services'] },
  hero: { $id: 'hero', componentId: 'section', parentId: ROOT, name: 'Hero', props: { element: 'section' }, sx: { py: 16 }, nodes: ['heroStack'] },
  heroStack: { $id: 'heroStack', componentId: 'muiStack', parentId: 'hero', props: { spacing: 3 }, nodes: ['heroTitle', 'heroCta'] },
  heroTitle: { $id: 'heroTitle', componentId: 'muiTypography', parentId: 'heroStack', props: { variant: 'h1', children: HEADLINE }, nodes: [] },
  heroCta: { $id: 'heroCta', componentId: 'muiButton', parentId: 'heroStack', props: { children: 'Book a visit' }, nodes: [] },
  services: { $id: 'services', componentId: 'section', parentId: ROOT, props: { element: 'section' }, nodes: ['servicesTitle'] },
  servicesTitle: { $id: 'servicesTitle', componentId: 'muiTypography', parentId: 'services', props: { variant: 'h2', children: 'What we fix' }, nodes: [] },
}

const LAYOUT_NODES = {
  [ROOT]: { $id: ROOT, componentId: 'div', parentId: ROOT, props: {}, nodes: ['footer'] },
  footer: { $id: 'footer', componentId: 'section', parentId: ROOT, name: 'Footer', props: { element: 'footer' }, nodes: ['footerLine'] },
  footerLine: { $id: 'footerLine', componentId: 'muiTypography', parentId: 'footer', props: { variant: 'body2', children: FOOTER }, nodes: [] },
}

const packed = (nodes: Record<string, unknown>) => Buffer.from(encodeStoredNodes(nodes) as Uint8Array)

const HOST = 'hosts/host-live'
const SEED = {
  [HOST]: { orgId: 'org-live', subdomain: 'brightside', screens: { home: '/' } },
  [`${HOST}/screens/home`]: { displayName: 'Home', versionId: 'v-live', slug: '/' },
  [`${HOST}/screens/home/versions/v-live`]: { screenId: 'home', hostId: 'host-live', displayName: 'Initial version', nodes: packed(PAGE_NODES) },
  [`${HOST}/layouts/frame`]: { displayName: 'Site frame', versionId: 'lv-live' },
  [`${HOST}/layouts/frame/versions/lv-live`]: { layoutId: 'frame', hostId: 'host-live', displayName: 'Initial version', nodes: packed(LAYOUT_NODES) },
}

/** The two requests, each with what must hold of the version it wrote. */
const CASES = [
  {
    id: 'page-hero-shorter',
    brief: "Make the home page's hero headline much shorter — a few words, same meaning.",
    inputs: { target: 'home', targetKind: 'screen' },
    written: `${HOST}/screens/home/versions/job-live-page-hero-shorter`,
    holds: (nodes: Record<string, any>) => {
      const text = String(nodes['heroTitle']?.props?.children ?? '')
      return text.length > 0 && text.length < HEADLINE.length / 2 && nodes['servicesTitle']?.props?.children === 'What we fix'
    },
  },
  {
    id: 'layout-footer-line',
    brief: 'Change the footer line to say we are licensed and insured plumbers serving the whole valley.',
    inputs: { target: 'frame', targetKind: 'layout' },
    written: `${HOST}/layouts/frame/versions/job-live-layout-footer-line`,
    holds: (nodes: Record<string, any>) => {
      const text = JSON.stringify(nodes).toLowerCase()
      return text.includes('licensed') && text.includes('insured')
    },
  },
]

function editJob(entry: (typeof CASES)[number]): AiJob {
  return {
    $id: `job-live-${entry.id}`,
    orgId: 'org-live',
    hostId: 'host-live',
    kind: 'edit',
    status: 'running',
    brief: entry.brief,
    inputs: entry.inputs,
    steps: [{ name: 'generate', status: 'running', creditsSpent: 0 }],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
    plan: null,
    review: null,
  } as unknown as AiJob
}

const describeLive = LIVE ? describe : describe.skip

describeLive("an edit job's change from the real model", () => {
  jest.setTimeout(15 * 60_000)

  it('lands each change in a new version beside the live one, doing what was asked', async () => {
    const { firestore, docs } = aiEvalMemoryFirestore(SEED)
    const step = createAiJobEditStep()
    const results = await Promise.all(
      CASES.map(async (entry) => {
        const outcome = (await step({
          job: editJob(entry),
          stepIndex: 0,
          now: NOW,
          firestore,
          org: { plan: 'pro', billingStatus: 'active' },
        } as never)) as unknown as Record<string, unknown>
        const stored = docs.get(entry.written)
        const nodes = stored ? decodeStoredNodes<Record<string, any>>(stored['nodes']) : null
        return {
          id: entry.id,
          failure: outcome['failure'] ?? null,
          review: (outcome['review'] as { message?: string } | undefined)?.message ?? null,
          refused: outcome['refused'] === true,
          written: Boolean(nodes),
          holds: nodes ? entry.holds(nodes) : false,
          note: (outcome['outputs'] as Array<{ note?: string }> | undefined)?.[0]?.note ?? null,
          estCostUsd: Number(outcome['estCostUsd'] ?? 0),
        }
      }),
    )
    console.log(JSON.stringify({ run: aiLiveRunLedger(), results }, null, 1))
    // The live versions are untouched.
    expect(docs.get(`${HOST}/screens/home`)?.['versionId']).toBe('v-live')
    expect(docs.get(`${HOST}/layouts/frame`)?.['versionId']).toBe('lv-live')
    expect(results.filter((result) => !result.written || !result.holds || result.refused)).toEqual([])
  })
})

if (!LIVE) {
  it('is skipped unless AGLYN_LIVE_AI=1 and ANTHROPIC_API_KEY are set', () => {
    expect(LIVE).toBe(false)
  })
}
