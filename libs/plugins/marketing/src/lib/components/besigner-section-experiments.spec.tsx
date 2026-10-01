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
 * The section experiments the besigner's Interactions section shows are this
 * plugin's records, reported through the `besignerInteractions` zone. The
 * console names no experiment collection; this widget reads it, reports what
 * the section badges, and is the one place a draft is started.
 */

import type { ConsoleBesignerSectionExperiments } from '@aglyn/aglyn'
import { act, render, waitFor } from '@testing-library/react'

const FIRESTORE = {}

/** What the site's experiments collection answers. */
let mockExperimentDocs: Array<Record<string, unknown>> = []
/** The paths each read was built over. */
let mockReadPaths: string[] = []
/** Every write the widget staged through the site-wide door: path and payload. */
let mockWrites: Array<{ path: string; data: Record<string, any> }> = []
/** The site each site-wide change was announced for. */
let mockSiteWideHosts: string[] = []
const mockSnackbar = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    mockReadPaths.push(String(built?.path ?? ''))
    return { data: mockExperimentDocs, status: 'success', fromCache: false }
  },
}))

/**
 * The door every write of something a page renders goes through: the batch
 * it hands over records what was staged, and the site it was asked to drop.
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () => ({
  writeSiteWideChange: async (options: {
    hostId: string
    write: (batch: { set: (ref: { path: string }, data: Record<string, any>) => void }) => void
  }) => {
    mockSiteWideHosts.push(options.hostId)
    options.write({
      set: (ref, data) => {
        mockWrites.push({ path: ref.path, data })
      },
    })
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  query: (base: any) => ({ path: base?.path }),
  limit: (value: number) => ({ limit: value }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

import BesignerSectionExperiments from './besigner-section-experiments'

/** The reports the widget made, in order, as the section received them. */
function reporter() {
  const reports: Array<[string, ConsoleBesignerSectionExperiments | null]> = []
  const report = jest.fn(
    (reporterId: string, value: ConsoleBesignerSectionExperiments | null) => {
      reports.push([reporterId, value])
    },
  )
  return { report, reports, last: () => reports[reports.length - 1] }
}

beforeEach(() => {
  mockExperimentDocs = []
  mockReadPaths = []
  mockWrites = []
  mockSiteWideHosts = []
  mockSnackbar.mockReset()
})

describe('BesignerSectionExperiments', () => {
  it('reports the site’s live section experiments, and only those', () => {
    mockExperimentDocs = [
      { $id: 'exp-1', target: 'section', nodeId: 'hero', name: 'Hero', status: 'running' },
      { $id: 'exp-2', target: 'section', nodeId: 'cta', deletedAt: 1 },
      { $id: 'exp-3', target: 'screen', screenId: 'screen-1' },
      { $id: 'exp-4', target: 'section' },
    ]
    const { report, last } = reporter()
    const { container } = render(
      <BesignerSectionExperiments
        hostId="host-1"
        screenId="screen-1"
        reportSectionExperiments={report}
      />,
    )
    // It draws nothing: the section renders what was reported.
    expect(container.innerHTML).toBe('')
    expect(mockReadPaths).toContain('hosts/host-1/experiments')
    const [reporterId, value] = last() ?? []
    expect(reporterId).toBe('marketing-section-experiments')
    expect(value?.experiments).toEqual([
      { id: 'exp-1', name: 'Hero', nodeId: 'hero', status: 'running' },
    ])
    expect(typeof value?.create).toBe('function')
  })

  it('starts a draft on the page under edit, with two even variants', async () => {
    const { report, last } = reporter()
    render(
      <BesignerSectionExperiments
        hostId="host-1"
        screenId="screen-1"
        reportSectionExperiments={report}
      />,
    )
    act(() => {
      last()?.[1]?.create?.({ nodeId: 'node-abcdefghij' })
    })
    await waitFor(() => expect(mockWrites).toHaveLength(1))
    // Through the site-wide door, for the site the experiment is on.
    expect(mockSiteWideHosts).toEqual(['host-1'])
    const [write] = mockWrites
    expect(write.path).toMatch(/^hosts\/host-1\/experiments\/[^/]+$/)
    expect(write.data).toMatchObject({
      status: 'draft',
      target: 'section',
      screenId: 'screen-1',
      nodeId: 'node-abcdefghij',
      variants: [
        { id: 'a', name: 'A (control)', weight: 1 },
        { id: 'b', name: 'B', weight: 1 },
      ],
      goal: { event: 'formSubmission' },
    })
    await waitFor(() =>
      expect(mockSnackbar).toHaveBeenCalledWith(
        expect.stringContaining('Draft experiment created'),
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('offers no start on a document that is not a page', () => {
    mockExperimentDocs = [{ $id: 'exp-1', target: 'section', nodeId: 'hero' }]
    const { report, last } = reporter()
    render(
      <BesignerSectionExperiments
        hostId="host-1"
        screenId={null}
        reportSectionExperiments={report}
      />,
    )
    // The badge still has its experiment; there is just nothing to start.
    expect(last()?.[1]?.experiments).toHaveLength(1)
    expect(last()?.[1]).not.toHaveProperty('create')
  })

  it('withdraws its report when the zone stops drawing it', () => {
    const { report, last } = reporter()
    const { unmount } = render(
      <BesignerSectionExperiments
        hostId="host-1"
        screenId="screen-1"
        reportSectionExperiments={report}
      />,
    )
    unmount()
    expect(last()).toEqual(['marketing-section-experiments', null])
  })
})
