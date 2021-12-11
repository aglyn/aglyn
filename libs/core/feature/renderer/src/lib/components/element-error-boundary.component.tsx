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
  AglynComponentClassElement,
  AglynComponentElementType,
  COMPONENT_ELEMENT_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from '@aglyn/core-data-framework'
import { AnyProps, PropsWithInnerRef } from '@aglyn/shared-data-types'
import { ReactIs } from '@aglyn/shared-ui-jsx'
import { Component } from 'react'


export interface ElementErrorBoundaryComponentState {error: any}

export type ElementErrorBoundaryComponentProps<P extends AnyProps> = PropsWithInnerRef<{
  component: AglynComponentElementType<P>
  errorComponent?: AglynComponentElementType<{ props: P, error: any }>
  props: P
}>

export class ElementErrorBoundaryComponent<P extends AnyProps> extends Component<ElementErrorBoundaryComponentProps<P>, ElementErrorBoundaryComponentState> {

  public static displayName = `ElementErrorBoundaryComponent`

  public state: ElementErrorBoundaryComponentState = {error: null}

  public static getDerivedStateFromError(error: any): Partial<ElementErrorBoundaryComponentState> | null {
    if (error) {
      console.error(error)
      return {error}
    }
    return null
  }
  public renderError() {
    const {props, errorComponent: ErrorComponent} = this.props

    return ReactIs.isValidElementType(ErrorComponent) ? (
      <ErrorComponent
        error={this.state.error}
        props={props}
      />
    ) : (
      <>Error rendering component!</>
    )
  }
  public render() {
    const {innerRef, props, component} = this.props,
      Component = component as any

    return this.state.error ? this.renderError() : (
      <Component ref={innerRef} {...props} />
    )
  }
}

export default ElementErrorBoundaryComponent
