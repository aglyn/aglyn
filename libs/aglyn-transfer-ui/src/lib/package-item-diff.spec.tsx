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
 * One changed package item in the import's Changes step (AGL-3545): a kind
 * the surface hands a renderer for is drawn side by side by it, each side
 * with its own content; records are a table of what the file adds, drops
 * and changes, with each changed cell marked, paged; and the value list
 * stays below either, without the records it would otherwise compare whole.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'

import type { SitePackageComparison, SitePackagePlanItem } from './site-package-client'
import {
  PackageItemDiff,
  type PackageItemRenderProps,
} from './package-item-diff.component'

function planItem(kind: string, id: string, name: string): SitePackagePlanItem {
  return {
    key: `${kind}/${id}`,
    kind,
    id,
    name,
    status: 'differs',
    comparison: 'differs',
    existing: { id, name },
    matchedBy: 'id',
    deps: [],
    missing: [],
    proposed: 'skip',
    needsChoice: true,
    choices: ['replace', 'keepBoth', 'skip'],
  } as SitePackagePlanItem
}

function FakeFormRenderer(props: PackageItemRenderProps) {
  const content = props.content as { fields?: Array<{ fieldName: string }> }
  return (
    <ul aria-label={`${props.side} form ${props.id}`}>
      {(content.fields ?? []).map((field) => (
        <li key={field.fieldName}>{field.fieldName}</li>
      ))}
    </ul>
  )
}

describe('PackageItemDiff renders a kind through the renderer the surface hands it', () => {
  const item = planItem('form', 'contact', 'Contact')
  const comparison: SitePackageComparison = {
    key: item.key,
    kind: 'form',
    id: 'contact',
    existing: { id: 'contact', content: { displayName: 'Contact', fields: [{ fieldName: 'email' }] } },
    incoming: { displayName: 'Contact us', fields: [{ fieldName: 'email' }, { fieldName: 'phone' }] },
  }

  it('draws both sides with it, each with its own content, and keeps the value list below', () => {
    const previewHref = jest.fn(() => '/preview')
    render(
      <PackageItemDiff
        item={item}
        comparison={comparison}
        decision="replace"
        previewHref={previewHref}
        renderers={{ form: FakeFormRenderer }}
      />,
    )
    const site = screen.getByRole('list', { name: 'site form contact' })
    const file = screen.getByRole('list', { name: 'file form contact' })
    expect(within(site).queryByText('phone')).toBeNull()
    expect(within(file).getByText('phone')).toBeTruthy()
    // The renderer stands in for the frame: no preview URL is asked for.
    expect(previewHref).not.toHaveBeenCalled()
    expect(screen.queryByTitle('Contact on this site')).toBeNull()
    expect(screen.getByRole('region', { name: 'Contact on this site' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Contact in the file' })).toBeTruthy()

    const values = screen.getByRole('table', { name: 'Changes to Contact' })
    expect(within(values).getByText('displayName')).toBeTruthy()
    expect(within(values).getByText('Contact us')).toBeTruthy()
  })

  it('says the site has no copy of a new item, and draws only the file`s side', () => {
    const fresh = planItem('form', 'quote', 'Quote')
    render(
      <PackageItemDiff
        item={fresh}
        comparison={{ key: fresh.key, kind: 'form', id: 'quote', existing: null, incoming: { fields: [{ fieldName: 'name' }] } }}
        decision={null}
        renderers={{ form: FakeFormRenderer }}
      />,
    )
    expect(screen.getByText('This site has no copy of it.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: /^site form/ })).toBeNull()
    expect(within(screen.getByRole('list', { name: 'file form quote' })).getByText('name')).toBeTruthy()
  })

  it('keeps the preview frames for a kind it has no renderer for', () => {
    const page = planItem('page', 'home', 'Home')
    render(
      <PackageItemDiff
        item={page}
        comparison={{ key: page.key, kind: 'page', id: 'home', existing: { id: 'home', content: { a: 1 } }, incoming: { a: 2 } }}
        decision={null}
        previewHref={({ side }) => `/preview/${side}`}
        renderers={{ form: FakeFormRenderer }}
      />,
    )
    expect(screen.getByTitle('Home on this site').getAttribute('src')).toBe('/preview/site')
    expect(screen.getByTitle('Home in the file').getAttribute('src')).toBe('/preview/file')
  })
})

describe('PackageItemDiff diffs an item`s records as a table', () => {
  const item = planItem('dataset', 'menu', 'Menu')
  const site = {
    displayName: 'Menu',
    records: [
      { $id: 'r1', name: 'Soup', price: 4 },
      { $id: 'r2', name: 'Bread', price: 2 },
      { $id: 'r3', name: 'Tea', price: 1 },
    ],
  }
  const file = {
    displayName: 'Lunch menu',
    records: [
      { $id: 'r1', name: 'Soup', price: 5 },
      { $id: 'r3', name: 'Tea', price: 1 },
      { $id: 'r4', name: 'Cake', price: 3 },
    ],
  }

  it('lists what the file adds, no longer holds and changes, and marks each changed cell', () => {
    render(
      <PackageItemDiff
        item={item}
        comparison={{ key: item.key, kind: 'dataset', id: 'menu', existing: { id: 'menu', content: site }, incoming: file }}
        decision="replace"
      />,
    )
    expect(
      screen.getByText('1 new record · 1 changed record · 1 record not in the file · 1 unchanged'),
    ).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Records of Menu' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual(['r1', 'r4', 'r2'])

    const [changed, added, removed] = rows as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(changed).getByText('Changed')).toBeTruthy()
    const marked = changed.querySelectorAll('[data-changed="true"]')
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toBe('54')
    expect(within(added).getByText('New')).toBeTruthy()
    expect(added.querySelectorAll('[data-changed="true"]')).toHaveLength(0)
    expect(within(removed).getByText('Not in the file')).toBeTruthy()
    expect(within(removed).getByText('Bread')).toBeTruthy()

    // The value list keeps every other value, and no longer compares the
    // records as one value.
    const values = screen.getByRole('table', { name: 'Changes to Menu' })
    expect(within(values).getByText('Lunch menu')).toBeTruthy()
    expect(within(values).queryByText('records')).toBeNull()
  })

  it('says so when every record matches, while the rest of the item differs', () => {
    render(
      <PackageItemDiff
        item={item}
        comparison={{
          key: item.key,
          kind: 'dataset',
          id: 'menu',
          existing: { id: 'menu', content: site },
          incoming: { ...site, displayName: 'Lunch menu' },
        }}
        decision={null}
      />,
    )
    expect(screen.getByText('Every record in the file matches this site’s.')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Records of Menu' })).toBeNull()
  })

  it('pages a long list', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ $id: `e${index + 1}`, title: `Entry ${index + 1}` }))
    const collection = planItem('collection', 'blog', 'Blog')
    render(
      <PackageItemDiff
        item={collection}
        comparison={{ key: collection.key, kind: 'collection', id: 'blog', existing: null, incoming: { entries: many } }}
        decision={null}
      />,
    )
    const table = () => screen.getByRole('table', { name: 'Records of Blog' })
    expect(within(table()).getAllByRole('row')).toHaveLength(26)
    expect(within(table()).getByText('e1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(within(table()).getAllByRole('row')).toHaveLength(6)
    expect(within(table()).getByText('e30')).toBeTruthy()
  })
})
