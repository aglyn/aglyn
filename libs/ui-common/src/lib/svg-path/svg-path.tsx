import React from 'react'


export const svgPathElement = (d: SvgPathData, passProps?: SvgPathProps) => {
  return (<SvgPath d={d} {...passProps}/>)
}
export const useSvgPathElement = (d: SvgPathData, passProps?: SvgPathProps) => {
  return React.useMemo(() => svgPathElement(d, passProps), [d, passProps])
}

export type SvgPathData = SvgPathProps['d']

/* eslint-disable-next-line */
export interface SvgPathProps extends React.SVGAttributes<SVGPathElement> {}

export const SvgPath = React.forwardRef<SVGPathElement, SvgPathProps>(
  function RefRenderFn(props, ref) {
    return (<path ref={ref} {...props} />)
  }
)

SvgPath.displayName = 'SvgPath'

export default SvgPath
