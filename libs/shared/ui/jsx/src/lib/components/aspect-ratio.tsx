import { forwardRef } from 'react'



export interface AspectRatioProps {
  children?: JSX.Children
}
const AspectRatio = forwardRef<any, AspectRatioProps>(
  (props, ref) => {
    const { children, ...rest } = props

    return (
      <div ref={ref} {...rest}>
        {children}
      </div>
    )
  }
)
AspectRatio.displayName = 'AspectRatio'
AspectRatio.defaultProps = {}
AspectRatio.aglyn = true

export { AspectRatio }
export default AspectRatio
