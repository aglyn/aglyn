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

import * as Aglyn from '@aglyn/aglyn'
import {
  AGLYN_OF,
  type AglynExoticComponent,
  COMPONENT_ELEMENT_TYPE,
  type ComponentRegisterPayload,
} from '@aglyn/aglyn'
import {
  type ErrorBoundaryProps,
  withErrorBoundary,
} from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { cloneDeep } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics, pascalCase } from '@aglyn/shared-util-vendor'
import { forwardRef } from 'react'

export function createAglynComponent<P extends JSX.AnyProps = any, C = any>(
  schema: Aglyn.ComponentSchema<P>,
  component: C | any,
  options?: Partial<ErrorBoundaryProps>,
): ComponentRegisterPayload<P> {
  const _schema = cloneDeep(schema)
  const { $id, pluginId, flags, styledOptions } = _schema
  const pascalId = `${pluginId ? pascalCase(pluginId) + '-' : ''}${pascalCase(
    $id,
  )}`

  const Component =
    flags?.emotion === Aglyn.FEATURE_FLAG.DISABLED
      ? component
      : styled(component, styledOptions)({})

  const AglynComponent = forwardRef<any, P>((props, ref) => {
    return <Component ref={ref} {...props} />
  }) as AglynExoticComponent<P>

  AglynComponent.displayName = `AglynComponent(${pascalId})`
  AglynComponent['$id'] = $id
  AglynComponent['pluginId'] = pluginId
  AglynComponent['aglyn'] = true
  AglynComponent[AGLYN_OF] = COMPONENT_ELEMENT_TYPE
  hoistNonReactStatics(AglynComponent, component)

  return {
    component: withErrorBoundary(
      AglynComponent,
      options,
    ) as AglynExoticComponent<P>,
    schema: cloneDeep(schema) as any,
  }
}

export default createAglynComponent
