/**
 * @license
 * Copyright 2021 Aglyn LLC
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
  type CanvasSetElementsPayload,
  type CanvasUndoPayload,
  type CanvasUpdateElementPayload,
} from '../constants/emitter'
import {
  type AglynModuleModelOptions,
  type AglynModuleModelT,
  type IAglynModuleModel,
} from '../models/aglyn-module.types'
import {type IAglynAppController} from './aglyn-app.types'
import {
  type AglynComponentElementDataDenormalized,
  type AglynComponentElementDataDenormalizedList,
  type AglynComponentElementDataNormalizedMap,
} from './aglyn-components.types'
import {type ContextDomain, type ContextEvent, type ContextStore} from './aglyn-contexts.types'


export type ElementsDataStore = {
  past: AglynComponentElementDataNormalizedMap[]
  present: AglynComponentElementDataNormalizedMap
  future: AglynComponentElementDataNormalizedMap[]
}

export interface ElementsDataStoreApi {
  undo: ContextEvent<any>
  redo: ContextEvent<any>
  setElements: ContextEvent<CanvasSetElementsPayload>
  addElement: ContextEvent<CanvasAddElementPayload>
  updateElement: ContextEvent<CanvasUpdateElementPayload>
  deleteElement: ContextEvent<CanvasDeleteElementPayload>
  moveElement: ContextEvent<CanvasMoveElementPayload>
  duplicateElement: ContextEvent<CanvasDuplicateElementPayload>
}

export interface AglynCanvasControllerOptions extends AglynModuleModelOptions {
  initialElements: AglynComponentElementDataDenormalized[]
}

export interface IAglynCanvasController extends IAglynModuleModel<AglynCanvasControllerOptions> {
  readonly domain: ContextDomain
  readonly events: ElementsDataStoreApi
  readonly context: ContextStore<ElementsDataStore>
  readonly normalizedElementsStore: ContextStore<AglynComponentElementDataNormalizedMap>
  readonly denormalizedElementsStore: ContextStore<AglynComponentElementDataDenormalizedList>

  getStore(payload?: CanvasGetApiEventsPayload)
  getApiEvents(payload?: CanvasGetApiEventsPayload)
  getNormalizedElementsStore(payload?: CanvasGetElementsNormalizedPayload): ContextStore<AglynComponentElementDataNormalizedMap>
  getDenormalizedElementsStore(payload?: CanvasGetElementsDenormalizedPayload): ContextStore<AglynComponentElementDataDenormalizedList>

  undo(payload?: CanvasUndoPayload)
  redo(payload?: CanvasRedoPayload)

  setElements(payload: CanvasSetElementsPayload)
  addElement(payload: CanvasAddElementPayload)
  updateElement(payload: CanvasUpdateElementPayload)
  deleteElement(payload: CanvasDeleteElementPayload)
  moveElement(payload: CanvasMoveElementPayload)
  duplicateElement(payload: CanvasDuplicateElementPayload)
}

export interface AglynCanvasControllerT extends AglynModuleModelT<AglynCanvasControllerOptions> {
  new(app: IAglynAppController, options: AglynCanvasControllerOptions): IAglynCanvasController
}
