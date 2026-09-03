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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-2551: a preview tab names the document it is previewing.
 *
 * The reported symptom was a tab reading `s66k8CsopK · Screen preview ·
 * aglyn-marketing · Aglyn` for a screen that has been called "Alternatives —
 * Webflow" since it was created — while the SAME screen's besigner tab read
 * the name correctly.
 *
 * AGL-2486 split the title in two: the server puts the id in the subject slot
 * (deliberately — a server-side name lookup on these routes is readable by an
 * anonymous GET), and the client swaps in the loaded name. Every besigner
 * route made the second call; no preview route did, because the snapshot it
 * renders from carries `nodes` and `theme` and no name. The id was not a
 * fallback that fired — it was the only title the route could produce.
 *
 * ## What is asserted, and where
 *
 * The subject STORE, not `document.title`. The rewrite from subject to tab is
 * `ConsoleBrandingEffects`, pinned against the real component and the real
 * MutationObserver in `entity-tab-title.spec.tsx`; re-testing it here would
 * measure that component again rather than the thing that was broken. What
 * was broken is that `DocumentPreview` published nothing, so that is what
 * this drives.
 *
 * The preview MARKER needs no assertion of its own: it is the noun the route
 * layout already passes to `entityPageTitle` (`Screen preview`, sitting where
 * the besigner's title says `Screen besigner`), it is covered by
 * `entity-page-title.spec.ts`, and this change does not touch it. The subject
 * swap is anchored at the START of the title, so it cannot reach the noun.
 *
 * Settle with `waitFor`, never `await act(async () => …)`. This component
 * mounts the site runtimes and arms an 8-second ceiling timer, and an async
 * `act` never returns against it — measured: every assertion here hung to the
 * 30s jest timeout before the switch, which reads as a broken fix rather than
 * a broken harness.
 */

import { render, waitFor } from '@testing-library/react'
import * as Aglyn from '@aglyn/aglyn'

jest.mock('@aglyn/aglyn-node-renderer', () => {
  const actualReact = jest.requireActual('react')
  return {
    __esModule: true,
    useAglynSiteTheme: () => ({}),
    AglynNodeRenderer: () =>
      actualReact.createElement('div', { 'data-testid': 'tree' }, 'rendered'),
  }
})

jest.mock('@aglyn/shared-ui-theme', () => ({
  __esModule: true,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  getGoogleFontsUrl: () => undefined,
  useThemeModeState: () => [['light', 'light']],
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
}))

/**
 * The document each read resolves to, keyed by the path it was asked for.
 * Keyed rather than a single value because the point of one assertion below
 * is WHICH document was read: the parent, not the version, and the collection
 * belonging to the previewed kind.
 */
let mockDocs: Record<string, Record<string, unknown> | undefined>
let mockRequestedPaths: string[]
/** How many document reads have RESOLVED; see `readsSettled`. */
let mockReadsSettled: number

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn(),
  // The real `doc(firestore, ...segments)` returns a reference; the path is
  // all this suite needs from one, so it stands in as the reference itself.
  doc: jest.fn((_firestore: unknown, ...segments: string[]) => {
    const path = segments.join('/')
    mockRequestedPaths.push(path)
    return path
  }),
  getDoc: jest.fn((path: string) =>
    Promise.resolve({ data: () => mockDocs[path] }).finally(() => {
      mockReadsSettled += 1
    }),
  ),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  limit: jest.fn(),
  query: jest.fn(),
}))

jest.mock('../utils/firestore-one-shot-retry', () => ({
  __esModule: true,
  default: (fn: () => unknown) => Promise.resolve(fn()),
}))

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'aglyn:preview:screen:h1:s1:v1',
  readPreviewState: () => ({ nodes: {}, theme: undefined, updatedAt: 0 }),
}))

import DocumentPreview from '../components/document-preview.component'
import {
  getDocumentSubject,
  resetDocumentSubject,
} from '../components/document-subject'

const SCREEN_ID = 's66k8CsopK'
const SCREEN_NAME = 'Alternatives — Webflow'
const VERSION_ID = 'X0ERx7zBRz'
const SCREEN_PATH = `hosts/h1/screens/${SCREEN_ID}`

const screenIds = {
  hostId: 'h1',
  kind: 'screen' as const,
  docId: SCREEN_ID,
  versionId: VERSION_ID,
}

/** Resolves once the component's name read has come back. */
const readsSettled = () =>
  waitFor(() => expect(mockReadsSettled).toBeGreaterThan(0))

/** Resolves once a subject has been published; fails the test if none is. */
const subjectPublished = () =>
  waitFor(() => expect(getDocumentSubject()).not.toBeNull())

describe('a preview tab names the document it previews (AGL-2551)', () => {
  beforeEach(() => {
    resetDocumentSubject()
    mockRequestedPaths = []
    mockReadsSettled = 0
    mockDocs = { [SCREEN_PATH]: { displayName: SCREEN_NAME } }
    jest
      .spyOn(Aglyn.canvas, 'setNodes')
      .mockImplementation(() => undefined as never)
    jest.spyOn(Aglyn.canvas, 'getNode').mockReturnValue(undefined as never)
  })

  afterEach(() => {
    resetDocumentSubject()
    jest.restoreAllMocks()
  })

  it('states its premise: nothing is published before the read lands', () => {
    // The instrument before it is trusted. If the store already held a
    // subject, every assertion below would pass without the read.
    expect(getDocumentSubject()).toBeNull()
  })

  it("publishes the screen's name against the id the server titled with", async () => {
    render(<DocumentPreview ids={screenIds} />)
    await subjectPublished()
    // The bug: this stayed null, so `ConsoleBrandingEffects` had nothing to
    // swap and the tab kept the id.
    expect(getDocumentSubject()).toEqual({ id: SCREEN_ID, name: SCREEN_NAME })
  })

  it('reads the name off the parent document, not the version', async () => {
    // `displayName` is a property of the screen; `AglynScreenVersion` has no
    // such field. Reading version-first — the rule `layoutId` really does
    // follow — would find nothing on every screen there is.
    render(<DocumentPreview ids={screenIds} />)
    await subjectPublished()
    expect(mockRequestedPaths).toContain(SCREEN_PATH)
    expect(mockRequestedPaths.some((path) => path.includes(VERSION_ID))).toBe(
      false,
    )
  })

  it('leaves the id title alone when the document has no name', async () => {
    // A half-loaded subject would flicker the tab through a wrong value; an
    // empty one would blank it. The id is a worse subject than the name and a
    // far better one than nothing.
    mockDocs = { [SCREEN_PATH]: {} }
    render(<DocumentPreview ids={screenIds} />)
    // Waiting on the READ rather than on a bare tick: an empty store is only
    // evidence once the thing that would have filled it has answered.
    await readsSettled()
    expect(getDocumentSubject()).toBeNull()
  })

  it('does not strand the name in a tab that has navigated away', async () => {
    const view = render(<DocumentPreview ids={screenIds} />)
    await subjectPublished()
    view.unmount()
    expect(getDocumentSubject()).toBeNull()
  })

  it.each([
    ['component', 'components'],
    ['layout', 'layouts'],
    ['template', 'templates'],
    ['form', 'forms'],
  ] as const)(
    'names a previewed %s from its own collection',
    async (kind, collectionName) => {
      // The defect was never screen-specific: all five preview routes render
      // through this one component and none of them published a subject.
      mockDocs = {
        [`hosts/h1/${collectionName}/d1`]: { displayName: `A ${kind}` },
      }
      render(
        <DocumentPreview
          ids={{ hostId: 'h1', kind, docId: 'd1', versionId: 'v1' }}
        />,
      )
      await subjectPublished()
      expect(getDocumentSubject()).toEqual({ id: 'd1', name: `A ${kind}` })
    },
  )
})
