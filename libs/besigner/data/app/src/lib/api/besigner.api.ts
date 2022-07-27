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

import type { IAglynAppController } from '@aglyn/core-data-foundation'
import { BehaviorSubject } from 'rxjs'
import { _INTERNAL_BESIGNERS_ } from '../constants/_internal'
import type {
  BesignerClosePanelPayload,
  BesignerGetStorePayload,
  BesignerOpenPanelPayload,
  BesignerSetCanvasHoveredPayload,
  BesignerSetCanvasItemPayload,
  BesignerSetCanvasPayload,
  BesignerSetCanvasSelectedPayload,
  BesignerSetDndItemPayload,
  BesignerSetDndPayload,
  BesignerSetFlagPayload,
  BesignerSetFlagsPayload,
  BesignerSetPanelPayload,
  BesignerSetPanelsPayload,
  BesignerTogglePanelPayload,
} from '../constants/emitter'
import type { IBesignerAppController } from '../definitions/besigner-app.types'
import type {
  BesignerContext,
  IBesignerInterfaceController,
} from '../definitions/besigner-interface.types'
import { _validateBesignerAppArg } from './app.api'

export function _getBesignerController(
  app: IAglynAppController,
): IBesignerInterfaceController {
  _validateBesignerAppArg(app as IBesignerAppController)
  return _INTERNAL_BESIGNERS_.get(app.getName())
}

export function getBesignerStore<K extends keyof BesignerContext>(
  app: IAglynAppController,
  payload: BesignerGetStorePayload<K>,
): BehaviorSubject<BesignerContext[K]> {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.getStore(payload)
}

export function setBesignerFlag(
  app: IAglynAppController,
  payload: BesignerSetFlagPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setFlag(payload)
}

export function setBesignerFlags(
  app: IAglynAppController,
  payload: BesignerSetFlagsPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setFlags(payload)
}

export function setBesignerPanel(
  app: IAglynAppController,
  payload: BesignerSetPanelPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setPanel(payload)
}

export function setBesignerPanels(
  app: IAglynAppController,
  payload: BesignerSetPanelsPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setPanels(payload)
}

export function toggleBesignerPanel(
  app: IAglynAppController,
  payload: BesignerTogglePanelPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.togglePanel(payload)
}

export function openBesignerPanel(
  app: IAglynAppController,
  payload: BesignerOpenPanelPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.openPanel(payload)
}

export function closeBesignerPanel(
  app: IAglynAppController,
  payload: BesignerClosePanelPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.closePanel(payload)
}

export function setBesignerDndItem(
  app: IAglynAppController,
  payload?: BesignerSetDndItemPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setDndItem(payload)
}

export function setBesignerDnd(
  app: IAglynAppController,
  payload?: BesignerSetDndPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setDnd(payload)
}

export function setBesignerCanvasItem(
  app: IAglynAppController,
  payload?: BesignerSetCanvasItemPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setCanvasItem(payload)
}

export function setBesignerCanvas(
  app: IAglynAppController,
  payload?: BesignerSetCanvasPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setCanvas(payload)
}

export function setBesignerCanvasSelected(
  app: IAglynAppController,
  payload?: BesignerSetCanvasSelectedPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setCanvasSelected(payload)
}

export function setBesignerCanvasHovered(
  app: IAglynAppController,
  payload?: BesignerSetCanvasHoveredPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setCanvasHovered(payload)
}
