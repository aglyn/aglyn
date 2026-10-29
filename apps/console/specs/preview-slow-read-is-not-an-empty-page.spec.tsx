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
 * AGL-4101: a slow or failed read is not a page with nothing saved.
 *
 * The reported symptom: a page whose saved version exists showed "Nothing to
 * preview yet — This page has no saved version to render" while another
 * console tab was open, and rendered in full from a fresh tab. The stored
 * reads were plain `getDoc`s, which never settle while another tab holds the
 * shared cache; the 8-second ceiling then set `storedNodes` to `null`, the
 * same value a document with nothing saved produces, so the preview printed
 * the refusal over a page that had a version.
 *
 * The reads are mocked at `getDocBounded`, the seam the component reads
 * through, so each test decides whether a read answers, hangs or fails.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import * as Aglyn from '@aglyn/aglyn'

jest.mock('@aglyn/aglyn-node-renderer', () => {
  const actualReact = jest.requireActual('react')
  return {
    __esModule: true,
    useAglynSiteSchemeThemes: () => undefined,
    useAglynSiteTheme: () => ({}),
    AglynNodeRenderer: () =>
      actualReact.createElement('div', { 'data-testid': 'tree' }, 'rendered'),
  }
})

jest.mock('@aglyn/shared-ui-theme', () => ({
  __esModule: true,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  getGoogleFontsUrl: () => undefined,
  SiteSchemeThemesContext: {
    Provider: ({ children }: { children: unknown }) => children,
  },
  useThemeModeState: () => [['light', 'light']],
}))

/**
 * One instance for every render, as the real hook returns. A fresh object per
 * render re-runs the read effect on each commit, so the read a test answers
 * late would belong to an effect that has already been cancelled.
 */
const mockFirestore = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn(),
  // The path stands in for the reference; it is all the reads need.
  doc: jest.fn((_firestore: unknown, ...segments: string[]) =>
    segments.join('/'),
  ),
  // The site read, which this suite answers at once.
  getDoc: jest.fn(() =>
    Promise.resolve({ data: () => ({}), get: () => undefined }),
  ),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  limit: jest.fn(),
  query: jest.fn(),
}))

/**
 * What each stored-document read does, keyed by path: a document to answer
 * with, `'hang'` for a read that never settles, or `'fail'` for one that
 * rejects. A path not listed answers as a document that does not exist.
 */
let mockReads: Record<string, Record<string, unknown> | 'hang' | 'fail'>
/** Settles a hung read later, keyed by path. */
let mockPending: Record<string, (data: Record<string, unknown>) => void>

const snapshotOf = (data: Record<string, unknown> | undefined) => ({
  data: () => data,
  get: (field: string) => data?.[field],
})

jest.mock(
  '@aglyn/tenant-feature-instance/hooks/firebase/firestore-bounded-read',
  () => ({
    __esModule: true,
    getDocBounded: jest.fn((path: string) => {
      const read = mockReads[path]
      if (read === 'fail') {
        return Promise.reject(
          Object.assign(new Error('nothing cached'), { code: 'unavailable' }),
        )
      }
      if (read === 'hang') {
        return new Promise((resolve) => {
          mockPending[path] = (data) =>
            resolve({ snapshot: snapshotOf(data), stale: false })
        })
      }
      return Promise.resolve({ snapshot: snapshotOf(read), stale: false })
    }),
  }),
)

jest.mock('../utils/firestore-one-shot-retry', () => ({
  __esModule: true,
  default: (fn: () => unknown) => Promise.resolve(fn()),
}))

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'aglyn:preview:screen:h1:s1:v1',
  // No besigner snapshot: the stored document is the only source.
  readPreviewState: () => null,
}))

import DocumentPreview, {
  DEFINITIONS_TIMEOUT_MS,
} from '../components/document-preview.component'

const SCREEN_PATH = 'hosts/h1/screens/s1'
const VERSION_PATH = `${SCREEN_PATH}/versions/v1`

const IDS = {
  hostId: 'h1',
  kind: 'screen' as const,
  docId: 's1',
  versionId: 'v1',
}

const SAVED_VERSION = {
  nodes: {
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      parentId: null,
      nodes: [],
    },
  },
}

const REFUSAL = /Nothing to preview yet/i
const NOT_LOADED = /hasn't loaded yet/i

/**
 * Under the fake clock: lets the promise chain behind each read run to its
 * end, then lets React commit what it scheduled.
 *
 * Never `await act(async () => …)`: this component mounts the site runtimes
 * and arms an 8-second ceiling, and an async `act` never returns against it
 * (the finding recorded in `preview-tab-names-the-document.spec.tsx`). React's
 * scheduler took the real `setImmediate` when it loaded, so a real macrotask
 * lets it commit, and a synchronous `act` runs whatever the fake clock holds
 * at zero delay.
 */
async function flush() {
  for (let round = 0; round < 10; round += 1) {
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    await new Promise<void>((resolve) => realSetImmediate(resolve))
    act(() => {
      jest.advanceTimersByTime(0)
    })
  }
}

/** A real macrotask, which the fake clock does not hold back. */
const realSetImmediate: (callback: () => void) => unknown =
  jest.requireActual('timers').setImmediate

describe('Preview tells a slow read from an empty page (AGL-4101)', () => {
  let setNodes: jest.SpyInstance

  beforeEach(() => {
    mockPending = {}
    mockReads = {
      [SCREEN_PATH]: { displayName: 'Enroll', versionId: 'v1' },
      [VERSION_PATH]: SAVED_VERSION,
    }
    setNodes = jest
      .spyOn(Aglyn.canvas, 'setNodes')
      .mockImplementation(() => undefined as never)
    jest.spyOn(Aglyn.canvas, 'getNode').mockReturnValue(undefined as never)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('says a version read past the ceiling has not loaded, not that it is empty', async () => {
    jest.useFakeTimers()
    // THE BUG: this printed "has no saved version" over a page that had one.
    mockReads[VERSION_PATH] = 'hang'
    render(<DocumentPreview ids={IDS} />)
    await flush()
    act(() => {
      jest.advanceTimersByTime(DEFINITIONS_TIMEOUT_MS + 1)
    })

    expect(screen.getByText(NOT_LOADED)).toBeTruthy()
    expect(screen.getByText(/taking longer than usual/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('CONTROL — before the ceiling it is still preparing', async () => {
    jest.useFakeTimers()
    mockReads[VERSION_PATH] = 'hang'
    render(<DocumentPreview ids={IDS} />)
    await flush()
    act(() => {
      jest.advanceTimersByTime(DEFINITIONS_TIMEOUT_MS - 1)
    })

    expect(screen.getByText(/Preparing the page preview/i)).toBeTruthy()
    expect(screen.queryByText(NOT_LOADED)).toBeNull()
  })

  it('renders the page when the slow read answers after the ceiling', async () => {
    jest.useFakeTimers()
    mockReads[VERSION_PATH] = 'hang'
    render(<DocumentPreview ids={IDS} />)
    await flush()
    act(() => {
      jest.advanceTimersByTime(DEFINITIONS_TIMEOUT_MS + 1)
    })
    expect(setNodes).not.toHaveBeenCalled()

    jest.useRealTimers()
    mockPending[VERSION_PATH](SAVED_VERSION)

    await waitFor(() => expect(setNodes).toHaveBeenCalled())
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('says a version read that failed could not be read, not that it is empty', async () => {
    mockReads[VERSION_PATH] = 'fail'
    render(<DocumentPreview ids={IDS} />)

    await waitFor(() => expect(screen.getByText(NOT_LOADED)).toBeTruthy())
    expect(screen.getByText(/couldn't be read just now/i)).toBeTruthy()
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('says so when the parent read failed and the link named no version', async () => {
    // With no version in the URL, the parent's pointer is the only way to
    // the saved version, and a failed read is not a missing pointer.
    mockReads[SCREEN_PATH] = 'fail'
    render(<DocumentPreview ids={{ ...IDS, versionId: undefined }} />)

    await waitFor(() => expect(screen.getByText(NOT_LOADED)).toBeTruthy())
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('CONTROL — a page that has never been saved still says there is nothing to preview', async () => {
    mockReads[SCREEN_PATH] = { displayName: 'Enroll' }
    render(<DocumentPreview ids={{ ...IDS, versionId: undefined }} />)

    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy())
    expect(screen.queryByText(NOT_LOADED)).toBeNull()
  })
})
