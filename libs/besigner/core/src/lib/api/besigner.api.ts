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

import { _INTERNAL_BESIGNERS_ } from '../constants/_internal'
import type {
  BesignerSetFlagPayload,
  BesignerSetFlagsPayload,
  BesignerSetPanelPayload,
  BesignerSetPanelsPayload,
} from '../definitions/emitter.types'
import type { IBesignerAppController } from '../definitions/besigner-app.types'
import type { IBesignerInterfaceController } from '../definitions/besigner-interface.types'
import { _validateBesignerAppArg } from './app.api'

export function _getBesignerController(
  app: IBesignerAppController,
): IBesignerInterfaceController {
  _validateBesignerAppArg(app as IBesignerAppController)
  return _INTERNAL_BESIGNERS_.get(app.getName())
}

export function setBesignerFlag(
  app: IBesignerAppController,
  payload: BesignerSetFlagPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setFlag(payload)
}

export function setBesignerFlags(
  app: IBesignerAppController,
  payload: BesignerSetFlagsPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setFlags(payload)
}

export function setBesignerPanel(
  app: IBesignerAppController,
  payload: BesignerSetPanelPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setPanel(payload)
}

export function setBesignerPanels(
  app: IBesignerAppController,
  payload: BesignerSetPanelsPayload,
) {
  const besignerController = _getBesignerController(
    app as IBesignerAppController,
  )
  return besignerController.setPanels(payload)
}


