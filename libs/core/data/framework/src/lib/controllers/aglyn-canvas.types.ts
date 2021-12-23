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

import type {Event as EffectorEvent} from 'effector/effector.cjs'
import type {
  CanvasAddElementPayload,
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasGetApiEventsPayload,
  CanvasGetElementsDenormalizedPayload,
  CanvasGetElementsNormalizedPayload,
  CanvasMoveElementPayload,
  CanvasRedoPayload,
  CanvasSetElementsPayload,
  CanvasUndoPayload,
  CanvasUpdateElementPayload,
} from '../constants/emitter'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from '../models/aglyn-module.types'
import type {
  AglynComponentElementDataNormalizedArray,
  AglynComponentElementDataNormalizedMap,
} from '../types'
import type {IAglynAppController} from './aglyn-app.types'
import type {AglynComponentElementDataDenormalized} from './aglyn-components.types'
import type {ContextDomain, ContextStore} from './aglyn-contexts.types'


export type ElementsDataStore = {
  past: AglynComponentElementDataNormalizedMap[]
  present: AglynComponentElementDataNormalizedMap
  future: AglynComponentElementDataNormalizedMap[]
}

export interface ElementsDataStoreApi {
  undo: EffectorEvent<any>
  redo: EffectorEvent<any>
  setElements: EffectorEvent<CanvasSetElementsPayload>
  addElement: EffectorEvent<CanvasAddElementPayload>
  updateElement: EffectorEvent<CanvasUpdateElementPayload>
  deleteElement: EffectorEvent<CanvasDeleteElementPayload>
  moveElement: EffectorEvent<CanvasMoveElementPayload>
  duplicateElement: EffectorEvent<CanvasDuplicateElementPayload>
}

export interface AglynCanvasControllerOptions extends AglynModuleModelOptions {
  initialElements: AglynComponentElementDataDenormalized[]
}

export interface IAglynCanvasController extends IAglynModuleModel<AglynCanvasControllerOptions> {
  readonly domain: ContextDomain
  readonly events: ElementsDataStoreApi
  readonly context: ContextStore<ElementsDataStore>
  readonly normalizedElementsStore: ContextStore<AglynComponentElementDataNormalizedMap>
  readonly denormalizedElementsStore: ContextStore<AglynComponentElementDataNormalizedArray>

  getStore(payload?: CanvasGetApiEventsPayload)
  getNormalizedElementsStore(payload?: CanvasGetElementsNormalizedPayload)
  getDenormalizedElementsStore(payload?: CanvasGetElementsDenormalizedPayload)
  undo(payload?: CanvasUndoPayload)
  redo(payload?: CanvasRedoPayload)
  getApiEvents(payload?: CanvasGetApiEventsPayload)
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
