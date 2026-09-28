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

import { act, render, waitFor } from '@testing-library/react'

/**
 * The requests the table sent, as their query parameters. The route under
 * the table serves a filter and a cursor together (`readActorActivity`), so
 * what belongs here is whether the table ASKS for them together.
 */
let mockRequests: URLSearchParams[] = []
/** The props the table last handed its card. */
let mockTableProps: any = null

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1' } }),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, href: string) => {
    const params = new URL(href).searchParams
    mockRequests.push(params)
    const page = mockRequests.length
    return {
      ok: true,
      json: async () => ({
        entries: [{ $id: `e${page}`, scopeType: 'host', scopeId: 'h1' }],
        nextCursor: `hosts/h1/activity/e${page}`,
      }),
    }
  },
}))

jest.mock('@aglyn/aglyn', () => ({ listPluginActivityFilters: () => [] }))

jest.mock('./activity-table.component', () => ({
  __esModule: true,
  default: (props: any) => {
    mockTableProps = props
    return null
  },
}))

import { ActorActivityTable } from './actor-activity-table.component'

const setClause = async (value: string | null) => {
  await act(async () => {
    mockTableProps.filterChips.props.onChange(
      value ? [{ field: 'action', op: 'equals', value }] : [],
    )
  })
}
const nextPage = async () => {
  await act(async () => {
    mockTableProps.onPageChange(mockTableProps.page + 1)
  })
}
const last = () => mockRequests[mockRequests.length - 1]
const filtersOf = (params: URLSearchParams) => JSON.parse(params.get('filters') ?? '[]')

beforeEach(() => {
  mockRequests = []
  mockTableProps = null
})

describe('the search box asks the route (AGL-3321)', () => {
  it('sends the words, and starts again at page one', async () => {
    render(<ActorActivityTable endpoint="/api/x" header="Activity" />)
    await waitFor(() => expect(mockRequests).toHaveLength(1))
    expect(mockTableProps.quickFilter).toBe(true)
    await act(async () => {
      mockTableProps.onFilterModelChange({ items: [], quickFilterValues: ['ada'] })
    })
    await waitFor(() => expect(last().get('search')).toBe('ada'))
    expect(last().get('cursor')).toBeNull()
  })
})

describe('a filtered activity feed pages forward (AGL-3321)', () => {
  it('carries the cursor AND the filter to the next page', async () => {
    render(<ActorActivityTable endpoint="/api/x" header="Activity" />)
    await waitFor(() => expect(mockRequests).toHaveLength(1))

    await setClause('Published the screen')
    await waitFor(() =>
      expect(filtersOf(last())).toEqual([
        { field: 'action', op: 'equals', value: 'Published the screen' },
      ]),
    )
    expect(last().get('cursor')).toBeNull()

    await nextPage()
    expect(filtersOf(last())[0].value).toBe('Published the screen')
    expect(last().get('cursor')).toBe(`hosts/h1/activity/e${mockRequests.length - 1}`)
    expect(mockTableProps.page).toBe(1)
  })

  it('starts again with no cursor when the filter changes', async () => {
    render(<ActorActivityTable endpoint="/api/x" header="Activity" />)
    await waitFor(() => expect(mockRequests).toHaveLength(1))
    await setClause('Published the screen')
    await waitFor(() => expect(filtersOf(last())).toHaveLength(1))
    await nextPage()
    expect(last().get('cursor')).not.toBeNull()

    await setClause('Saved the screen')
    await waitFor(() => expect(filtersOf(last())[0]?.value).toBe('Saved the screen'))
    expect(last().get('cursor')).toBeNull()
    expect(mockTableProps.page).toBe(0)

    await setClause(null)
    await waitFor(() => expect(last().get('filters')).toBeNull())
    expect(last().get('cursor')).toBeNull()
  })
})

describe('every row names who acted (AGL-3376)', () => {
  it('has a Who column reading the address then, a key, or the address now', async () => {
    render(<ActorActivityTable endpoint="/api/x" header="Activity" />)
    await waitFor(() => expect(mockRequests).toHaveLength(1))
    const who = mockTableProps.columns.find((column: any) => column.field === 'actorEmail')
    expect(who?.headerName).toBe('Who (then)')
    const read = (row: Record<string, unknown>) => who.valueGetter(undefined, row)
    expect(read({ actorId: 'u1', actorEmail: 'then@example.test' })).toBe('then@example.test')
    expect(read({ actorId: 'api', actorEmail: null, apiKeyName: 'Zapier' })).toBe(
      'API key Zapier',
    )
    expect(read({ actorId: 'u1', actorEmail: null, actorEmailNow: 'now@example.test' })).toBe(
      'now@example.test',
    )
  })
})

