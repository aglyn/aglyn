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

import React from 'react'

type State = {
  hasError: boolean
}
type Props = React.PropsWithChildren<{
  fallback?: React.ReactNode
}>

/**
 * @see https://reactjs.org/docs/error-boundaries.html
 */
class ErrorBoundary extends React.Component<Props, State> {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    console.error(error, 'getDerivedStateFromError')
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    // logErrorToMyService(error, errorInfo)
    console.error(error, errorInfo, 'componentDidCatch')
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return this.props.fallback ?? <h6>Something went wrong.</h6>
    }

    return this.props.children
  }
}

export default ErrorBoundary
