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

import { HelpTip, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import { Grid, type GridProps, IconButton, Tooltip } from '@mui/material'
import { styled } from '@mui/material/styles'

import clsx from 'clsx'

const PREFIX = 'FormFieldGrid'

const classes = {
  grid: `${PREFIX}-grid`,
}

const StyledGrid = styled(Grid)({
  [`&.${classes.grid}`]: {
    position: 'relative',
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

export interface FormFieldGridProps extends Omit<GridProps, 'size'> {
  children?: ReactNode
  className?: string
  size?: GridProps['size']
  /** Contextual help affordance at the field's top-right (AGL-601). */
  help?: HelpTipContent
  /** Reset-to-unset affordance at the field's top-right (AGL-2486). */
  clear?: FieldClearAction
}

export const FormFieldGrid = ({
  children,
  className,
  help,
  clear,
  size = { xs: 12 },
  ...props
}: FormFieldGridProps) => (
  <StyledGrid size={size} className={clsx(classes.grid, className)} {...props}>
    {children}
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
