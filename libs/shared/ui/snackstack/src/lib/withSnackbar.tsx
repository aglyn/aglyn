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

import {getDisplayName} from '@aglyn/shared-util-tools'
import {hoistNonReactStatics} from '@aglyn/shared-util-vendor'
import {forwardRef} from 'react'
import SnackbarContext from './SnackbarContext'


export const withSnackbar = (Component) => {
  const displayName = getDisplayName(Component)
  const WrappedComponent = forwardRef((props, ref) => (
    <SnackbarContext.Consumer>
      {context => (
        <Component
          {...props}
          ref={ref}
          enqueueSnackbar={context.enqueueSnackbar}
          closeSnackbar={context.closeSnackbar}
        />
      )}
    </SnackbarContext.Consumer>
  ))

  WrappedComponent.displayName = `WithSnackbar(${displayName})`
  hoistNonReactStatics(WrappedComponent, Component)

  return WrappedComponent
}

export default withSnackbar
