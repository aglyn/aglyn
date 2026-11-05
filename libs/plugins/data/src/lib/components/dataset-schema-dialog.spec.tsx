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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as Aglyn from '@aglyn/aglyn'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { doc, updateDoc } from 'firebase/firestore'
import { DatasetSchemaDialog } from './dataset-schema-dialog.component'

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))

/** What the route was asked, one body per call. */
const sharingCalls = () =>
  mockFetch.mock.calls.map((call) => JSON.parse(call[2].body))

let mockOrgHosts: Array<{ $id: string; name?: string }> = []

jest.mock('firebase/firestore', () => ({
  // Keep the real module (Timestamp etc. ride into @aglyn/aglyn) and only
  // stub the two calls the dialog makes.
  ...jest.requireActual('firebase/firestore'),
  doc: jest.fn(() => ({})),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostOrgId: () => undefined,
  // The dialog takes an explicit `orgId` prop, which `useOrgDataScope`
  // resolves without any lookup — so the mock mirrors that directly. It
  // was missing when the hook replaced the inline ternary (AGL-1061),
  // which took these three specs down with a "not a function" long before
  // they could assert anything; a scope of null here would leave the Save
  // button disabled and fail them just as silently (AGL-1050).
  useOrgDataScope: ({ orgId }: { orgId?: string }) => ({
    scope: orgId ? (['orgs', orgId] as const) : null,
    orgId: orgId ?? null,
    ready: true,
  }),
  // Scoped sharing (AGL-1044). Org-wide by default so these specs exercise
  // the editable path; the read-only branch is covered by the rules tests.
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  // The sites query is membership-constrained on the signed-in uid, because
  // `/hosts/{hostId}` is gated per document and Firestore rejects a LIST that
  // could return a denied doc (AGL-1145). No uid, no query — so a mock that
  // omitted this would leave the hook returning nothing for the wrong reason.
  useUser: () => ({ data: { uid: 'uid-test' } }),
  // The org's sites, for the "Selected sites…" chips. Empty unless a case
  // needs sites to pick.
  useFirestoreCollection: () => ({ data: mockOrgHosts }),
  // The REAL guard (AGL-1358), not a stub. A mocked guard would let the
  // write through no matter what the dialog passed it, which is the one
  // thing these specs are here to disprove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))

const renderDialog = (
  dataset: NonNullable<
    Parameters<typeof DatasetSchemaDialog>[0]['dataset']
  >,
  seedFromCache = false,
) =>
  render(
    <DatasetSchemaDialog
      orgId="org-1"
      dataset={dataset}
      datasets={[]}
      recordCount={0}
      // Server-confirmed unless a spec says otherwise: every suite below
      // exercises the ORDINARY save, which the AGL-1358 guard must leave
      // alone.
      seedFromCache={seedFromCache}
      onClose={jest.fn()}
    />,
  )

describe('DatasetSchemaDialog field names & descriptions (AGL-560)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('round-trips a renamed display name and description on save', async () => {
    renderDialog({
      $id: 'products',
      displayName: 'Products',
      model: {
        fields: { title: { name: 'Title', type: 'text' } },
        order: ['title'],
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: '  Product title ' },
    })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: ' Shown on the product card. ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save field' }))

    // The row list surfaces the description as secondary text.
    expect(screen.getByText('Shown on the product card.')).toBeTruthy()
    expect(screen.getByText('Product title')).toBeTruthy()
    expect(screen.getByText('· title')).toBeTruthy()

    // findBy: the editor dialog's exit transition keeps the main dialog
    // aria-hidden for a beat after "Save field".
    fireEvent.click(await screen.findByRole('button', { name: 'Save schema' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    expect(doc).toHaveBeenCalledWith(
      expect.anything(),
      'orgs',
      'org-1',
      'datasets',
      'products',
    )
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    // The id stays the stable key; only the display name renames, and the
    // trimmed description rides along.
    expect(payload.model.fields.title).toEqual({
      name: 'Product title',
      type: 'text',
      description: 'Shown on the product card.',
    })
    expect(payload.model.order).toEqual(['title'])
    expect(payload.fields).toEqual(['title'])
    // The collection's name, with its search key beside it (AGL-4047).
    expect(payload.displayName).toBe('Products')
    expect(payload.nameLower).toBe('products')
  })

  it('drops a whitespace-only description instead of persisting it', async () => {
    renderDialog({
      $id: 'products',
      displayName: 'Products',
      model: {
        fields: { title: { name: 'Title', type: 'text' } },
        order: ['title'],
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save field' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save schema' }))

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.model.fields.title).toEqual({ name: 'Title', type: 'text' })
  })

  it('keeps humanized display names for v1 flat-field datasets', async () => {
    // No model: the effective model derives humanized names from slug ids
    // (AGL-558) and the dialog must preserve them through a save.
    renderDialog({
      $id: 'catalog',
      displayName: 'Catalog',
      fields: ['unit_price'],
    })

    expect(screen.getByText('Unit price')).toBeTruthy()
    expect(screen.getByText('· unit_price')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.model.fields.unit_price).toEqual({
      name: 'Unit price',
      type: 'text',
    })
    expect(payload.fields).toEqual(['unit_price'])
  })
})

/**
 * The stale-seed guard (AGL-1358).
 *
 * The dialog is seeded from a listener that lives in the parent card, and it
 * writes the whole `model` plus `visibleTo` back — so `updateDoc`'s field
 * merging protects nothing, every field is in the payload. `visibleTo` is the
 * AGL-1041/1042 access-control predicate: rewriting it from a snapshot the
 * server never confirmed re-exposes a collection that was narrowed, or hides
 * one that was widened.
 *
 * Both directions are asserted, and the POSITIVE one matters most: this guard
 * stands in front of the ordinary schema save (every suite above is that
 * control, all of them running through the real guard).
 */
describe('DatasetSchemaDialog refuses a stale seed (AGL-1358)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  })

  const dataset = {
    $id: 'products',
    displayName: 'Products',
    model: {
      fields: { title: { name: 'Title', type: 'text' as const } },
      order: ['title'],
    },
  }

  it('does NOT write when the seeding listener is unconfirmed', async () => {
    renderDialog(dataset, true)

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))

    // Settle the click's promise chain before concluding nothing happened,
    // so this cannot pass merely by asserting too early.
    await waitFor(() => expect(doc).not.toHaveBeenCalled())
    expect(updateDoc).not.toHaveBeenCalled()
    // The refusal keeps the dialog open with the edited schema on screen.
    expect(screen.getByRole('button', { name: 'Save schema' })).toBeTruthy()
  })

  it('DOES write the same schema once the server has confirmed it', async () => {
    renderDialog(dataset, false)

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
  })
})

/**
 * AGL-1484: the dialog says what a collection's sharing actually is.
 *
 * This is the fourth copy of the substitution AGL-1466 removed from the two
 * media-folder surfaces and AGL-1480 removed from the two in the DAM detail
 * drawer — the same `Array.isArray(doc.visibleTo) ? doc.visibleTo : ['org']`
 * written out longhand, here at the seed AND at `handleSave`'s
 * `previousScope`.
 *
 * It bites harder in this collection than in media. `orgs/{orgId}/datasets`
 * is read with `array-contains-any` in `resolve-dataset.ts` and in the
 * console's `organizations.ts`, so an unstamped dataset is matched by no
 * reader in the product: it renders on no site and is missing from the
 * reference-health and workflow cards even for an org-wide member — the
 * exact inverse of the "All sites" this dialog reported about it.
 *
 * The treatment is AGL-1466's, deliberately not re-litigated: show the true
 * state rather than persist a default on render.
 */
describe('DatasetSchemaDialog shows the stored scope (AGL-1484)', () => {
  beforeEach(() => jest.clearAllMocks())

  const SOURCE = readFileSync(
    join(__dirname, 'dataset-schema-dialog.component.tsx'),
    'utf8',
  )

  /** Neither side re-derives the reading; both ask the one helper. */
  it('reads the stored sharing through the one helper, at both sites', () => {
    expect(SOURCE.match(/sharingChoiceOf\(dataset\)/g) ?? []).toHaveLength(2)
  })

  /**
   * The trap in this at all. An untouched dialog writes no sharing only because
   * the seed and the save read the same answer. Let them differ and a display
   * fix becomes a WRITE, on every dataset anyone merely opens, from a control
   * they never touched. So: saved untouched across the shapes a dataset arrives
   * in, a marked one included, and it asks the route for nothing.
   */
  it.each([
    [{}],
    [{ visibleTo: undefined }],
    [{ visibleTo: [] }],
    [{ visibleTo: ['org'] }],
    [{ visibleTo: ['host:a', 'host:b'] }],
    [{ visibleTo: ['host:a'], scopeMode: 'allExcept', scopeExcept: ['host:b'] }],
    [{ visibleTo: [], scopeMode: 'allExcept', scopeExcept: ['host:a', 'host:b'] }],
  ])('saves %j without touching its sharing', async (shape) => {
    renderDialog({ ...unsetDataset, ...shape } as never)

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(Object.keys(payload)).not.toContain('visibleTo')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  /** The write is still gated on that comparison, and only on it. */
  it('still writes the sharing only when it changed', () => {
    expect(SOURCE).toMatch(
      /const sharingWrite = orgId && viewerOrgWide && canChangeSharing && scopeChanged \?/,
    )
  })

  const unsetDataset = {
    $id: 'products',
    displayName: 'Products',
    model: {
      fields: { title: { name: 'Title', type: 'text' as const } },
      order: ['title'],
    },
  }

  it('reads unset — not "All sites" — for a collection with no visibleTo', () => {
    renderDialog(unsetDataset)

    expect(screen.getByText(/never been shared/i)).toBeTruthy()
    expect(screen.getByText(/hidden from every site/i)).toBeTruthy()
    // Offered, and not picked: nothing says All sites about a collection no
    // site can see.
    expect((screen.getByRole('radio', { name: 'All sites' }) as HTMLInputElement).checked).toBe(false)
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).checked).toBe(false)
    }
  })

  it('still reads "All sites" for a collection that stores the org token', () => {
    renderDialog({ ...unsetDataset, visibleTo: ['org'] } as never)

    expect(screen.queryByText(/never been shared/i)).toBeNull()
    expect((screen.getByRole('radio', { name: 'All sites' }) as HTMLInputElement).checked).toBe(true)
  })

  /** Opening the dialog is not a write. */
  it('writes nothing on open', async () => {
    renderDialog(unsetDataset)

    await waitFor(() =>
      expect(screen.getByText(/never been shared/i)).toBeTruthy(),
    )
    expect(updateDoc).not.toHaveBeenCalled()
    expect(doc).not.toHaveBeenCalled()
  })

  /** Choosing ends the unset state, and THAT save writes the scope. */
  it('writes the scope once somebody chooses one', async () => {
    renderDialog(unsetDataset)

    fireEvent.click(screen.getByRole('radio', { name: 'All sites' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(sharingCalls()[0]).toEqual({
      orgId: 'org-1',
      action: 'set-sharing',
      datasetId: 'products',
      choice: { mode: 'all' },
    })
    // Through the route alone: a client's write of `visibleTo` is what strands a marker.
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(Object.keys(payload)).not.toContain('visibleTo')
  })
})

/**
 * A sharing choice the document cannot store is refused, never widened
 * (AGL-2773).
 *
 * `normalizeVisibleTo` answers null for "Selected sites…" with no site picked,
 * and for more sites than one `array-contains-any` can match. Substituting the
 * org-wide token for that null saved a collection somebody was NARROWING as
 * shared with every site — straight after the dialog had warned about the
 * sites the change would take access from.
 */
describe('DatasetSchemaDialog refuses a scope it cannot store (AGL-2773)', () => {
  const dataset = {
    $id: 'products',
    displayName: 'Products',
    model: {
      fields: { title: { name: 'Title', type: 'text' as const } },
      order: ['title'],
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    mockOrgHosts = []
  })
  afterEach(() => {
    mockOrgHosts = []
  })

  /**
   * Waits past the narrowing confirmation and the seed guard, both of which
   * resolve asynchronously, so "nothing was written" cannot pass by being
   * asserted before the write would have landed.
   */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

  it('does not save "Selected sites…" with no site picked as All sites', async () => {
    renderDialog({ ...dataset, visibleTo: ['org'] } as never)

    fireEvent.click(screen.getByRole('radio', { name: /^Selected sites/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))
    await settle()

    expect(updateDoc).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.getByText(/at least one site/i)).toBeTruthy()
  })

  it('does not save more sites than a scope can hold as All sites', async () => {
    mockOrgHosts = Array.from(
      { length: Aglyn.MAX_SCOPE_HOSTS + 1 },
      (_, index) => ({ $id: `h${index + 1}`, name: `Site ${index + 1}` }),
    )
    renderDialog({ ...dataset, visibleTo: ['host:h1'] } as never)

    for (let index = 2; index <= Aglyn.MAX_SCOPE_HOSTS + 1; index += 1) {
      fireEvent.click(screen.getByText(`Site ${index}`))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))
    await settle()

    expect(updateDoc).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        new RegExp(`${Aglyn.MAX_SCOPE_HOSTS} sites or fewer`, 'i'),
      ),
    ).toBeTruthy()
  })

  it('THE CONTROL: still saves a selection it can store', async () => {
    mockOrgHosts = [
      { $id: 'h1', name: 'Site 1' },
      { $id: 'h2', name: 'Site 2' },
    ]
    renderDialog({ ...dataset, visibleTo: ['host:h1'] } as never)

    fireEvent.click(screen.getByText('Site 2'))
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(sharingCalls()[0].choice).toEqual({ mode: 'selected', hostIds: ['h1', 'h2'] })
  })
})

/**
 * "All sites except…" (AGL-4047). A dataset's sharing is written by the route,
 * which alone may set or remove the marker, and the dialog says what the route
 * would.
 */
describe('DatasetSchemaDialog shares with all sites except some (AGL-4047)', () => {
  const dataset = {
    $id: 'products',
    displayName: 'Products',
    model: {
      fields: { title: { name: 'Title', type: 'text' as const } },
      order: ['title'],
    },
  }
  const THREE_SITES = [
    { $id: 'h1', name: 'Site 1' },
    { $id: 'h2', name: 'Site 2' },
    { $id: 'h3', name: 'Site 3' },
  ]
  const exceptRadio = () => screen.getByRole('radio', { name: /^All sites except/ }) as HTMLInputElement
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    mockOrgHosts = THREE_SITES
  })
  afterEach(() => {
    mockOrgHosts = []
  })

  it('from All sites, starts with nothing left out and refuses to save that', async () => {
    renderDialog({ ...dataset, visibleTo: ['org'] } as never)

    fireEvent.click(exceptRadio())
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))
    await settle()

    expect(screen.getByText(/at least one site to leave out/i)).toBeTruthy()
    expect(updateDoc).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('saves the sites left out, through the route and never in the schema write', async () => {
    renderDialog({ ...dataset, visibleTo: ['org'] } as never)

    fireEvent.click(exceptRadio())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Site 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(sharingCalls()[0].choice).toEqual({ mode: 'allExcept', exceptHostIds: ['h2'] })
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(Object.keys(payload).sort()).toEqual(['displayName', 'fields', 'model', 'nameLower', 'names'])
  })

  it('from chosen sites, leaves out the ones not chosen', () => {
    renderDialog({ ...dataset, visibleTo: ['host:h1', 'host:h3'] } as never)

    fireEvent.click(exceptRadio())

    expect((screen.getByRole('checkbox', { name: 'Site 2' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Site 1' }) as HTMLInputElement).checked).toBe(false)
  })

  it('a marked dataset opens as what it is, and back to All sites goes through the route', async () => {
    renderDialog({ ...dataset, visibleTo: ['host:h1', 'host:h3'], scopeMode: 'allExcept', scopeExcept: ['host:h2'] } as never)

    expect(exceptRadio().checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Site 2' }) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'All sites' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(sharingCalls()[0].choice).toEqual({ mode: 'all' })
  })

  it('says the route’s refusal, and stays open', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Not yours to share.' }) })
    renderDialog({ ...dataset, visibleTo: ['org'] } as never)

    fireEvent.click(exceptRadio())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Site 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))
    await settle()

    expect(screen.getByRole('button', { name: 'Save schema' })).toBeTruthy()
  })

  it('a member who can only change the sharing writes no schema', async () => {
    render(
      <DatasetSchemaDialog
        orgId="org-1"
        dataset={{ ...dataset, visibleTo: ['org'] } as never}
        datasets={[]}
        recordCount={0}
        seedFromCache={false}
        sharingOnlyReason="This site narrows you."
        onClose={jest.fn()}
      />,
    )

    fireEvent.click(exceptRadio())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Site 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save sharing' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('a reader who can’t change it reads the all-except sentence', () => {
    render(
      <DatasetSchemaDialog
        orgId="org-1"
        dataset={{ ...dataset, visibleTo: ['host:h1', 'host:h3'], scopeMode: 'allExcept', scopeExcept: ['host:h2'] } as never}
        datasets={[]}
        recordCount={0}
        seedFromCache={false}
        canChangeSharing={false}
        onClose={jest.fn()}
      />,
    )

    expect(screen.getByText('All sites except Site 2')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('does not offer as a reference target a dataset chosen sites hold, for one a new site joins', () => {
    render(
      <DatasetSchemaDialog
        orgId="org-1"
        dataset={{
          ...dataset,
          visibleTo: ['host:h1', 'host:h3'],
          scopeMode: 'allExcept',
          scopeExcept: ['host:h2'],
          model: { fields: { link: { name: 'Link', type: 'reference' } }, order: ['link'] },
        } as never}
        datasets={[
          { $id: 'chosen', displayName: 'Chosen sites', visibleTo: ['host:h1', 'host:h3'] },
          { $id: 'every', displayName: 'Every site', visibleTo: ['org'] },
        ] as never}
        recordCount={0}
        seedFromCache={false}
        onClose={jest.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.mouseDown(screen.getByLabelText(/Target|Dataset|Collection/))
    const offered = screen.getAllByRole('option').map((option) => option.textContent)
    expect(offered).toContain('Every site')
    expect(offered).not.toContain('Chosen sites')
  })
})
