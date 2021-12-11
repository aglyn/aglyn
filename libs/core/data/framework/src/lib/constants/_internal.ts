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

import type { AglynAppController } from '../controllers/aglyn-app.controller'
import type { AglynBesignerController } from '../controllers/aglyn-besigner.controller'
import type { AglynCanvasController } from '../controllers/aglyn-canvas.controller'
import type { AglynCommandsController } from '../controllers/aglyn-commands.controller'
import type { AglynComponentsController } from '../controllers/aglyn-components.controller'
import type { AglynContextsController } from '../controllers/aglyn-contexts.controller'
import type { AglynExtensionsController } from '../controllers/aglyn-extensions.controller'
import type { AppUUN } from '../types'


export const DEFAULT_APP_UUN = '[DEFAULT]'
export type DEFAULT_APP_UUN = typeof DEFAULT_APP_UUN

export const _INTERNAL_APPS_: Map<AppUUN, AglynAppController> = new Map()
export const _INTERNAL_EXTENSIONS_: Map<AppUUN, AglynExtensionsController> = new Map()
export const _INTERNAL_COMMANDS_: Map<AppUUN, AglynCommandsController> = new Map()
export const _INTERNAL_COMPONENTS_: Map<AppUUN, AglynComponentsController> = new Map()
export const _INTERNAL_BESIGNERS_: Map<AppUUN, AglynBesignerController> = new Map()
export const _INTERNAL_CANVAS_: Map<AppUUN, AglynCanvasController> = new Map()
export const _INTERNAL_CONTEXTS_: Map<AppUUN, AglynContextsController> = new Map()


const y = new Date().getFullYear()
export const CONSOLE_GREETING_STYLES = 'font-family:"Courier New",monospace;color:#E040FB;font-size:12px;'
export const CONSOLE_GREETING = `%c
       d8888          888                         888      888       .d8888b.
      d88888          888                         888      888      d88P  Y88b
     d88P888          888                         888      888      888    888
    d88P 888  .d88b.  888 888  888 88888b.        888      888      888
   d88P  888 d88P"88b 888 888  888 888 "88b       888      888      888
  d88P   888 888  888 888 888  888 888  888       888      888      888    888
 d8888888888 Y88b 888 888 Y88b 888 888  888       888      888      Y88b  d88P
d88P     888  "Y88888 888  "Y88888 888  888       88888888 88888888  "Y8888P"
                  888          888
             Y8b d88P     Y8b d88P
              "Y88P"       "Y88P"

                            Copyright (c) ${y} Aglyn LLC. All Rights Reserved.

Hello there, Friend! 👋

For detailed information please visit 'https://aglyn.com' or you may send an
email to 'info@aglyn.com'.

— Aglyn Engineering Team
`

if (process?.['browser']) {
  console.log(CONSOLE_GREETING, CONSOLE_GREETING_STYLES)
}
