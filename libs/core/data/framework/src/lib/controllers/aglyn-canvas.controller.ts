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

import { _isArrEmpty } from '@aglyn/shared-util-guards'
import { arrayAddAtIndex } from '@aglyn/shared-util-tools'
import { objectDeepMerge } from '@aglyn/shared-util-vendor'
import { createApi, Event as EffectorEvent } from 'effector'
import {
  CanvasAddElementPayload,
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasGetApiEventsPayload,
  CanvasGetElementPayload,
  CanvasGetElementsDenormalizedPayload,
  CanvasGetElementsNormalizedPayload,
  CanvasGetStorePayload,
  CanvasMoveElementPayload,
  CanvasRedoPayload,
  CanvasSetElementsPayload,
  CanvasUndoPayload,
  CanvasUpdateElementPayload,
} from '../constants/emitter'
import {
  AglynModuleEffectListener,
  AglynModuleModel,
  AglynModuleModelOptions,
} from '../models/aglyn-module.model'
import { AglynComponentElementDataNormalizedMap } from '../types'
import { createComponentElementData } from '../util/create-component-element-data'
import { denormalizeComponentElementData } from '../util/denormalize-component-element-data'
import { normalizeComponentElementData } from '../util/normalize-component-element-data'
import { AglynComponentElementDataDenormalized } from './aglyn-components.controller'
import { ContextDomain, ContextStore } from './aglyn-contexts.controller'


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
  defaultElements: AglynComponentElementDataDenormalized[]
}

export interface AglynCanvasController extends AglynModuleModel<AglynCanvasControllerOptions> {
  getStore(payload?: CanvasGetApiEventsPayload)
  getNormalizedElementsStore(payload?: CanvasGetElementsNormalizedPayload)
  getDenormalizedElementsStore(payload?: CanvasGetElementsDenormalizedPayload)
  undo(payload?: CanvasUndoPayload)
  redo(payload?: CanvasRedoPayload)
  getApiEvents(payload?: CanvasGetApiEventsPayload)
  setElements(payload: CanvasSetElementsPayload)
  addElement(payload: CanvasAddElementPayload)
  getElement(payload: CanvasGetElementPayload)
  updateElement(payload: CanvasUpdateElementPayload)
  deleteElement(payload: CanvasDeleteElementPayload)
  moveElement(payload: CanvasMoveElementPayload)
  duplicateElement(payload: CanvasDuplicateElementPayload)
}

const MAX_HISTORY = 20
const TAG = 'AglynCanvas'
const MODULE_NAME = 'canvas'

export class AglynCanvasController extends AglynModuleModel<AglynCanvasControllerOptions> {

  public static readonly [Symbol.toStringTag]: string = TAG
  public static readonly moduleName: string = MODULE_NAME
  public static readonly childNs: string = MODULE_NAME

  #domain: ContextDomain = null
  #context: ContextStore<ElementsDataStore> = null
  #events: ElementsDataStoreApi = null
  #normalizedElementsStore: ContextStore<ElementsDataStore['present']> = null
  #denormalizedElementsStore: ContextStore<AglynComponentElementDataDenormalized[]> = null

  public get domain(): ContextDomain {return this.#domain}
  public get events(): ElementsDataStoreApi {return this.#events}
  public get context(): ContextStore<ElementsDataStore> {return this.#context}
  public get normalizedElementsStore(): ContextStore<ElementsDataStore['present']> {return this.#normalizedElementsStore}
  public get denormalizedElementsStore(): ContextStore<AglynComponentElementDataDenormalized[]> {return this.#denormalizedElementsStore}

  constructor(options) {
    super(options)
    this.#setup()
  }
  #setup() {
    this.#domain = this.app.contexts.domain.domain(this.moduleName)

    this.#context = this.#domain.createStore<ElementsDataStore>({
      past: [] as AglynComponentElementDataNormalizedMap[],
      present: normalizeComponentElementData(this.options.defaultElements || [], '__root__'),
      future: [] as AglynComponentElementDataNormalizedMap[],
    })
    this.#normalizedElementsStore = this.#context.map((elements) => {
      return elements.present
    })
    this.#denormalizedElementsStore = this.#context.map((elements) => {
      return denormalizeComponentElementData(elements.present, '__root__')
    })

    const undo = (state: ElementsDataStore) => {
      if (!_isArrEmpty(state.past)) {
        return {
          past: state.past.slice(1),
          present: state.past.slice(0, 1)[0],
          future: [state.present, ...state.future],
        }
      }
    }

    const redo = (state: ElementsDataStore) => {
      if (!_isArrEmpty(state.future)) {
        return {
          past: [state.present, ...state.past],
          present: state.future.slice(0, 1)[0],
          future: state.future.slice(1),
        }
      }
    }

    const setElements = (state: ElementsDataStore, payload: CanvasSetElementsPayload) => {
      const {elements} = payload
      return {
        past: [state.present, ...state.past].slice(0, MAX_HISTORY),
        present: elements,
        future: [],
      }
    }

    const addElement = (state: ElementsDataStore, payload: CanvasAddElementPayload) => {
      const {element, parentId, position} = payload
      const newData = normalizeComponentElementData(element, parentId)
      const present = {
        ...state.present,
        ...newData,
        [parentId]: {
          ...state.present[parentId],
          elements: arrayAddAtIndex(
            position,
            state.present[parentId]?.elements || [],
            newData[parentId]?.elements || [],
            {copy: true},
          ).items,
        },
      }

      return {
        past: [state.present, ...state.past].slice(0, MAX_HISTORY),
        present,
        future: [],
      }
    }

    const updateElement = (state: ElementsDataStore, payload: CanvasUpdateElementPayload) => {
      const {element: {props, ...element}} = payload
      const present = {
        ...state.present,
        [element.$id]: {
          ...objectDeepMerge(state.present[element.$id], element),
          props,
        },
      }

      return {
        past: [state.present, ...state.past].slice(0, MAX_HISTORY),
        present,
        future: [],
      }
    }

    const moveElement = (state: ElementsDataStore, payload: CanvasMoveElementPayload) => {
      const {$id, position, parentId} = payload
      const current = state.present[$id]
      const present = {
        ...state.present,
        [$id]: {
          ...state.present[$id],
          parentId: parentId,
        },
        [parentId]: {
          ...state.present[parentId],
          elements: arrayAddAtIndex(
            position,
            state.present[parentId].elements || [],
            $id,
            {copy: true},
          ).items,
        },
        [current.parentId]: {
          ...state.present[current.parentId],
          elements: (state.present[current.parentId].elements || []).filter(i => i !== $id),
        },
      }

      return {
        past: [state.present, ...state.past].slice(0, MAX_HISTORY),
        present,
        future: [],
      }
    }

    const duplicateElement = (state: ElementsDataStore, payload: CanvasDuplicateElementPayload) => {
      const {$id} = payload
      const element = state.present[$id]
      const parentElements = denormalizeComponentElementData(state.present, element.parentId)
      let position = parentElements.length - 1
      const denormalizedElement = parentElements.find((i, index) => {
        if (i.$id === $id) {
          position = index
          console.log('denormalizedElement', i)
          return true
        }
        return false
      })
      const newElement = createComponentElementData({data: denormalizedElement})
      return addElement(state, {
        element: newElement,
        parentId: element.parentId,
        position: position + 1,
      })
    }

    const deleteElement = (state: ElementsDataStore, payload: CanvasDeleteElementPayload) => {
      const {$id} = payload
      const current = state.present[$id]
      const present = {
        ...state.present,
        [current.parentId]: {
          ...state.present[current.parentId],
          elements: (state.present[current.parentId].elements || []).filter(i => i !== $id),
        },
      }
      delete present[$id]

      return {
        past: [state.present, ...state.past].slice(0, MAX_HISTORY),
        present,
        future: [],
      }
    }

    this.#events = createApi(this.#context, {
      undo,
      redo,
      setElements,
      addElement,
      updateElement,
      deleteElement,
      moveElement,
      duplicateElement,
    })
  }

  public getStore(payload: CanvasGetStorePayload) {
    return this.#context
  }

  public getNormalizedElementsStore(payload: CanvasGetElementsNormalizedPayload) {
    return this.#normalizedElementsStore
  }

  public getDenormalizedElementsStore(payload: CanvasGetElementsDenormalizedPayload) {
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

export type AglynCanvasControllerT = typeof AglynCanvasController
export default AglynCanvasController
