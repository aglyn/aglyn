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

  /**
   * The two expressions, lifted from the component's own source.
   *
   * Both are single-line `const` declarations with nothing but the
   * expression after the `=`, and each name occurs once in the file — so a
   * comment cannot stand in for either. The assertion below is on the
   * VALUES they produce, which is the only form that catches the trap.
   */
  const expressionAfter = (declaration: string): string => {
    const start = SOURCE.indexOf(declaration)
    expect(start).toBeGreaterThan(-1)
    return SOURCE.slice(start + declaration.length, SOURCE.indexOf('\n', start))
  }

  /**
   * The trap in fixing this at all, and the reason the two call sites move
   * in ONE commit.
   *
   * Today an untouched dialog writes no scope only because the seed and
   * `previousScope` substituted the SAME `['org']`, so `scopeChanged` came
   * out false. Correct one and not the other and a display bug becomes a
   * WRITE — on every unset collection anyone merely opens, from a control
   * they never touched, and one the AGL-1041 rules then reject for any
   * member who is not org-wide, failing the whole schema save with it.
   *
   * So: both expressions are evaluated against the same document across the
   * shapes a dataset actually arrives in, and required to agree. If they
   * agree, `scopeChanged` is false however either is spelled.
   */
  it('opens without making the save gate think the scope changed', () => {
    const seed = expressionAfter('const storedDatasetScope =')
    const previous = expressionAfter('const previousScope: string[] =')
    expect(seed.trim()).toBeTruthy()
    expect(previous.trim()).toBeTruthy()

    /**
     * The lifted expression, run against a document.
     *
     * The only edit is erasing the `as { visibleTo?: string[] }` assertions
     * — `new Function` parses JavaScript, and an assertion is precisely the
     * part of the text that has no runtime meaning, so removing it is what
     * the compiler does rather than a simplification of what is asserted.
     * Both sides are checked below to still read the field through the
     * helper afterwards, so an erasure that ate the expression would not
     * pass quietly.
     */
    const evaluate = (expression: string, document: unknown) => {
      const runtime = expression
        .replace(/\s+as\s+\{[^}]*\}/g, '')
        .replace(/,\s*$/, '')
      expect(runtime).toMatch(/storedScope\(\(?dataset\)?\.visibleTo\)/)
      return new Function(
        'storedScope',
        'dataset',
        `return (${runtime})`,
      )(Aglyn.storedScope, document)
    }

    for (const document of [
      {},
      { visibleTo: undefined },
      // A stored empty array is a written "visible to nobody". The dialog
      // must not read that as org-wide either.
      { visibleTo: [] },
      { visibleTo: ['org'] },
      { visibleTo: ['host:a', 'host:b'] },
    ]) {
      expect(evaluate(`${seed} ?? []`, document)).toEqual(
        evaluate(previous, document),
      )
    }
  })

  /** Neither side re-derives the reading; both ask the one helper. */
  it('reads the stored scope through the one helper, at both sites', () => {
    expect(SOURCE.match(/storedScope\(\(dataset as/g) ?? []).toHaveLength(2)
  })

  /** The write is still gated on that comparison, and only on it. */
  it('still writes the scope only when it changed', () => {
    expect(SOURCE).toMatch(
      /\.\.\.\(orgId && viewerOrgWide && scopeChanged\s*\n?\s*\?\s*\{ visibleTo:/,
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
    // A real sentinel, never '' — MUI cannot hold an empty string as a
    // selected value and a corpus spec forbids one.
    expect(screen.getByText('Not shared with any site')).toBeTruthy()
    expect(screen.queryByText('All sites')).toBeNull()
  })

  it('still reads "All sites" for a collection that stores the org token', () => {
    renderDialog({ ...unsetDataset, visibleTo: ['org'] } as never)

    expect(screen.queryByText(/never been shared/i)).toBeNull()
    expect(screen.queryByText('Not shared with any site')).toBeNull()
    expect(screen.getByText('All sites')).toBeTruthy()
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

  /**
   * And saving an untouched dialog does not smuggle a scope in with the
   * schema. `visibleTo` is absent from the payload entirely — which is the
   * difference between this and the cascading write the pairing prevents.
   */
  it('saves the schema without stamping a scope nobody chose', async () => {
    renderDialog(unsetDataset)

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(Object.keys(payload)).not.toContain('visibleTo')
  })

  /** Choosing ends the unset state, and THAT save writes the scope. */
  it('writes the scope once somebody chooses one', async () => {
    renderDialog(unsetDataset)

    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'All sites' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save schema' }))
    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = (updateDoc as jest.Mock).mock.calls[0]
    expect(payload.visibleTo).toEqual(['org'])
  })
})
