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

//   _______  ______  ___________
//  /_  __\ \/ / __ \/ ____/ ___/
//   / /   \  / /_/ / __/  \__ \
//  / /    / / ____/ /___ ___/ /
// /_/    /_/_/   /_____//____/
// 👇

export * from './lib/types/aglyn-app.types'
export * from './lib/types/aglyn-base.types'
export * from './lib/types/aglyn-canvas.types'
export * from './lib/types/aglyn-commands.types'
export * from './lib/types/aglyn-components.types'
export * from './lib/types/aglyn-contexts.types'
export * from './lib/types/aglyn-depends.types'
export * from './lib/types/aglyn-elements.types'
export * from './lib/types/aglyn-extension.types'
export * from './lib/types/aglyn-extensions.types'
export * from './lib/types/aglyn-module.types'
export * from './lib/types/aglyn-tenancy.types'
export * from './lib/types/generic.types'

//     ___    ____  ____
//    /   |  / __ \/  _/
//   / /| | / /_/ // /
//  / ___ |/ _____/ /
// /_/  |_/_/   /___/
// 👇

export * from './lib/api/app.api'
export * from './lib/api/canvas.api'
export * from './lib/api/commands.api'
export * from './lib/api/components.api'
export * from './lib/api/contexts.api'
export * from './lib/api/extensions.api'
export * from './lib/api/logger.api'


//    __________  _   ________________    _   _____________
//   / ____/ __ \/ | / / ___/_  __/   |  / | / /_  __/ ___/
//  / /   / / / /  |/ /\__ \ / / / /| | /  |/ / / /  \__ \
// / /___/ /_/ / /|  /___/ // / / ___ |/ /|  / / /  ___/ /
// \____/\____/_/ |_//____//_/ /_/  |_/_/ |_/ /_/  /____/
// 👇

export * from './lib/constants/_internal'
export * from './lib/constants/app'
export * from './lib/constants/canvas'
export * from './lib/constants/components'
export * from './lib/constants/emitter'
export * from './lib/constants/error'
export * from './lib/constants/lifecycle'
export * from './lib/constants/logger'
export * from './lib/constants/platform'
export * from './lib/constants/symbol'
export * from './lib/constants/tenancy'
export * from './lib/constants/version'


//    __  ______________   _____
//   / / / /_  __/  _/ /  / ___/
//  / / / / / /  / // /   \__ \
// / /_/ / / / _/ // /______/ /
// \____/ /_/ /___/_____/____/
// 👇

export * from './lib/util/aglyn-is'
export * from './lib/util/build-component-props-form-schema'
export * from './lib/util/confirm-valid-lineal-relationship'
export * from './lib/util/create-component-element-data'
export * from './lib/util/create-component-element-data-copy'
export * from './lib/util/create-component-element-id'
export * from './lib/util/create-components-bundle'
export * from './lib/util/create-resource-uid'
export * from './lib/util/delete-component-element'
export * from './lib/util/denormalize-component-element-data'
export * from './lib/util/get-component-element-hierarchy'
export * from './lib/util/handle-state-modification-history-change'
export * from './lib/util/handle-state-modification-history-redo'
export * from './lib/util/handle-state-modification-history-undo'
export * from './lib/util/is-root-element-id'
export * from './lib/util/normalize-component-element-data'


//     __  _______  ____  ________   _____
//    /  |/  / __ \/ __ \/ ____/ /  / ___/
//   / /|_/ / / / / / / / __/ / /   \__ \
//  / /  / / /_/ / /_/ / /___/ /______/ /
// /_/  /_/\____/_____/_____/_____/____/
// 👇

export * from './lib/models/aglyn-base.model'
export * from './lib/models/aglyn-extension.model'
export * from './lib/models/aglyn-module.model'


//    __________  _   ____________  ____  __    __    __________ _____
//   / ____/ __ \/ | / /_  __/ __ \/ __ \/ /   / /   / ____/ __ / ___/
//  / /   / / / /  |/ / / / / /_/ / / / / /   / /   / __/ / /_/ \__ \
// / /___/ /_/ / /|  / / / / _, _/ /_/ / /___/ /___/ /___/ _, ____/ /
// \____/\____/_/ |_/ /_/ /_/ |_|\____/_____/_____/_____/_/ |_/____/
// 👇

export * from './lib/controllers/aglyn-app.controller'
export * from './lib/controllers/aglyn-canvas.controller'
export * from './lib/controllers/aglyn-commands.controller'
export * from './lib/controllers/aglyn-components.controller'
export * from './lib/controllers/aglyn-contexts.controller'
