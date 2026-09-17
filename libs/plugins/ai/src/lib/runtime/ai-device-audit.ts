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

import type { HostTheme, HostThemeSchemeColors } from '@aglyn/shared-data-types'
import type { AiInventoryTheme } from '../model/ai-site-inventory'

/**
 * THE DEVICE AUDIT (AGL-3020): what a generated document looks like at every
 * width the besigner's device switcher previews, and the rule a recording of
 * it is held to.
 *
 * Rule 12 is held on the tree: no fixed width, and a Grid of columns is a
 * container of items full width on a phone (`detectUnresponsiveGrids`). What a
 * tree cannot show is what renders: a Stack that stays a row on a phone, a
 * line of copy wider than the screen. `tools/scripts/record-ai-page-axe.mts`
 * renders each golden page and each rendered eval answer at the switcher's
 * five devices — through `devicePreviewWidth` and the canvas's own pinned
 * theme, in a real browser — and records what it measured here, in the
 * shapes below. Specs read the recording; nothing here renders.
 */

/** The devices the switcher previews, narrowest first, by their flag names. */
export const AI_AUDIT_DEVICES = ['XS', 'SM', 'MD', 'LG', 'XL'] as const
export type AiAuditDevice = (typeof AI_AUDIT_DEVICES)[number]

/** One axe-core violation, as a recording keeps it. */
export interface AiAuditViolation {
  id: string
  impact: string | null
  help: string
  /** How many elements break it. */
  nodes: number
}

/** A document rendered at one device's width. */
export interface AiDeviceRender {
  device: AiAuditDevice
  /** The viewport width the switcher previews the device at, in CSS pixels. */
  width: number
  /**
   * The deepest elements whose box runs past the viewport's edge, in document
   * order; empty when the page is no wider than the screen.
   */
  overflow: string[]
  /**
   * axe-core's violations, every rule on. Recorded for the golden pages, whose
   * sites author the colors their pages are measured against; an eval answer
   * is recorded for its widths alone.
   */
  violations?: AiAuditViolation[]
}

/**
 * A row a layout element draws: a Stack, Grid, Box, Section or Container of
 * the palette (its schema's Layout category) laid out as a flex or grid box.
 */
export interface AiLayoutRow {
  /** The element: the id the model wrote for it, or its section and position. */
  node: string
  component: string
  /** Whether it is a Grid container, which rule 12 holds to one column on a phone. */
  grid: boolean
  /**
   * Its children that hold content. A child drawn by an Input or a Navigation
   * element of the palette, or an icon, is a control: a row of buttons, links
   * or an icon beside its label reads as one line on a phone.
   */
  content: number
  /** The children on its first line, per device. */
  columns: Record<AiAuditDevice, number>
}

/** What a recording holds for one document. */
export interface AiDeviceAudit {
  devices: AiDeviceRender[]
  rows: AiLayoutRow[]
}

/**
 * A band: a row of two or more columns of content at LG, which the palette's
 * own Grid row stacks on a phone ("three columns that stack on mobile").
 */
export function aiLayoutRowIsBand(row: AiLayoutRow): boolean {
  return row.content >= 2 && row.columns.LG >= 2
}

/**
 * What a recorded document gets wrong at the switcher's widths, as findings:
 *
 *  - `widths-missing:<device>`: a device the recording never rendered;
 *  - `overflow:<device>:<element>`: an element wider than the device's screen,
 *    which scrolls the page sideways;
 *  - `band-not-broken-down:<element>`: a band with as many columns on a phone
 *    (XS) as on a desktop (LG).
 *
 * Empty when the document works at every width.
 */
export function aiDeviceAuditFindings(audit: AiDeviceAudit): string[] {
  const findings: string[] = []
  for (const device of AI_AUDIT_DEVICES) {
    if (!audit.devices.some((render) => render.device === device)) findings.push(`widths-missing:${device}`)
  }
  for (const render of audit.devices) {
    for (const element of render.overflow) findings.push(`overflow:${render.device}:${element}`)
  }
  for (const row of audit.rows) {
    if (aiLayoutRowIsBand(row) && row.columns.XS >= row.columns.LG) findings.push(`band-not-broken-down:${row.node}`)
  }
  return findings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The theme document a site inventory's theme summarizes: its light scheme's
 * colors, from the flat `primary.main` paths the inventory lists them by, and
 * its fonts. A golden site has no theme document of its own, so this is the
 * theme its pages were built against and are rendered with; `null` renders
 * the brand base alone, as a site with no theme does.
 */
export function aiInventoryHostTheme(theme: AiInventoryTheme | null): HostTheme | null {
  if (!theme) return null
  const light: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(theme.colors)) {
    const keys = path.split('.').filter(Boolean)
    if (!keys.length) continue
    let cursor = light
    for (const key of keys.slice(0, -1)) {
      if (!isRecord(cursor[key])) cursor[key] = {}
      cursor = cursor[key] as Record<string, unknown>
    }
    cursor[keys[keys.length - 1]] = value
  }
  return {
    colorSchemes: { light: light as HostThemeSchemeColors },
    ...(theme.fonts.length ? { fonts: theme.fonts.map((family) => ({ family })) } : {}),
  }
}
