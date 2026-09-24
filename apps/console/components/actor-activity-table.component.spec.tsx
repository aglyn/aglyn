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

beforeEach(() => {
  mockRequests = []
  mockTableProps = null
})

describe('a filtered activity feed pages forward (AGL-3321)', () => {
  it('carries the cursor AND the filter to the next page', async () => {
    render(<ActorActivityTable endpoint="/api/x" header="Activity" />)
    await waitFor(() => expect(mockRequests).toHaveLength(1))

    await setClause('Published the screen')
    expect(last().get('filterValue')).toBe('Published the screen')
    expect(last().get('cursor')).toBeNull()

    await nextPage()
    expect(last().get('filterValue')).toBe('Published the screen')
    expect(last().get('cursor')).toBe(`hosts/h1/activity/e${mockRequests.length - 1}`)
    expect(mockTableProps.page).toBe(1)
  })

  it('starts again with no cursor when the filter changes', async () => {
    render(<ActorActivityTable endpoint="/api/x" header="Activity" />)
    await waitFor(() => expect(mockRequests).toHaveLength(1))
    await setClause('Published the screen')
    await nextPage()
    expect(last().get('cursor')).not.toBeNull()

    await setClause('Saved the screen')
    expect(last().get('filterValue')).toBe('Saved the screen')
    expect(last().get('cursor')).toBeNull()
    expect(mockTableProps.page).toBe(0)

    await setClause(null)
    expect(last().get('filterField')).toBeNull()
    expect(last().get('cursor')).toBeNull()
  })
})
