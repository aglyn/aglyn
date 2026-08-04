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
 * AGL-1139: does Preview hand the site's identity to what it renders?
 *
 * The reported symptom was "cart button seems to not work in preview". It was
 * not a broken button — there was no button. Every plugin block guards on
 * `if (!hostId)` and renders a dashed placeholder without one, so a previewed
 * shop was inert markup: `closest('button')` null, no `href`, nothing to click.
 * Thirty such guards across eighteen blocks.
 *
 * The preview page knew the host the whole time — it calls `useHostId()` — and
 * simply never put it on the context the blocks read.
 *
 * This asserts the value ARRIVES, from a child rendered exactly where the node
 * tree renders, rather than asserting that the provider is present in the
 * source. A provider passing `{}` would satisfy the latter and change nothing.
 */

import { render, screen } from '@testing-library/react'
import * as Aglyn from '@aglyn/aglyn'

// The node renderer stands in for a plugin block: it reads the same context
// `cart.tsx` reads and prints what it got, so a wrong or empty value fails
// loudly instead of rendering a placeholder that looks fine.
jest.mock('@aglyn/aglyn-node-renderer', () => {
  const actualReact = jest.requireActual('react')
  const aglyn = jest.requireActual('@aglyn/aglyn')
  return {
    __esModule: true,
    useAglynSiteTheme: () => ({}),
    AglynNodeRenderer: () => {
      const site = aglyn.useSite()
      return actualReact.createElement(
        'div',
        { 'data-testid': 'block' },
        `hostId=${site.hostId ?? 'MISSING'} preview=${String(site.preview ?? false)}`,
      )
    },
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
  useFirestore: () => null,
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn(),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  limit: jest.fn(),
  query: jest.fn(),
}))

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'k',
  readPreviewState: () => ({ nodes: {}, theme: undefined }),
}))

import DocumentPreview from '../components/document-preview.component'

describe('Preview site context (AGL-1139)', () => {
  beforeEach(() => {
    // A truthy root is all the component needs to render the tree; composing
    // real nodes would test the canvas, not the wiring under test.
    jest
      .spyOn(Aglyn.canvas, 'getNode')
      .mockReturnValue({ $id: '_@_', componentId: 'root' } as never)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('gives the rendered tree the real hostId', () => {
    render(<DocumentPreview ids={{ hostId: 'host-1', kind: 'screen', docId: 's1' }} />)
    // The exact failure AGL-1139 describes: without this the block reads
    // `undefined` and every commerce element becomes a dashed box.
    expect(screen.getByTestId('block').textContent).toContain('hostId=host-1')
  })

  it('marks the surface as preview, so writes can be refused', () => {
    render(<DocumentPreview ids={{ hostId: 'host-1', kind: 'screen', docId: 's1' }} />)
    // Without the flag the same hostId that fixes rendering also lets a
    // preview click place a real order.
    expect(screen.getByTestId('block').textContent).toContain('preview=true')
  })

  it('CONTROL — the probe reports a missing host rather than passing blank', () => {
    // Proves the assertions above can fail. `ids` absent is the pre-fix state
    // as far as the context is concerned.
    render(<DocumentPreview ids={null} />)
    expect(screen.getByTestId('block').textContent).toContain('hostId=MISSING')
  })
})
