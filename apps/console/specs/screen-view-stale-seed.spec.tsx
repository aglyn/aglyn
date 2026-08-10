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
 * The screen detail page must not write from a seed the server never
 * confirmed (AGL-1358). Two handlers on it, both seeded from the same screen
 * listener:
 *
 * - the rename writes `description` on every save, even when only the name
 *   was retyped, so a pure rename against a cached read rolls the description
 *   back — and takes `nameLower` with it, the key the screen switcher's
 *   prefix search finds the screen by.
 * - the SEO panel is the subtler one, because half of it was already fixed.
 *   AGL-1337 stopped it building a fresh `seo` map from its own three fields;
 *   carrying `existing` forward instead is what makes it THIS issue's shape.
 *   `existing` is `screen?.seo` off the same listener, and `updateDoc`
 *   REPLACES a nested map, so a cached read reinstates that snapshot's
 *   `image`, `imageWidth`, `imageHeight` and `breadcrumb` while the author
 *   thought they were editing a title. The empty branch is worse:
 *   `seo: deleteField()` removes the map outright.
 *
 * Neither has a create path: both write the screen that is already on screen.
 *
 * Both directions asserted for each. The positive controls matter most —
 * these stand in front of the ordinary save on the page every author uses.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUpdateDoc = jest.fn().mockReturnValue(Promise.resolve())
const mockEnqueueSnackbar = jest.fn()

/** Mutable so each spec picks the screen listener's verdict before rendering. */
const mockScreenDoc = {
  data: {
    $id: 'screen-1',
    displayName: 'Pricing',
    // Written on every rename, seeded from here.
    description: 'The plans page',
    seo: {
      title: 'Pricing — Acme',
      description: 'What Acme costs',
      // The social card a stale seed would reinstate. None of it is editable
      // from the title field the author is typing in.
      image: 'https://cdn.test/og.png',
      imageWidth: 1200,
      imageHeight: 630,
      breadcrumb: 'Home / Pricing',
    },
    visibility: 'public',
  } as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteField: () => '__delete__',
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  GridItems: ({ items }: { items: Array<{ children: ReactNode }> }) => (
    <div>
      {items.map((item, index) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
  useLoading: () => ({ queueLoading: () => () => undefined, loading: false }),
}))

// Every other surface on the page reads its own data and is not part of this
// shape.
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
// The rename button lives in the layout's `headerRight` slot, so a
// children-only pass-through would hide the handler under test.
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    children,
    headerRight,
  }: {
    children?: ReactNode
    headerRight?: ReactNode
  }) => (
    <div>
      {headerRight}
      {children}
    </div>
  ),
}))
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/secondary-nav-bar.component', () => nullCard)
jest.mock('../components/analytics/screen-analytics-card.component', () => nullCard)
jest.mock('../components/plugin-widget-slot.component', () => nullCard)
jest.mock('../components/host-display-name.component', () => nullCard)
jest.mock('../components/screen-social-image-field.component', () => nullCard)
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' } }),
}))
jest.mock('../hooks/use-collection-templates', () => ({
  __esModule: true,
  default: () => ({
    templateScreenIds: new Set<string>(),
    routesByScreenId: new Map<string, unknown>(),
  }),
}))
jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [], status: 'success', fromCache: false }),
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({
    data: mockScreenDoc.data,
    status: mockScreenDoc.status,
    fromCache: mockScreenDoc.fromCache,
  }),
}))
jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
jest.mock('next/navigation', () => ({
  useParams: () => ({ screenId: 'screen-1', versionId: 'ver-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ScreenDetails =
  require('../app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page').default

beforeEach(() => {
  jest.clearAllMocks()
  mockScreenDoc.fromCache = false
  mockScreenDoc.status = 'success'
})

describe('Screen rename (AGL-1358)', () => {
  const renameAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Plans' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('REFUSES a rename seeded from an unconfirmed read', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenDetails />)

    renameAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('screen details'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The dialog stays open with what was typed.
    expect(
      (screen.getByLabelText('Display name') as HTMLInputElement).value,
    ).toEqual('Plans')
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<ScreenDetails />)

    renameAndSave()

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    expect(payload.displayName).toBe('Plans')
    // The description rides along off the seed — the reason for the guard.
    expect(payload.description).toBe('The plans page')
    expect(payload.nameLower).toBeTruthy()
  })

  it('REFUSES when the screen read failed, and says so differently', async () => {
    mockScreenDoc.status = 'error'
    render(<ScreenDetails />)

    renameAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})

describe('Screen SEO (AGL-1358)', () => {
  /** A keystroke is what creates the draft; Save SEO is dead until then. */
  const editTitleAndSave = () => {
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Pricing and plans' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save SEO' }))
  }

  it('REFUSES an SEO save seeded from an unconfirmed read', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenDetails />)

    editTitleAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('SEO settings'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The staged title is still on screen.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toEqual(
      'Pricing and plans',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<ScreenDetails />)

    editTitleAndSave()

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    expect(payload.seo.title).toBe('Pricing and plans')
    // The whole carried-forward map goes with it — none of it editable from
    // the field that was typed in.
    expect(payload.seo.image).toBe('https://cdn.test/og.png')
    expect(payload.seo.breadcrumb).toBe('Home / Pricing')
  })
})
