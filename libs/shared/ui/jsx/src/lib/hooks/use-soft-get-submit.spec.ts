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

import { renderHook } from '@testing-library/react'
import type { FormEvent } from 'react'
import { softGetSubmitHref, useSoftGetSubmit } from './use-soft-get-submit'

const form = (html: string) => {
  document.body.innerHTML = html
  return document.querySelector('form') as HTMLFormElement
}

describe('softGetSubmitHref', () => {
  it('builds the URL a GET submit would load, fields replacing the query', () => {
    const el = form(
      '<form action="/search?in=blog" method="get"><input name="q" value="red shoes"></form>',
    )
    expect(softGetSubmitHref(el)).toBe('/search?q=red+shoes')
  })

  it('treats a form with no method as GET', () => {
    expect(
      softGetSubmitHref(
        form('<form action="/search"><input name="q" value="x"></form>'),
      ),
    ).toBe('/search?q=x')
  })

  it('leaves POST, other targets and other origins to the browser', () => {
    expect(
      softGetSubmitHref(form('<form action="/search" method="post"></form>')),
    ).toBeNull()
    expect(
      softGetSubmitHref(form('<form action="/search" target="_blank"></form>')),
    ).toBeNull()
    expect(
      softGetSubmitHref(
        form('<form action="https://elsewhere.example/search"></form>'),
      ),
    ).toBeNull()
  })

  it('drops the question mark when there is nothing to send', () => {
    expect(softGetSubmitHref(form('<form action="/search"></form>'))).toBe(
      '/search',
    )
  })

  it('leaves the submit to the browser when no App Router is mounted', () => {
    const el = form('<form action="/search"><input name="q" value="x"></form>')
    const { result } = renderHook(() => useSoftGetSubmit())
    const preventDefault = jest.fn()
    result.current({
      currentTarget: el,
      defaultPrevented: false,
      preventDefault,
      nativeEvent: {},
    } as unknown as FormEvent<HTMLFormElement>)
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
