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
 * Aglyn Assist's mount point, one module for both shells (AGL-2706).
 *
 * The `(app)` and `(editor)` layouts each mount the assistant above every
 * route boundary, which is the whole point of where it sits — and it means
 * the chat panel, its `Drawer`, `Collapse` and `Tooltip`, and the docs and
 * entitlement helpers behind them were in the first paint of every console
 * page. None of it can draw before the client has resolved the release flag
 * and the URL's workspace, so `ssr: false` states what the component's own
 * `verdict.visible && scopedOrgId` gate already decided, and puts the panel
 * in a chunk fetched when that gate says yes.
 *
 * Both layouts import THIS module rather than calling `dynamic()` twice, so
 * the two shells share one chunk instead of racing to define two.
 */
const AssistPanelMount = dynamic(() => import('./assist-panel.component'), {
  ssr: false,
})

export default AssistPanelMount
