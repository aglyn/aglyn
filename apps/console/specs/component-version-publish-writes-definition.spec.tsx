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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * PUBLISH ON A COMPONENT'S VERSION ROW WRITES THE DEFINITION (AGL-2878).
 *
 * The tenant renders a component from its parent document's own `nodes`,
 * `rootId` and `props`, never from a version. The Versions dialog published a
 * component the way it publishes a screen — by moving `versionId` — so the
 * Published chip moved and every page kept the old definition. Its Schedule
 * button wrote a `publishSchedule` that no executor ever applies.
 *
 * Rendered through the real dialog, with Firestore stood in for, so what is
 * asserted is the write that reaches the parent document.
 */

const mockUpdateDoc = jest.fn(async (..._args: unknown[]) => undefined)
const mockEnqueueSnackbar = jest.fn()
/** The version documents `getDoc` answers with, by path. */
const mockVersions = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostVersionApi: () => jest.fn(),
  useUser: () => ({ data: { uid: 'u1' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  HelpTip: () => null,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('firebase/firestore', () => ({
  Bytes: {
    fromUint8Array: (packed: Uint8Array) => ({ packed }),
  },
  collection: jest.fn(() => ({})),
  deleteDoc: jest.fn(),
  deleteField: jest.fn(),
  doc: jest.fn((_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })),
  getDoc: jest.fn(async (ref: { path: string }) => ({
    exists: () => mockVersions.has(ref.path),
    get: (field: string) => mockVersions.get(ref.path)?.[field],
    data: () => mockVersions.get(ref.path),
  })),
  getDocs: jest.fn(),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  setDoc: jest.fn(),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}))

jest.mock('../components/host-id-provider', () => ({
  useHostSubdomain: () => 'aglyn-marketing',
}))

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'aglyn-org',
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' }, ready: true }),
}))

jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({
    data: [
      { $id: 'v-live', displayName: 'Live', createdAt: { seconds: 2 } },
      { $id: 'v-older', displayName: 'Older', createdAt: { seconds: 1 } },
    ],
  }),
}))

jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: {} }),
}))

jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
  describeRevalidateShortfall: jest.fn(() => null),
}))

jest.mock('../utils/rewrite-stored-binding-tokens', () => ({
  __esModule: true,
  default: jest.fn(() => null),
  storedBindingTokenNeeds: jest.fn(() => ({ variables: false, functions: false })),
}))

// Required after the mocks above, so the dialog binds to the doubles.
const {
  BesignerVersionsComponent,
} = require('../components/besigner-versions.component')

const HOST = 'DXnRbPH4CQ'
const COMPONENT = 'b1XhhThlX4'

/** A version the besigner saved: canvas-shaped, with props declared on it. */
const OLDER_VERSION = {
  nodes: {
    '_@_': { $id: '_@_', componentId: 'box', parentId: null, nodes: ['band'] },
    band: { $id: 'band', componentId: 'box', parentId: '_@_', nodes: [] },
  },
  rootId: 'band',
  props: [{ name: 'headline', type: 'text' }],
}

function openDialog(kind: 'component' | 'screen', id: string) {
  render(
    <BesignerVersionsComponent
      hostId={HOST}
      parent={{ kind, id }}
      versionId="v-live"
      publishedVersionId="v-live"
    />,
  )
  fireEvent.click(screen.getByText('Live'))
}

/** The row buttons of the version that is NOT published. */
function olderRow() {
  const row = screen.getByText('Older').closest('tr') as HTMLElement
  expect(row).not.toBeNull()
  return row
}

beforeEach(() => {
  mockUpdateDoc.mockClear()
  mockEnqueueSnackbar.mockClear()
  mockVersions.clear()
})

describe('the Versions dialog, for a reusable component', () => {
  it('writes the version’s definition onto the component, not just the pointer', async () => {
    mockVersions.set(
      `hosts/${HOST}/components/${COMPONENT}/versions/v-older`,
      OLDER_VERSION,
    )
    openDialog('component', COMPONENT)

    const publish = Array.from(olderRow().querySelectorAll('button')).find(
      (button) => button.textContent === 'Publish',
    ) as HTMLButtonElement
    fireEvent.click(publish)

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled())
    const [ref, fields] = mockUpdateDoc.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ]
    expect(ref.path).toBe(`hosts/${HOST}/components/${COMPONENT}`)
    expect(fields).toMatchObject({
      versionId: 'v-older',
      rootId: 'band',
      props: [{ name: 'headline', type: 'text' }],
    })
    // Compressed, as the besigner's own publish writes it.
    expect(fields['nodes']).toEqual({ packed: expect.any(Uint8Array) })
  })

  it('refuses, and moves nothing, when the version has no single top element', async () => {
    mockVersions.set(`hosts/${HOST}/components/${COMPONENT}/versions/v-older`, {
      ...OLDER_VERSION,
      nodes: {
        ...OLDER_VERSION.nodes,
        '_@_': { ...OLDER_VERSION.nodes['_@_'], nodes: ['band', 'other'] },
        other: { $id: 'other', componentId: 'box', parentId: '_@_' },
      },
    })
    openDialog('component', COMPONENT)

    const publish = Array.from(olderRow().querySelectorAll('button')).find(
      (button) => button.textContent === 'Publish',
    ) as HTMLButtonElement
    fireEvent.click(publish)

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/single top-level element/),
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
    expect(mockUpdateDoc).not.toHaveBeenCalled()
  })

  it('offers no Schedule it cannot keep', () => {
    openDialog('component', COMPONENT)

    const schedule = Array.from(olderRow().querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'schedule publish',
    ) as HTMLButtonElement
    expect(schedule).toBeDefined()
    expect(schedule.disabled).toBe(true)
  })
})

describe('the Versions dialog, for a screen', () => {
  it('still publishes by moving the pointer alone', async () => {
    openDialog('screen', 'MxuaTpTwfk')

    const publish = Array.from(olderRow().querySelectorAll('button')).find(
      (button) => button.textContent === 'Publish',
    ) as HTMLButtonElement
    fireEvent.click(publish)

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled())
    const [ref, fields] = mockUpdateDoc.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ]
    expect(ref.path).toBe(`hosts/${HOST}/screens/MxuaTpTwfk`)
    expect(Object.keys(fields).sort()).toEqual(['updatedAt', 'versionId'])
  })

  it('keeps its Schedule', () => {
    openDialog('screen', 'MxuaTpTwfk')

    const schedule = Array.from(olderRow().querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'schedule publish',
    ) as HTMLButtonElement
    expect(schedule.disabled).toBe(false)
  })
})
