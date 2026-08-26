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
import { FieldMuteButton } from '@aglyn/shared-ui-jsx-forms'
import { Autocomplete, Chip, TextField } from '@mui/material'
import { action } from 'mobx'
import { observer } from 'mobx-react-lite'
import { useCallback, useMemo } from 'react'

import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import { toggleRevealedNodeId } from '../utils/canvas-reveal'
import {
  isClassMuted,
  isClassSwitchable,
  toggleMutedClass,
} from '../utils/muted-classes'

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
 *
 * Each chip carries an eye as well as its ✕ (AGL-2486). The eye stops the
 * class applying ON THE CANVAS and keeps it on the element; the ✕ is still
 * the one control that takes a class off. Nothing about the eye is written
 * down, so the chips are always the class list that ships.
 *
 * The hidden class is the exception, and deliberately so: switching it off
 * on the canvas is the same act as the hierarchy's visibility eye (AGL-592),
 * so its chip drives THAT state rather than a second one that could
 * disagree with it.
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

    const [mutedClasses, setMutedClasses] = useAglynBesignerFlag('mutedClasses')
    const [revealedNodeIds, setRevealedNodeIds] =
      useAglynBesignerFlag('revealedNodeIds')

    const nodeId = node?.$id

    /** Whether the canvas is currently rendering without this class. */
    const isSwitchedOff = useCallback(
      (className: string) => {
        if (!nodeId) return false
        return isClassSwitchable(className)
          ? isClassMuted(mutedClasses, { nodeId, className })
          : Boolean(revealedNodeIds?.some((id) => id === nodeId))
      },
      [nodeId, mutedClasses, revealedNodeIds],
    )

    const toggleClass = useCallback(
      (className: string) => {
        if (!nodeId) return
        if (isClassSwitchable(className)) {
          setMutedClasses((current) =>
            toggleMutedClass(current, { nodeId, className }),
          )
          return
        }
        // One switch, two places to reach it.
        setRevealedNodeIds((current) => toggleRevealedNodeId(current, nodeId))
      },
      [nodeId, setMutedClasses, setRevealedNodeIds],
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
          value.map((option, index) => {
            const off = isSwitchedOff(option)
            const switchable = isClassSwitchable(option)
            return (
              <Chip
                label={option}
                size="small"
                {...getItemProps({ index })}
                key={option}
                variant={off ? 'outlined' : 'filled'}
                sx={
                  off
                    ? { textDecoration: 'line-through', opacity: 0.6 }
                    : undefined
                }
                icon={
                  <FieldMuteButton
                    mute={{
                      muted: off,
                      label: switchable
                        ? off
                          ? `Apply ${option} again`
                          : `Stop applying ${option} while designing`
                        : off
                          ? `Stop showing this element on the canvas`
                          : `Show this element on the canvas`,
                      onToggle: () => toggleClass(option),
                    }}
                    sx={{ ml: 0.5 }}
                  />
                }
              />
            )
          })
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
