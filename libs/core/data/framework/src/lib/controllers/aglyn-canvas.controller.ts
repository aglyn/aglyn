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

import {createApi} from 'effector'
import {persist} from 'effector-storage/local'
import {CANVAS_ROOT_ELEMENT_ID} from '../constants/canvas'
import type {
  CanvasAddElementPayload,
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasGetApiEventsPayload,
  CanvasGetElementsDenormalizedPayload,
  CanvasGetElementsNormalizedPayload,
  CanvasGetStorePayload,
  CanvasMoveElementPayload,
  CanvasRedoPayload,
  CanvasSetElementsPayload,
  CanvasUndoPayload,
  CanvasUpdateElementPayload,
} from '../constants/emitter'
import AglynModuleModel from '../models/aglyn-module.model'
import type {AglynModuleEffectListener} from '../models/aglyn-module.types'
import type {
  AglynComponentElementDataNormalizedArray,
  AglynComponentElementDataNormalizedMap,
} from '../types'
import {denormalizeComponentElementData} from '../util/denormalize-component-element-data'
import {handleRedoEvent} from '../util/handle-state-modification-history-redo'
import {handleUndoEvent} from '../util/handle-state-modification-history-undo'
import {normalizeComponentElementData} from '../util/normalize-component-element-data'
import {
  handleCanvasAddElement,
  handleCanvasApiChangeEvent,
  handleCanvasDeleteElement,
  handleCanvasDuplicateElement,
  handleCanvasMoveElement,
  handleCanvasSetElements,
  handleCanvasUpdateElement,
} from '../util/utils.canvas'
import type {IAglynAppController} from './aglyn-app.types'
import type {
  AglynCanvasControllerOptions,
  ElementsDataStore,
  ElementsDataStoreApi,
  IAglynCanvasController,
} from './aglyn-canvas.types'
import type {AglynComponentElementDataDenormalized} from './aglyn-components.types'
import {ContextDomain, ContextStore} from './aglyn-contexts.types'


const TAG = 'AglynCanvas'
const MODULE_NAME = 'canvas'

export class AglynCanvasController extends AglynModuleModel<AglynCanvasControllerOptions> implements IAglynCanvasController {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = `aglyn:${MODULE_NAME}`
  public static readonly moduleName: string = MODULE_NAME

  #domain: ContextDomain = null
  #context: ContextStore<ElementsDataStore> = null
  #events: ElementsDataStoreApi = null
  #normalizedElementsStore: ContextStore<AglynComponentElementDataNormalizedMap> = null
  #denormalizedElementsStore: ContextStore<AglynComponentElementDataDenormalized[]> = null

  public get domain(): ContextDomain {return this.#domain}
  public get events(): ElementsDataStoreApi {return this.#events}
  public get context(): ContextStore<ElementsDataStore> {return this.#context}
  public get normalizedElementsStore(): ContextStore<AglynComponentElementDataNormalizedMap> {return this.#normalizedElementsStore}
  public get denormalizedElementsStore(): ContextStore<AglynComponentElementDataNormalizedArray> {return this.#denormalizedElementsStore}

  constructor(app: IAglynAppController, options: AglynCanvasControllerOptions) {
    super(app, options)
    this.#setup()
  }
  #setup() {
    this.#domain = this.app.contexts.domain.domain(this.moduleName)

    this.#context = this.#domain.createStore<ElementsDataStore>({
      past: [] as AglynComponentElementDataNormalizedMap[],
      present: normalizeComponentElementData(this.options.initialElements || [], CANVAS_ROOT_ELEMENT_ID),
      future: [] as AglynComponentElementDataNormalizedMap[],
    }, {name: `${this.namespace}:canvas-elements`})
    persist({store: this.#context})
    this.#normalizedElementsStore = this.#context.map((elements) => {
      return elements.present
    })
    this.#denormalizedElementsStore = this.#context.map((elements) => {
      return denormalizeComponentElementData(elements.present, CANVAS_ROOT_ELEMENT_ID)
    })

    this.#events = createApi(this.#context, {
      undo: handleUndoEvent,
      redo: handleRedoEvent,
      setElements: handleCanvasApiChangeEvent(handleCanvasSetElements),
      addElement: handleCanvasApiChangeEvent(handleCanvasAddElement),
      updateElement: handleCanvasApiChangeEvent(handleCanvasUpdateElement),
      moveElement: handleCanvasApiChangeEvent(handleCanvasMoveElement),
      duplicateElement: handleCanvasApiChangeEvent(handleCanvasDuplicateElement),
      deleteElement: handleCanvasApiChangeEvent(handleCanvasDeleteElement),
    })
  }

  public getStore(payload?: CanvasGetStorePayload) {
    return this.#context
  }

  public getNormalizedElementsStore(payload?: CanvasGetElementsNormalizedPayload) {
    return this.#normalizedElementsStore
  }

  public getDenormalizedElementsStore(payload?: CanvasGetElementsDenormalizedPayload) {
    return this.#denormalizedElementsStore
  }

  public getApiEvents(payload?: CanvasGetApiEventsPayload) {
    return this.#events
  }

  public undo(payload?: CanvasUndoPayload) {
    return this.#events.undo(payload)
  }

  public redo(payload?: CanvasRedoPayload) {
    return this.#events.undo(payload)
  }

  public setElements(payload: CanvasSetElementsPayload) {
    return this.#events.setElements(payload)
  }

  public addElement(payload: CanvasAddElementPayload) {
    return this.#events.addElement(payload)
  }

  public updateElement(payload: CanvasUpdateElementPayload) {
    return this.#events.updateElement(payload)
  }

  public deleteElement(payload: CanvasDeleteElementPayload) {
    return this.#events.deleteElement(payload)
  }

  public moveElement(payload: CanvasMoveElementPayload) {
    return this.#events.deleteElement(payload)
  }

  public duplicateElement(payload: CanvasDuplicateElementPayload) {
    return this.#events.duplicateElement(payload)
  }


  public toJSON() {
    return {
      ...super.toJSON(),
      ...this.#context,
    }
  }

  protected listeners: AglynModuleEffectListener<any>[] = []
}

export default AglynCanvasController
