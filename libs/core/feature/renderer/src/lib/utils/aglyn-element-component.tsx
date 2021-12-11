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

import type {
  AglynComponentElementType,
  AglynComponentSchema,
  ComponentRegisterPayload,
  IAglynComponent,
} from '@aglyn/core-data-framework'
import {
  COMPONENT_ELEMENT_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from '@aglyn/core-data-framework'
import { AnyProps } from '@aglyn/shared-data-types'
import { styled } from '@aglyn/shared-feature-themes'
import { copy, getDisplayName } from '@aglyn/shared-util-tools'
import { ChangeCase} from '@aglyn/shared-util-vendor'
import { forwardRef } from 'react'
import {
  ElementErrorBoundaryComponent,
  ElementErrorBoundaryComponentProps,
} from '../components/element-error-boundary.component'


export function aglynElementComponent<P extends AnyProps>(
  schema: AglynComponentSchema<P>,
  component: AglynComponentElementType<P>,
  errorComponent?: ElementErrorBoundaryComponentProps<P>['errorComponent'],
): ComponentRegisterPayload<P> {
  const {componentId, bundleId, renderFlags} = schema
  const {emotionStyled} = {...renderFlags}

  const displayName = getDisplayName(component, ChangeCase.pascalCase(componentId))

  const ComponentElement =
    !emotionStyled?.disable
      ? styled(component as any, {
        name: displayName,
        ...emotionStyled?.options,
      })({})
      : component

  const AglynComponent: IAglynComponent<P> = forwardRef<any, any>(
    function RefRenderFn(props, ref) {
      return (
        <ElementErrorBoundaryComponent
          innerRef={ref}
          props={props}
          component={ComponentElement}
          errorComponent={errorComponent}
        />
      )
    },
  )

  AglynComponent.displayName = `AglynComponent(${displayName})`
  AglynComponent.componentId = componentId
  AglynComponent.bundleId = bundleId
  ;(AglynComponent as any)[TYPE_OF] = MODULE_TYPE
  ;(AglynComponent as any)[TYPE_KIND] = COMPONENT_ELEMENT_TYPE

  return {
    schema: copy(schema),
    component: AglynComponent,
  }
}

export default aglynElementComponent
