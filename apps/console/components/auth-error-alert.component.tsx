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

import {
  AuthErrorIgnore,
  AuthErrorMessage,
  AuthErrorNotice,
  type AuthResultError,
} from '@aglyn/shared-data-enums'
import {Alert, type AlertProps as MuiAlertProps, Typography} from '@mui/material'


export interface AuthErrorAlertComponentProps extends Partial<MuiAlertProps> {
  error?: AuthResultError
}

function AuthErrorAlertComponent(props: AuthErrorAlertComponentProps) {
  const {error, ...rest} = props

  return (
    <>
      {error?.code && !AuthErrorIgnore[error.code] ? (
        <Alert
          severity={AuthErrorNotice[error.code] ? 'info' : 'error'}
          {...rest}
        >
          <Typography
            component="div"
            variant="body1"
          >
            {error.message}
          </Typography>
          <Typography
            component="div"
            variant="caption"
            color="textSecondary"
          >
            {AuthErrorMessage[error.code] || AuthErrorMessage.general}
          </Typography>
        </Alert>
      ) : null
      }
    </>
  )
}
AuthErrorAlertComponent.displayName = 'AuthErrorAlertComponent'
AuthErrorAlertComponent.aglyn = true

export {AuthErrorAlertComponent}
export default AuthErrorAlertComponent
