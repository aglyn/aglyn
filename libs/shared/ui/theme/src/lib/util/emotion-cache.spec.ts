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
 * @jest-environment node
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CacheProvider,
  createEmotionCache,
  withEmotionCache,
} from '../../vendor/emotion'
import { APP_EMOTION_CACHE_OPTIONS, EMOTION_CACHE_KEY } from './emotion-cache'

/**
 * AGL-1266. Every tenant page threw a hydration mismatch whose diff was the
 * emotion class PREFIX and nothing else — `css-13b992c` against
 * `mui-13b992c`, the same hash under two different caches — so React
 * discarded the server tree and re-rendered the whole page on the client.
 *
 * The node environment is the whole point of this file. Emotion ships a
 * separate non-browser build, and only that build contains the branch this
 * suite exists to pin: when the cache context is null, the SERVER quietly
 * manufactures `createCache({ key: 'css' })` and renders on. Under jsdom the
 * browser build answers instead, the fallback branch never executes, and the
 * suite would prove nothing.
 */

/** Reports the cache the surrounding tree actually rendered under. */
const CacheProbe = withEmotionCache((_props: object, cache) =>
  createElement('div', { 'data-cache-key': cache.key }),
)

const keyOf = (markup: string) =>
  markup.match(/data-cache-key="([^"]*)"/)?.[1] ?? null

describe('emotion cache key (AGL-1266)', () => {
  it('falls back to `css` on the server when the provider is missing', () => {
    // The bug's mechanism, not a hypothetical: emotion does NOT throw when a
    // server render loses its cache context. It invents one, keyed `css`, and
    // the page renders — correctly styled, wrong prefix, no warning. The only
    // symptom is that hydration then disagrees with the browser, which is
    // exactly how AGL-1266 presented.
    expect(keyOf(renderToStaticMarkup(createElement(CacheProbe)))).toBe('css')
  })

  it('renders under the app key when the provider is in place', () => {
    const markup = renderToStaticMarkup(
      createElement(
        CacheProvider,
        { value: createEmotionCache({ key: EMOTION_CACHE_KEY }) },
        createElement(CacheProbe),
      ),
    )
    expect(keyOf(markup)).toBe(EMOTION_CACHE_KEY)
  })

  it('never uses emotion’s own fallback key, so a lost provider is visible', () => {
    // If the app ever adopted `css` as its key, the fallback above would be
    // indistinguishable from a healthy render and the failure would go back
    // to being invisible — including to the tenant production smoke, which
    // greps the served HTML for exactly this prefix.
    expect(EMOTION_CACHE_KEY).not.toBe('css')
  })

  it('carries the cascade layer alongside the key', () => {
    // `@mui/styled-engine` keys its cache `mui` when the layer is on and
    // `css` when it is off. Shipping the two settings as one object is what
    // stops a surface from turning the layer off and silently renaming every
    // class it emits.
    expect(APP_EMOTION_CACHE_OPTIONS).toEqual({
      key: EMOTION_CACHE_KEY,
      enableCssLayer: true,
    })
  })
})
