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

import type {BehaviorSubject, Observable} from 'rxjs'
import type {
  CanvasAddElementPayload,
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasGetElementsDenormalizedPayload,
  CanvasGetElementsFuturePayload,
  CanvasGetElementsNormalizedPayload,
  CanvasGetElementsPastPayload,
  CanvasGetElementsPresentPayload,
  CanvasGetStatePayload,
  CanvasGetStorePayload,
  CanvasMoveElementPayload,
  CanvasNextStatePayload,
  CanvasRedoPayload,
  CanvasSetElementPayload,
  CanvasSetElementsPayload,
  CanvasUndoPayload,
  CanvasUpdateElementPayload,
} from '../constants/emitter'
import type {IAglynAppController} from './aglyn-app.types'
import type {ContextEvent} from './aglyn-contexts.types'
import type {AglynElementsDenormalized, AglynElementsNormalized} from './aglyn-elements.types'
import type {
  AglynModuleModelOptions,
  AglynModuleModelT,
  IAglynModuleModel,
} from './aglyn-module.types'


export type CanvasContext = {
  future: AglynElementsDenormalized[]
  past: AglynElementsDenormalized[]
  present: AglynElementsDenormalized
  readonly normalized?: AglynElementsNormalized
}

export interface ElementsDataStoreApi {
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

export interface AglynCanvasControllerOptions extends AglynModuleModelOptions {
  defaults?: {
    present?: AglynElementsNormalized
  }
}

export interface IAglynCanvasController extends IAglynModuleModel<AglynCanvasControllerOptions> {
  readonly __store__: {
    [K in keyof CanvasContext]: K extends 'normalized'
      ? Observable<CanvasContext[K]>
      : BehaviorSubject<CanvasContext[K]>
  }
  readonly pastElements: this['__store__']['past']
  readonly futureElements: this['__store__']['future']
  readonly presentElements: this['__store__']['present']
  readonly denormalizedElements: this['__store__']['present']
  readonly normalizedElements: this['__store__']['normalized']

  getStore<K extends keyof CanvasContext>(payload: CanvasGetStorePayload<K>): this['__store__'][K]
  getState(payload?: CanvasGetStatePayload): CanvasContext
  nextState(payload: CanvasNextStatePayload): this

  getPastElements(payload?: CanvasGetElementsPastPayload): this['__store__']['past']
  getFutureElements(payload?: CanvasGetElementsFuturePayload): this['__store__']['future']
  getPresentElements(payload?: CanvasGetElementsPresentPayload): this['__store__']['present']
  getDenormalizedElements(payload?: CanvasGetElementsDenormalizedPayload): this['__store__']['present']
  getNormalizedElements(payload?: CanvasGetElementsNormalizedPayload): this['__store__']['normalized']
  getApi(payload?: CanvasGetElementsNormalizedPayload): Pick<this,
    'undo' |
    'redo' |
    'addElement' |
    'deleteElement' |
    'duplicateElement' |
    'moveElement' |
    'setElement' |
    'setElements' |
    'updateElement'>

  undo(payload?: CanvasUndoPayload): this
  redo(payload?: CanvasRedoPayload): this

  addElement(payload: CanvasAddElementPayload): this
  deleteElement(payload: CanvasDeleteElementPayload): this
  duplicateElement(payload: CanvasDuplicateElementPayload): this
  moveElement(payload: CanvasMoveElementPayload): this
  setElement(payload: CanvasSetElementPayload): this
  setElements(payload: CanvasSetElementsPayload): this
  updateElement(payload: CanvasUpdateElementPayload): this
}

export interface AglynCanvasControllerT extends AglynModuleModelT<AglynCanvasControllerOptions> {
  new(app: IAglynAppController, options: AglynCanvasControllerOptions): IAglynCanvasController
}
