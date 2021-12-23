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

import type {IAglynAppController} from '../controllers/aglyn-app.types'
import type {IAglynBesignerController} from '../controllers/aglyn-besigner.types'
import type {IAglynCanvasController} from '../controllers/aglyn-canvas.types'
import type {IAglynCommandsController} from '../controllers/aglyn-commands.types'
import type {IAglynComponentsController} from '../controllers/aglyn-components.types'
import type {IAglynContextsController} from '../controllers/aglyn-contexts.types'
import type {IAglynExtensionsController} from '../controllers/aglyn-extensions.types'
import type {AppUUN} from '../types'


export const DEFAULT_APP_UUN = '[DEFAULT]'
export type DEFAULT_APP_UUN = typeof DEFAULT_APP_UUN

export const _INTERNAL_APPS_: Map<AppUUN, IAglynAppController> = new Map()
export const _INTERNAL_EXTENSIONS_: Map<AppUUN, IAglynExtensionsController> = new Map()
export const _INTERNAL_COMMANDS_: Map<AppUUN, IAglynCommandsController> = new Map()
export const _INTERNAL_COMPONENTS_: Map<AppUUN, IAglynComponentsController> = new Map()
export const _INTERNAL_BESIGNERS_: Map<AppUUN, IAglynBesignerController> = new Map()
export const _INTERNAL_CANVAS_: Map<AppUUN, IAglynCanvasController> = new Map()
export const _INTERNAL_CONTEXTS_: Map<AppUUN, IAglynContextsController> = new Map()


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
