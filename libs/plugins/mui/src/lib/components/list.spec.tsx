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

import { render, screen } from '@testing-library/react'
import List, { ID as LIST_ID, presets as listPresets, schema as listSchema } from './list'
import ListItem, {
  ID as LIST_ITEM_ID,
  schema as listItemSchema,
} from './list-item'
import ListItemText, {
  ID as LIST_ITEM_TEXT_ID,
  schema as listItemTextSchema,
} from './list-item-text'

const names = (schema: any): string[] =>
  (schema.attributes ?? []).map((attribute: any) => attribute.name)

describe('List (AGL-1201: the schema had no attributes at all)', () => {
  it('renders a string heading as a real list subheader', () => {
    // MUI types `subheader` as a node: a bare string lands as unstyled
    // text outside the list's own heading treatment.
    const { container } = render(
      <List subheader="Resources">
        <ListItem>
          <ListItemText primary="One" />
        </ListItem>
      </List>,
    )
    expect(screen.getByText('Resources').className).toMatch(
      /MuiListSubheader/,
    )
    expect(container.querySelector('.MuiList-root')).toBeTruthy()
  })

  it('renders no subheader element when the heading is blank', () => {
    const { container } = render(
      <List subheader="">
        <ListItem>
          <ListItemText primary="One" />
        </ListItem>
      </List>,
    )
    expect(container.querySelector('.MuiListSubheader-root')).toBeNull()
  })

  it('passes the density and padding props through to MUI', () => {
    const { container } = render(
      <List dense disablePadding>
        <ListItem>
          <ListItemText primary="One" />
        </ListItem>
      </List>,
    )
    const root = container.querySelector('.MuiList-root') as HTMLElement
    expect(root.className).toMatch(/MuiList-dense/)
    // MUI adds `MuiList-padding` only when padding is NOT disabled.
    expect(root.className).not.toMatch(/MuiList-padding/)
  })

  it('exposes density, padding and a heading in the inspector', () => {
    // These were only reachable by hand-writing sx, which is not where
    // an author looks.
    expect(names(listSchema)).toEqual(
      expect.arrayContaining(['subheader', 'dense', 'disablePadding']),
    )
  })

  it('keeps the persisted component ids', () => {
    expect(LIST_ID).toBe('muiList')
    expect(LIST_ITEM_ID).toBe('muiListItem')
    expect(LIST_ITEM_TEXT_ID).toBe('muiListItemText')
  })

  it('still ships a preset with items already in it', () => {
    const list = listPresets[0].data as any
    expect(list.nodes.length).toBeGreaterThan(0)
    expect(list.nodes[0].componentId).toBe(LIST_ITEM_ID)
  })
})

describe('List Item', () => {
  it('exposes the row props the current docs list', () => {
    expect(names(listItemSchema)).toEqual(
      expect.arrayContaining([
        'divider',
        'alignItems',
        'dense',
        'disableGutters',
        'disablePadding',
      ]),
    )
  })

  it('does not offer `button`, removed from ListItem in MUI v6', () => {
    // v9 is installed here; `button` is silently ignored and the row
    // would simply not be clickable.
    expect(names(listItemSchema)).not.toContain('button')
  })

  it('offers only the two alignments MUI accepts', () => {
    const field = listItemSchema.attributes.find(
      (a: any) => a.name === 'alignItems',
    ) as any
    expect(field.options.map((option: any) => option.value)).toEqual([
      '',
      'flex-start',
    ])
  })

  it('draws a divider when asked', () => {
    const { container } = render(
      <List>
        <ListItem divider>
          <ListItemText primary="One" />
        </ListItem>
      </List>,
    )
    expect(
      (container.querySelector('.MuiListItem-root') as HTMLElement).className,
    ).toMatch(/MuiListItem-divider/)
  })
})

describe('List Item Text', () => {
  it('offers the inset alignment a mixed list needs', () => {
    expect(names(listItemTextSchema)).toEqual(
      expect.arrayContaining(['primary', 'secondary', 'inset']),
    )
  })

  it('indents when inset', () => {
    const { container } = render(
      <List>
        <ListItem>
          <ListItemText inset primary="One" />
        </ListItem>
      </List>,
    )
    expect(
      (container.querySelector('.MuiListItemText-root') as HTMLElement)
        .className,
    ).toMatch(/MuiListItemText-inset/)
  })
})
