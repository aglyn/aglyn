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
 * Three console cards must not write from a seed the server never confirmed
 * (AGL-1358).
 *
 * - business details — `mergeFields: ['business']` is what makes this
 *   dangerous rather than merely lossy. It replaces the whole `business` map
 *   atomically, deliberately, so that removing a social link is possible at
 *   all; every key in it comes from a form seeded by the listener. Against a
 *   cached read, correcting the support email restores that snapshot's
 *   address and links.
 * - languages — both fields go out on every save and both come off the seed,
 *   and the empty case does not rewrite them, it `deleteField()`s them. A
 *   cache that has never seen a locale list de-configures multilingual
 *   routing on a site whose screens are already translated.
 * - components — the narrowest of the three, and worth being exact about:
 *   `nodes`, `versionId` and `deletedAt` are not in the payload and a plain
 *   `updateDoc` leaves them alone. What makes it the same shape is that
 *   `description` and `icon` ride out on every save as echoes of the seed, so
 *   a rename against a cached read restores that snapshot's identity for the
 *   component — the one it wears in every besigner drawer and its listing.
 *
 * None of the three has a create path to exempt: two write a FIXED document
 * path, where an all-blank form is the worst input rather than a harmless
 * one, and the third only ever opens on a stored row.
 *
 * Both directions asserted at each. The positive controls matter most: these
 * stand in front of the ordinary save.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import BusinessDetailsCard from '../components/business-details-card.component'
import HostComponentsCard from '../components/host-components-card.component'
import LanguagesCard from '../components/languages-card.component'

/** Mutable so each spec picks the listener's verdict before rendering. */
const mockListener = {
  fromCache: false,
  status: 'success' as 'success' | 'error',
}

const mockHostDoc = {
  $id: 'host-1',
  business: {
    supportEmail: 'help@acme.test',
    // The values a stale save would restore.
    address: '1 Market St',
    socialLinks: [{ label: 'X', url: 'https://x.test/acme' }],
  },
  locales: ['en', 'es'],
  defaultLocale: 'en',
}

const mockComponentDocs = [
  {
    $id: 'cmp-1',
    displayName: 'Hero band',
    // The identity a rename against a stale seed would restore.
    description: 'Full-bleed hero with a call to action',
    icon: { name: 'star' },
    nodes: {},
    versionId: 'ver-1',
  },
]

const mockSetDoc = jest.fn().mockResolvedValue(undefined)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHost: () => ({
    doc: {
      data: mockHostDoc,
      status: mockListener.status,
      fromCache: mockListener.fromCache,
    },
    setDoc: mockSetDoc,
  }),
  useHostVersionApi: () => jest.fn(),
  useHostResourceApi: () => jest.fn(),
  useUser: () => ({ data: { uid: 'uid-owner', getIdToken: jest.fn() } }),
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the card passed it, which is the one thing these specs disprove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({
    data: mockHostDoc,
    status: mockListener.status,
    fromCache: mockListener.fromCache,
  }),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({
    data: mockComponentDocs,
    status: mockListener.status,
    fromCache: mockListener.fromCache,
  }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' } }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
}))
jest.mock('../components/host-id-provider', () => ({
  useHostSubdomain: () => 'acme',
  useHostId: () => 'host-1',
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
/**
 * The components list is an x-data-grid, which virtualises and renders no
 * rows at zero height in jsdom. This stand-in renders each row's action cell
 * so the REAL dialog and the REAL save handler are still what the spec
 * drives — only the grid chrome is replaced.
 */
jest.mock('@aglyn/shared-ui-jsx/components/data-table.component', () => ({
  DataTableComponent: ({ rows, columns }: any) => (
    <div>
      {rows.map((row: any) => (
        <div key={row.$id}>
          {columns
            .filter((column: any) => column.type === 'actions')
            .flatMap((column: any) => column.getActions({ row, id: row.$id }))
            .map((action: any, index: number) => (
              <button
                key={index}
                type="button"
                onClick={(event) => action.props.onClick?.(event)}
              >
                {action.props.label}
              </button>
            ))}
        </div>
      ))}
    </div>
  ),
}))
jest.mock('../components/component-icon-field.component', () => ({
  __esModule: true,
  default: () => null,
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockListener.fromCache = false
  mockListener.status = 'success'
})

describe('BusinessDetailsCard (AGL-1358)', () => {
  const editAndSave = () => {
    fireEvent.change(screen.getByLabelText('Support email'), {
      target: { value: 'support@acme.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('REFUSES to replace the business map from an unconfirmed read', async () => {
    mockListener.fromCache = true
    render(<BusinessDetailsCard hostId="host-1" />)

    editAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('business details'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The form keeps what was typed, so the refusal is not a silent no-op.
    expect(
      (screen.getByLabelText('Support email') as HTMLInputElement).value,
    ).toEqual('support@acme.test')
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<BusinessDetailsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [payload, options] = mockSetDoc.mock.calls[0]
    expect(payload.business.supportEmail).toBe('support@acme.test')
    // The rest of the map rides along, replaced atomically — which is why the
    // guard is the only thing standing in front of it.
    expect(payload.business.address).toBe('1 Market St')
    expect(options).toEqual({ mergeFields: ['business'] })
  })

  it('REFUSES when the host read failed, and says so differently', async () => {
    mockListener.status = 'error'
    render(<BusinessDetailsCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })
})

describe('LanguagesCard (AGL-1358)', () => {
  const editAndSave = () => {
    fireEvent.change(screen.getByLabelText('Languages'), {
      target: { value: 'en, es, fr' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save languages' }))
  }

  it('REFUSES to rewrite the locale list from an unconfirmed read', async () => {
    mockListener.fromCache = true
    render(<LanguagesCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('language settings'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    expect(
      (screen.getByLabelText('Languages') as HTMLInputElement).value,
    ).toEqual('en, es, fr')
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<LanguagesCard hostId="host-1" />)

    editAndSave()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.locales).toEqual(['en', 'es', 'fr'])
    // The default rides along off the same seed.
    expect(payload.defaultLocale).toBe('en')
  })
})

describe('HostComponentsCard (AGL-1358)', () => {
  const renameAndSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('REFUSES to rewrite a component seeded from an unconfirmed read', async () => {
    mockListener.fromCache = true
    render(<HostComponentsCard hostId="host-1" />)

    renameAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('component'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The dialog is still open with what was being edited. This path had no
    // report at all before the guard, so the message is the whole point.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toEqual(
      'Hero band',
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<HostComponentsCard hostId="host-1" />)

    renameAndSave()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.displayName).toBe('Hero band')
    // The description and icon ride along as echoes of the seed.
    expect(payload.description).toBe('Full-bleed hero with a call to action')
    expect(payload.icon).toEqual({ name: 'star' })
  })
})
