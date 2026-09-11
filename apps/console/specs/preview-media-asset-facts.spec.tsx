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
 * Preview draws a replaced film or image the way the published page does
 * (AGL-2849, AGL-2856).
 *
 * The published page lays a placed asset's current DAM records over its node
 * as the last step of composing it (AGL-2807, AGL-2833). Preview composes the
 * draft snapshot itself and renders what it puts in the canvas store, so the
 * facts have to be laid over THAT: the pick's values while the asset's
 * document has not answered, the replacement's once it has, and the pick's
 * again if the read fails.
 */

import * as Aglyn from '@aglyn/aglyn'
import { act, render, waitFor } from '@testing-library/react'

type MockDocState = {
  status: 'loading' | 'success' | 'error'
  data?: Record<string, unknown>
}

const mockDocuments = new Map<string, MockDocState>()
const mockListeners = new Set<() => void>()
let mockVersion = 0

/** What a live listener on `path` delivers next. */
function mockDeliver(path: string, state: MockDocState) {
  mockDocuments.set(path, state)
  mockVersion += 1
  for (const listener of [...mockListeners]) listener()
}

/**
 * The draft the besigner handed Preview: an org film and a site image, as the
 * pick stored them.
 */
function mockSnapshotNodes() {
  return {
    '_@_': { $id: '_@_', componentId: 'div', nodes: ['film', 'photo'] },
    film: {
      $id: 'film',
      componentId: 'video',
      parentId: '_@_',
      props: {
        src: 'media:org:acme/film',
        title: 'The tour',
        durationSeconds: 2,
        intrinsicWidth: 640,
        intrinsicHeight: 360,
        posterFromSource: true,
      },
      nodes: [],
    },
    photo: {
      $id: 'photo',
      componentId: 'image',
      parentId: '_@_',
      props: {
        src: 'media:site1/photo',
        alt: 'The pipeline board',
        intrinsicWidth: 1200,
        intrinsicHeight: 630,
      },
      nodes: [],
    },
  }
}

jest.mock('@aglyn/aglyn-node-renderer', () => ({
  __esModule: true,
  useAglynSiteTheme: () => ({}),
  AglynNodeRenderer: () => null,
}))

jest.mock('@aglyn/shared-ui-theme', () => ({
  __esModule: true,
  ThemeProvider: ({ children }: { children: unknown }) => children,
  getGoogleFontsUrl: () => undefined,
  useThemeModeState: () => [['light', 'light']],
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  const react = jest.requireActual('react')
  return {
    __esModule: true,
    useFirestore: () => 'firestore',
    // A live listener in miniature: its caller re-renders whenever
    // `mockDeliver` hands a path a new state.
    useFirestoreDoc: (buildRef: () => { path: string } | null) => {
      react.useSyncExternalStore(
        (listener: () => void) => {
          mockListeners.add(listener)
          return () => mockListeners.delete(listener)
        },
        () => mockVersion,
      )
      const path = buildRef()?.path
      const state = path ? mockDocuments.get(path) : undefined
      return {
        data: state?.data,
        status: state?.status ?? 'loading',
        error: undefined,
        hasPendingWrites: false,
        fromCache: false,
        serverDenied: false,
      }
    },
  }
})

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn(),
  doc: (_firestore: unknown, path: string) => ({ path }),
  getDoc: jest.fn(() => Promise.resolve({ data: () => undefined })),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  limit: jest.fn(),
  query: jest.fn(),
}))

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'k',
  readPreviewState: () => ({ nodes: mockSnapshotNodes(), theme: undefined }),
}))

import DocumentPreview from '../components/document-preview.component'

const FILM_DOCUMENT = 'orgs/acme/media/film'
const PHOTO_DOCUMENT = 'hosts/site1/media/photo'
const REPLACED = { durationMs: 3000, width: 480, height: 480 }

/** A node's props as Preview put them in the store it renders. */
const shownProps = (id: string) =>
  (Aglyn.canvas.getNode(id) as { props?: Record<string, unknown> } | undefined)
    ?.props
const shownFilm = () => shownProps('film')
const shownPhoto = () => shownProps('photo')

const openPreview = () =>
  render(
    <DocumentPreview ids={{ hostId: 'site1', kind: 'screen', docId: 's1' }} />,
  )

beforeEach(() => {
  mockDocuments.clear()
  mockListeners.clear()
  Aglyn.canvas.reset()
})

describe("Preview lays a placed asset's current DAM facts over the draft (AGL-2849, AGL-2856)", () => {
  it("renders the pick's values while the film's document has not answered", async () => {
    openPreview()
    await waitFor(() => expect(shownFilm()?.['intrinsicWidth']).toBe(640))
    expect(shownFilm()).toMatchObject({
      intrinsicHeight: 360,
      durationSeconds: 2,
      posterFromSource: true,
    })
  })

  it('follows a replace to the new film', async () => {
    openPreview()
    await waitFor(() => expect(shownFilm()?.['intrinsicWidth']).toBe(640))
    act(() =>
      mockDeliver(FILM_DOCUMENT, {
        status: 'success',
        data: { video: REPLACED, visibleTo: ['org'] },
      }),
    )
    await waitFor(() =>
      expect(shownFilm()).toMatchObject({
        intrinsicWidth: 480,
        intrinsicHeight: 480,
        durationSeconds: 3,
      }),
    )
    // The replacement has no generated poster, so Preview offers none.
    expect(shownFilm()).not.toHaveProperty('posterFromSource')
  })

  it("returns to the pick's values when the read fails", async () => {
    openPreview()
    await waitFor(() => expect(shownFilm()?.['intrinsicWidth']).toBe(640))
    act(() =>
      mockDeliver(FILM_DOCUMENT, {
        status: 'success',
        data: { video: REPLACED, visibleTo: ['org'] },
      }),
    )
    await waitFor(() => expect(shownFilm()?.['intrinsicWidth']).toBe(480))
    act(() => mockDeliver(FILM_DOCUMENT, { status: 'error' }))
    await waitFor(() => expect(shownFilm()?.['intrinsicWidth']).toBe(640))
  })

  it("reserves the replacement's box for an image the replace reshaped", async () => {
    openPreview()
    await waitFor(() => expect(shownPhoto()?.['intrinsicWidth']).toBe(1200))
    act(() =>
      mockDeliver(PHOTO_DOCUMENT, {
        status: 'success',
        data: { width: 480, height: 480 },
      }),
    )
    await waitFor(() =>
      expect(shownPhoto()).toMatchObject({
        intrinsicWidth: 480,
        intrinsicHeight: 480,
      }),
    )
    // The film has not answered, so it still renders as the pick stored it.
    expect(shownFilm()).toMatchObject({ intrinsicWidth: 640, intrinsicHeight: 360 })
  })
})
