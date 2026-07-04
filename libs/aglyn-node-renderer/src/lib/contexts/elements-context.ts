/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import type {
  CanvasAddElementPayload,
  CanvasContext,
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasMoveElementPayload,
  CanvasSetElementPayload,
  CanvasSetElementsPayload,
  CanvasUpdateElementPayload,
  ContextEvent,
} from '@aglyn/aglyn'
import { createContext, useContext } from 'react'

export type UseElementsContextType = () => ElementsContextType

export interface ElementsContextType {
  elements: CanvasContext['present']
  redo: ContextEvent<any>
  undo: ContextEvent<any>
  addElement: ContextEvent<CanvasAddElementPayload>
  deleteElement: ContextEvent<CanvasDeleteElementPayload>
  duplicateElement: ContextEvent<CanvasDuplicateElementPayload>
  moveElement: ContextEvent<CanvasMoveElementPayload>
  setElement: ContextEvent<CanvasSetElementPayload>
  setElements: ContextEvent<CanvasSetElementsPayload>
  updateElement: ContextEvent<CanvasUpdateElementPayload>
}

export const ElementsContext = createContext<ElementsContextType>(null as unknown as ElementsContextType)
ElementsContext.displayName = 'ElementsContext'
ElementsContext.aglyn = true

// export const {
//   Provider: ElementsContextProvider,
//   Consumer: ElementsContextConsumer,
// } = ElementsContext

export const useElementsContext: UseElementsContextType = () => {
  return useContext(ElementsContext)
}

export default ElementsContext
