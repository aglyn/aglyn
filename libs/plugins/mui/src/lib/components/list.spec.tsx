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

import * as Aglyn from '@aglyn/aglyn'
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
    // `center` rather than `''` since AGL-1451: both are real MUI values
    // and both persist, so the row can be moved back off Top.
    expect(field.options.map((option: any) => option.value)).toEqual([
      'center',
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

  /**
   * The second element that accepted children in the hierarchy and discarded
   * them at render (AGL-1388), found sweeping for the Markdown block's shape.
   * MUI reads `children` only as a fallback for a missing `primary`, so with
   * a primary set — every preset, every authored row — a dropped node is
   * gone with no warning.
   */
  it('takes no children: a dropped node vanishes behind `primary`', () => {
    expect(listItemTextSchema.flags?.dropping).toBe(
      Aglyn.FEATURE_FLAG.DISABLED,
    )
    // The render behaviour the flag is describing, so the flag cannot drift
    // away from the component it speaks for.
    render(
      <ListItemText primary="One">
        <span data-testid="dropped">{'two'}</span>
      </ListItemText>,
    )
    expect(screen.queryByTestId('dropped')).toBeNull()
    expect(screen.getByText('One')).toBeTruthy()
  })
})

/** AGL-1451 — cleared values must reach MUI as absences, not as `''`. */
const itemRoot = (ui: React.ReactElement): HTMLElement => {
  const { container } = render(ui)
  return container.querySelector('.MuiListItem-root') as HTMLElement
}

describe('List Item drops cleared props before MUI sees them (AGL-1451)', () => {
  it('a cleared alignment renders exactly as an absent one', () => {
    const absent = itemRoot(<ListItem>{'One'}</ListItem>).className
    for (const cleared of [null, '']) {
      expect(
        itemRoot(
          <ListItem alignItems={cleared as any}>{'One'}</ListItem>,
        ).className,
      ).toBe(absent)
    }
  })

  it('and that render is MUI’s own default: centred, not flex-start', () => {
    expect(
      itemRoot(<ListItem alignItems={null as any}>{'One'}</ListItem>)
        .className,
    ).not.toMatch(/alignItemsFlexStart/)
  })

  it('a cleared switch attribute does not reach MUI as a value', () => {
    expect(
      itemRoot(<ListItem divider={null as any}>{'One'}</ListItem>).className,
    ).toBe(itemRoot(<ListItem>{'One'}</ListItem>).className)
  })

  // ---- positive controls ----

  it('keeps an explicit flex-start alignment', () => {
    expect(
      itemRoot(<ListItem alignItems="flex-start">{'One'}</ListItem>)
        .className,
    ).toMatch(/alignItemsFlexStart/)
  })

  it('keeps `disablePadding` when it is really set', () => {
    // MUI emits `MuiListItem-padding` only when padding is NOT disabled,
    // so the class disappearing is the prop having arrived.
    expect(itemRoot(<ListItem>{'One'}</ListItem>).className).toMatch(
      /MuiListItem-padding/,
    )
    expect(
      itemRoot(<ListItem disablePadding>{'One'}</ListItem>).className,
    ).not.toMatch(/MuiListItem-padding/)
  })

  it('never offers a value the attributes form cannot persist', () => {
    for (const attribute of listItemSchema.attributes ?? []) {
      for (const option of (attribute as any).options ?? []) {
        expect(option.value).not.toBe('')
        expect(option.value).not.toBeNull()
        expect(option.value).not.toBeUndefined()
      }
    }
  })
})
