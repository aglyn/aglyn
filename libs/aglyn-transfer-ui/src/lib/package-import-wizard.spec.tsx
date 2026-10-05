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
 * The site package import wizard (AGL-3534), driven through a fake client
 * the way a person drives it: a changed item waits for a decision, a
 * default applies where an item can take it and an item's own choice wins,
 * a missing dependency is answered before the import goes on, each changed
 * item is compared rendered and value by value, a merged item is chosen
 * key by key, the review waits for every warning and refuses what a plan
 * limit refuses, and an import is undone with each edited item asked about.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import {
  SITE_PACKAGE_FILE,
  createFakeSitePackageClient,
  type FakeSitePackageClient,
} from '../fixtures/site-package'
import { PackageImportWizard } from './package-import-wizard.component'
import type { PackageImportWizardProps } from './package-import-wizard.component'
import type { PackagePreviewInput } from './package-item-diff.component'

function choose(name: string | RegExp, option: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }))
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const disabled = (name: string | RegExp) => button(name).hasAttribute('disabled')

function renderWizard(
  client: FakeSitePackageClient = createFakeSitePackageClient(),
  props: Partial<PackageImportWizardProps> = {},
) {
  const view = render(<PackageImportWizard client={client} {...props} />)
  return { ...view, client }
}

async function upload(content: string = JSON.stringify(SITE_PACKAGE_FILE)) {
  const file = new File([content], 'acme.json', { type: 'application/json' })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Package file'), { target: { files: [file] } })
  })
}

async function toItems(client?: FakeSitePackageClient, props?: Partial<PackageImportWizardProps>) {
  const rendered = renderWizard(client, props)
  await upload()
  await screen.findByRole('table', { name: 'Pages' })
  return rendered
}

describe('PackageImportWizard', () => {
  it('reads the file, plans it, and groups the items by kind with their status', async () => {
    const { client } = await toItems()
    expect(client.calls.plan).toEqual([undefined])
    expect(screen.getByText(/acme\.json: 1 new item, 2 items that differ/)).toBeTruthy()
    const pages = screen.getByRole('table', { name: 'Pages' })
    expect(within(pages).getByText('Differs')).toBeTruthy()
    expect(within(pages).getByText('Already on this site')).toBeTruthy()
    expect(within(pages).getByText('Needs something')).toBeTruthy()
    expect(within(pages).getByText('Needs layout gone')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Layouts' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Site settings' })).toBeTruthy()
  })

  it('says a file that is not JSON cannot be read', async () => {
    renderWizard()
    await upload('not json')
    expect(await screen.findByText('That file is not a site package or backup.')).toBeTruthy()
  })

  it('waits for every changed item; a default applies where it can, and an item’s own choice wins', async () => {
    await toItems()
    expect(disabled('Next')).toBe(true)
    expect(screen.getByText(/Choose what to do with 2 changed items/)).toBeTruthy()
    choose('Changed items', /Keep both/)
    // Settings cannot be kept twice, so the default does not reach it.
    expect(screen.getByText(/Choose what to do with 1 changed item/)).toBeTruthy()
    choose('Decision for Site settings', /Merge/)
    expect(disabled('Next')).toBe(false)
    expect(within(screen.getByRole('table', { name: 'Pages' })).getByRole('combobox', { name: 'Decision for Home' }).textContent).toContain('Keep both')
    choose('Decision for Home', /Replace/)
    expect(screen.getByRole('combobox', { name: 'Decision for Home' }).textContent).toContain('Replace')
  })

  it('filters by status, kind and search', async () => {
    await toItems()
    choose('Show', /^New \(1\)/)
    expect(screen.queryByRole('table', { name: 'Pages' })).toBeNull()
    expect(screen.getByRole('table', { name: 'Layouts' })).toBeTruthy()
    choose('Show', /^All/)
    choose('Kind', /Pages/)
    expect(screen.queryByRole('table', { name: 'Layouts' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'orph' } })
    const pages = screen.getByRole('table', { name: 'Pages' })
    expect(within(pages).queryByText('Home')).toBeNull()
    expect(within(pages).getByText('Orphan')).toBeTruthy()
  })

  it('walks a whole import: dependencies, a rendered and value diff, keys of a merge, review, apply and undo', async () => {
    const previewHref = jest.fn((input: PackagePreviewInput) =>
      input.kind === 'page' ? `/preview/${input.side}/${input.id}` : null,
    )
    const onImported = jest.fn()
    const { client } = await toItems(undefined, { previewHref, onImported })
    choose('Changed items', /Replace/)
    choose('Decision for Site settings', /Merge/)
    choose('Decision for New chrome', /Skip/)
    fireEvent.click(button('Next'))

    // Missing items: the layout the file carries is imported unless told
    // otherwise; the one nobody holds waits for an answer.
    const missing = await screen.findByRole('table', { name: 'Missing items' })
    expect(within(missing).getByRole('combobox', { name: 'What to do about New chrome' }).textContent).toContain(
      'Import it from the file',
    )
    expect(screen.getByText(/Choose what to do about 1 missing item/)).toBeTruthy()
    choose('What to do about Layouts: gone', /Use an item this site has/)
    expect(screen.getByText(/Pick the item to use for 1 reference/)).toBeTruthy()
    const picker = await screen.findByRole('combobox', { name: 'Use instead of Layouts: gone' })
    fireEvent.mouseDown(picker)
    fireEvent.click(await screen.findByRole('option', { name: 'Site chrome' }))
    await waitFor(() => expect(disabled('Next')).toBe(false))
    await act(async () => {
      fireEvent.click(button('Next'))
    })

    // Changes: the first changed item, rendered both sides and value by value.
    await screen.findByRole('table', { name: 'Changes to Home' })
    expect(client.calls.compare).toEqual([['page/home']])
    expect(screen.getByTitle('Home on this site').getAttribute('src')).toBe('/preview/site/home')
    expect(screen.getByTitle('Home in the file').getAttribute('src')).toBe('/preview/file/home')
    const changes = screen.getByRole('table', { name: 'Changes to Home' })
    expect(within(changes).getByText('version › nodes › text › props › children')).toBeTruthy()
    expect(within(changes).getByText('Welcome')).toBeTruthy()
    expect(within(changes).getByText('Welcome back')).toBeTruthy()

    // The merged settings, key by key: the site keeps what it set unless told.
    await act(async () => {
      fireEvent.click(within(screen.getByRole('list', { name: 'Changed items' })).getByText('Site settings'))
    })
    const keys = await screen.findByRole('table', { name: 'Keys of Site settings' })
    expect(within(keys).getByRole('combobox', { name: 'Keep for locale' }).textContent).toContain('This site’s')
    expect(within(keys).getByRole('combobox', { name: 'Keep for favicon' }).textContent).toContain('The file’s')
    choose('Keep for displayName', /The file’s/)
    await act(async () => {
      fireEvent.click(button('Review'))
    })

    // Review: re-planned with every decision; each warning acknowledged.
    await screen.findByText('Replace: 1 item')
    expect(client.calls.plan.at(-1)?.decisions).toMatchObject({ 'page/home': 'replace' })
    expect(disabled('Import')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand: Items written over' }))
    expect(disabled('Import')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand: References pointed at this site/ }))
    expect(disabled('Import')).toBe(false)
    await act(async () => {
      fireEvent.click(button('Import'))
    })

    expect(client.calls.apply).toEqual([
      {
        decisions: {
          'page/home': 'replace',
          'page/about': 'skip',
          'page/orphan': 'create',
          'layout/chrome-new': 'skip',
          'settings/settings': 'merge',
        },
        dependencyChoices: { 'layout/chrome-new': 'import', 'layout/gone': { mapTo: 'site-chrome' } },
        mergeChoices: { 'settings/settings': { displayName: 'package' } },
      },
    ])
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ importId: 'import-1' }))
    expect(await screen.findByText(/Imported: .*\(7 documents written\)/)).toBeTruthy()

    // Undo asks about the item edited since, and leaves it unless told.
    await act(async () => {
      fireEvent.click(button('Undo this import…'))
    })
    await screen.findByRole('table', { name: 'Items edited since the import' })
    choose('Undo for Home', /Undo it too/)
    await act(async () => {
      fireEvent.click(button('Undo import'))
    })
    expect(client.calls.undo).toEqual([{ decisions: { 'page/home': 'revert' }, otherwise: 'keep' }])
    expect(await screen.findByText(/Undone: 4 items put back/)).toBeTruthy()
  })

  it('refuses an import a plan limit refuses, and tells what the site cannot read', async () => {
    const client = createFakeSitePackageClient({
      capRefusal: 'This site has reached its 10 pages.',
      unknownKinds: ['booking'],
    })
    await toItems(client)
    choose('Changed items', /^Skip/)
    fireEvent.click(button('Next'))
    choose('What to do about Layouts: gone', /Remove the reference/)
    expect(screen.getByText('Removed from 1 item.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(button('Next'))
    })
    // Skipped items that differ are still there to compare.
    expect(await screen.findByRole('list', { name: 'Changed items' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(button('Review'))
    })
    await screen.findByText('This site has reached its 10 pages.')
    expect(screen.getByText(/A plan limit refuses this import/)).toBeTruthy()
    expect(screen.getByText(/Items this site cannot read/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand: References removed' }))
    expect(disabled('Import')).toBe(true)
  })

  it('plans a file it is handed and opens on the items', async () => {
    const { client } = renderWizard(undefined, { initialFile: { name: 'acme.json', content: SITE_PACKAGE_FILE } })
    await screen.findByRole('table', { name: 'Pages' })
    expect(client.calls.plan).toHaveLength(1)
  })
})
