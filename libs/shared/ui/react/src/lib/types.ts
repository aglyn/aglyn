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

import { ElementType, Ref } from 'react'


export type InferElementTypeProps<T> = T extends ElementType<infer P> ? P : never

export interface ComponentProp<T extends ElementType = any> {
  component?: T
} //& InferElementTypeProps<T>

export interface InnerRefProps<T> {
  innerRef?: Ref<T>
}
