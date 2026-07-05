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

import {CrudModel, Initializable} from '@aglyn/shared-data-types'


/**
 * Describes the base model object
 *
 * @export
 * @interface BaseModel
 * @extends {Initializable}
 * @extends {Crud<T>}
 * @extends {toJSON<T>}
 * @template T
 */
export interface RefController<T> extends Initializable, CrudModel<T> {


}
