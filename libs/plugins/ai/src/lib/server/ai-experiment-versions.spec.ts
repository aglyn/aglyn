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
 * A page's or a section's A/B variants as draft versions (AGL-3603), and the
 * proof that it is DRAFTS ONLY: each variant past the control gets a NEW
 * version holding its copy, the published version and the screen document
 * are byte-for-byte what they were, a second press makes nothing new, and a
 * section test changes nothing outside its section.
 */

type Doc = Record<string, unknown>

let mockDocs = new Map<string, Doc>()
const mockWrites: string[] = []

function mockSnapshot(path: string) {
  const data = mockDocs.get(path)
  return { id: path.split('/').pop() as string, exists: data !== undefined, data: () => data, get: (field: string) => (data ?? {})[field] }
}
function mockRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => ({ doc: (id: string) => mockRef(`${path}/${name}/${id}`) }),
    get: async () => mockSnapshot(path),
    set: async (data: Doc) => {
      mockWrites.push(path)
      mockDocs.set(path, data)
    },
  }
}
const mockFirestore = {
  collection: (name: string) => ({ doc: (id: string) => mockRef(`${name}/${id}`) }),
} as unknown as FirebaseFirestore.Firestore

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__now__' },
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements').checkEntitlement,
  createResourceUid: () => 'uid',
  // Stored uncompressed here, so the spec reads the node map back as it was written.
  encodeStoredNodes: () => null,
  hostRoleCanWrite: jest.requireActual('@aglyn/aglyn/app-utils/organizations').hostRoleCanWrite,
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({ __esModule: true, lockdownRefusal: async () => null }))
jest.mock('./ai-jobs-gate', () => ({ __esModule: true, aiJobsGate: jest.fn() }))

import type { AiExperimentVariantsProposalView } from '../model/ai-experiment-proposal'
import { applyAiExperimentVariantCopy } from '../runtime/experiment-variant-copy'
import {
  aiExperimentVersionId,
  aiExperimentVersionName,
  createAiExperimentVersions,
} from './ai-experiment-versions'

const NODES: Record<string, Doc> = {
  _: { $id: '_', componentId: 'div', parentId: null, nodes: ['hero', 'other'] },
  hero: { $id: 'hero', componentId: 'muiBox', parentId: '_', nodes: ['h', 'p', 'rich'] },
  h: { $id: 'h', componentId: 'muiTypography', parentId: 'hero', props: { variant: 'h1', children: 'Roofs done right' }, nodes: [] },
  p: { $id: 'p', componentId: 'muiTypography', parentId: 'hero', props: { variant: 'body1', children: 'Free quotes.' }, nodes: [] },
  rich: { $id: 'rich', componentId: 'muiTypography', parentId: 'hero', props: { html: '<b>x</b>' }, nodes: [] },
  other: { $id: 'other', componentId: 'muiBox', parentId: '_', nodes: ['h2', 'p2'] },
  h2: { $id: 'h2', componentId: 'muiTypography', parentId: 'other', props: { variant: 'h2', children: 'Our work' }, nodes: [] },
  p2: { $id: 'p2', componentId: 'muiTypography', parentId: 'other', props: { children: 'Ten years.' }, nodes: [] },
}

const SCREEN = 'hosts/host-1/screens/scr-1'
const PUBLISHED = `${SCREEN}/versions/v-live`

const proposal: AiExperimentVariantsProposalView = {
  target: 'section',
  goal: 'quotes',
  variants: [
    { name: 'A (control)', headline: 'Roofs done right', body: 'Free quotes.', subject: '', preheader: '', rationale: '' },
    { name: 'B — speed', headline: 'A new roof in a week', body: 'Quotes in a day.', subject: '', preheader: '', rationale: '' },
    { name: 'C — price', headline: 'Fixed prices', body: '', subject: '', preheader: '', rationale: '' },
  ],
}

beforeEach(() => {
  mockWrites.length = 0
  mockDocs = new Map([
    [SCREEN, { versionId: 'v-live', name: 'Home' }],
    [PUBLISHED, { displayName: 'Live', rootId: '_', nodes: NODES }],
  ])
})

describe('a variant’s copy in a copy of the page', () => {
  it('puts the headline in the first heading and the body in the first text after it, within the region', () => {
    const result = applyAiExperimentVariantCopy(NODES, { headline: 'New', body: 'Body' }, 'other')
    expect(result.changed).toEqual(['headline', 'body'])
    expect((result.nodes['h2'].props as Doc)['children']).toBe('New')
    expect((result.nodes['p2'].props as Doc)['children']).toBe('Body')
    // Outside the region, and the map it was handed, are untouched.
    expect((result.nodes['h'].props as Doc)['children']).toBe('Roofs done right')
    expect((NODES['h2'].props as Doc)['children']).toBe('Our work')
  })

  it('never rewrites rich text, and says why when nothing could take the copy', () => {
    const result = applyAiExperimentVariantCopy(NODES, { headline: 'New', body: 'Body' }, 'rich')
    expect(result.changed).toEqual([])
    expect(result.reason).toMatch(/no plain heading or text/)
    expect(applyAiExperimentVariantCopy(NODES, { headline: 'x', body: '' }, 'gone').reason).toMatch(/no longer there/)
  })
})

describe('the draft versions', () => {
  const run = (nodeId: string | null) =>
    createAiExperimentVersions(mockFirestore, {
      hostId: 'host-1',
      screenId: 'scr-1',
      nodeId,
      job: { $id: 'job-1' },
      proposal,
      uid: 'u1',
      now: new Date('2026-10-06T12:00:00Z'),
    })

  it('makes one unpublished version per variant past the control, and touches nothing live', async () => {
    const live = JSON.stringify(mockDocs.get(PUBLISHED))
    const screen = JSON.stringify(mockDocs.get(SCREEN))
    const result = await run('hero')

    expect(result.refusal).toBeNull()
    expect(result.versions).toEqual([
      { index: 1, name: 'A/B: B — speed', versionId: aiExperimentVersionId('job-1', 1), changed: ['headline', 'body'] },
      { index: 2, name: 'A/B: C — price', versionId: aiExperimentVersionId('job-1', 2), changed: ['headline'] },
    ])
    expect(mockWrites).toEqual([`${SCREEN}/versions/ab-job-1-1`, `${SCREEN}/versions/ab-job-1-2`])
    const b = mockDocs.get(`${SCREEN}/versions/ab-job-1-1`) as { nodes: Record<string, Doc>; displayName: string }
    expect(b.displayName).toBe('A/B: B — speed')
    expect((b.nodes['h'].props as Doc)['children']).toBe('A new roof in a week')
    expect((b.nodes['p'].props as Doc)['children']).toBe('Quotes in a day.')
    // The section test changes nothing outside its section.
    expect((b.nodes['h2'].props as Doc)['children']).toBe('Our work')
    expect(JSON.stringify(mockDocs.get(PUBLISHED))).toBe(live)
    expect(JSON.stringify(mockDocs.get(SCREEN))).toBe(screen)
  })

  it('finds the versions it made on a second press, and makes nothing new', async () => {
    await run('hero')
    mockWrites.length = 0
    const again = await run('hero')
    expect(mockWrites).toEqual([])
    expect(again.versions.map((entry) => entry.versionId)).toEqual(['ab-job-1-1', 'ab-job-1-2'])
  })

  it('works on the page’s content for a page test', async () => {
    const result = await run(null)
    expect(result.versions).toHaveLength(2)
    const b = mockDocs.get(`${SCREEN}/versions/ab-job-1-1`) as { nodes: Record<string, Doc> }
    expect((b.nodes['h'].props as Doc)['children']).toBe('A new roof in a week')
  })

  it('refuses a page with no published version to start from', async () => {
    mockDocs.set(SCREEN, { name: 'Home' })
    expect((await run(null)).refusal).toMatch(/no published version/)
    expect(mockWrites).toEqual([])
  })

  it('names a version for its variant, within the list’s length', () => {
    expect(aiExperimentVersionName('  ', 2)).toBe('A/B: Variant 3')
    expect(aiExperimentVersionName('x'.repeat(200), 1).length).toBe(80)
  })
})
