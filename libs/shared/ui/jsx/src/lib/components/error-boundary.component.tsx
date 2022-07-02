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

import { getDisplayName } from '@aglyn/shared-util-tools'
import { hoistNonReactStatics } from '@aglyn/shared-util-vendor'
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  forwardRef,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
  type RefAttributes,
} from 'react'

export interface ErrorBoundaryProps {
  children?: JSX.Children
  fallback?: JSX.Node
  onCatch?: (error: Error, errorInfo: ErrorInfo) => void
}

type State = {
  hasError: boolean
  error: any
}

/**
 * @see https://reactjs.org/docs/error-boundaries.html
 */
class ErrorBoundaryComponentClass extends Component<ErrorBoundaryProps, State> {
  public static displayName = 'ErrorBoundaryComponentClass'
  public static readonly aglyn = true

  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: undefined,
    }
  }

  public static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    console.error(error, 'getDerivedStateFromError')
    return { hasError: true, error }
  }

  public componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    // logErrorToMyService(error, errorInfo)
    console.error(error, errorInfo, 'componentDidCatch')

    if (typeof this.props.onCatch === 'function') {
      this.props.onCatch(error, errorInfo)
    }
  }

  public render() {
    return this.state.hasError
      ? this.props.fallback ?? <h6>Something went wrong...</h6>
      : this.props.children
  }
}

const ErrorBoundaryComponent = forwardRef<
  ErrorBoundaryComponentClass,
  ErrorBoundaryProps
>((props, ref) => {
  const { children, ...rest } = props

  return (
    <ErrorBoundaryComponentClass ref={ref} {...rest}>
      {children}
    </ErrorBoundaryComponentClass>
  )
})
ErrorBoundaryComponent.displayName = 'ErrorBoundaryComponent'
ErrorBoundaryComponent.aglyn = true

export function withErrorBoundary<P, T>(
  WrappedComponent: ComponentType<P>,
  options?: ErrorBoundaryProps,
): ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<T>> {
  const displayName = getDisplayName(WrappedComponent)
  const WithErrorBoundary = forwardRef<T, P>((props, ref) => {
    return (
      <ErrorBoundaryComponentClass {...options}>
        <WrappedComponent ref={ref} {...props} />
      </ErrorBoundaryComponentClass>
    )
  })
  WithErrorBoundary.displayName = `WithErrorBoundary(${displayName})`
  hoistNonReactStatics(WithErrorBoundary, WrappedComponent)

  return WithErrorBoundary
}

export { ErrorBoundaryComponent }
export default ErrorBoundaryComponent
