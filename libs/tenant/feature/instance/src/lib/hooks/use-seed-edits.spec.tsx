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
 * The shared half of "a first Save press is never refused for a late
 * server" (AGL-4047): edits replayed onto whatever the seed is now, and the
 * hold that keeps the press until the server has answered.
 */

import { act, renderHook } from '@testing-library/react'
import {
  isSeedChecking,
  seedCheckingText,
  useSeedEdits,
} from './use-seed-edits'

type Form = { name: string; phone: string; city: string }

const cached: Form = { name: 'Acme', phone: '555-0100', city: 'Austin' }

function renderForm(seed: Form) {
  return renderHook(({ seed }: { seed: Form }) => useSeedEdits(seed), {
    initialProps: { seed },
  })
}

describe('useSeedEdits (AGL-4047)', () => {
  it('shows the seed until something is typed', () => {
    const { result } = renderForm(cached)
    expect(result.current.values).toEqual(cached)
    expect(result.current.dirty).toBe(false)
  })

  it('replays an edit onto the seed the server confirms, so untouched fields follow it', () => {
    const { result, rerender } = renderForm(cached)
    act(() => result.current.edit({ name: 'Acme Builders' }))
    expect(result.current.dirty).toBe(true)

    // The server's copy differs from the cache's in a field nobody touched.
    rerender({ seed: { ...cached, phone: '555-0199' } })

    expect(result.current.values).toEqual({
      name: 'Acme Builders',
      phone: '555-0199',
      city: 'Austin',
    })
    expect(result.current.dirty).toBe(true)
  })

  it('keeps an edited field on what was typed whatever the seed later says', () => {
    const { result, rerender } = renderForm(cached)
    act(() => result.current.edit({ city: 'Round Rock' }))
    rerender({ seed: { ...cached, city: 'Cedar Park' } })
    expect(result.current.values.city).toBe('Round Rock')
  })

  it('gives an updater the values on screen', () => {
    const { result } = renderForm(cached)
    act(() => result.current.edit({ name: 'Acme' + ' Co' }))
    act(() => result.current.edit((values) => ({ city: `${values.name} City` })))
    expect(result.current.values.city).toBe('Acme Co City')
  })

  it('reverts a key to the seed', () => {
    const { result, rerender } = renderForm(cached)
    act(() => result.current.edit({ phone: '555-0123', city: 'Waco' }))
    act(() => result.current.revert('phone'))
    rerender({ seed: { ...cached, phone: '555-0199' } })
    expect(result.current.values.phone).toBe('555-0199')
    expect(result.current.values.city).toBe('Waco')
  })

  it('after a save, shows what was written until the seed moves, then follows the seed', () => {
    const { result, rerender } = renderForm(cached)
    act(() => result.current.edit({ name: 'Acme Builders' }))
    const written = result.current.edits
    act(() => result.current.settle(written))

    expect(result.current.dirty).toBe(false)
    // The seed has not caught up yet: the form must not flash back.
    expect(result.current.values.name).toBe('Acme Builders')

    rerender({ seed: { ...cached, name: 'Acme Builders' } })
    expect(result.current.values.name).toBe('Acme Builders')
    // Dropped once the seed moved, so a later change shows as it is.
    rerender({ seed: cached })
    expect(result.current.values.name).toBe('Acme')
  })

  it('keeps an edit typed while the save was in flight unsaved', () => {
    const { result } = renderForm(cached)
    act(() => result.current.edit({ name: 'Acme Builders' }))
    const written = result.current.edits
    act(() => result.current.edit({ city: 'Waco' }))
    act(() => result.current.settle(written))
    expect(result.current.dirty).toBe(true)
    expect(result.current.edits).toEqual({ name: 'Acme Builders', city: 'Waco' })
  })

  it('discards', () => {
    const { result } = renderForm(cached)
    act(() => result.current.edit({ name: 'Nope' }))
    act(() => result.current.discard())
    expect(result.current.values).toEqual(cached)
    expect(result.current.dirty).toBe(false)
  })
})

describe('the hold beside Save (AGL-4047)', () => {
  it('holds while the read is the cache’s', () => {
    expect(isSeedChecking({ fromCache: true })).toBe(true)
    expect(isSeedChecking({ fromCache: false })).toBe(false)
    expect(isSeedChecking({})).toBe(false)
  })

  it('leaves a FAILED read to the guard, whose refusal no wait would change', () => {
    expect(isSeedChecking({ fromCache: true, unreadable: true })).toBe(false)
  })

  it('says why, in the guard’s subject, number-neutral', () => {
    expect(seedCheckingText('profile')).toBe(
      'Checking your profile with the server…',
    )
    expect(seedCheckingText('site settings')).toBe(
      'Checking your site settings with the server…',
    )
  })
})
