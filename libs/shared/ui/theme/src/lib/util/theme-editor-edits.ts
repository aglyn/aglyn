/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import {
  BORDER_RADIUS_FIELD,
  DARK_SCHEME_FIELD,
  GOOGLE_FONT_OPTIONS,
  SPACING_FIELD,
  SYSTEM_FONT_VALUE,
  THEME_COLOR_FIELDS,
  THEME_EDITOR_SCHEMES,
  TOOLBAR_HEIGHT_FIELDS,
  readDarkScheme,
  readFontFamily,
  readThemeColor,
  readToolbarHeight,
  writeBorderRadius,
  writeDarkScheme,
  writeFontFamily,
  writeSpacing,
  writeThemeColor,
  writeToolbarHeight,
  type ThemeColorToken,
} from './theme-editor-fields'

/*
 * THE THEME EDITOR'S CONTROLS AS EDITS (AGL-3668).
 *
 * The console's theme section edits the resolved theme in the browser with
 * the writers in `theme-editor-fields.ts` and saves the difference from the
 * picked theme as the site's override. A native app sends the same controls
 * as named edits instead — one color for one scheme, the font, the radius,
 * the spacing unit, a nav height, the dark scheme — and `/api/hosts/theme`
 * applies them here with those same writers, so both clients make exactly the
 * same theme from the same choice. `readThemeEditorValues` is the other half:
 * what each control currently shows.
 */

/** One control's change; a null value clears it back to the theme's own. */
export type ThemeEditorEdit =
  | { control: 'color'; scheme: HostThemeScheme; token: ThemeColorToken; value: string | null }
  | { control: 'darkScheme'; value: 'auto' | 'off' }
  | { control: 'fontFamily'; value: string }
  | { control: 'borderRadius'; value: number | null }
  | { control: 'spacing'; value: number | null }
  | { control: 'navHeight'; breakpoint: 'xs' | 'sm'; value: number | null }

/** The most edits one save may carry: every color of both schemes and the rest. */
export const THEME_EDITOR_EDITS_MAX = THEME_COLOR_FIELDS.length * 2 + 8

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function readNumber(
  value: unknown,
  range: { min: number; max: number },
): number | null | string {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 'Use a number.'
  if (parsed < range.min || parsed > range.max) {
    return `Use a number from ${range.min} to ${range.max}.`
  }
  return parsed
}

/** One edit from a request body, or why it was refused. */
export function readThemeEditorEdit(raw: unknown): ThemeEditorEdit | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'That change could not be read.'
  const edit = raw as Record<string, unknown>
  switch (edit['control']) {
    case 'color': {
      const scheme = edit['scheme']
      if (!THEME_EDITOR_SCHEMES.includes(scheme as HostThemeScheme)) return 'Pick light or dark.'
      const token = edit['token']
      if (!THEME_COLOR_FIELDS.some((field) => field.token === token)) return 'That is not a theme color.'
      const value = edit['value']
      if (value !== null && value !== undefined && value !== '' && (typeof value !== 'string' || !HEX_COLOR.test(value))) {
        return 'Use a hex color such as #1A73E8.'
      }
      return {
        control: 'color',
        scheme: scheme as HostThemeScheme,
        token: token as ThemeColorToken,
        value: typeof value === 'string' && value ? value : null,
      }
    }
    case 'darkScheme':
      return edit['value'] === 'off' ? { control: 'darkScheme', value: 'off' } : { control: 'darkScheme', value: 'auto' }
    case 'fontFamily': {
      const value = edit['value']
      if (value !== SYSTEM_FONT_VALUE && !GOOGLE_FONT_OPTIONS.some((option) => option.family === value)) {
        return 'Pick a font from the list.'
      }
      return { control: 'fontFamily', value: value as string }
    }
    case 'borderRadius': {
      const value = readNumber(edit['value'], BORDER_RADIUS_FIELD)
      return typeof value === 'string' ? value : { control: 'borderRadius', value }
    }
    case 'spacing': {
      const value = readNumber(edit['value'], SPACING_FIELD)
      return typeof value === 'string' ? value : { control: 'spacing', value }
    }
    case 'navHeight': {
      const breakpoint = edit['breakpoint']
      if (breakpoint !== 'xs' && breakpoint !== 'sm') return 'Pick mobile or desktop.'
      const value = readNumber(edit['value'], TOOLBAR_HEIGHT_FIELDS[breakpoint])
      return typeof value === 'string' ? value : { control: 'navHeight', breakpoint, value }
    }
    default:
      return 'That is not a theme control.'
  }
}

/** Every edit of a request body, or the first refusal. */
export function readThemeEditorEdits(raw: unknown): ThemeEditorEdit[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'Nothing to change.'
  if (raw.length > THEME_EDITOR_EDITS_MAX) return 'Too many changes at once.'
  const edits: ThemeEditorEdit[] = []
  for (const entry of raw) {
    const edit = readThemeEditorEdit(entry)
    if (typeof edit === 'string') return edit
    edits.push(edit)
  }
  return edits
}

/** The theme with [edits] applied, in order, by the editor's own writers. */
export function applyThemeEditorEdits(theme: HostTheme, edits: readonly ThemeEditorEdit[]): HostTheme {
  let next = theme
  for (const edit of edits) {
    switch (edit.control) {
      case 'color':
        next = writeThemeColor(next, edit.scheme, edit.token, edit.value ?? undefined)
        break
      case 'darkScheme':
        next = writeDarkScheme(next, edit.value)
        break
      case 'fontFamily':
        next = writeFontFamily(next, edit.value)
        break
      case 'borderRadius':
        next = writeBorderRadius(next, edit.value ?? undefined)
        break
      case 'spacing':
        next = writeSpacing(next, edit.value ?? undefined)
        break
      case 'navHeight':
        next = writeToolbarHeight(next, edit.breakpoint, edit.value ?? undefined)
        break
    }
  }
  return next
}

/** What each control shows for [theme]; an absent value inherits the platform's. */
export interface ThemeEditorValues {
  colors: Record<HostThemeScheme, Record<string, string | null>>
  darkScheme: 'auto' | 'off'
  fontFamily: string
  borderRadius: number | null
  spacing: number | null
  navHeight: { xs: number | null; sm: number | null }
}

export function readThemeEditorValues(theme: HostTheme | undefined): ThemeEditorValues {
  const safe = theme ?? {}
  const colors = {} as Record<HostThemeScheme, Record<string, string | null>>
  for (const scheme of THEME_EDITOR_SCHEMES) {
    colors[scheme] = {}
    for (const field of THEME_COLOR_FIELDS) {
      colors[scheme][field.token] = readThemeColor(safe, scheme, field.token) ?? null
    }
  }
  const radius = safe.shape?.borderRadius
  return {
    colors,
    darkScheme: readDarkScheme(safe),
    fontFamily: readFontFamily(safe),
    borderRadius: typeof radius === 'number' && Number.isFinite(radius) ? radius : null,
    spacing: typeof safe.spacing === 'number' ? safe.spacing : null,
    navHeight: {
      xs: readToolbarHeight(safe, 'xs') ?? null,
      sm: readToolbarHeight(safe, 'sm') ?? null,
    },
  }
}

/**
 * The controls themselves, for a client that draws the editor from data:
 * every color field, the font list, and each number's range and label.
 */
export const THEME_EDITOR_CATALOG = {
  schemes: THEME_EDITOR_SCHEMES,
  colors: THEME_COLOR_FIELDS,
  darkScheme: DARK_SCHEME_FIELD,
  systemFont: SYSTEM_FONT_VALUE,
  fonts: GOOGLE_FONT_OPTIONS,
  borderRadius: BORDER_RADIUS_FIELD,
  spacing: SPACING_FIELD,
  navHeight: TOOLBAR_HEIGHT_FIELDS,
} as const
