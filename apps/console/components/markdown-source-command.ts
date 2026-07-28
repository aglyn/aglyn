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
 * The toolbar's other half (AGL-985): the same commands applied to a raw
 * markdown textarea instead of the visual editor's block model. One
 * implementation, because the blog body and the marketplace README are the
 * same dialect behind the same toolbar.
 */

import type { MarkdownEditorCommand } from './markdown-visual-editor.component'

export interface SourceEdit {
  body: string
  /** Selection to restore — the inserted run, so it can be typed over. */
  start: number
  end: number
}

/**
 * Wraps or inserts at [start, end) of `body`. Block-level constructs get a
 * blank line ahead of them, or markdown-lite would fold them into the
 * paragraph above.
 */
export function applyCommandToSource(
  body: string,
  start: number,
  end: number,
  command: MarkdownEditorCommand,
): SourceEdit {
  const selected = body.slice(start, end)
  const blockPrefix =
    start > 0 && !/\n\n$/.test(body.slice(0, start)) ? '\n\n' : ''
  const insert =
    command === 'bold'
      ? `**${selected || 'bold text'}**`
      : command === 'italic'
        ? `*${selected || 'italic text'}*`
        : command === 'heading'
          ? `${blockPrefix}## ${selected || 'Heading'}`
          : command === 'heading3'
            ? `${blockPrefix}### ${selected || 'Heading'}`
            : command === 'list'
              ? `${blockPrefix}- ${selected || 'list item'}`
              : command === 'link'
                ? `[${selected || 'link text'}](https://)`
                : command === 'code'
                  ? `${blockPrefix}\`\`\`\n${selected || 'code'}\n\`\`\``
                  : command === 'table'
                    ? `${blockPrefix}| Column | Column |\n| --- | --- |\n|  |  |`
                    : `${blockPrefix}![${selected || 'alt text'}](https://)`
  return {
    body: body.slice(0, start) + insert + body.slice(end),
    start,
    end: start + insert.length,
  }
}

/** Markdown-lite's syntax, as one line of helper text under a source box. */
export const MARKDOWN_SOURCE_HINT =
  'Markdown-lite: **bold**, *italic*, ## headings, - lists, ' +
  '[links](https:// or /page), ![images](https://), ``` code fences, ' +
  '| pipe | tables |.'
