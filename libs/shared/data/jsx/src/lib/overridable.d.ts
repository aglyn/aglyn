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

declare global {
  namespace JSX {
    type OverrideComponentProp<P = any> = { component?: ElementType<P> }

    type OverrideComponentsProps<T extends OverrideComponentProp = any> = [
      T,
    ] extends [{ component: infer C }]
      ? ComponentProps<C>
      : never

    type OverrideComponentPropPlusOverrideProps<
      T extends OverrideComponentProp = any,
    > = [T] extends [{ component: ElementType }]
      ? OverrideComponentsProps<T> & Pick<T, 'component'>
      : { component?: undefined }

    export type OverrideableComponentProps<
      P = any,
      T = OverrideComponentProp,
    > = P & OverrideComponentPropPlusOverrideProps<T>
  }
}

export {}
