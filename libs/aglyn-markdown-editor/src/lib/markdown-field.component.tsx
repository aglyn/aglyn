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
'use client'

import { Stack, TextField, Typography } from '@mui/material'
import { useRef, useState } from 'react'
import MarkdownEditorToolbar from './markdown-editor-toolbar.component'
import {
  applyCommandToSource,
  MARKDOWN_SOURCE_HINT,
} from './markdown-source-command'
import MarkdownVisualEditor, {
  type MarkdownEditorCommand,
  type MarkdownEditorContext,
  type MarkdownVisualEditorHandle,
} from './markdown-visual-editor.component'

export interface MarkdownFieldHandle {
  /** Insert an image at the cursor — used by a media picker upstream. */
  insertImage: (alt: string, url: string) => void
}

export interface MarkdownFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  /**
   * Open the caller's media picker, with the alt text the author typed in the
   * image dialog (AGL-1645). Omitted when there is nowhere to pick from — the
   * toolbar's image action is then the editor's own prompt.
   */
  onPickImageFromMedia?: (alt: string) => void
  minHeight?: number
  /** Shown under the editor in visual mode. */
  helperText?: string
}

/**
 * A markdown field: toolbar, visual editor, and a raw-source escape hatch
 * (AGL-1080).
 *
 * This plumbing — one toolbar driving two surfaces, a mode switch, a
 * source-mode command path that wraps the textarea selection, and a handle
 * for inserting picked media — lived only inside the listing detail editor.
 * The publish form, which is where a README is written for the FIRST time,
 * had a four-row textarea instead: the worst tool on the first pass and the
 * good one on the second, for the same field.
 *
 * Copying sixty lines into the second caller is how two surfaces for one
 * piece of content drift apart, which is the complaint this closes. So it
 * is extracted once and used twice.
 *
 * The media picker itself stays with the caller: it needs a scope (an org
 * or a host) that this component has no business knowing.
 */
export function MarkdownField(
  props: MarkdownFieldProps & { editorRef?: (handle: MarkdownFieldHandle | null) => void },
) {
  const {
    label,
    value,
    onChange,
    onPickImageFromMedia,
    minHeight = 200,
    helperText,
    editorRef,
  } = props
  const visualRef = useRef<MarkdownVisualEditorHandle | null>(null)
  const sourceRef = useRef<HTMLTextAreaElement | null>(null)
  // Visual by default, raw markdown one click away (AGL-985) — publishers
  // often arrive holding a README they wrote somewhere else.
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  const [context, setContext] = useState<MarkdownEditorContext | null>(null)

  // One toolbar, two surfaces (AGL-985): in Visual a command mutates the
  // editor's block model; in Markdown it wraps the textarea selection.
  const handleCommand = (command: MarkdownEditorCommand) => {
    if (mode === 'visual') {
      visualRef.current?.exec(command)
      return
    }
    const input = sourceRef.current
    const edit = applyCommandToSource(
      value,
      input?.selectionStart ?? value.length,
      input?.selectionEnd ?? value.length,
      command,
    )
    onChange(edit.body)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(edit.start, edit.end)
    })
  }

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{label}</Typography>
      <MarkdownEditorToolbar
        onCommand={handleCommand}
        context={mode === 'visual' ? context : null}
        mode={mode}
        onModeChange={setMode}
      />
      {mode === 'visual' ? (
        // No wrapper box (AGL-982): the editor draws its own border and
        // focus ring, so a second one read as a box inside a box.
        <MarkdownVisualEditor
          ref={(handle) => {
            visualRef.current = handle
            editorRef?.(
              handle
                ? { insertImage: (alt, url) => handle.insertImage(alt, url) }
                : null,
            )
          }}
          value={value}
          onChange={onChange}
          onPickImageFromMedia={onPickImageFromMedia}
          onContextChange={setContext}
          minHeight={minHeight}
        />
      ) : (
        <TextField
          label="Markdown source"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          size="small"
          multiline
          minRows={12}
          fullWidth
          inputRef={sourceRef}
          helperText={MARKDOWN_SOURCE_HINT}
        />
      )}
      {mode === 'visual' && helperText ? (
        <Typography variant="caption" color="text.secondary">
          {helperText}
        </Typography>
      ) : null}
    </Stack>
  )
}

MarkdownField.displayName = 'MarkdownField'

export default MarkdownField
