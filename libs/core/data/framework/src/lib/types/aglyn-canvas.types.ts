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

import {
  type CanvasAddElementPayload,
  type CanvasDeleteElementPayload,
  type CanvasDuplicateElementPayload,
  type CanvasGetApiEventsPayload,
  type CanvasGetElementsDenormalizedPayload,
  type CanvasGetElementsNormalizedPayload,
  type CanvasMoveElementPayload,
  type CanvasRedoPayload,
  type CanvasSetElementPayload,
  type CanvasSetElementsPayload,
  type CanvasUndoPayload,
  type CanvasUpdateElementPayload,
} from '../constants/emitter'
import {type IAglynAppController} from './aglyn-app.types'
import {type ContextDomain, type ContextEvent, type ContextStore} from './aglyn-contexts.types'
import {
  type AglynElementNormalized,
  type AglynElementsById,
  type AglynElementsList,
} from './aglyn-elements.types'
import {
  type AglynModuleModelOptions,
  type AglynModuleModelT,
  type IAglynModuleModel,
} from './aglyn-module.types'


export type ElementsDataStore = {
  past: AglynElementsById[]
  present: AglynElementsById
  future: AglynElementsById[]
}

export interface ElementsDataStoreApi {
  undo: ContextEvent<any>
  redo: ContextEvent<any>
  setElements: ContextEvent<CanvasSetElementsPayload>
  addElement: ContextEvent<CanvasAddElementPayload>
  updateElement: ContextEvent<CanvasUpdateElementPayload>
  setElement: ContextEvent<CanvasSetElementPayload>
  deleteElement: ContextEvent<CanvasDeleteElementPayload>
  moveElement: ContextEvent<CanvasMoveElementPayload>
  duplicateElement: ContextEvent<CanvasDuplicateElementPayload>
}

export interface AglynCanvasControllerOptions extends AglynModuleModelOptions {
  initialElements: AglynElementNormalized[]
}

export interface IAglynCanvasController extends IAglynModuleModel<AglynCanvasControllerOptions> {
  readonly domain: ContextDomain
  readonly events: ElementsDataStoreApi
  readonly context: ContextStore<ElementsDataStore>
  readonly denormalizedElementsStore: ContextStore<AglynElementsById>
  readonly normalizedElementsStore: ContextStore<AglynElementsList>

  getStore(payload?: CanvasGetApiEventsPayload): ContextStore<ElementsDataStore>
  getApiEvents(payload?: CanvasGetApiEventsPayload): ElementsDataStoreApi
  getDenormalizedElementsStore(payload?: CanvasGetElementsDenormalizedPayload): ContextStore<AglynElementsById>
  getNormalizedElementsStore(payload?: CanvasGetElementsNormalizedPayload): ContextStore<AglynElementsList>

  undo(payload?: CanvasUndoPayload): this
  redo(payload?: CanvasRedoPayload): this

  setElements(payload: CanvasSetElementsPayload): this
  addElement(payload: CanvasAddElementPayload): this
  updateElement(payload: CanvasUpdateElementPayload): this
  setElement(payload: CanvasSetElementPayload): this
  deleteElement(payload: CanvasDeleteElementPayload): this
  moveElement(payload: CanvasMoveElementPayload): this
  duplicateElement(payload: CanvasDuplicateElementPayload): this
}

export interface AglynCanvasControllerT extends AglynModuleModelT<AglynCanvasControllerOptions> {
  new(app: IAglynAppController, options: AglynCanvasControllerOptions): IAglynCanvasController
}
