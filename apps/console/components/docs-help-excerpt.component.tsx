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

import dynamic from 'next/dynamic'

/**
 * A help topic's tooltip prose, in a chunk fetched when a tooltip first opens
 * (AGL-2706).
 *
 * The 147 excerpts are ~20 KB of English, and every console page carried them:
 * `DocsHelpTip` sits in the shell, and `docsHelp()` is called by cards and
 * page headers throughout. Nothing reads an excerpt until someone hovers a
 * `?`, and a tooltip's content mounts only when it opens — so `ssr: false`
 * states what MUI's popper already decided, and the prose leaves the first
 * paint.
 *
 * What does NOT move is the path and the title. The path is the help button's
 * own `href` and the title its accessible name, so a deferred registry would
 * ship a link with nowhere to go and a control screen readers announce as
 * "button". Those stay in `docs-help.generated.ts`, synchronous.
 *
 * Every call site imports THIS module rather than calling `dynamic()` itself,
 * so one chunk serves them all — the reason `assist-panel-mount.component.tsx`
 * gives beside it.
 */
const DocsHelpExcerpt = dynamic(
  () => import('./docs-help-excerpt-text.component'),
  { ssr: false },
)

export default DocsHelpExcerpt
