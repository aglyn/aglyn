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
 * The site theme, as Stripe's Appearance API reads it (AGL-3606).
 */

import { createTheme } from '@mui/material/styles'
import {
  fontFamilies,
  storefrontPaymentAppearance,
  storefrontPaymentFonts,
} from './storefront-payment-appearance'

describe('storefrontPaymentAppearance', () => {
  it('carries the theme palette, type and radius into Stripe variables', () => {
    const theme = createTheme({
      palette: {
        primary: { main: '#7b1fa2' },
        background: { paper: '#fffaf0' },
        text: { primary: '#222222', secondary: '#555555' },
        error: { main: '#c62828' },
      },
      typography: { fontFamily: '"Playfair Display", Georgia, serif' },
      shape: { borderRadius: 12 },
    })
    expect(storefrontPaymentAppearance(theme)).toEqual({
      theme: 'stripe',
      variables: {
        colorPrimary: '#7b1fa2',
        colorBackground: '#fffaf0',
        colorText: '#222222',
        colorTextSecondary: '#555555',
        colorDanger: '#c62828',
        fontFamily: '"Playfair Display", Georgia, serif',
        borderRadius: '12px',
      },
    })
  })

  it('a dark theme starts from Stripe\'s dark base', () => {
    const theme = createTheme({ palette: { mode: 'dark' } })
    expect(storefrontPaymentAppearance(theme).theme).toBe('night')
  })

  it('drops a CSS variable Stripe cannot resolve inside its frame', () => {
    const theme = createTheme()
    ;(theme.palette.primary as any).main = 'var(--brand)'
    const variables = storefrontPaymentAppearance(theme).variables ?? {}
    expect(variables.colorPrimary).toBeUndefined()
    expect(variables.colorText).toBeTruthy()
  })
})

describe('storefrontPaymentFonts', () => {
  it('loads the first web font in the stack', () => {
    expect(storefrontPaymentFonts('"Playfair Display", Georgia, serif')).toEqual([
      {
        cssSrc:
          'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap',
      },
    ])
  })

  it('loads nothing for a system stack', () => {
    expect(
      storefrontPaymentFonts('-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'),
    ).toEqual([])
    expect(storefrontPaymentFonts(undefined)).toEqual([])
  })

  it('never builds a URL from a family name with URL syntax in it', () => {
    expect(storefrontPaymentFonts('"Evil&family=x", serif')).toEqual([])
  })

  it('splits and unquotes a font-family value', () => {
    expect(fontFamilies(`'Inter', "Open Sans", sans-serif`)).toEqual([
      'Inter',
      'Open Sans',
      'sans-serif',
    ])
  })
})
