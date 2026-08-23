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

/** AGL-2486. The resolver the renderer runs for every node on every page. */

import {
  ANIMATION_DEFAULT_DELAY_MS,
  ANIMATION_DEFAULT_DURATION_MS,
  ANIMATION_DEFAULT_TRIGGER,
  ANIMATION_MAX_DELAY_MS,
  ANIMATION_MAX_DURATION_MS,
  nodePropsAnimate,
  resolveElementAnimation,
} from './element-animation'

describe('resolveElementAnimation (AGL-2486)', () => {
  it('returns undefined for a node that does not animate', () => {
    expect(resolveElementAnimation(undefined)).toBeUndefined()
    expect(resolveElementAnimation({})).toBeUndefined()
    expect(resolveElementAnimation({ children: 'Hi' })).toBeUndefined()
  })

  it('treats the "none" sentinel as no animation', () => {
    expect(resolveElementAnimation({ aglynAnimation: 'none' })).toBeUndefined()
  })

  it('refuses a preset it does not know rather than emitting a dead class', () => {
    // Reaches a class name and a `data-` attribute; a screen saved against a
    // future preset must degrade to a static element.
    expect(
      resolveElementAnimation({ aglynAnimation: 'barrel-roll' }),
    ).toBeUndefined()
    expect(resolveElementAnimation({ aglynAnimation: 42 })).toBeUndefined()
  })

  it('emits the class, attributes and custom properties for a preset', () => {
    const resolved = resolveElementAnimation({ aglynAnimation: 'slide-up' })
    expect(resolved?.className).toBe('aglyn-anim aglyn-anim--slide-up')
    expect(resolved?.attributes).toEqual({ 'data-aglyn-anim-trigger': 'scroll' })
    expect(resolved?.style).toEqual({
      '--aglyn-anim-duration': `${ANIMATION_DEFAULT_DURATION_MS}ms`,
      '--aglyn-anim-delay': `${ANIMATION_DEFAULT_DELAY_MS}ms`,
    })
  })

  it('defaults an unset trigger to scroll', () => {
    // The tenant's asset detector agrees with this; if the two ever disagreed
    // the element would be hidden with nothing to reveal it.
    expect(resolveElementAnimation({ aglynAnimation: 'fade' })?.trigger).toBe(
      ANIMATION_DEFAULT_TRIGGER,
    )
  })

  it('falls back to the default trigger for an unknown one', () => {
    expect(
      resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationTrigger: 'telepathy',
      })?.trigger,
    ).toBe(ANIMATION_DEFAULT_TRIGGER)
  })

  describe('the dials', () => {
    // `strictNullChecks` is OFF repo-wide and `0` is a legitimate value for
    // both dials. A truthiness test (`if (!delay) delay = DEFAULT`) would
    // silently replace a deliberate 0 with 600/0 — the single most likely bug
    // in this function, and invisible in the editor.
    it('honours a deliberate ZERO delay instead of substituting the default', () => {
      const resolved = resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationDelay: 0,
      })
      expect(resolved?.delayMs).toBe(0)
      expect(resolved?.style['--aglyn-anim-delay']).toBe('0ms')
    })

    it('honours a deliberate ZERO duration', () => {
      const resolved = resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationDuration: 0,
      })
      expect(resolved?.durationMs).toBe(0)
    })

    it('accepts a numeric STRING, which is what a number input stores', () => {
      const resolved = resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationDuration: '250',
        aglynAnimationDelay: '0',
      })
      expect(resolved?.durationMs).toBe(250)
      expect(resolved?.delayMs).toBe(0)
    })

    it('falls back for a value that is not a number at all', () => {
      const resolved = resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationDuration: 'fast',
        aglynAnimationDelay: null,
      })
      expect(resolved?.durationMs).toBe(ANIMATION_DEFAULT_DURATION_MS)
      expect(resolved?.delayMs).toBe(ANIMATION_DEFAULT_DELAY_MS)
    })

    it('clamps both ends', () => {
      const high = resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationDuration: 999999,
        aglynAnimationDelay: 999999,
      })
      expect(high?.durationMs).toBe(ANIMATION_MAX_DURATION_MS)
      expect(high?.delayMs).toBe(ANIMATION_MAX_DELAY_MS)
      const low = resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationDuration: -500,
      })
      expect(low?.durationMs).toBe(0)
    })
  })

  describe('replay', () => {
    it('is emitted for a scroll trigger', () => {
      const resolved = resolveElementAnimation({
        aglynAnimation: 'fade',
        aglynAnimationTrigger: 'scroll',
        aglynAnimationRepeat: true,
      })
      expect(resolved?.repeat).toBe(true)
      expect(resolved?.attributes['data-aglyn-anim-repeat']).toBe('1')
    })

    it('is ignored for load and hover, which cannot replay', () => {
      for (const trigger of ['load', 'hover']) {
        const resolved = resolveElementAnimation({
          aglynAnimation: 'fade',
          aglynAnimationTrigger: trigger,
          aglynAnimationRepeat: true,
        })
        expect(resolved?.repeat).toBe(false)
        expect(resolved?.attributes['data-aglyn-anim-repeat']).toBeUndefined()
      }
    })

    it('emits no attribute when off, so the runtime unobserves', () => {
      const resolved = resolveElementAnimation({ aglynAnimation: 'fade' })
      expect(resolved?.attributes['data-aglyn-anim-repeat']).toBeUndefined()
    })
  })
})

describe('nodePropsAnimate (AGL-2486)', () => {
  it('agrees with the resolver on every case that decides asset shipping', () => {
    // These two are read by different layers (renderer vs. tenant route) and
    // must not drift: one says "emit the class", the other says "ship the
    // stylesheet that makes the class mean something".
    const cases = [
      undefined,
      {},
      { aglynAnimation: 'none' },
      { aglynAnimation: 'barrel-roll' },
      { aglynAnimation: 'fade' },
      { aglynAnimation: 'zoom-out' },
    ]
    for (const props of cases) {
      expect(nodePropsAnimate(props)).toBe(
        resolveElementAnimation(props) !== undefined,
      )
    }
  })
})
