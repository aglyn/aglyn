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
import { Box } from '@mui/material'
import { observer } from 'mobx-react-lite'
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { inlineTextEdit } from '../utils/inline-text-edit.store'

/**
 * Fixed-position overlay that edits a node's text (`children` prop) in
 * place. Opened by double-clicking a `textEditable` element in the canvas
 * (see DraggableDroppable); Enter or blur commits ONCE through
 * `Aglyn.canvas.updateNodeProps` (a single undo entry), Escape cancels.
 */
export const InlineTextEditorComponent = observer(
  function InlineTextEditorComponent() {
    const node = inlineTextEdit.node
    const rect = inlineTextEdit.rect
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const [value, setValue] = useState('')
    // Distinguish commit-blur (Enter already committed) from cancel paths.
    const committedRef = useRef(false)

    useEffect(() => {
      if (!node) return
      const text = node.resolvedProps?.['children'] ?? node.props?.['children']
      setValue(typeof text === 'string' ? text : '')
      committedRef.current = false
      // Focus + select after the overlay paints.
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
      return () => cancelAnimationFrame(raf)
    }, [node])

    const commit = useCallback(() => {
      if (committedRef.current) return
      committedRef.current = true
      const current = inlineTextEdit.node
      if (current) {
        Aglyn.canvas.updateNodeProps(current, { children: value })
      }
      inlineTextEdit.close()
    }, [value])

    const cancel = useCallback(() => {
      committedRef.current = true
      inlineTextEdit.close()
    }, [])

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          commit()
        }
      },
      [cancel, commit],
    )

    if (!node || !rect) return null

    return (
      <Box
        data-aglyn="overlay:inline-text-editor"
        sx={{
          position: 'fixed',
          left: rect.left,
          top: rect.top,
          minWidth: Math.max(rect.width, 120),
          zIndex: (theme) => theme.zIndex.modal,
        }}
      >
        <Box
          component="textarea"
          ref={inputRef}
          value={value}
          rows={Math.max(1, value.split('\n').length)}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          aria-label="Edit text"
          sx={{
            width: '100%',
            minHeight: rect.height,
            font: 'inherit',
            p: 0.5,
            resize: 'none',
            bgcolor: 'background.paper',
            color: 'text.primary',
            border: '2px solid',
            borderColor: 'secondary.main',
            borderRadius: 0.5,
            outline: 'none',
            boxShadow: 4,
          }}
        />
      </Box>
    )
  },
)
InlineTextEditorComponent.displayName = 'InlineTextEditorComponent'

export default InlineTextEditorComponent
