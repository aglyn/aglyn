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

import type { Icon } from '../types'
import { MDI_ICON_SEARCH_LIMIT, searchMdiIcons } from './search-mdi-icons'

const icon = (id: string, name: string, as: string[] = [], tags: string[] = []): Icon => ({
  id,
  name,
  path: `M${id}`,
  as,
  tags,
})

const catalog: Icon[] = [
  icon('account', 'Account', [], ['person', 'user']),
  icon('account-circle', 'Account Circle', [], ['person']),
  icon('cart', 'Cart', ['shopping-cart'], ['shop', 'commerce']),
  icon('basket', 'Basket', [], ['shopping', 'shop']),
  icon('bullhorn', 'Bullhorn', ['megaphone'], ['marketing']),
  icon('cellphone-play', 'Cellphone Play'),
]

describe('searchMdiIcons', () => {
  it('answers the first icons, in catalog order, when nothing is typed', () => {
    expect(searchMdiIcons(catalog, '', 2).map((entry) => entry.id)).toEqual(['account', 'account-circle'])
    expect(searchMdiIcons(catalog, '   ').length).toBe(catalog.length)
  })

  it('needs every typed word to start a word of the name, an alias or a tag', () => {
    expect(searchMdiIcons(catalog, 'account circle').map((entry) => entry.id)).toEqual(['account-circle'])
    expect(searchMdiIcons(catalog, 'account').map((entry) => entry.id)).toEqual(['account', 'account-circle'])
    expect(searchMdiIcons(catalog, 'account zebra')).toEqual([])
  })

  it('finds an icon by an alias or a tag, ranked below a name hit', () => {
    expect(searchMdiIcons(catalog, 'shop').map((entry) => entry.id)).toEqual(['basket', 'cart'])
    expect(searchMdiIcons(catalog, 'megaphone').map((entry) => entry.id)).toEqual(['bullhorn'])
    expect(searchMdiIcons(catalog, 'bullhorn').map((entry) => entry.id)).toEqual(['bullhorn'])
  })

  it('reads case and separators loosely', () => {
    expect(searchMdiIcons(catalog, 'CELLPHONE-play').map((entry) => entry.id)).toEqual(['cellphone-play'])
    expect(searchMdiIcons(catalog, 'cellphone_play').map((entry) => entry.id)).toEqual(['cellphone-play'])
  })

  it('never answers more than the limit', () => {
    const many = Array.from({ length: 200 }, (_, index) => icon(`item-${index}`, `Item ${index}`))
    expect(searchMdiIcons(many, '').length).toBe(MDI_ICON_SEARCH_LIMIT)
    expect(searchMdiIcons(many, 'item', 500).length).toBe(MDI_ICON_SEARCH_LIMIT)
    expect(searchMdiIcons(many, 'item', 5).length).toBe(5)
    expect(searchMdiIcons(many, 'item', 0).length).toBe(1)
  })
})
