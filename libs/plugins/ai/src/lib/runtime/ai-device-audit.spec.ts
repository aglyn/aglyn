/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import {
  AI_AUDIT_DEVICES,
  aiDeviceAuditFindings,
  aiInventoryHostTheme,
  aiLayoutRowIsBand,
  type AiAuditDevice,
  type AiDeviceAudit,
  type AiLayoutRow,
} from './ai-device-audit'

/** A document that fits every device, with the given rows. */
const fits = (rows: AiLayoutRow[] = []): AiDeviceAudit => ({
  devices: AI_AUDIT_DEVICES.map((device, index) => ({ device, width: [390, 600, 900, 1200, 1536][index], overflow: [], violations: [] })),
  rows,
})

const row = (columns: Record<AiAuditDevice, number>, content = 3, node = 'cards'): AiLayoutRow => ({
  node,
  component: 'muiStack',
  grid: false,
  content,
  columns,
})

describe('the device audit rule (AGL-3020)', () => {
  it('finds nothing in a document that fits every device and stacks its bands on a phone', () => {
    expect(aiDeviceAuditFindings(fits([row({ XS: 1, SM: 1, MD: 3, LG: 3, XL: 3 })]))).toEqual([])
  })

  it('finds each element past a device screen, by device', () => {
    const audit = fits()
    audit.devices[0].overflow = ['hero > 0.1']
    audit.devices[1].overflow = ['hero > 0.1']
    expect(aiDeviceAuditFindings(audit)).toEqual(['overflow:XS:hero > 0.1', 'overflow:SM:hero > 0.1'])
  })

  it('finds a band with as many columns on a phone as on a desktop, or more', () => {
    expect(aiDeviceAuditFindings(fits([row({ XS: 3, SM: 3, MD: 3, LG: 3, XL: 3 })]))).toEqual(['band-not-broken-down:cards'])
    expect(aiDeviceAuditFindings(fits([row({ XS: 3, SM: 2, MD: 2, LG: 2, XL: 2 }, 3)]))).toEqual(['band-not-broken-down:cards'])
    // Fewer columns on a phone is a band that breaks down.
    expect(aiDeviceAuditFindings(fits([row({ XS: 2, SM: 3, MD: 3, LG: 3, XL: 3 })]))).toEqual([])
  })

  it('leaves a row of controls, and a row that is one column on a desktop, alone', () => {
    // Two buttons, or an icon beside its label: one column of content at most.
    const controls = row({ XS: 2, SM: 2, MD: 2, LG: 2, XL: 2 }, 1, 'actions')
    expect(aiLayoutRowIsBand(controls)).toBe(false)
    const column = row({ XS: 1, SM: 1, MD: 1, LG: 1, XL: 1 })
    expect(aiLayoutRowIsBand(column)).toBe(false)
    expect(aiDeviceAuditFindings(fits([controls, column]))).toEqual([])
  })

  it('refuses a recording missing a device, since a width nobody rendered was never checked', () => {
    const audit = fits()
    audit.devices = audit.devices.filter((render) => render.device !== 'SM')
    expect(aiDeviceAuditFindings(audit)).toEqual(['widths-missing:SM'])
  })
})

describe('aiInventoryHostTheme', () => {
  it('turns an inventory theme summary back into the light scheme and fonts it summarizes', () => {
    expect(
      aiInventoryHostTheme({
        summary: ['Light scheme with the theme’s default type'],
        colors: { 'primary.main': '#1f5fa8', 'secondary.main': '#c2410c', 'background.default': '#ffffff', divider: '#e0e0e0' },
        fonts: ['Inter'],
      }),
    ).toEqual({
      colorSchemes: {
        light: {
          primary: { main: '#1f5fa8' },
          secondary: { main: '#c2410c' },
          background: { default: '#ffffff' },
          divider: '#e0e0e0',
        },
      },
      fonts: [{ family: 'Inter' }],
    })
  })

  it('renders a site with no theme on the base alone, and names no fonts a summary has none of', () => {
    expect(aiInventoryHostTheme(null)).toBeNull()
    expect(aiInventoryHostTheme({ summary: [], colors: {}, fonts: [] })).toEqual({ colorSchemes: { light: {} } })
  })
})
