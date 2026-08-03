/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import ReactMonacoEditor, { EditorProps } from '@monaco-editor/react'
import { useColorScheme, useTheme } from '@mui/material/styles'

export interface MonacoEditorProps extends EditorProps {}

export const MonacoEditor = (props: MonacoEditorProps) => {
  // Monaco defaults to its light theme regardless of the app's, so the raw
  // JSON editor rendered a white page inside a dark dialog.
  //
  // `palette.mode` is NOT the answer on its own: the console runs a CSS-vars
  // theme whose scheme is driven by a class on <html>, so `palette.mode`
  // stays 'light' whatever the user picked. `useColorScheme` is the live
  // one — `systemMode` when following the OS, else the explicit `mode` —
  // with `palette.mode` kept as the fallback for the non-CSS-vars trees.
  // `props` spreads last, so a caller can still pin a Monaco theme.
  const { palette } = useTheme()
  const { mode, systemMode } = useColorScheme()
  const resolved = systemMode ?? mode ?? palette.mode
  return (
    <ReactMonacoEditor
      defaultLanguage="json"
      theme={resolved === 'dark' ? 'vs-dark' : 'light'}
      {...props}
    />
  )
}
MonacoEditor.displayName = 'MonacoEditor'

export default MonacoEditor
