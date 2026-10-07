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

import { buildFontFamilyList } from '../constants'
import { consoleOptions, consoleOptionsDark } from '../console.theme'
import { tenantOptions, tenantOptionsDark } from '../tenant.theme'
import {
  ROBOTO_FLEX_FACES,
  ROBOTO_FLEX_FALLBACK_FAMILY,
  ROBOTO_FLEX_FAMILY,
  robotoFlexFontFaceCss,
  robotoFlexPreloadUrls,
} from './roboto-flex'

const familyOf = (options: { typography?: unknown }) =>
  (options.typography as { fontFamily: string }).fontFamily

/**
 * The console serves Roboto Flex itself (AGL-3655). These pin the three
 * things that have to agree for that to work, and the one thing it must not
 * change: a published site's default stack.
 */
describe('Roboto Flex', () => {
  it('declares the family the brand stack names, at the full weight range', () => {
    const css = robotoFlexFontFaceCss()
    expect(buildFontFamilyList()[0]).toBe(ROBOTO_FLEX_FAMILY)
    for (const face of ROBOTO_FLEX_FACES) {
      expect(css).toContain(
        `src:url(/_static/fonts/roboto-flex/${face.file}) format('woff2')`,
      )
    }
    expect(css.match(/font-family:"Roboto Flex";/g)).toHaveLength(
      ROBOTO_FLEX_FACES.length,
    )
    expect(css).toContain('font-weight:100 1000')
    expect(css).toContain('font-display:swap')
  })

  it('preloads the Latin file and nothing else', () => {
    expect(robotoFlexPreloadUrls()).toEqual([
      '/_static/fonts/roboto-flex/roboto-flex-v3200-latin.woff2',
    ])
  })

  it('declares the stand-in as a local, metric-matched face', () => {
    expect(robotoFlexFontFaceCss()).toMatch(
      /@font-face\{font-family:"Roboto Flex Fallback";src:local\('Arial'\);size-adjust:[\d.]+%;ascent-override:[\d.]+%;descent-override:[\d.]+%;line-gap-override:0%\}/,
    )
  })

  it('puts the stand-in directly after Roboto Flex in the console stack', () => {
    for (const options of [consoleOptions, consoleOptionsDark]) {
      const [first, second, third] = familyOf(options).split(',')
      expect([first, second, third]).toEqual([
        ROBOTO_FLEX_FAMILY,
        ROBOTO_FLEX_FALLBACK_FAMILY,
        buildFontFamilyList()[1],
      ])
    }
  })

  it('leaves a published site on the plain stack it always had', () => {
    for (const options of [tenantOptions, tenantOptionsDark]) {
      expect(familyOf(options)).toBe(buildFontFamilyList().join(','))
      expect(familyOf(options)).not.toContain('Fallback')
    }
  })

  it('keeps the rest of the type ramp shared with the console', () => {
    const withoutFamily = (options: { typography?: unknown }) =>
      Object.fromEntries(
        Object.entries(options.typography as Record<string, unknown>).filter(
          ([key]) => key !== 'fontFamily',
        ),
      )
    expect(withoutFamily(tenantOptions)).toEqual(withoutFamily(consoleOptions))
  })
})
