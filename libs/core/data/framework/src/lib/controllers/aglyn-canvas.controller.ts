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

import {createApi} from 'effector'
import {persist} from 'effector-storage/local'
import {CANVAS_ROOT_ELEMENT_ID} from '../constants/canvas'
import {
  type CanvasAddElementPayload,
  type CanvasDeleteElementPayload,
  type CanvasDuplicateElementPayload,
  type CanvasGetApiEventsPayload,
  type CanvasGetElementsDenormalizedPayload,
  type CanvasGetElementsNormalizedPayload,
  type CanvasGetStorePayload,
  type CanvasMoveElementPayload,
  type CanvasRedoPayload,
  type CanvasSetElementPayload,
  type CanvasSetElementsPayload,
  type CanvasUndoPayload,
  type CanvasUpdateElementPayload,
} from '../constants/emitter'
import {AglynModuleModel} from '../models/aglyn-module.model'
import {type IAglynAppController} from '../types/aglyn-app.types'
import {
  type AglynCanvasControllerOptions,
  type ElementsDataStore,
  type ElementsDataStoreApi,
  type IAglynCanvasController,
} from '../types/aglyn-canvas.types'
import {type ContextDomain, type ContextStore} from '../types/aglyn-contexts.types'
import {
  type AglynElementNormalized,
  type AglynElementsById,
  type AglynElementsList,
} from '../types/aglyn-elements.types'
import {type AglynModuleEffectListener} from '../types/aglyn-module.types'
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
  handleCanvasSetElement,
  handleCanvasSetElements,
  handleCanvasUpdateElement,
} from '../util/utils.canvas'


const TAG = 'AglynCanvas'
const NS = 'aglyn.core.data.framework.module.canvas'

export class AglynCanvasController extends AglynModuleModel<AglynCanvasControllerOptions> implements IAglynCanvasController {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly namespace: string = NS

  #domain: ContextDomain = null
  #context: ContextStore<ElementsDataStore> = null
  #events: ElementsDataStoreApi = null
  #denormalizedElementsStore: ContextStore<AglynElementsById> = null
  #normalizedElementsStore: ContextStore<AglynElementNormalized[]> = null

  public get domain(): ContextDomain {return this.#domain}
  public get events(): ElementsDataStoreApi {return this.#events}
  public get context(): ContextStore<ElementsDataStore> {return this.#context}
  public get denormalizedElementsStore(): ContextStore<AglynElementsById> {return this.#denormalizedElementsStore}
  public get normalizedElementsStore(): ContextStore<AglynElementsList> {return this.#normalizedElementsStore}

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return []
  }

  constructor(app: IAglynAppController, options: AglynCanvasControllerOptions) {
    super(app, options)
    this.#setup()
  }
  #setup() {
    this.#domain = this.app.contexts.domain.domain(this.namespace)

    this.#context = this.#domain.createStore<ElementsDataStore>({
      past: [] as AglynElementsById[],
      present: denormalizeComponentElementData(this.options.initialElements || [], CANVAS_ROOT_ELEMENT_ID),
      future: [] as AglynElementsById[],
    }, {name: `${this.namespace}:canvas-elements`})
    persist({store: this.#context})
    this.#denormalizedElementsStore = this.#context.map((elements) => {
      return elements.present
    })
    this.#normalizedElementsStore = this.#context.map((elements) => {
      return normalizeComponentElementData(elements.present, CANVAS_ROOT_ELEMENT_ID)
    })

    this.#events = createApi(this.#context, {
      undo: handleUndoEvent,
      redo: handleRedoEvent,
      setElements: handleCanvasApiChangeEvent(handleCanvasSetElements),
      addElement: handleCanvasApiChangeEvent(handleCanvasAddElement),
      updateElement: handleCanvasApiChangeEvent(handleCanvasUpdateElement),
      setElement: handleCanvasApiChangeEvent(handleCanvasSetElement),
      moveElement: handleCanvasApiChangeEvent(handleCanvasMoveElement),
      duplicateElement: handleCanvasApiChangeEvent(handleCanvasDuplicateElement),
      deleteElement: handleCanvasApiChangeEvent(handleCanvasDeleteElement),
    })
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      ...this.#context,
    }
  }

  public getStore(payload?: CanvasGetStorePayload): ContextStore<ElementsDataStore> {
    return this.#context
  }
  public getDenormalizedElementsStore(payload?: CanvasGetElementsDenormalizedPayload): ContextStore<AglynElementsById> {
    return this.#denormalizedElementsStore
  }
  public getNormalizedElementsStore(payload?: CanvasGetElementsNormalizedPayload): ContextStore<AglynElementsList> {
    return this.#normalizedElementsStore
  }
  public getApiEvents(payload?: CanvasGetApiEventsPayload): ElementsDataStoreApi {
    return this.#events
  }
  public undo(payload?: CanvasUndoPayload): this {
    this.#events.undo(payload)
    return this
  }
  public redo(payload?: CanvasRedoPayload): this {
    this.#events.undo(payload)
    return this
  }
  public setElements(payload: CanvasSetElementsPayload): this {
    this.#events.setElements(payload)
    return this
  }
  public addElement(payload: CanvasAddElementPayload): this {
    this.#events.addElement(payload)
    return this
  }
  public updateElement(payload: CanvasUpdateElementPayload): this {
    this.#events.updateElement(payload)
    return this
  }
  public setElement(payload: CanvasSetElementPayload): this {
    this.#events.setElement(payload)
    return this
  }
  public deleteElement(payload: CanvasDeleteElementPayload): this {
    this.#events.deleteElement(payload)
    return this
  }
  public moveElement(payload: CanvasMoveElementPayload): this {
    this.#events.deleteElement(payload)
    return this
  }
  public duplicateElement(payload: CanvasDuplicateElementPayload): this {
    this.#events.duplicateElement(payload)
    return this
  }
}

export default AglynCanvasController
