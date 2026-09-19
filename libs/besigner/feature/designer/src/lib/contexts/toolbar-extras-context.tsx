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

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Controls the host app adds to the besigner's secondary toolbar, after the
 * undo and redo controls (AGL-2984).
 *
 * The designer stays free of console imports the way the Attributes panel's
 * section does: the console supplies the node — its plugin widget slot,
 * rendered with the shell's own gates — and the toolbar draws whatever
 * arrives, and nothing when the host supplied nothing. Nothing here knows
 * what a plugin is.
 */
export const BesignerToolbarExtrasContext = createContext<ReactNode>(null)
BesignerToolbarExtrasContext.displayName = 'BesignerToolbarExtrasContext'

/** The host-supplied controls, or `null` when the host supplied nothing. */
export function useBesignerToolbarExtras(): ReactNode {
  return useContext(BesignerToolbarExtrasContext)
}

export default BesignerToolbarExtrasContext
