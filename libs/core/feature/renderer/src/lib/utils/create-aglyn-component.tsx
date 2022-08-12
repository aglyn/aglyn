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
  AGLYN_OF,
  type AglynComponentSchema,
  type AglynExoticComponent,
  COMPONENT_ELEMENT_TYPE,
  type ComponentRegisterPayload,
  FEATURE_FLAG,
} from '@aglyn/core-data-foundation'
import {
  type ErrorBoundaryProps,
  withErrorBoundary,
} from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { copy } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics, pascalCase } from '@aglyn/shared-util-vendor'
import { forwardRef } from 'react'

export function createAglynComponent<P = any, C = any>(
  schema: AglynComponentSchema<P>,
  component: C | any,
  options?: Partial<ErrorBoundaryProps>,
): ComponentRegisterPayload<P> {
  const _schema = copy(schema)
  const { componentId, bundleId, flags, styledOptions } = _schema
  const pascalId = `${bundleId ? pascalCase(bundleId) + '-' : ''}${pascalCase(
    componentId,
  )}`

  const Component =
    flags?.emotion === FEATURE_FLAG.DISABLED
      ? component
      : styled(component, styledOptions)({})

  const AglynComponent = forwardRef<any, P>((props, ref) => {
    return <Component ref={ref} {...props} />
  }) as AglynExoticComponent<P>

  AglynComponent.displayName = `AglynComponent(${pascalId})`
  AglynComponent.componentId = componentId
  AglynComponent.bundleId = bundleId
  AglynComponent.aglyn = true
  AglynComponent[AGLYN_OF] = COMPONENT_ELEMENT_TYPE
  hoistNonReactStatics(AglynComponent, component)

  return {
    component: withErrorBoundary(
      AglynComponent,
      options,
    ) as AglynExoticComponent<P>,
    schema: copy(schema),
  }
}

export default createAglynComponent
