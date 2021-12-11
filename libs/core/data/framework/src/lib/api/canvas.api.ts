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

import { _INTERNAL_CANVAS_ } from '../constants/_internal'
import {
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
import { AglynAppController } from '../controllers/aglyn-app.controller'
import type { AglynCanvasController } from '../controllers/aglyn-canvas.controller'
import { _validateAppArg } from './app.api'


export function _getCanvasController(app: AglynAppController): AglynCanvasController {
  _validateAppArg(app)
  return _INTERNAL_CANVAS_.get(app.getName())
}


export function getCanvasStore(
  app: AglynAppController,
  payload?: CanvasGetStorePayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getStore(payload)
}

export function getCanvasNormalizedElementsStore(
  app: AglynAppController,
  payload?: CanvasGetElementsNormalizedPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getNormalizedElementsStore(payload)
}

export function getCanvasDenormalizedElementsStore(
  app: AglynAppController,
  payload?: CanvasGetElementsDenormalizedPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getDenormalizedElementsStore(payload)
}

export function getCanvasApiEvents(
  app: AglynAppController,
  payload?: CanvasGetApiEventsPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getApiEvents(payload)
}


export function canvasUndo(
  app: AglynAppController,
  payload: CanvasUndoPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.undo(payload)
}

export function canvasRedo(
  app: AglynAppController,
  payload: CanvasRedoPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.redo(payload)
}

export function setCanvasElements(
  app: AglynAppController,
  payload: CanvasSetElementsPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.setElements(payload)
}

export function addCanvasElement(
  app: AglynAppController,
  payload: CanvasAddElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.addElement(payload)
}

export function updateCanvasElement(
  app: AglynAppController,
  payload: CanvasUpdateElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.updateElement(payload)
}

export function deleteCanvasElement(
  app: AglynAppController,
  payload: CanvasDeleteElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.deleteElement(payload)
}

export function moveCanvasElement(
  app: AglynAppController,
  payload: CanvasMoveElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.moveElement(payload)
}

export function duplicateCanvasElement(
  app: AglynAppController,
  payload: CanvasDuplicateElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.duplicateElement(payload)
}

// export function getCanvasElement(
//   app: AglynAppController,
//   payload: CanvasAddElementPayload,
// ) {
//   const canvasController = _getCanvasController(app)
//   return canvasController.addElement(payload)
// }
