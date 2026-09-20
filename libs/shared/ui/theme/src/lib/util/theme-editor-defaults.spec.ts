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
 * "Default" names the color THIS site renders (AGL-3068).
 *
 * The theme editor prints the resolved value beside every slot the site has
 * left unset, and the preview beside it builds on the same base. Both read
 * the platform brand for every site, so a customer whose pages publish over
 * the neutral tenant palette was told its untouched primary was Aglyn cyan —
 * a color that site never draws, offered as the thing to design against.
 */

import { consoleThemeDark, consoleThemeLight } from '../console.theme'
import { hostBrandKey, tenantThemeDark, tenantThemeLight } from '../tenant.theme'
import { inheritedThemeColor } from './theme-editor-defaults'

/** The operator's own marketing host, as the console knows it. */
const PLATFORM_SITE = 'aglyn.com'
/** A customer site with no domain attached, as the console knows it. */
const CUSTOMER_SITE = 'ready-to-roll'

describe('inheritedThemeColor', () => {
  it('reports the tenant default for a customer site', () => {
    expect(inheritedThemeColor('light', 'primary', CUSTOMER_SITE)).toBe(
      tenantThemeLight.palette.primary.main,
    )
    expect(inheritedThemeColor('dark', 'secondary', CUSTOMER_SITE)).toBe(
      tenantThemeDark.palette.secondary.main,
    )
  })

  it('reports the platform brand for the operator’s own host', () => {
    expect(inheritedThemeColor('light', 'primary', PLATFORM_SITE)).toBe(
      consoleThemeLight.palette.primary.main,
    )
    expect(inheritedThemeColor('dark', 'primary', PLATFORM_SITE)).toBe(
      consoleThemeDark.palette.primary.main,
    )
  })

  it('does not report one site’s default to the other', () => {
    expect(inheritedThemeColor('light', 'primary', CUSTOMER_SITE)).not.toBe(
      inheritedThemeColor('light', 'primary', PLATFORM_SITE),
    )
  })

  it('treats an unnamed site as a customer site, as the tenant does', () => {
    expect(inheritedThemeColor('light', 'primary')).toBe(
      inheritedThemeColor('light', 'primary', CUSTOMER_SITE),
    )
  })

  it('resolves the MUI-derived slots, which the options alone cannot', () => {
    // `text` and `divider` exist only on a built theme, which is why the
    // defaults are read off one.
    expect(inheritedThemeColor('light', 'text.primary', CUSTOMER_SITE)).toBe(
      tenantThemeLight.palette.text.primary,
    )
    expect(inheritedThemeColor('light', 'divider', CUSTOMER_SITE)).toBe(
      tenantThemeLight.palette.divider,
    )
  })
})

describe('hostBrandKey', () => {
  it('prefers the attached domain, which is what a platform host is listed as', () => {
    expect(hostBrandKey({ cname: 'aglyn.com', subdomain: 'aglyn-marketing' })).toBe(
      'aglyn.com',
    )
  })

  it('falls back to the subdomain a site with no domain is reached by', () => {
    expect(hostBrandKey({ subdomain: 'ready-to-roll' })).toBe('ready-to-roll')
  })

  it('names nothing for a site it has not read yet', () => {
    expect(hostBrandKey(undefined)).toBeUndefined()
    expect(hostBrandKey({})).toBeUndefined()
  })
})
