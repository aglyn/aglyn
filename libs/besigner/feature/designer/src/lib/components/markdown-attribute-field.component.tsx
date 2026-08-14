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

import { MarkdownField } from '@aglyn/aglyn-markdown-editor'
import { useFieldApi } from '@aglyn/shared-ui-jsx-forms'
import { Stack, Typography } from '@mui/material'
import { useCallback } from 'react'

/** Mapper key for the attributes form (editor-internal, never persisted). */
export const MARKDOWN_ATTRIBUTE_FIELD_COMPONENT =
  'aglyn-markdown-attribute-field'

/**
 * A markdown-lite attribute, edited with the WYSIWYG the console already
 * ships (AGL-1616).
 *
 * The Markdown component's whole document is ONE `content` attribute, and it
 * was a plain textarea: correcting the published Privacy Policy meant
 * preparing a 13 KB paste of raw markdown-lite (AGL-1594). The same editor the
 * blog and the marketplace listing editor use is now the field.
 *
 * ## Commit semantics — the part that can lose an author's work
 *
 * A besigner attribute commits on a 250 ms debounce, flushed when focus leaves
 * the form and again on unmount (`useDebouncedCommit`, AGL-567). That is only
 * safe while every edit has already reached react-final-form by the time a
 * flush runs. `MarkdownVisualEditor` emits on every input event rather than on
 * blur, so it does — and this wrapper must not undo that:
 *
 * - `input.onChange` is called straight from the editor's `onChange`, never
 *   deferred to a blur of our own. The toolbar, the link popover and the
 *   source/visual toggle all move focus (two of them into a portal outside the
 *   `<form>`), so a blur-committed wrapper would strand everything typed since
 *   the previous one — silently, with the canvas still showing the right text.
 * - Nothing here re-derives the value. The editor re-parses its row model
 *   whenever the incoming `value` differs from what it last emitted, which
 *   resets the undo history and the caret; handing back anything but the
 *   editor's own string would do that mid-sentence.
 */
export function MarkdownAttributeField(props: Record<string, unknown>) {
  const { input, label, description, isDisabled } = useFieldApi(props as never)

  const value = typeof input.value === 'string' ? input.value : ''

  const handleChange = useCallback(
    (next: string) => {
      input.onChange(next)
    },
    [input],
  )

  return (
    <Stack spacing={0.5} sx={{ width: '100%' }} data-testid="markdown-attribute-field">
      <MarkdownField
        label={String(label ?? 'Content')}
        value={value}
        onChange={handleChange}
        minHeight={220}
      />
      {description ? (
        <Typography variant="caption" color="text.secondary">
          {String(description)}
        </Typography>
      ) : null}
      {isDisabled ? (
        <Typography variant="caption" color="text.secondary">
          {'This attribute is read-only here.'}
        </Typography>
      ) : null}
    </Stack>
  )
}

MarkdownAttributeField.displayName = 'MarkdownAttributeField'

export default MarkdownAttributeField
