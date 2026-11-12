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
import { setSeedConfirmWaitMs } from './helpers/listen-confirmation'
import {
  heldSaveLabel,
  isSeedChecking,
  seedCheckingText,
  seedUnconfirmedText,
  useHeldSave,
  useSeedEdits,
  rebaseSeedEdits,
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

/**
 * The same rule for a form that seeds its own buffer once (AGL-4047): a newer
 * seed is replayed under the edits instead of being ignored.
 */
describe('rebaseSeedEdits (AGL-4047)', () => {
  const cached = { title: 'Hello', seoTitle: 'Hello — Acme', tags: ['a'] }

  it('keeps what was changed and takes the new seed for the rest', () => {
    const typed = { ...cached, title: 'Hello again' }
    const confirmed = { title: 'Hello', seoTitle: 'Hi — Acme', tags: ['a', 'b'] }
    expect(rebaseSeedEdits(cached, typed, confirmed)).toEqual({
      title: 'Hello again',
      seoTitle: 'Hi — Acme',
      tags: ['a', 'b'],
    })
  })

  it('compares by content, so a rebuilt but equal value counts as untouched', () => {
    const rebuilt = { ...cached, tags: ['a'] }
    const confirmed = { ...cached, tags: ['c'] }
    expect(rebaseSeedEdits(cached, rebuilt, confirmed).tags).toEqual(['c'])
  })

  it('is the new seed when nothing was changed', () => {
    const confirmed = { title: 'Bye', seoTitle: '', tags: [] as string[] }
    expect(rebaseSeedEdits(cached, { ...cached }, confirmed)).toEqual(confirmed)
  })
})

/**
 * A Save pressed while it is held is KEPT (AGL-4047). The 11/11 production
 * check found the press during the 64–660 ms hold after a fresh load landed on
 * a disabled button and did nothing, so the person took Save to be broken.
 */
describe('useHeldSave (AGL-4047)', () => {
  type Props = { checking: boolean; values: Form; onRefused?: (message: string) => void }

  function renderHeld(initial: Props) {
    const saved: Form[] = []
    let finish: (() => void) | null = null
    const view = renderHook(
      ({ checking, values, onRefused }: Props) =>
        useHeldSave(
          () => {
            saved.push(values)
            return new Promise<void>((resolve) => {
              finish = resolve
            })
          },
          { checking, subject: 'business profile', onRefused },
        ),
      { initialProps: initial },
    )
    return { ...view, saved, finish: () => finish?.() }
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    setSeedConfirmWaitMs()
  })

  it('saves at once when nothing is held, and says Saving… until the save ends', async () => {
    const { result, saved, finish } = renderHeld({ checking: false, values: cached })
    act(() => result.current.press())
    expect(saved).toEqual([cached])
    expect(result.current.saving).toBe(true)
    expect(heldSaveLabel(result.current, 'Update')).toBe('Saving…')
    await act(async () => finish())
    expect(result.current.saving).toBe(false)
    expect(heldSaveLabel(result.current, 'Update')).toBe('Update')
  })

  it('keeps a press made during the hold and saves the confirmed values once the hold ends', async () => {
    const typed = { ...cached, name: 'Acme Builders' }
    const { result, rerender, saved } = renderHeld({ checking: true, values: typed })

    act(() => result.current.press())
    // The press is answered at once, and nothing is written over the cache's seed.
    expect(result.current.saving).toBe(true)
    expect(result.current.waiting).toBe(true)
    expect(heldSaveLabel(result.current, 'Update')).toBe('Saving…')
    expect(saved).toEqual([])

    // The server confirms a phone the cache did not have; the edit is replayed onto it.
    const confirmed = { ...typed, phone: '555-0199' }
    rerender({ checking: false, values: confirmed })
    expect(result.current.saving).toBe(true)
    await act(async () => {
      jest.runOnlyPendingTimers()
    })

    // One save, of the values as they stand after the confirmation.
    expect(saved).toEqual([confirmed])
    expect(result.current.waiting).toBe(false)
    expect(result.current.saving).toBe(true)
  })

  it('takes a second press while one is kept as the same press', async () => {
    const { result, rerender, saved } = renderHeld({ checking: true, values: cached })
    act(() => result.current.press())
    act(() => result.current.press())
    rerender({ checking: false, values: cached })
    await act(async () => {
      jest.runOnlyPendingTimers()
    })
    act(() => result.current.press())
    expect(saved).toHaveLength(1)
  })

  it('refuses with the guard’s own words, and saves nothing, when no confirmation comes', async () => {
    setSeedConfirmWaitMs(1_000)
    const refused: string[] = []
    const { result, rerender, saved } = renderHeld({
      checking: true,
      values: cached,
      onRefused: (message) => refused.push(message),
    })
    act(() => result.current.press())
    await act(async () => {
      jest.advanceTimersByTime(1_000)
    })

    const words = seedUnconfirmedText('business profile')
    expect(words).toMatch(/^We could not confirm your business profile with the server yet, so nothing was saved/)
    expect(refused).toEqual([words])
    expect(result.current.refusal).toBe(words)
    expect(result.current.saving).toBe(false)
    expect(heldSaveLabel(result.current, 'Update')).toBe('Update')

    // A confirmation after the refusal does not resurrect the dropped press.
    rerender({ checking: false, values: cached })
    await act(async () => {
      jest.runOnlyPendingTimers()
    })
    expect(saved).toEqual([])

    // The next press clears the refusal and saves.
    act(() => result.current.press())
    expect(result.current.refusal).toBeNull()
    expect(saved).toEqual([cached])
  })

  it('does not save after the surface is gone', async () => {
    const { result, rerender, unmount, saved } = renderHeld({ checking: true, values: cached })
    act(() => result.current.press())
    rerender({ checking: false, values: cached })
    unmount()
    await act(async () => {
      jest.runOnlyPendingTimers()
    })
    expect(saved).toEqual([])
  })
})
