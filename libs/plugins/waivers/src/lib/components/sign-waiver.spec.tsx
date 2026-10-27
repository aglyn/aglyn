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

import { entityPickerForAttribute } from '@aglyn/aglyn/plugin-manager/plugin-entity-pickers'
import { act, render } from '@testing-library/react'
import SignWaiver, { schema } from './sign-waiver'

jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: null }) }))
jest.mock('@aglyn/aglyn', () => ({ ...jest.requireActual('@aglyn/aglyn'), useSite: () => ({ hostId: 'host-1' }) }))

/**
 * The Sign waiver element's waiver (AGL-4042): the site builder PICKS it from
 * the site's waivers in the Besigner, never types an id or a link, and a
 * share link's `?waiver=` still opens the waiver it was made for.
 */

const asked: string[] = []

beforeEach(() => {
  asked.length = 0
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    asked.push(String(url))
    return { ok: false, status: 404, json: async () => ({ error: 'This waiver is not available.' }) }
  }) as never
})

async function place(props: Record<string, unknown>, search = '') {
  window.history.pushState({}, '', `/sign-waiver${search}`)
  await act(async () => {
    render(<SignWaiver {...props} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe('the Sign waiver element’s waiver picker', () => {
  it('is a picker of the site’s waivers, listed by title from the waivers the routes mirror', () => {
    const attribute = schema.attributes?.find((one) => one.name === 'waiverId')
    expect(attribute).toMatchObject({ label: 'Waiver', component: 'waiver-select' })
    expect(entityPickerForAttribute(String(attribute?.component))).toMatchObject({
      kind: 'waivers',
      pluginId: 'waivers',
      scope: 'host',
      collection: 'waiverTitles',
      nameField: 'title',
      where: [{ field: 'pickable', equals: true }],
      page: 'the Waivers page',
    })
    // The waiver is chosen, never typed: the only other setting is the list's heading.
    expect(schema.attributes?.map((one) => one.name)).toEqual(['waiverId', 'heading'])
  })

  it('opens the picked waiver', async () => {
    await place({ waiverId: 'w-picked' })
    expect(asked[asked.length - 1]).toBe('/api/waivers/public?hostId=host-1&waiverId=w-picked')
  })

  it('opens a share link’s waiver over the picked one', async () => {
    await place({ waiverId: 'w-picked' }, '?waiver=w-linked')
    expect(asked[asked.length - 1]).toBe('/api/waivers/public?hostId=host-1&waiverId=w-linked')
  })

  it('lists the site’s waivers when none is picked', async () => {
    await place({})
    expect(asked[asked.length - 1]).toBe('/api/waivers/public?hostId=host-1')
  })
})
