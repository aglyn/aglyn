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

import { getDisplayName } from '@aglyn/shared/util/tools'
import { Component as ReactComponent, ComponentType } from 'react'
import {Theme, ThemeProvider} from '../mui'

export function withThemeProvider(theme: Theme) {
  return function <P>(Component: ComponentType<P>) {
    const displayName = `WithThemeProvider(${getDisplayName(Component)})`

    return class WithTheme extends ReactComponent<P> {
      static displayName = displayName
      static WrappedComponent: ComponentType<P> = Component
      public render(): React.ReactNode {
        return (
          <ThemeProvider theme={theme}>
            <Component {...this.props}/>
          </ThemeProvider>
        )
      }
    }
  }
}
export default withThemeProvider
