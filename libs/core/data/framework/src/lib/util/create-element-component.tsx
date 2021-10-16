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

import { JSXElementType } from '@aglyn/shared-data-types'
import { styled as hocStyled } from '@aglyn/shared-feature-themes'
import { getDisplayName } from '@aglyn/shared-util-tools'
import { Component, Ref } from 'react'
import { RegisterComponentPayload } from '../constants/emitter'
import { EXTENSION_TYPE, MODULE_TYPE, TYPE_KIND, TYPE_OF } from '../constants/symbol'
import {
  AglynComponentElementType,
  IAglynComponentSchema,
} from '../controllers/aglyn-components.controller'


export function createElementComponent(
  schema: IAglynComponentSchema,
  component: AglynComponentElementType,
): RegisterComponentPayload {
  const {componentId, bundleId, renderFlags} = schema
  const {styled} = {...renderFlags}
  const displayName = getDisplayName(component, componentId)
  const ComponentElement: JSXElementType = styled?.disable
    ? component
    : hocStyled(component as any, {name: displayName})({})

  class AglynComponent extends Component<any> {
    public static readonly displayName = displayName

    public static readonly componentId = componentId
    public static readonly bundleId = bundleId
    public static readonly [TYPE_OF] = MODULE_TYPE
    public static readonly [TYPE_KIND] = EXTENSION_TYPE

    public elemRef: Ref<any>

    constructor(props: any) {
      super(props)
      this.elemRef = props.innerRef
    }

    public render() {
      return <ComponentElement {...this.props} />
    }
  }

  return {
    schema,
    component: AglynComponent,
  }
}
