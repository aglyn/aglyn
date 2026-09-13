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
 * The overlay editors never promise a token the published page shows raw
 * (AGL-2885).
 *
 * The announcement bar card used to say its text "supports variable bindings,
 * e.g. {{saleEndsAt}}", and the popup card said the same of its body. A
 * published page resolves a variable only as `{{var:id}}`, and nothing stored
 * what the author typed in that form, so every token typed into these fields
 * reached visitors exactly as typed.
 *
 * So each case is carried through to the page. What an editor SAVES is handed
 * to the same site-page enricher a published page is rendered through, and the
 * assertion is on what the visitor reads there — not on the saved string, which
 * could look right and still render raw.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { setDoc, updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import { marketingSitePageEnricher } from '../server/site-page-enricher'
import AnnouncementBarCard from './announcement-bar-card.component'
import HostOverlaysCard from './host-overlays-card.component'
import PopupCard from './popup-card.component'
import { OVERLAY_COPY_HELPER_TEXT } from './use-overlay-copy-editor'

/** A variable an author made for a sale, as its document is stored. */
const SALE_ENDS_AT = {
  $id: 'var-sale',
  name: 'saleEndsAt',
  type: 'text',
  value: 'Sunday at midnight',
}

/** Mutable so each case sets the site's variables and their read state. */
const variablesRead = {
  docs: [SALE_ENDS_AT] as Array<Record<string, unknown>>,
  status: 'success' as 'loading' | 'success' | 'error',
}

/** Every collection path an editor asked to read, in order. */
const collectionReads: string[] = []

const site: Record<string, any> = {}
const resetSite = () => {
  for (const key of Object.keys(site)) delete site[key]
  Object.assign(site, {
    $id: 'host-1',
    displayName: 'Northwind Coffee',
    subdomain: 'northwind',
  })
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: () => ({ data: site, status: 'success', fromCache: false }),
  useFirestoreCollection: (build: () => string | null) => {
    const path = build()
    // What the real hook reports for a query it was never handed.
    if (!path) return { data: [], status: 'loading', fromCache: true }
    collectionReads.push(path)
    return path.endsWith('/variables')
      ? {
          data: variablesRead.status === 'success' ? variablesRead.docs : [],
          status: variablesRead.status,
          fromCache: false,
        }
      : { data: [], status: 'success', fromCache: false }
  },
  useHostActivityLogger: () => jest.fn(),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path,
  limit: () => undefined,
  orderBy: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useLoading: () => ({ queueLoading: () => () => undefined }),
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('./overlay-stats-row.component', () => ({
  __esModule: true,
  default: () => null,
}))

// The published page's own reads, answered from the same fixtures.
jest.mock('../server/get-overlays', () => ({
  __esModule: true,
  default: jest.fn(async () => []),
}))
jest.mock('../server/get-screen-experiments', () => ({
  __esModule: true,
  getScreenExperiments: jest.fn(async () => []),
}))
jest.mock('../server/get-client-automations', () => ({
  __esModule: true,
  getClientAutomations: jest.fn(async () => []),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  // Keyed by document id, as the published page reads them.
  default: jest.fn(async () =>
    Object.fromEntries(
      variablesRead.docs.map(({ $id, ...variable }) => [$id, variable]),
    ),
  ),
}))

const ORG = { plan: 'business' } as never
const PUBLISHED_ORG = {
  $id: 'org-1',
  plan: 'business',
  subscriptionStatus: 'active',
}

/** What a visitor reads for the given host fields on a published page. */
async function publishedPage(hostFields: Record<string, unknown>) {
  return (await marketingSitePageEnricher({
    hostId: 'host-1',
    host: { ...site, ...hostFields },
    org: PUBLISHED_ORG,
    path: '/',
    slugSegments: [],
    nodes: { root: {} },
  } as never)) as Record<string, any>
}

beforeEach(() => {
  jest.clearAllMocks()
  resetSite()
  variablesRead.docs = [SALE_ENDS_AT]
  variablesRead.status = 'success'
  collectionReads.length = 0
})

describe('AnnouncementBarCard (AGL-2885)', () => {
  const textField = () => screen.getByLabelText('Text') as HTMLTextAreaElement
  const typeText = (value: string) =>
    fireEvent.change(textField(), { target: { value } })
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  it('names no variable the site may not have', () => {
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    expect(screen.getByText(OVERLAY_COPY_HELPER_TEXT)).toBeTruthy()
    expect(screen.queryByText(/saleEndsAt/)).toBeNull()
  })

  it('stores a typed variable name so the published bar fills it in', async () => {
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    typeText('Sale ends {{saleEndsAt}}')
    save()

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.announcementBar.text).toBe('Sale ends {{var:var-sale}}')

    const page = await publishedPage({
      announcementBar: { ...payload.announcementBar, enabled: true },
    })
    expect(page.announcementBar.text).toBe('Sale ends Sunday at midnight')
  })

  it('CONTROL: the token as it used to be stored renders raw on the page', async () => {
    // The form every token typed into this card was saved in. It is why the
    // card cannot store what was typed as it was typed.
    const page = await publishedPage({
      announcementBar: { enabled: true, text: 'Sale ends {{saleEndsAt}}' },
    })

    expect(page.announcementBar.text).toBe('Sale ends {{saleEndsAt}}')
  })

  it('shows the stored token as the name, and previews what visitors read', () => {
    site.announcementBar = {
      enabled: true,
      text: 'Sale ends {{var:var-sale}} at {{host.businessName}}',
    }
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    expect(textField().value).toBe(
      'Sale ends {{saleEndsAt}} at {{host.businessName}}',
    )
    expect(
      screen.getByText('Sale ends Sunday at midnight at Northwind Coffee'),
    ).toBeTruthy()
    // Nothing was typed, so nothing is waiting to be saved.
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('says a name no variable carries would show as typed', async () => {
    variablesRead.docs = []
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    typeText('Sale ends {{saleEndsAt}}')

    expect(textField().getAttribute('aria-invalid')).toBe('true')
    expect(
      screen.getByText(
        'Visitors would see {{saleEndsAt}} exactly as typed. Use the name ' +
          'of a variable from Logic, or remove the braces.',
      ),
    ).toBeTruthy()

    // The warning is the whole of the promise: the page does show it raw.
    save()
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    const page = await publishedPage({
      announcementBar: { ...payload.announcementBar, enabled: true },
    })
    expect(page.announcementBar.text).toBe('Sale ends {{saleEndsAt}}')
  })

  it('does not save a token while the variables are still being read', () => {
    variablesRead.status = 'loading'
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    typeText('Sale ends {{saleEndsAt}}')

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // …and says nothing about the name yet, which the site may well have.
    expect(textField().getAttribute('aria-invalid')).toBe('false')
  })

  it('reads the variables only once the copy holds a token', () => {
    render(<AnnouncementBarCard hostId="host-1" org={ORG} />)

    typeText('Free shipping this week')
    expect(collectionReads).not.toContain('hosts/host-1/variables')

    // Control: the same card does read them for a token.
    typeText('Free shipping until {{saleEndsAt}}')
    expect(collectionReads).toContain('hosts/host-1/variables')
  })
})

describe('PopupCard (AGL-2885)', () => {
  it('names no variable the site may not have', () => {
    render(<PopupCard hostId="host-1" org={ORG} />)

    expect(screen.getByText(OVERLAY_COPY_HELPER_TEXT)).toBeTruthy()
    expect(screen.queryByText(/saleEndsAt/)).toBeNull()
  })

  it('stores typed names so the published popup fills them in', async () => {
    render(<PopupCard hostId="host-1" org={ORG} />)

    fireEvent.change(screen.getByLabelText('Headline'), {
      target: { value: 'Until {{saleEndsAt}}' },
    })
    fireEvent.change(screen.getByLabelText('Body'), {
      target: { value: 'Everything at {{host.businessName}} ends {{saleEndsAt}}.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    const page = await publishedPage({
      popup: { ...payload.popup, enabled: true },
    })
    expect(page.popup.headline).toBe('Until Sunday at midnight')
    expect(page.popup.body).toBe(
      'Everything at Northwind Coffee ends Sunday at midnight.',
    )
  })

  it('says a headline token would show as typed', () => {
    render(<PopupCard hostId="host-1" org={ORG} />)

    fireEvent.change(screen.getByLabelText('Headline'), {
      target: { value: 'Ends {{saleEnds}}' },
    })

    expect(
      screen.getByLabelText('Headline').getAttribute('aria-invalid'),
    ).toBe('true')
    expect(
      screen.getByText(/Visitors would see \{\{saleEnds\}\} exactly as typed/),
    ).toBeTruthy()
  })
})

describe('HostOverlaysCard (AGL-2885)', () => {
  it('stores a typed name in a new bar so the published bar fills it in', async () => {
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'New bar' }))
    const dialog = screen.getByRole('dialog')
    const [text] = within(dialog).getAllByLabelText(/^Text/)
    expect(within(dialog).getByText(OVERLAY_COPY_HELPER_TEXT)).toBeTruthy()
    fireEvent.change(text, { target: { value: 'Sale ends {{saleEndsAt}}' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1))
    const [, overlay] = (setDoc as jest.Mock).mock.calls[0]
    expect(overlay.bar.text).toBe('Sale ends {{var:var-sale}}')

    const getOverlays = jest.requireMock('../server/get-overlays')
      .default as jest.Mock
    getOverlays.mockResolvedValueOnce([{ $id: 'ov-1', ...overlay }])
    const page = await publishedPage({})
    expect(page.announcementBar.text).toBe('Sale ends Sunday at midnight')
  })

  it('says a popup body token would show as typed', () => {
    variablesRead.docs = []
    render(<HostOverlaysCard hostId="host-1" org={ORG} />)

    fireEvent.click(screen.getByRole('button', { name: 'New popup' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Body/), {
      target: { value: 'Ends {{saleEndsAt}}' },
    })

    expect(
      within(dialog).getByText(
        /Visitors would see \{\{saleEndsAt\}\} exactly as typed/,
      ),
    ).toBeTruthy()
  })
})
