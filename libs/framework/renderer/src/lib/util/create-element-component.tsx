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

import {
  AglynComponent,
  AglynComponentElementType,
  AglynComponentOptions,
  EXTENSION_TYPE,
  MODULE_TYPE,
  SelfComponentId,
  TYPE_KIND,
  TYPE_OF,
} from '@aglyn/framework/sdk'
import { styled } from '@aglyn/shared/ui/themes'
import { Component, Ref } from 'react'


export type ComponentBuilder<P = any> = (element: AglynComponentElementType<P>) => AglynComponent<P>

export function createElementComponent<P = any>(
  componentId: SelfComponentId,
  options: AglynComponentOptions<P>,
): ComponentBuilder<P> {
  return function(element: AglynComponentElementType<P>): AglynComponent<P> {
    const displayName = `AglynComponent($id: ${componentId})`
    const Element = options?.disableStyled
      ? element
      : styled(element as any, {name: displayName})({})

    return class AglynComponent extends Component<P> {
      static readonly [TYPE_OF] = MODULE_TYPE
      static readonly [TYPE_KIND] = EXTENSION_TYPE
      static readonly $id = componentId
      static readonly displayName = displayName
      static readonly options = {displayName: componentId, ...options}
      static readonly defaultProps: Partial<P> = {...options?.defaultProps}
      public innerRef: Ref<any>

      constructor(props) {
        super(props)
        this.innerRef = props?.innerRef
      }

      public render() {
        return (
          <Element {...this.props} />
        )
      }
    }
  }
}
