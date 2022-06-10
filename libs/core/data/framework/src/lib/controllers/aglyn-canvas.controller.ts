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

import {copy} from '@aglyn/shared-util-tools'
import defaultsDeep from 'lodash-es/defaultsDeep'
import isEqual from 'lodash-es/isEqual'
import {BehaviorSubject, Observable} from 'rxjs'
import {map} from 'rxjs/operators'
import {CANVAS_ROOT_ELEMENT_ID} from '../constants/canvas'
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
import type {IAglynAppController} from '../definitions/aglyn-app.types'
import type {
  AglynCanvasControllerOptions,
  CanvasContext,
  IAglynCanvasController,
} from '../definitions/aglyn-canvas.types'
import type {AglynElementsDenormalized} from '../definitions/aglyn-elements.types'
import type {AglynModuleEffectListener} from '../definitions/aglyn-module.types'
import {AglynModuleModel} from '../models/aglyn-module.model'
import denormalizeComponentElementData from '../util/denormalize-component-element-data'
import handleStateModificationHistoryChange from '../util/handle-state-modification-history-change'
import handleStateModificationHistoryRedo from '../util/handle-state-modification-history-redo'
import handleStateModificationHistoryUndo from '../util/handle-state-modification-history-undo'
import normalizeComponentElementData from '../util/normalize-component-element-data'
import {
  handleCanvasAddElement,
  handleCanvasDeleteElement,
  handleCanvasDuplicateElement,
  handleCanvasMoveElement,
  handleCanvasSetElement,
  handleCanvasSetElements,
  handleCanvasUpdateElement,
} from '../util/utils.canvas'


const TAG = 'AglynCanvas'
const NS = 'com.aglyn.core.data.framework.controller.canvas'

export class AglynCanvasController extends AglynModuleModel<AglynCanvasControllerOptions> implements IAglynCanvasController {

  public static get [Symbol.toStringTag](): string {return TAG}
  public static get namespace(): string {return NS}

  public readonly __store__: {
    [K in keyof CanvasContext]: K extends 'normalized'
      ? Observable<CanvasContext[K]>
      : BehaviorSubject<CanvasContext[K]>
  }

  public get pastElements(): this['__store__']['past'] {
    return this.__store__?.past
  }
  public get futureElements(): this['__store__']['future'] {
    return this.__store__?.future
  }
  public get presentElements(): this['__store__']['present'] {
    return this.__store__?.present
  }
  public get denormalizedElements(): this['__store__']['present'] {
    return this.__store__?.present
  }
  public get normalizedElements(): this['__store__']['normalized'] {
    return this.__store__?.normalized
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return []
  }

  constructor(app: IAglynAppController, options: AglynCanvasControllerOptions) {
    super(app, options)
    const state = defaultsDeep(
      options.defaults || {},
      {
        past: [],
        future: [],
        present: [],
      },
    )

    const present = new BehaviorSubject(
      denormalizeComponentElementData(
        state.present || [],
        CANVAS_ROOT_ELEMENT_ID,
      ),
    )

    this.__store__ = {
      past: new BehaviorSubject(state.past),
      future: new BehaviorSubject(state.future),
      present: present,
      normalized: present.pipe(
        // throttleTime(20, undefined, {leading: false, trailing: true}),
        map((present) => normalizeComponentElementData(present || {}, CANVAS_ROOT_ELEMENT_ID)),
      ),
    }

    this.#setup()
  }
  #setup() {}

  public toJSON() {
    return {
      ...super.toJSON(),
    }
  }

  public getStore<K extends keyof CanvasContext>(payload: CanvasGetStorePayload<K>): this['__store__'][K] {
    const {store} = payload
    return this.__store__?.[store]
  }
  public getState(payload?: CanvasGetStatePayload): CanvasContext {
    return {
      past: this.__store__?.past?.getValue(),
      future: this.__store__?.future?.getValue(),
      present: this.__store__?.present?.getValue(),
    }
  }
  public nextState(payload: CanvasNextStatePayload): this {
    const {past, future, present} = payload
    this.__store__?.past?.next(past)
    this.__store__?.future?.next(future)
    this.__store__?.present?.next(present)
    return this
  }
  private handleStateModification<P>(
    callback: (present: AglynElementsDenormalized, payload?: P) => AglynElementsDenormalized,
    payload?: P,
  ) {
    const state = this.getState()
    const prev = state.present
    const now = callback(copy(prev), payload)
    const updated = handleStateModificationHistoryChange(state, now)
    !this.isDeepEqual(prev, now) && this.nextState(updated)
    return this
  }
  private isDeepEqual<T>(prev: unknown, now: T): prev is T {
    return isEqual(prev, now)
  }

  public getPastElements(payload?: CanvasGetElementsPastPayload): this['__store__']['past'] {
    return this.__store__?.['past']
  }
  public getFutureElements(payload?: CanvasGetElementsFuturePayload): this['__store__']['future'] {
    return this.__store__?.['future']
  }
  public getPresentElements(payload?: CanvasGetElementsPresentPayload): this['__store__']['present'] {
    return this.__store__?.['present']
  }
  public getDenormalizedElements(payload?: CanvasGetElementsDenormalizedPayload): this['__store__']['present'] {
    return this.__store__?.['present']
  }
  public getNormalizedElements(payload?: CanvasGetElementsNormalizedPayload): this['__store__']['normalized'] {
    return this.__store__?.['normalized']
  }
  public getApi(payload?: CanvasGetElementsNormalizedPayload): Pick<this,
    'undo' |
    'redo' |
    'addElement' |
    'deleteElement' |
    'duplicateElement' |
    'moveElement' |
    'setElement' |
    'setElements' |
    'updateElement'> {
    return {
      undo: this.undo.bind(this),
      redo: this.redo.bind(this),
      addElement: this.addElement.bind(this),
      deleteElement: this.deleteElement.bind(this),
      duplicateElement: this.duplicateElement.bind(this),
      moveElement: this.moveElement.bind(this),
      setElement: this.setElement.bind(this),
      setElements: this.setElements.bind(this),
      updateElement: this.updateElement.bind(this),
    }
  }


  public undo(payload?: CanvasUndoPayload): this {
    this.nextState(handleStateModificationHistoryUndo(this.getState()))
    return this
  }
  public redo(payload?: CanvasRedoPayload): this {
    this.nextState(handleStateModificationHistoryRedo(this.getState()))
    return this
  }
  public addElement(payload: CanvasAddElementPayload): this {
    return this.handleStateModification(handleCanvasAddElement, payload)
  }
  public deleteElement(payload: CanvasDeleteElementPayload): this {
    return this.handleStateModification(handleCanvasDeleteElement, payload)
  }
  public duplicateElement(payload: CanvasDuplicateElementPayload): this {
    return this.handleStateModification(handleCanvasDuplicateElement, payload)
  }
  public moveElement(payload: CanvasMoveElementPayload): this {
    return this.handleStateModification(handleCanvasMoveElement, payload)
  }
  public setElement(payload: CanvasSetElementPayload): this {
    return this.handleStateModification(handleCanvasSetElement, payload)
  }
  public setElements(payload: CanvasSetElementsPayload): this {
    return this.handleStateModification(handleCanvasSetElements, payload)
  }
  public updateElement(payload: CanvasUpdateElementPayload): this {
    return this.handleStateModification(handleCanvasUpdateElement, payload)
  }
}

export default AglynCanvasController
