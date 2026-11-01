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
import { useBesignerOpenDraftParam } from './use-besigner-open-draft-param'

/** The address an AI change links, and what a reload must not ask again (AGL-4116). */
describe('useBesignerOpenDraftParam', () => {
  const at = (search: string) => window.history.replaceState(null, '', `/acme/hosts/roofers/screens/home/versions/v1/besigner${search}`)

  afterEach(() => at(''))

  it('reads the ask once and takes it off the address', () => {
    at('?draft=open')
    const { result, rerender } = renderHook(() => useBesignerOpenDraftParam())
    expect(result.current).toBe(true)
    expect(window.location.search).toBe('')
    rerender()
    expect(result.current).toBe(true)
  })

  it('leaves the rest of the query alone', () => {
    at('?draft=open&panel=theme')
    renderHook(() => useBesignerOpenDraftParam())
    expect(window.location.search).toBe('?panel=theme')
  })

  it('is false for any other address, which it leaves as it is', () => {
    at('?draft=closed')
    const { result } = renderHook(() => useBesignerOpenDraftParam())
    expect(result.current).toBe(false)
    expect(window.location.search).toBe('?draft=closed')
  })
})
