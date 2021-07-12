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

export const svgPathElement = (d: SvgPathData, passProps?: SvgPathProps) => {
  return <SvgPath d={d} {...passProps} />
}
export const useSvgPathElement = (d: SvgPathData, passProps?: SvgPathProps) => {
  return React.useMemo(() => svgPathElement(d, passProps), [d, passProps])
}

export type SvgPathData = SvgPathProps['d']

/* eslint-disable-next-line */
export interface SvgPathProps extends React.SVGAttributes<SVGPathElement> {}

export const SvgPath = React.forwardRef<SVGPathElement, SvgPathProps>(function RefRenderFn(props, ref) {
  return <path ref={ref} {...props} />
})

SvgPath.displayName = 'SvgPath'

export default SvgPath
