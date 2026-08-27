/**
 * @jest-environment jsdom
 */

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
 * The count a cursor feed does not have.
 *
 * Everything else here is MUI's; the part worth testing is the arithmetic that
 * lets ONE footer serve both a list that knows its total and a feed that
 * cannot know it without paying to read it.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { ListPagination } from './list-pagination.component'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
} from '../const/table-pagination'

const nextButton = () => screen.getByLabelText(/go to next page/i)
const prevButton = () => screen.getByLabelText(/go to previous page/i)

describe('ListPagination', () => {
  it('offers the shared page sizes, starting at the smallest', () => {
    render(
      <ListPagination
        page={0}
        pageSize={TABLE_PAGE_SIZE_DEFAULT}
        rowCount={TABLE_PAGE_SIZE_DEFAULT}
        hasMore
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
      />,
    )
    expect(TABLE_PAGE_SIZE_DEFAULT).toBe(Math.min(...TABLE_PAGE_SIZE_OPTIONS))
    expect(screen.getByText('Rows per page:')).toBeTruthy()
  })

  it('a feed with more to come says so, and leaves Next live', () => {
    render(
      <ListPagination
        page={0}
        pageSize={10}
        rowCount={10}
        hasMore
        onPageChange={() => undefined}
      />,
    )
    // MUI's own rendering of count={-1}: honest about not knowing.
    expect(screen.getByText(/more than/i)).toBeTruthy()
    expect(nextButton().hasAttribute('disabled')).toBe(false)
  })

  it('the LAST page stops guessing and disables Next', () => {
    /*
     * The whole trick. A cursor feed cannot know its total — until it reaches
     * the end, where `page × pageSize + rowCount` IS the total. Handing MUI
     * the real number is what disables Next, with no version-specific reach
     * into the button, and the count line stops saying "more than" at exactly
     * the point that would become a lie.
     */
    render(
      <ListPagination
        page={2}
        pageSize={10}
        rowCount={4}
        hasMore={false}
        onPageChange={() => undefined}
      />,
    )
    expect(screen.getByText(/21–24 of 24/)).toBeTruthy()
    expect(nextButton().hasAttribute('disabled')).toBe(true)
  })

  it('a known total is used verbatim rather than derived', () => {
    render(
      <ListPagination
        page={0}
        pageSize={10}
        rowCount={10}
        count={57}
        onPageChange={() => undefined}
      />,
    )
    expect(screen.getByText(/1–10 of 57/)).toBeTruthy()
    expect(nextButton().hasAttribute('disabled')).toBe(false)
  })

  it('Previous is dead on the first page and live after it', () => {
    const { rerender } = render(
      <ListPagination
        page={0}
        pageSize={10}
        rowCount={10}
        hasMore
        onPageChange={() => undefined}
      />,
    )
    expect(prevButton().hasAttribute('disabled')).toBe(true)
    rerender(
      <ListPagination
        page={1}
        pageSize={10}
        rowCount={10}
        hasMore
        onPageChange={() => undefined}
      />,
    )
    expect(prevButton().hasAttribute('disabled')).toBe(false)
  })

  it('resizing the page returns to the FIRST one', () => {
    // Page 4 of a 10-row list does not exist once the reader asks for 50 at a
    // time, and MUI renders an out-of-range page as an empty list with no
    // explanation — which reads as "your data is gone".
    const pages: number[] = []
    const sizes: number[] = []
    render(
      <ListPagination
        page={3}
        pageSize={10}
        rowCount={10}
        count={100}
        onPageChange={(page) => pages.push(page)}
        onPageSizeChange={(size) => sizes.push(size)}
      />,
    )
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: '50' }))
    expect(sizes).toEqual([50])
    expect(pages).toEqual([0])
  })
})
