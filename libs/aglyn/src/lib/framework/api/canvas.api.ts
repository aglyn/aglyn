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
  CanvasDeleteElementPayload,
  CanvasDuplicateElementPayload,
  CanvasGetApiEventsPayload,
  CanvasGetElementsDenormalizedPayload,
  CanvasGetElementsNormalizedPayload,
  CanvasGetStorePayload,
  CanvasMoveElementPayload,
  CanvasRedoPayload,
  CanvasSetElementPayload,
  CanvasSetElementsPayload,
  CanvasUndoPayload,
  CanvasUpdateElementPayload,
  IAglynAppController,
  IAglynCanvasController,
} from '../../foundation'
import { _INTERNAL_CANVAS_ } from '../../foundation'
import { _validateAppArg } from './app.api'

export function _getCanvasController(
  app: IAglynAppController,
): IAglynCanvasController {
  _validateAppArg(app)
  return _INTERNAL_CANVAS_.get(app.getName())
}

export function getCanvasStore(
  app: IAglynAppController,
  payload?: CanvasGetStorePayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getStore(payload)
}

export function getCanvasNormalizedNodesStore(
  app: IAglynAppController,
  payload?: CanvasGetElementsNormalizedPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getNormalizedElements(payload)
}

export function getCanvasDenormalizedNodesStore(
  app: IAglynAppController,
  payload?: CanvasGetElementsDenormalizedPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getDenormalizedElements(payload)
}

export function getCanvasApiEvents(
  app: IAglynAppController,
  payload?: CanvasGetApiEventsPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.getApi(payload)
}

export function canvasUndo(
  app: IAglynAppController,
  payload: CanvasUndoPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.undo(payload)
}

export function canvasRedo(
  app: IAglynAppController,
  payload: CanvasRedoPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.redo(payload)
}

export function setCanvasElements(
  app: IAglynAppController,
  payload: CanvasSetElementsPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.setElements(payload)
}

export function addCanvasElement(
  app: IAglynAppController,
  payload: CanvasAddElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.addElement(payload)
}

export function updateCanvasElement(
  app: IAglynAppController,
  payload: CanvasUpdateElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.updateElement(payload)
}

export function setCanvasElement(
  app: IAglynAppController,
  payload: CanvasSetElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.setElement(payload)
}

export function deleteCanvasElement(
  app: IAglynAppController,
  payload: CanvasDeleteElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.deleteElement(payload)
}

export function moveCanvasElement(
  app: IAglynAppController,
  payload: CanvasMoveElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.moveElement(payload)
}

export function duplicateCanvasElement(
  app: IAglynAppController,
  payload: CanvasDuplicateElementPayload,
) {
  const canvasController = _getCanvasController(app)
  return canvasController.duplicateElement(payload)
}
