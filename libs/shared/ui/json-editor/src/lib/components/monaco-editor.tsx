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

import ReactMonacoEditor, { EditorProps, loader } from '@monaco-editor/react'
import { useColorScheme, useTheme } from '@mui/material/styles'

/**
 * Where Monaco's AMD bundle is served from — our origin, never a CDN.
 *
 * `apps/console/next.config.js` copies `monaco-editor/min/vs` into
 * `apps/console/public/monaco/vs` at build time and FAILS THE BUILD if it
 * cannot, so this path is either correct or the build never shipped.
 */
export const MONACO_VS_PATH = '/monaco/vs'

/**
 * Point the loader at our own copy before anything can mount (AGL-1779).
 *
 * `@monaco-editor/loader` defaults to
 * `https://cdn.jsdelivr.net/npm/monaco-editor@<version>/min/vs` and `init()`
 * injects `<script src="${paths.vs}/loader.js">` into `document.body` with no
 * `integrity` and no `crossOrigin` — SRI is not reachable through that path at
 * all. That put an unpinned third-party script inside the `app.aglyn.com`
 * origin, with the session cookie, the DOM and every live Firestore listener
 * in scope, for anyone who could open Edit -> Raw JSON: any org member with
 * edit rights, site collaborators included. The console CSP allowed it — the
 * `script-src` carries a bare `https:` on purpose (`strict-dynamic` took
 * violations from 1 to 70), so a jsDelivr compromise was a console-origin XSS.
 *
 * Deliberately NOT wrapped in a try/catch and deliberately without a CDN
 * fallback: falling back would restore exactly the exposure this closes, and
 * would be invisible in every normal run because the local path wins.
 *
 * Module scope, not an effect: this module is `next/dynamic`-imported by
 * `json-editor.tsx`, so it is evaluated before the first `<ReactMonacoEditor>`
 * renders and therefore before `loader.init()` reads `state.config`.
 */
loader.config({ paths: { vs: MONACO_VS_PATH } })

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
