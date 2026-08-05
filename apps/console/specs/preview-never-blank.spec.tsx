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
 * AGL-1261: a Preview tab must never sit blank forever.
 *
 * The reported symptom was "the PREVIEW button opens a new tab that never
 * finishes loading". The route answers 200 and the app boots — the hang is
 * here: the snapshot is only applied once the host-components read
 * (AGL-1211's graft) has settled, and a one-shot `getDocs` that never settles
 * left `definitions` `undefined` forever. The component then rendered
 * `root ? … : null`, i.e. an empty document: no snapshot, no message, no
 * spinner, and nothing to distinguish it from a page that will load in a
 * second.
 *
 * Two properties, both about the PENDING read rather than a failing one (the
 * `.catch` already covered failure):
 *
 * 1. while it is outstanding the page SAYS so, and
 * 2. it is bounded — after the ceiling the preview renders anyway, fail-open
 *    with an empty definitions map, exactly as the error path does.
 */

import { act, render, screen } from '@testing-library/react'
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
  // Truthy: the components effect is gated on a firestore instance, and a
  // `null` one would skip the very code under test.
  useFirestore: () => ({}),
}))

// The whole point: a read that never settles. Not a rejection — a rejection
// already had a `.catch`, and it was never the failing case.
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn(),
  getDocs: jest.fn(() => new Promise(() => undefined)),
  limit: jest.fn(),
  query: jest.fn(),
}))

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'aglyn:preview:screen:h1:s1:v1',
  readPreviewState: () => ({ nodes: {}, theme: undefined, updatedAt: 0 }),
}))

import DocumentPreview, {
  DEFINITIONS_TIMEOUT_MS,
} from '../components/document-preview.component'

const IDS = {
  hostId: 'h1',
  kind: 'screen' as const,
  docId: 's1',
  versionId: 'v1',
}

describe('Preview never renders a blank tab (AGL-1261)', () => {
  let setNodes: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    setNodes = jest.spyOn(Aglyn.canvas, 'setNodes').mockImplementation(() => undefined as never)
    // No root until the snapshot is applied — the real pre-paint state.
    jest.spyOn(Aglyn.canvas, 'getNode').mockReturnValue(undefined as never)
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('says it is preparing the preview instead of painting nothing', () => {
    render(<DocumentPreview ids={IDS} />)
    // Pre-fix this was an empty document — `document.body.textContent` held
    // only the React comment markers.
    expect(screen.getByText(/Preparing the screen preview/i)).toBeTruthy()
    expect(screen.queryByTestId('tree')).toBeNull()
  })

  it('applies the snapshot anyway once the read has had its ceiling', () => {
    render(<DocumentPreview ids={IDS} />)
    // The bug: this stayed 0 forever, because the apply effect returns early
    // while `definitions` is undefined.
    expect(setNodes).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(DEFINITIONS_TIMEOUT_MS + 1)
    })

    expect(setNodes).toHaveBeenCalled()
  })

  it('CONTROL — without the ceiling the apply never runs', () => {
    render(<DocumentPreview ids={IDS} />)
    // One millisecond short of the ceiling: proves the assertion above is
    // driven by the timer and not by something else settling on its own.
    act(() => {
      jest.advanceTimersByTime(DEFINITIONS_TIMEOUT_MS - 1)
    })
    expect(setNodes).not.toHaveBeenCalled()
  })
})
