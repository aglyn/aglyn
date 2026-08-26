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
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0) and
 * updated for the current MUI Grid API (`size` instead of `item`/`xs`).
 */

import type { ReactNode } from 'react'

import {
  ICON_VARIANT_VISIBILITY_HIDDEN,
  ICON_VARIANT_VISIBILITY_SHOWN,
} from '@aglyn/shared-data-enums'
import { HelpTip, type HelpTipContent, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  formControlClasses,
  formLabelClasses,
  Grid,
  type GridProps,
  IconButton,
  inputBaseClasses,
  Tooltip,
  toggleButtonGroupClasses,
  typographyClasses,
} from '@mui/material'
import { styled } from '@mui/material/styles'

import clsx from 'clsx'

const PREFIX = 'FormFieldGrid'

const classes = {
  grid: `${PREFIX}-grid`,
  muted: `${PREFIX}-muted`,
}

const StyledGrid = styled(Grid)({
  [`&.${classes.grid}`]: {
    position: 'relative',
  },
  // A muted field has to read as "set but not applying", never as unset —
  // that distinction is the whole point of switching a declaration off
  // rather than deleting it. So the VALUE is struck through and the control
  // fades, while the corner buttons stay at full strength: they are the way
  // back and must not look disabled themselves.
  [`&.${classes.muted}`]: {
    [[
      `& .${formControlClasses.root}`,
      `& .${formLabelClasses.root}`,
      `& .${typographyClasses.root}`,
      `& .${toggleButtonGroupClasses.root}`,
    ].join(',')]: {
      opacity: 0.5,
    },
    [`& .${inputBaseClasses.input}`]: {
      textDecoration: 'line-through',
    },
  },
})

/**
 * The "put this field back to unset" affordance (AGL-2486).
 *
 * Every editor in the styles panel could SET a value and none of them
 * could take one off again: a colour typed once stayed on the node
 * forever, because "unset" is not a value any of these controls can be
 * driven to — a colour picker has no empty swatch, a length box with a
 * unit picked re-serializes `px` onto an emptied number, and a select's
 * "Default" option only exists where someone remembered to author one.
 * The way back has to be a control of its own.
 *
 * It lives on the shared wrapper rather than inside each editor so the
 * affordance is one thing in one place — but each editor still supplies
 * {@link onClear}, because what "clear" MEANS differs per editor (a
 * gradient drops its stops, a length drops its unit) and a wrapper that
 * only knew the form value would leave those drafts behind.
 */
export interface FieldClearAction {
  /** Accessible name, e.g. `Clear Text Color`. */
  label: string
  /** Nothing to clear — the button is not rendered at all. */
  hidden?: boolean
  disabled?: boolean
  onClear: () => void
}

/**
 * Builds a {@link FieldClearAction} for one editor.
 *
 * `hasValue` is passed in rather than derived from a form value because
 * `0` and `'0'` are legitimate style values and this repo compiles with
 * `strictNullChecks` off — a falsy test here would hide the clear button
 * on exactly the values hardest to type back in.
 */
export const buildFieldClear = (options: {
  /** Opt-in: only fields whose schema asks for it get the affordance. */
  clearable?: boolean
  label?: ReactNode
  hasValue: boolean
  locked?: boolean
  onClear: () => void
}): FieldClearAction | undefined => {
  const { clearable, label, hasValue, locked, onClear } = options
  if (!clearable || locked) return undefined
  return {
    label:
      typeof label === 'string' && label ? `Clear ${label}` : 'Clear value',
    hidden: !hasValue,
    onClear,
  }
}

/**
 * The "stop applying this one declaration, keep its value" affordance
 * (AGL-2486) — the browser-devtools checkbox, in the styles panel.
 *
 * Distinct from {@link FieldClearAction} in the only way that matters: clear
 * takes the value off the element, mute leaves it exactly where it is and
 * stops it painting, so a layout can be looked at with one property switched
 * off and the comparison value is still there to switch back on.
 *
 * Supplied by the panel through the field's `FormFieldGridProps`, not by each
 * editor, because unlike clear it needs nothing from the editor: which
 * declaration to mute is the field's own name, and where the mute lives is
 * the panel's business.
 */
export interface FieldMuteAction {
  /** Accessible name, e.g. `Stop applying Max Width`. */
  label: string
  /** True while the declaration is switched off. */
  muted?: boolean
  onToggle: () => void
}

export interface FormFieldGridProps extends Omit<GridProps, 'size'> {
  children?: ReactNode
  className?: string
  size?: GridProps['size']
  /** Contextual help affordance at the field's top-right (AGL-601). */
  help?: HelpTipContent
  /** Reset-to-unset affordance at the field's top-right (AGL-2486). */
  clear?: FieldClearAction
  /** Switch this declaration off without losing it (AGL-2486). */
  mute?: FieldMuteAction
}

export const FormFieldGrid = ({
  children,
  className,
  help,
  clear,
  mute,
  size = { xs: 12 },
  ...props
}: FormFieldGridProps) => (
  <StyledGrid
    size={size}
    className={clsx(classes.grid, mute?.muted && classes.muted, className)}
    {...props}
  >
    {children}
    {mute && (
      <Tooltip title={mute.label}>
        <IconButton
          size="small"
          aria-label={mute.label}
          aria-pressed={!!mute.muted}
          onClick={mute.onToggle}
          sx={{
            position: 'absolute',
            top: -8,
            // Outermost of the corner controls, so adding it never moves the
            // help tip or the clear button an author has learned the place of.
            right: (help ? 22 : 0) + (clear && !clear.hidden ? 22 : 0),
            zIndex: 1,
            p: 0.25,
            fontSize: '0.85rem',
            lineHeight: 1,
            color: mute.muted ? 'secondary.main' : 'text.secondary',
          }}
        >
          <MdiIcon
            fontSize="inherit"
            path={
              mute.muted
                ? ICON_VARIANT_VISIBILITY_HIDDEN.path
                : ICON_VARIANT_VISIBILITY_SHOWN.path
            }
          />
        </IconButton>
      </Tooltip>
    )}
    {clear && !clear.hidden && (
      <Tooltip title={clear.label}>
        {/* Sits beside the help tip rather than under it — both are pinned
            to the field's top-right corner. */}
        <IconButton
          size="small"
          aria-label={clear.label}
          disabled={clear.disabled}
          onClick={clear.onClear}
          sx={{
            position: 'absolute',
            top: -8,
            right: help ? 22 : 0,
            zIndex: 1,
            p: 0.25,
            fontSize: '0.85rem',
            lineHeight: 1,
            color: 'text.secondary',
          }}
        >
          {'✕'}
        </IconButton>
      </Tooltip>
    )}
    {help && (
      <HelpTip
        {...help}
        sx={{
          position: 'absolute',
          top: -6,
          right: 0,
          fontSize: '0.95em',
          zIndex: 1,
        }}
      />
    )}
  </StyledGrid>
)

export default FormFieldGrid
