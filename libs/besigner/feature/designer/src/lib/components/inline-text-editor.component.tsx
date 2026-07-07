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
import { Box, Button, IconButton, Paper } from '@mui/material'
import { observer } from 'mobx-react-lite'
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { inlineTextEdit } from '../utils/inline-text-edit.store'
import {
  richTextToPlain,
  sanitizeRichText,
} from '../utils/sanitize-rich-text'

const RICH_COMMANDS: Array<{ command: string; label: string; title: string }> =
  [
    { command: 'bold', label: 'B', title: 'Bold' },
    { command: 'italic', label: 'I', title: 'Italic' },
    { command: 'underline', label: 'U', title: 'Underline' },
    { command: 'insertUnorderedList', label: '•', title: 'Bulleted list' },
    { command: 'insertOrderedList', label: '1.', title: 'Numbered list' },
  ]

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

/**
 * Fixed-position overlay that edits a node's text in place, opened by
 * double-clicking a `textEditable` element in the canvas (see
 * DraggableDroppable). Plain components edit through a textarea (Enter or
 * blur commits, Escape cancels). Components flagged `richTextEditable`
 * (AGL-54) get a contentEditable surface with a basic formatting toolbar;
 * the commit sanitizes the markup through an allowlist and stores it in the
 * `html` prop with `children` kept as the plain-text fallback. Either mode
 * commits ONCE through `Aglyn.canvas.updateNodeProps` (a single undo entry).
 */
export const InlineTextEditorComponent = observer(
  function InlineTextEditorComponent() {
    const node = inlineTextEdit.node
    const rect = inlineTextEdit.rect
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const richRef = useRef<HTMLDivElement>(null)
    const [value, setValue] = useState('')
    // Distinguish commit-blur (Enter already committed) from cancel paths.
    const committedRef = useRef(false)

    const rich =
      ((node?.componentSchema?.flags?.richTextEditable ??
        Aglyn.FEATURE_FLAG.DISABLED) &
        Aglyn.FEATURE_FLAG.ENABLED) !==
      0

    useEffect(() => {
      if (!node) return
      committedRef.current = false
      const props = { ...node.props, ...node.resolvedProps } as any
      const text =
        typeof props?.children === 'string' ? (props.children as string) : ''
      if (rich) {
        const initial =
          typeof props?.html === 'string' && props.html
            ? (props.html as string)
            : escapeHtml(text)
        // Set once on open — contentEditable manages its own DOM after.
        const raf = requestAnimationFrame(() => {
          if (richRef.current) {
            richRef.current.innerHTML = initial
            richRef.current.focus()
            // Place the caret at the end of the content.
            const selection = window.getSelection()
            if (selection) {
              const range = document.createRange()
              range.selectNodeContents(richRef.current)
              range.collapse(false)
              selection.removeAllRanges()
              selection.addRange(range)
            }
          }
        })
        return () => cancelAnimationFrame(raf)
      }
      setValue(text)
      // Focus + select after the overlay paints.
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
      return () => cancelAnimationFrame(raf)
    }, [node, rich])

    const commit = useCallback(() => {
      if (committedRef.current) return
      committedRef.current = true
      const current = inlineTextEdit.node
      if (current) {
        // updateNodeProps REPLACES the props object — spread the existing
        // props so variant/component/etc. survive the text edit.
        if (rich && richRef.current) {
          const sanitized = sanitizeRichText(richRef.current.innerHTML)
          const plain = richTextToPlain(sanitized)
          const hasMarkup = /<[a-z]/i.test(sanitized)
          Aglyn.canvas.updateNodeProps(current, {
            ...current.props,
            // Empty html falls back to plain children in the renderer.
            html: hasMarkup ? sanitized : '',
            children: plain,
          })
        } else {
          Aglyn.canvas.updateNodeProps(current, {
            ...current.props,
            children: value,
          })
        }
      }
      inlineTextEdit.close()
    }, [value, rich])

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

    const handleRichKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          commit()
        }
      },
      [cancel, commit],
    )

    // Keep the selection inside the editable surface while clicking tools.
    const keepFocus = useCallback((event: MouseEvent) => {
      event.preventDefault()
    }, [])

    const exec = useCallback(
      (command: string) => () => {
        // execCommand is deprecated but universally supported and keeps this
        // dependency-free; the output is normalized by the sanitizer anyway.
        document.execCommand(command)
        richRef.current?.focus()
      },
      [],
    )

    const handleLink = useCallback(() => {
      const url = window.prompt('Link URL (https://…)')
      if (url) document.execCommand('createLink', false, url)
      richRef.current?.focus()
    }, [])

    if (!node || !rect) return null

    return (
      <Box
        data-aglyn="overlay:inline-text-editor"
        sx={{
          position: 'fixed',
          left: rect.left,
          top: rect.top,
          minWidth: Math.max(rect.width, 120),
          maxWidth: '90vw',
          zIndex: (theme) => theme.zIndex.modal,
        }}
      >
        {rich ? (
          <>
            <Paper
              elevation={4}
              sx={{
                position: 'absolute',
                top: -40,
                left: 0,
                px: 0.5,
                py: 0.25,
                display: 'flex',
                gap: 0.25,
                alignItems: 'center',
              }}
            >
              {RICH_COMMANDS.map(({ command, label, title }) => (
                <IconButton
                  key={command}
                  size="small"
                  title={title}
                  onMouseDown={keepFocus}
                  onClick={exec(command)}
                  sx={{
                    width: 28,
                    height: 28,
                    fontSize: 13,
                    fontWeight: 700,
                    fontStyle: command === 'italic' ? 'italic' : undefined,
                    textDecoration:
                      command === 'underline' ? 'underline' : undefined,
                    borderRadius: 0.5,
                  }}
                >
                  {label}
                </IconButton>
              ))}
              <IconButton
                size="small"
                title="Insert link"
                onMouseDown={keepFocus}
                onClick={handleLink}
                sx={{ width: 28, height: 28, fontSize: 13, borderRadius: 0.5 }}
              >
                {'🔗'}
              </IconButton>
              <Button
                size="small"
                color="secondary"
                onMouseDown={keepFocus}
                onClick={commit}
              >
                {'Done'}
              </Button>
            </Paper>
            <Box
              ref={richRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Edit rich text"
              onKeyDown={handleRichKeyDown}
              onBlur={commit}
              sx={{
                width: '100%',
                minHeight: rect.height,
                font: 'inherit',
                p: 0.5,
                bgcolor: 'background.paper',
                color: 'text.primary',
                border: '2px solid',
                borderColor: 'secondary.main',
                borderRadius: 0.5,
                outline: 'none',
                boxShadow: 4,
                '& a': { pointerEvents: 'none' },
              }}
            />
          </>
        ) : (
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
              borderRadius: 0.5,
              borderColor: 'secondary.main',
              outline: 'none',
              boxShadow: 4,
            }}
          />
        )}
      </Box>
    )
  },
)
InlineTextEditorComponent.displayName = 'InlineTextEditorComponent'

export default InlineTextEditorComponent
