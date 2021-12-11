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

import { _INTERNAL_BESIGNERS_ } from '../constants/_internal'
import type {
  BesignerClosePanelPayload,
  BesignerFlagInteractModePayload,
  BesignerGetStorePayload,
  BesignerOpenPanelPayload,
  BesignerSetCanvasHoveredPayload,
  BesignerSetCanvasSelectedPayload,
  BesignerSetPanelPayload,
} from '../constants/emitter'
import type { AglynAppController } from '../controllers/aglyn-app.controller'
import type {
  AglynBesignerController,
  BesignerContextStores,
} from '../controllers/aglyn-besigner.controller'
import type { ContextStore } from '../controllers/aglyn-contexts.controller'
import { _validateAppArg } from './app.api'


export function _getBesignerController(app: AglynAppController): AglynBesignerController {
  _validateAppArg(app)
  return _INTERNAL_BESIGNERS_.get(app.getName())
}

export function getBesignerStore<K extends keyof BesignerContextStores>(
  app: AglynAppController,
  payload: BesignerGetStorePayload<K>,
): ContextStore<BesignerContextStores[K]> {
  const besignerController = _getBesignerController(app)
  return besignerController.getStore(payload)
}

export function setBesignerFlag(
  app: AglynAppController,
  payload: BesignerFlagInteractModePayload,
) {
  const besignerController = _getBesignerController(app)
  return besignerController.setFlag(payload)
}

export function setBesignerPanels(
  app: AglynAppController,
  payload: BesignerSetPanelPayload,
) {
  const besignerController = _getBesignerController(app)
  return besignerController.setPanels(payload)
}

export function openBesignerPanel(
  app: AglynAppController,
  payload: BesignerOpenPanelPayload,
) {
  const besignerController = _getBesignerController(app)
  return besignerController.openPanel(payload)
}

export function closeBesignerPanel(
  app: AglynAppController,
  payload: BesignerClosePanelPayload,
) {
  const besignerController = _getBesignerController(app)
  return besignerController.closePanel(payload)
}

export function setBesignerCanvasSelected(
  app: AglynAppController,
  payload?: BesignerSetCanvasSelectedPayload,
) {
  const besignerController = _getBesignerController(app)
  return besignerController.setCanvasSelected(payload)
}

export function setBesignerCanvasHovered(
  app: AglynAppController,
  payload?: BesignerSetCanvasHoveredPayload,
) {
  const besignerController = _getBesignerController(app)
  return besignerController.setCanvasHovered(payload)
}
