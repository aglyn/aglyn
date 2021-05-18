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