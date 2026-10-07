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

import { fireEvent, render, screen } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useInView } from '../hooks/use-in-view'
import {
  downloadCostLabel,
  DownloadCostBadge,
  formatDownloadSize,
} from './download-cost-badge.component'
import { SearchableVirtualList } from './searchable-virtual-list.component'

// jsdom lays nothing out, so the virtual list is drawn whole.
jest.mock('react-virtuoso', () => ({
  Virtuoso: (props: {
    totalCount: number
    itemContent: (index: number) => JSX.Children
    components?: { Header?: () => JSX.Children }
  }) => (
    <div>
      {props.components?.Header ? <props.components.Header /> : null}
      {Array.from({ length: props.totalCount }, (_, index) => (
        <div key={index}>{props.itemContent(index)}</div>
      ))}
    </div>
  ),
}))

describe('DownloadCostBadge (AGL-3656)', () => {
  it('reads a size as a person does', () => {
    expect(formatDownloadSize(0)).toBe('0 KB')
    expect(formatDownloadSize(300)).toBe('1 KB')
    expect(formatDownloadSize(38_912)).toBe('38 KB')
    expect(formatDownloadSize(1_258_291)).toBe('1.2 MB')
    expect(downloadCostLabel(38_912, 2, true)).toBe('≈ 38 KB · 2 files')
    expect(downloadCostLabel(24_000, 1)).toBe('23 KB · 1 file')
    expect(downloadCostLabel(0, 0)).toBe('0 KB')
  })

  it('shows measuring, unavailable and measured states', () => {
    const { rerender } = render(<DownloadCostBadge loading />)
    expect(screen.getByText('Measuring…')).toBeTruthy()
    rerender(<DownloadCostBadge error="Google could not be reached" />)
    expect(screen.getByText('Size unavailable')).toBeTruthy()
    rerender(<DownloadCostBadge bytes={38_912} files={2} approximate />)
    expect(screen.getByText('≈ 38 KB · 2 files')).toBeTruthy()
  })
})

describe('SearchableVirtualList (AGL-3656)', () => {
  const base = {
    itemKey: (item: string) => item,
    renderItem: (item: string) => <span>{item}</span>,
    search: { value: '', onChange: jest.fn(), label: 'Search fonts' },
    empty: { label: 'No fonts match' },
  }

  it('draws the rows, the search box and one chip per choice', () => {
    const onFilter = jest.fn()
    render(
      <SearchableVirtualList
        {...base}
        items={['Inter', 'Lora']}
        header={<p>{'Pinned'}</p>}
        filters={{ label: 'Category', options: [{ value: 'serif', label: 'Serif' }], value: '', onChange: onFilter }}
      />,
    )
    expect(screen.getByText('Inter')).toBeTruthy()
    expect(screen.getByText('Pinned')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Serif' }))
    expect(onFilter).toHaveBeenCalledWith('serif')
  })

  it('clears its search, and says when nothing matches', () => {
    const onChange = jest.fn()
    render(<SearchableVirtualList {...base} items={[]} search={{ ...base.search, value: 'zz', onChange }} />)
    expect(screen.getByText('No fonts match')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('shows its loading and failed states, with a retry', () => {
    const onRetry = jest.fn()
    const { rerender } = render(<SearchableVirtualList {...base} items={[]} loading />)
    expect(screen.getByLabelText('Loading')).toBeTruthy()
    rerender(<SearchableVirtualList {...base} items={[]} error={{ message: 'Could not load', onRetry }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('useInView (AGL-3656)', () => {
  it('counts an element as seen where the browser has no observer', () => {
    const { result } = renderHook(() => useInView<HTMLDivElement>())
    expect(result.current[1]).toBe(false)
    const node = document.createElement('div')
    const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    try {
      const { result: seen, rerender } = renderHook(() => useInView<HTMLDivElement>())
      seen.current[0](node)
      rerender()
      expect(seen.current[1]).toBe(true)
    } finally {
      if (original) (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original
    }
  })
})
