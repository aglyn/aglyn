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

import { forwardRef, SVGAttributes, useMemo } from 'react'
import { PropsWithInnerRef } from '../../types'


export type SvgPathData = SvgPathProps['d']
export type SvgPassProps = PropsWithInnerRef<SvgPathProps, SVGPathElement>
/* eslint-disable-next-line */
export interface SvgPathProps extends SVGAttributes<SVGPathElement> {}

export const SvgPath = forwardRef<SVGPathElement, SvgPathProps>(
  function RefRenderFn(props, ref) {
    return <path ref={ref} {...props} />
  }
)

SvgPath.displayName = 'SvgPath'

export default SvgPath

export function svgPathElement(d: SvgPathData, passProps?: SvgPassProps) {
  const {innerRef, ...rest} = {...passProps}
  return (<SvgPath d={d} ref={innerRef} {...rest} />)
}

export function useSvgPathElement(d: SvgPathData, passProps?: SvgPassProps) {
  return useMemo(() => svgPathElement(d, passProps), [d, passProps])
}
