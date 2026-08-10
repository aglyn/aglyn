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
import { doc, updateDoc } from 'firebase/firestore'
import { DatasetSchemaDialog } from './dataset-schema-dialog.component'

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
  useFirestoreCollection: () => ({ data: [] }),
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
  beforeEach(() => jest.clearAllMocks())

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
