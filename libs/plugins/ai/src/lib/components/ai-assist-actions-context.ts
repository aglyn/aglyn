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

import type { NodeSchema } from '@aglyn/aglyn'
import { createContext } from 'react'

/**
 * The besigner doors the copy assistant's provider opens (AGL-89, AGL-169),
 * read by this plugin's own besigner controls (AGL-2984). A refused
 * permission publishes no callback, so the control for it is not drawn.
 */
export interface AiAssistActions {
  /** Opens the instruction dialog that rewrites an element's copy. */
  onRewrite?: (node: NodeSchema<any>) => void
  /** Opens the prompt dialog for a section grafted into the canvas root. */
  onGenerateSection?: () => void
}

export const AiAssistActionsContext = createContext<AiAssistActions>({})
AiAssistActionsContext.displayName = 'AiAssistActionsContext'
