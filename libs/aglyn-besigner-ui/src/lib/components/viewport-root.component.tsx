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

import { alpha, styled } from '@aglyn/shared-ui-theme'
import { forwardRef } from 'react'

const AglynViewport = styled('div', {
  name: 'AglynViewport',
})(({ theme }) => {
  const o = 'transparent'
  const bg = theme.palette.background.default
  const base = theme.palette.divider
  const sq = alpha(base, 0.02)
  const outline = alpha(base, 0.0312)
  const corner = alpha(base, 0.016)
  const gradient = 'linear-gradient'
  const s = {
    sq: '4px',
    grid: '97px',
    line: '1px',
    rot: '-90deg',
  }

  return {
    flexGrow: 1,
    overflow: 'hidden',
    flexDirection: 'column',
    alignItems: 'center',
    display: 'flex',
    // position: 'relative',
    boxShadow: theme.shadowsInset[3],
    // minHeight: '100%',
    backgroundColor: bg,
    background: [
      `${gradient}(${s.rot}, ${sq} ${s.line}, ${o} ${s.line})`,
      `${gradient}(${sq} ${s.line}, ${o} ${s.line})`,
      `${gradient}(${s.rot}, ${outline} ${s.line}, ${o} ${s.line})`,
      `${gradient}(${outline} ${s.line}, ${o} ${s.line})`,
      `${gradient}(${o} ${s.sq}, ${bg} ${s.sq}, ${bg} ${s.grid}, ${o} ${s.grid})`,
      `${gradient}(${s.rot}, ${corner} ${s.line}, ${o} ${s.line})`,
      `${gradient}(${s.rot}, ${o} ${s.sq}, ${bg} ${s.sq}, ${bg} ${s.grid}, ${o} ${s.grid})`,
      `${gradient}(${corner} ${s.line}, ${o} ${s.line})`,
      corner,
    ].join(','),
    backgroundSize: [
      '10px 10px',
      '10px 10px',
      '100px 100px',
      '100px 100px',
      '100px 100px',
      '100px 100px',
      '100px 100px',
      '100px 100px',
    ].join(','),
    // position: 'relative',
  }
})

export interface ViewportRootComponentProps
  extends JSX.ComponentProps<typeof AglynViewport> {
  // drawerWidth?: number
  component?
}

const ViewportRootComponent = forwardRef<any, ViewportRootComponentProps>(
  (props, ref) => {
    const { children, ...rest } = props

    return (
      <AglynViewport
        ref={ref}
        id="aglyn:viewport-root"
        aria-label="besigner viewport root"
        component="main"
        // drawerWidth={left?.drawerWidth}
        {...rest}
      >
        {children}
      </AglynViewport>
    )
  },
)

ViewportRootComponent.displayName = 'ViewportRootComponent'
ViewportRootComponent.aglyn = true
ViewportRootComponent.defaultProps = {}

export { ViewportRootComponent }
export default ViewportRootComponent
