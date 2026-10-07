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

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useClientPagination } from '../hooks/use-client-pagination'
import { CopyField } from './copy-field.component'
import { StatusChip } from './status-chip.component'

/** The status chip, the copy field and in-memory paging (AGL-3637). */

describe('StatusChip', () => {
  it('names the state and colors it by tone', () => {
    render(<StatusChip label="Connected" tone="success" data-testid="chip" />)
    const chip = screen.getByTestId('chip')
    expect(chip.textContent).toBe('Connected')
    expect(chip.className).toMatch(/colorSuccess/)
  })

  it('is neutral by default', () => {
    render(<StatusChip label="Off" data-testid="chip" />)
    expect(screen.getByTestId('chip').className).toMatch(/colorDefault/)
  })
})

describe('CopyField', () => {
  it('shows the value read-only and copies it', async () => {
    const writeText = jest.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const onCopied = jest.fn()
    render(<CopyField label="Feed address" value="https://x.example.com/feed.xml" onCopied={onCopied} />)
    const input = screen.getByLabelText('Feed address') as HTMLInputElement
    expect(input.value).toBe('https://x.example.com/feed.xml')
    expect(input.readOnly).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Copy feed address' }))
    await waitFor(() => expect(onCopied).toHaveBeenCalled())
    expect(writeText).toHaveBeenCalledWith('https://x.example.com/feed.xml')
  })

  it('reports a refused clipboard', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => Promise.reject(new Error('denied'))) } })
    const onCopyFailed = jest.fn()
    render(<CopyField label="Key" value="k" onCopyFailed={onCopyFailed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy key' }))
    await waitFor(() => expect(onCopyFailed).toHaveBeenCalled())
  })
})

describe('useClientPagination', () => {
  const items = Array.from({ length: 23 }, (_, n) => n)

  it('pages a list for ListPagination, with its total', () => {
    const { result } = renderHook(() => useClientPagination(items, { pageSize: 10 }))
    expect(result.current.pageItems).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.current.paginationProps).toMatchObject({ page: 0, pageSize: 10, rowCount: 10, count: 23 })
    act(() => result.current.setPage(2))
    expect(result.current.pageItems).toEqual([20, 21, 22])
    act(() => result.current.setPageSize(25))
    expect(result.current.page).toBe(0)
    expect(result.current.pageItems).toHaveLength(23)
  })

  it('pulls the page back inside a list that shrank', () => {
    const { result, rerender } = renderHook(({ list }) => useClientPagination(list, { pageSize: 10 }), {
      initialProps: { list: items },
    })
    act(() => result.current.setPage(2))
    rerender({ list: items.slice(0, 4) })
    expect(result.current.page).toBe(0)
    expect(result.current.pageItems).toEqual([0, 1, 2, 3])
  })
})
