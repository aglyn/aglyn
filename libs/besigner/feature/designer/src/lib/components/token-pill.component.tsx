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

import { Button, Popover, Stack, Typography } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import type { CSSProperties } from 'react'
import type { SystemStyleObject } from '@mui/system'

import {
  TOKEN_PILL_ATTR,
  TOKEN_PILL_GROUP_ATTR,
} from '../utils/token-editable-dom'
import type { ResolvedTokenLabel } from '../utils/token-segments'

/**
 * Token pills (AGL-586): the colored badges that render `{{...}}` bindings
 * as their CURRENT display names inside editable text surfaces. The
 * serialized value keeps the raw id-based token; the pill is presentation
 * only. Pills are atomic (`contenteditable="false"`) and clickable — the
 * host surface opens {@link TokenPillPopover} to replace or remove one.
 *
 * Styling lives on the CONTAINER (keyed off the data attributes) so React
 * pills and the inline editor's direct-DOM pills look identical.
 */

/** Pill colors by token family — stable theme-palette assignments. */
const PILL_GROUP_STYLES: Record<string, { bgcolor: string; color: string }> = {
  // Slate, not the accent (AGL-1194): a pill is editor chrome rendered
  // inside the user's own text, so it must not read as content styling.
  // The other families keep their semantic hues — they encode WHAT the
  // token is, which is information, not decoration.
  variable: { bgcolor: 'tertiary.main', color: 'tertiary.contrastText' },
  function: { bgcolor: 'tertiary.main', color: 'tertiary.contrastText' },
  entry: { bgcolor: 'info.main', color: 'info.contrastText' },
  collection: { bgcolor: 'success.main', color: 'success.contrastText' },
  item: { bgcolor: 'grey.700', color: 'common.white' },
  // A value each page supplies, like a variable is one the site supplies.
  property: { bgcolor: 'tertiary.main', color: 'tertiary.contrastText' },
  // A value the site supplies from its own settings (AGL-2881).
  host: { bgcolor: 'tertiary.main', color: 'tertiary.contrastText' },
  // Unresolvable referent (deleted variable, unknown grammar): warning.
  unknown: { bgcolor: 'warning.main', color: 'warning.contrastText' },
}

/**
 * Container styles for any surface that hosts pills. Spread into the
 * editable element's `sx` — pills themselves carry only data attributes.
 * Built as a plain record and cast once: MUI's sx union chokes (TS2590)
 * on computed spreads inside the literal.
 */
const containerStyles: Record<string, unknown> = {
  [`& [${TOKEN_PILL_ATTR}]`]: {
    display: 'inline-block',
    borderRadius: 1,
    px: 0.75,
    mx: 0.125,
    // Relative to the text the pill sits in, so it scales with a heading.
    fontSize: '0.8em',
    lineHeight: 1.7,
    fontWeight: 'fontWeightMedium',
    whiteSpace: 'nowrap',
    verticalAlign: 'baseline',
    cursor: 'pointer',
    userSelect: 'none',
    ...PILL_GROUP_STYLES['unknown'],
  },
}
for (const [group, style] of Object.entries(PILL_GROUP_STYLES)) {
  containerStyles[
    `& [${TOKEN_PILL_ATTR}][${TOKEN_PILL_GROUP_ATTR}="${group}"]`
  ] = style
}
export const tokenPillContainerSx =
  containerStyles as SystemStyleObject<Theme>

/** A palette path (`tertiary.main`, `grey.700`) read off a theme. */
function paletteValue(theme: Theme, path: string): string | undefined {
  let value: unknown = theme.palette
  for (const key of path.split('.')) {
    value = (value as Record<string, unknown> | undefined)?.[key]
  }
  return typeof value === 'string' ? value : undefined
}

/**
 * Gives every pill under `root` the pill look as INLINE style, for a surface
 * the container styles above cannot reach.
 *
 * The canvas edits text in place, inside the page's own closed shadow root:
 * the console's style sheets stop at its boundary, and the page's theme is the
 * SITE's, which has no `tertiary` at all. A pill there was bare text with a
 * tooltip — nothing said it was a variable. So the console's own colours are
 * written onto each pill directly. Presentation only: pills turn back into raw
 * tokens before anything is read or stored, so none of this is ever saved.
 */
export function paintTokenPills(root: HTMLElement, theme: Theme): void {
  const pills = root.querySelectorAll<HTMLElement>(`[${TOKEN_PILL_ATTR}]`)
  for (const pill of pills) {
    Object.assign(
      pill.style,
      tokenPillStyle(theme, pill.getAttribute(TOKEN_PILL_GROUP_ATTR)),
    )
  }
}

/**
 * The pill look as resolved style values — the container styles above,
 * read off `theme` — for a pill drawn where those styles cannot reach.
 */
export function tokenPillStyle(
  theme: Theme,
  group: string | null | undefined,
): CSSProperties {
  const colors =
    PILL_GROUP_STYLES[group ?? 'unknown'] ?? PILL_GROUP_STYLES['unknown']!
  const radius = theme.shape.borderRadius
  return {
    display: 'inline-block',
    borderRadius: typeof radius === 'number' ? `${radius}px` : String(radius),
    padding: theme.spacing(0, 0.75),
    margin: theme.spacing(0, 0.125),
    fontSize: '0.8em',
    lineHeight: '1.7',
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    verticalAlign: 'baseline',
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: paletteValue(theme, colors.bgcolor) ?? '',
    color: paletteValue(theme, colors.color) ?? '',
  }
}

export interface TokenPillProps {
  /** Raw stored token, e.g. `{{var:AbC123}}`. */
  token: string
  resolved: ResolvedTokenLabel
}

/**
 * One atomic pill inside a React-rendered editable surface. Clicks are
 * handled by the surface via delegation on the `data-token` attribute
 * (matching the inline editor's direct-DOM pills), so the pill itself
 * stays a dumb, re-render-safe span.
 */
export function TokenPill(props: TokenPillProps) {
  const { token, resolved } = props
  const attributes = {
    [TOKEN_PILL_ATTR]: token,
    [TOKEN_PILL_GROUP_ATTR]: resolved.known ? resolved.group : 'unknown',
  }
  return (
    <span
      {...attributes}
      contentEditable={false}
      role="button"
      // The raw token stays inspectable (names shown, ids stored).
      title={token}
    >
      {resolved.label}
    </span>
  )
}
TokenPill.displayName = 'TokenPill'

export interface TokenPillPopoverProps {
  anchorEl: HTMLElement | null
  /** Raw token of the clicked pill (shown so editors can see the id form). */
  token: string
  onClose: () => void
  /** Opens the insert picker to swap this token in place. */
  onReplace: () => void
  /** Deletes this token from the value. */
  onRemove: () => void
}

/** The click affordance on a pill: replace it (via the picker) or remove it. */
export function TokenPillPopover(props: TokenPillPopoverProps) {
  const { anchorEl, token, onClose, onReplace, onRemove } = props
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      // The editable surface keeps its DOM selection while the popover is up.
      disableRestoreFocus
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 1, alignItems: 'center', maxWidth: 420 }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ maxWidth: 200, fontFamily: 'monospace' }}
        >
          {token}
        </Typography>
        <Button size="small" onClick={onReplace}>
          {'Replace'}
        </Button>
        <Button size="small" color="error" onClick={onRemove}>
          {'Remove'}
        </Button>
      </Stack>
    </Popover>
  )
}
TokenPillPopover.displayName = 'TokenPillPopover'

export default TokenPill
