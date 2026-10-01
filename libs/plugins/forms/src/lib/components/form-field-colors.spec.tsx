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
 * A FORM'S LABELS TAKE THEIR COLOR FROM THE THEME'S TEXT TOKEN (AGL-3449).
 *
 * The form field sets no color of its own. MUI's `FormLabel` and
 * `InputLabel` paint `palette.text.secondary`, and the site's light and dark
 * themes each define that token, so a label follows the visitor's scheme
 * without a line of code here. A literal color on a label, or a theme
 * override that pins one, would hold one scheme's value in both. A dark-grey
 * label on a dark card is the symptom AGL-3449 was filed against.
 *
 * Every field type renders under each scheme of the theme a site actually
 * gets: the platform brand (aglyn.com) and the customer default. Its label
 * must come back as that theme's own token.
 */

import {
  consoleThemeDark,
  consoleThemeLight,
  tenantThemeDark,
  tenantThemeLight,
  type Theme,
} from '@aglyn/shared-ui-theme'
import { ThemeProvider } from '@mui/material/styles'
import { render } from '@testing-library/react'
import { FormField, type FormFieldProps } from './form'

const siteThemes: Array<[site: string, light: Theme, dark: Theme]> = [
  ['the platform brand', consoleThemeLight, consoleThemeDark],
  ['the customer default', tenantThemeLight, tenantThemeDark],
]

const fields: Array<[fieldType: string, props: FormFieldProps]> = [
  ['text', { fieldName: 'name', label: 'Name', required: true }],
  ['email', { fieldName: 'email', label: 'Email', fieldType: 'email' }],
  ['textarea', { fieldName: 'about', label: 'About', fieldType: 'textarea' }],
  [
    'text with a placeholder',
    { fieldName: 'site', label: 'Website', placeholder: 'https://' },
  ],
  [
    'select',
    {
      fieldName: 'size',
      label: 'Team size',
      fieldType: 'select',
      options: '1,2',
    },
  ],
  [
    'radio',
    { fieldName: 'plan', label: 'Plan', fieldType: 'radio', options: 'A,B' },
  ],
  [
    'checkbox',
    {
      fieldName: 'optIn',
      label: 'Email me',
      fieldType: 'checkbox',
      options: 'Yes',
    },
  ],
  ['rating', { fieldName: 'score', label: 'Score', fieldType: 'rating' }],
]

const labelColor = (theme: Theme, props: FormFieldProps) => {
  const { container, unmount } = render(
    <ThemeProvider theme={theme}>
      <FormField {...props} />
    </ThemeProvider>,
  )
  const label = container.querySelector<HTMLElement>('.MuiFormLabel-root')
  if (!label) throw new Error('the field rendered no label')
  const color = getComputedStyle(label).color
  unmount()
  return color
}

describe.each(siteThemes)(
  'form field labels under %s',
  (_site, light, dark) => {
    it('defines a different text.secondary for each scheme', () => {
      expect(light.palette.mode).toBe('light')
      expect(dark.palette.mode).toBe('dark')
      expect(light.palette.text.secondary).not.toBe(dark.palette.text.secondary)
    })

    it.each(fields)('a %s label is text.secondary in light', (_type, props) => {
      expect(labelColor(light, props)).toBe(light.palette.text.secondary)
    })

    it.each(fields)('a %s label is text.secondary in dark', (_type, props) => {
      expect(labelColor(dark, props)).toBe(dark.palette.text.secondary)
    })
  },
)
