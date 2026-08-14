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
 * The markdown-lite WYSIWYG editor (AGL-1616).
 *
 * It was written inside `apps/console/components` for the blog/content page
 * and the marketplace listing editor. The besigner attributes panel needs the
 * same editor for the Markdown component's `content` attribute, and the
 * designer is a lib — a lib cannot import an app, so the editor moved here.
 *
 * The home is an `scope:aglyn` + `scope:ui` lib rather than a `scope:shared`
 * one because the editor speaks the markdown-lite dialect, which lives in
 * `@aglyn/aglyn` (`scope:aglyn`). `scope:shared` may only depend on
 * `scope:shared`, so a shared-UI home would have had to re-implement the
 * dialect — the exact wall AGL-1558 hit and correctly refused to climb.
 */

export {
  default as MarkdownVisualEditor,
  markdownToRows,
  rowsToMarkdown,
  readInlinesFromElement,
  type EditorRow,
  type MarkdownEditorCommand,
  type MarkdownEditorContext,
  type MarkdownVisualEditorHandle,
  type MarkdownVisualEditorProps,
} from './lib/markdown-visual-editor.component'

export {
  default as MarkdownEditorToolbar,
  type MarkdownEditorToolbarProps,
} from './lib/markdown-editor-toolbar.component'

export {
  default as MarkdownField,
  type MarkdownFieldHandle,
  type MarkdownFieldProps,
} from './lib/markdown-field.component'

export {
  applyCommandToSource,
  MARKDOWN_SOURCE_HINT,
  type SourceEdit,
} from './lib/markdown-source-command'

export { htmlToInlines, htmlToRows } from './lib/markdown-html-paste'

export {
  default as MarkdownLiteView,
  type MarkdownLiteViewProps,
} from './lib/markdown-lite-view.component'
