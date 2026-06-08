/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  AliasesCSSProperties,
  OverwriteCSSProperties,
  StandardCSSProperties,
} from '@mui/system'
import type { Pseudos } from 'csstype'

declare global {
  namespace JSX {
    /**
     * The `css` function accepts arrays as values for mobile-first responsive
     * styles. Note that this extends to non-theme values also. For example
     * `display=['none', 'block']` will also works.
     */
    export type ResponsiveStyleValue<T> =
      | T
      | Array<T | null>
      | { [key: string]: T | null }

    /**
     * Map of all CSS pseudo selectors (e.g., hover, focus).
     */
    export type CSSPseudoSelectorProps<Theme extends object = EmptyObj> = {
      [K in Pseudos]?:
        | ((theme: Theme) => SystemStyleObject<Theme>)
        | SystemStyleObject<Theme>
    }

    /**
     * Map all nested selectors.
     */
    export interface CSSSelectorObject<Theme extends object = EmptyObj> {
      [cssSelector: string]:
        | ((theme: Theme) => SystemStyleObject<Theme>)
        | SystemStyleObject<Theme>
    }

    type CssVariableType = string | number

    /**
     * Map all nested selectors and CSS variables.
     */
    export interface CSSSelectorObjectOrCssVariables<
      Theme extends object = EmptyObj,
    > {
      [cssSelectorOrVariable: string]:
        | ((theme: Theme) => SystemStyleObject<Theme> | string | number)
        | SystemStyleObject<Theme>
        | CssVariableType
    }

    /**
     * Map of all available CSS properties (including aliases) and their raw
     * value. Only used internally to map CSS properties to input types
     * (responsive value, theme function or nested) in `SystemCssProperties`.
     */
    export interface AllSystemCSSProperties
      extends Omit<StandardCSSProperties, keyof OverwriteCSSProperties>,
        OverwriteCSSProperties,
        AliasesCSSProperties {}

    export type SystemCssProperties<Theme extends object = EmptyObj> = {
      [K in keyof AllSystemCSSProperties]:
        | ResponsiveStyleValue<AllSystemCSSProperties[K]>
        | ((theme: Theme) => ResponsiveStyleValue<AllSystemCSSProperties[K]>)
        | SystemStyleObject<Theme>
    }

    /**
     * The `SystemStyleObject` defines custom properties that will be
     * transformed to their corresponding values from the `Theme`. Other valid
     * CSS properties are also allowed.
     */
    export type SystemStyleObject<Theme extends object = EmptyObj> =
      | SystemCssProperties<Theme>
      | CSSPseudoSelectorProps<Theme>
      | CSSSelectorObjectOrCssVariables<Theme>
      | null

    export type SxStyleFunctionProp<Theme extends object = EmptyObj> = (
      theme: Theme,
    ) => SystemStyleObject<Theme>
    export type SxStyleObjectProp<Theme extends object = EmptyObj> =
      SystemStyleObject<Theme>

    export type SxStyleProp<Theme extends object = EmptyObj> =
      | SxStyleFunctionProp<Theme>
      | SxStyleObjectProp<Theme>
    export type SxStyleArrayProp<Theme extends object = EmptyObj> =
      ReadonlyArray<boolean | SxStyleProp<Theme>>

    /**
     * The `SxProps` can be either object or function
     */
    export type SxProps<Theme extends object = EmptyObj> =
      | SxStyleProp<Theme>
      | SxStyleArrayProp<Theme>
  }
}

export {}
