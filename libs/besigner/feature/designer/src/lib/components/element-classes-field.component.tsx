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

import * as Aglyn from '@aglyn/aglyn'
import { Autocomplete, Chip, TextField } from '@mui/material'
import { action } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useCallback, useMemo } from 'react'

/** Valid CSS class identifier (letters, digits, hyphen, underscore). */
const CLASS_NAME_PATTERN = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/

export const isValidClassName = (name: string): boolean =>
  CLASS_NAME_PATTERN.test(name)

export interface ElementClassesFieldProps {
  node?: Aglyn.NodeSchema
}

/**
 * Custom CSS classes on the selected element (AGL-335): chips persisted
 * into `node.props.className` (space-separated), merged into the
 * rendered className by the node renderer. Pairs with theme stylesheet
 * classes and the interaction builder's class actions.
 */
export const ElementClassesField = observer(
  (props: ElementClassesFieldProps) => {
    const { node } = props
    const classes = useMemo(
      () =>
        String((node?.props as any)?.className ?? '')
          .split(/\s+/)
          .filter(Boolean),
      [(node?.props as any)?.className],
    )

    const handleChange = useCallback(
      (event: unknown, value: string[]) => {
        if (!node) return
        const cleaned = value
          .map((name) => name.trim())
          .filter((name) => isValidClassName(name))
        action(() => {
          const nextProps: Record<string, unknown> = { ...(node.props as any) }
          if (cleaned.length) nextProps['className'] = cleaned.join(' ')
          else delete nextProps['className']
          node.props = nextProps as any
        })()
      },
      [node],
    )

    return (
      <Autocomplete
        multiple
        freeSolo
        size="small"
        options={[] as string[]}
        value={classes}
        onChange={handleChange}
        renderValue={(value, getItemProps) =>
          value.map((option, index) => (
            <Chip
              label={option}
              size="small"
              {...getItemProps({ index })}
              key={option}
            />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label="Classes"
            placeholder="Add class…"
            helperText="Custom CSS classes — targetable from theme styles and interactions"
          />
        )}
      />
    )
  },
)
ElementClassesField.displayName = 'ElementClassesField'

export default ElementClassesField
