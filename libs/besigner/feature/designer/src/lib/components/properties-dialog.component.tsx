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

import { Container } from '@aglyn/shared-ui-jsx'
import {
  componentMapper,
  FieldComponentType,
  FormRenderer,
} from '@aglyn/shared-ui-jsx-forms'
import type { FormSchema } from '@aglyn/shared-ui-jsx-forms'
import { forwardRef, useCallback } from 'react'
import CloseableDrawerComponent, {
  type CloseableDrawerProps,
} from './closeable-drawer.component'

const formSchema: FormSchema = {
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'title',
      label: 'Page Title',
      description:
        'The page title will show in the browser tab. Additionally, will be the default text used in search results.',
    },
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'description',
      label: 'Page Description',
      description:
        'The page description will be the default text used in search results.',
    },
  ],
}

export interface PropertiesDialogProps extends Partial<CloseableDrawerProps> {
  children?: JSX.Children
}

export const PropertiesDialogComponent = forwardRef<any, PropertiesDialogProps>(
  (props, ref) => {
    const { children, onClose, ...rest } = props
    const handleFormCancel = useCallback(
      (values: any, ...args: any[]) => {
        onClose?.call(null, null, 'cancelClick')
      },
      [onClose],
    )

    return (
      <CloseableDrawerComponent
        ref={ref}
        drawerTitle={'Screen Properties'}
        action={'Done'}
        disableCloseButton
        onClose={onClose}
        {...rest}
      >
        <Container gutterY maxWidth={false}>
          <FormRenderer
            componentMapper={componentMapper}
            onCancel={handleFormCancel}
            // onSubmit={()}
            // initialValues={elemStyles}
            schema={formSchema}
          >
            {({ formFields }) => <>{formFields}</>}
          </FormRenderer>
        </Container>
        {children}
      </CloseableDrawerComponent>
    )
  },
)
PropertiesDialogComponent.displayName = 'PropertiesDialogComponent'
PropertiesDialogComponent.aglyn = true

export default PropertiesDialogComponent
