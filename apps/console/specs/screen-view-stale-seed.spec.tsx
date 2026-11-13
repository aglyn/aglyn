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
import { setSeedConfirmWaitMs } from '@aglyn/tenant-feature-instance/hooks/helpers/listen-confirmation'
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

/**
 * A CLOSED WORLD: anything the tree reaches for and this object does not
 * name is `undefined`, and calling it is a TypeError that fails every case
 * in the file for a reason that has nothing to do with what it asserts.
 * That is exactly how `useAuthPersistence` broke it — AGL-1379 sealed
 * `setPersistence` onto the instance, `use-presence.ts` started reading the
 * class through the hook, and `<DocumentPresenceLive>` renders inside
 * `<ScreenDetails>`, so every render threw before a single seed was checked.
 * Widen this list when the tree grows a dependency; do not narrow the tree.
 */
jest.mock('@aglyn/tenant-feature-instance', () => {
  /**
   * The persistence class the provider's `Auth` was built with (AGL-1379).
   *
   * Built inside the factory so it is ONE object for the whole file: the
   * real hook hands back a context value, and `use-presence` lists it in an
   * effect dependency array — a fresh object per render would re-mint the
   * presence session every pass, the exact loop the note above that
   * dependency list exists to prevent. Its value is never asserted here;
   * only its identity holding still is.
   */
  const authPersistence = { __stub: 'authPersistence' }
  return {
    useFirestore: () => ({}),
    useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
    // Presence announces the console's avatar answer (AGL-3270); this
    // closed-world mock has to name it. No photo — initials, as before.
    useUserPhoto: () => undefined,
    useAuthPersistence: () => authPersistence,
    // The site's campaigns, which fill the picker on the page's Campaigns
    // card. Empty: what is under test is the rename's seed guard.
    useSiteContainerOptions: () => ({ options: [], truncated: false, ready: true }),
    // The REAL guard, not a stub. A stub would let the write through whatever
    // the page passed it, which is the one thing this spec disproves.
    writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
      .writeGuardedBySeed,
  }
})

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
  // The header's action slot too: the Name & description card's only save
  // lives there.
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
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
// AGL-2334 gave the editor pages a host-role read, purely to disable the
// publish controls for an `author` and say why. This spec drives the RENAME
// and SEO save paths, which that role does not gate, so the hook is stubbed
// at the owner's answer — the standing these cases had before AGL-2334, and
// the one that leaves the seed guard the only thing deciding the write.
//
// Stubbed at the hook rather than widened at '@aglyn/tenant-feature-instance':
// that mock is a closed world and the real `useHostRole` reaches through
// `useHostOrgId` into `getDoc`, so feeding it there would put a Firestore
// read behind every case to no purpose. The symptom was
// `(0, _useHostOrgId.default) is not a function`.
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'owner', canPublish: true, loaded: true }),
}))
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

// This spec pins the refusal, not the wait before it (AGL-4120).
beforeAll(() => setSeedConfirmWaitMs(0))
afterAll(() => setSeedConfirmWaitMs())

describe('Screen rename (AGL-1358)', () => {
  const renameAndSave = () => {
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Plans' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  }

  /**
   * The first press is never refused for a late server (AGL-4047): Save
   * details is HELD while the screen read is the cache's, with the reason
   * beside it, and what was typed stays.
   */
  it('KEEPS a Save details pressed while the screen read is unconfirmed, keeping what was typed', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenDetails />)

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Plans' },
    })
    // Held, yet pressable: the reason shows and Save details takes the press.
    expect(
      screen.getByText('Checking your page details with the server…'),
    ).toBeTruthy()
    const save = screen.getByRole('button', {
      name: 'Save details',
    }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockUpdateDoc).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    expect(
      (screen.getByLabelText('Display name') as HTMLInputElement).value,
    ).toEqual('Plans')
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save details' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
  })

  it('keeps the rename through the server’s copy, and saves the confirmed description on the first press', async () => {
    mockScreenDoc.fromCache = true
    const cached = mockScreenDoc.data
    try {
      const { rerender } = render(<ScreenDetails />)
      fireEvent.change(screen.getByLabelText('Display name'), {
        target: { value: 'Plans' },
      })
      // The server answers: the description was changed elsewhere since the
      // cached snapshot.
      mockScreenDoc.data = { ...cached, description: 'Every plan we offer' }
      mockScreenDoc.fromCache = false
      rerender(<ScreenDetails />)

      expect(
        (screen.getByLabelText('Display name') as HTMLInputElement).value,
      ).toEqual('Plans')
      // The untouched field follows the server's copy (the first of two
      // "Description" fields; the SEO card's is the other).
      expect(
        (screen.getAllByLabelText('Description')[0] as HTMLInputElement).value,
      ).toEqual('Every plan we offer')
      fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

      await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
      const [, payload] = mockUpdateDoc.mock.calls[0]
      expect(payload.displayName).toBe('Plans')
      // Not the cache's 'The plans page'.
      expect(payload.description).toBe('Every plan we offer')
    } finally {
      mockScreenDoc.data = cached
    }
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
    // One Save SEO, drawn in the header and at the foot of its card.
  fireEvent.click(screen.getAllByRole('button', { name: 'Save SEO' })[0])
  }

  it('KEEPS a Save SEO pressed while the screen read is unconfirmed, keeping the staged title', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenDetails />)

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Pricing and plans' },
    })
    // Held, yet pressable: the reason shows and both Save SEO buttons take the press.
    expect(
      screen.getByText('Checking your SEO settings with the server…'),
    ).toBeTruthy()
    const saves = screen.getAllByRole('button', { name: 'Save SEO' })
    for (const save of saves) {
      expect((save as HTMLButtonElement).disabled).toBe(false)
    }
    fireEvent.click(saves[0])
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockUpdateDoc).not.toHaveBeenCalled()
    // Kept, not dropped (AGL-4047): no confirmation came within the
    // guard's wait (0 in this spec), so the press ends in the guard's refusal.
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/could not confirm your .+ with the server yet, so nothing was saved/),
        expect.anything(),
      ),
    )
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toEqual(
      'Pricing and plans',
    )
    await waitFor(() => {
      for (const save of screen.getAllByRole('button', { name: 'Save SEO' })) {
        expect((save as HTMLButtonElement).disabled).toBe(false)
      }
    })
  })

  it('stages only what was typed, so the server’s description is saved beside it', async () => {
    mockScreenDoc.fromCache = true
    const cached = mockScreenDoc.data
    try {
      const { rerender } = render(<ScreenDetails />)
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Pricing and plans' },
      })
      mockScreenDoc.data = {
        ...cached,
        seo: {
          ...(cached.seo as Record<string, unknown>),
          description: 'Plans from $0',
        },
      }
      mockScreenDoc.fromCache = false
      rerender(<ScreenDetails />)

      fireEvent.click(screen.getAllByRole('button', { name: 'Save SEO' })[0])
      await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
      const [, payload] = mockUpdateDoc.mock.calls[0]
      expect(payload.seo.title).toBe('Pricing and plans')
      // It used to copy the cache's 'What Acme costs' into the draft.
      expect(payload.seo.description).toBe('Plans from $0')
    } finally {
      mockScreenDoc.data = cached
    }
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
