/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import { styled } from '@aglyn/shared-ui-theme'
import type { ComponentProps } from 'react'
import { forwardRef } from 'react'

const AglynViewport = styled('main', {
  name: 'AglynViewport',
})(({ theme }) => {
  // const o = 'transparent'
  const t = theme as any
  // In CSS vars mode `theme.palette.*` is always the static light value; resolve
  // through `theme.vars.palette.*` so this becomes a live CSS custom-property ref.
  const bg = (t.vars || theme).palette.background.default
  // const base = theme.palette.divider
  // const sq = alpha(base, 0.02)
  // const outline = alpha(base, 0.0312)
  // const corner = alpha(base, 0.016)
  // const gradient = 'linear-gradient'
  // const s = {
  //   sq: '4px',
  //   grid: '97px',
  //   line: '1px',
  //   rot: '-90deg',
  // }

  // theme.vars is available from MuiCssVarsProvider; use channel variables so the
  // colours update when the mode switches without calling alpha() on a CSS-variable string.
  const divider = `rgba(${t.vars.palette.dividerChannel} / 0.0312)`
  const dot = `rgba(${t.vars.palette.dividerChannel} / 0.0486)`
  const minor = theme.spacing(1)
  const major = theme.spacing(12)

  return {
    flexGrow: 1,
    overflow: 'hidden',
    flexDirection: 'column',
    alignItems: 'center',
    display: 'flex',
    // position: 'relative',
    // minHeight: '100%',
    boxShadow: theme.shadowsInset[3],
    backgroundColor: bg,
    // backgroundImage: `radial-gradient(circle, #000000 1px, rgba(0, 0, 0, 0) 1px)`,
    backgroundImage: [
      // `${gradient}(${s.rot}, ${sq} ${s.line}, ${o} ${s.line})`,
      // `${gradient}(${sq} ${s.line}, ${o} ${s.line})`,
      // `${gradient}(${s.rot}, ${outline} ${s.line}, ${o} ${s.line})`,
      // `${gradient}(${outline} ${s.line}, ${o} ${s.line})`,
      // `${gradient}(${o} ${s.sq}, ${bg} ${s.sq}, ${bg} ${s.grid}, ${o} ${s.grid})`,
      // `${gradient}(${s.rot}, ${corner} ${s.line}, ${o} ${s.line})`,
      // `${gradient}(${s.rot}, ${o} ${s.sq}, ${bg} ${s.sq}, ${bg} ${s.grid}, ${o} ${s.grid})`,
      // `${gradient}(${corner} ${s.line}, ${o} ${s.line})`,
      `linear-gradient(to right, ${divider} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${divider} 1px, transparent 1px)`,
      `linear-gradient(to right, ${divider} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${divider} 1px, transparent 1px)`,
      `radial-gradient(circle at 0% 0%, ${dot} 2px, transparent 2px)`,
      `radial-gradient(circle at 100% 0%, ${dot} 2px, transparent 2px)`,
      `radial-gradient(circle at 100% 100%, ${dot} 2px, transparent 2px)`,
      `radial-gradient(circle at 0% 100%, ${dot} 2px, transparent 2px)`,
    ].join(', '),
    backgroundSize: [
      // '40px 40px',
      // '40px 40px',
      // '40px 40px',
      // '10px 10px',
      // '100px 100px',
      // '100px 100px',
      // '100px 100px',
      // '100px 100px',
      // '100px 100px',
      `${minor} ${minor}`,
      `${minor} ${minor}`,
      `${major} ${major}`,
      `${major} ${major}`,
      `${major} ${major}`,
      `${major} ${major}`,
      `${major} ${major}`,
      `${major} ${major}`,
    ].join(', '),
  }
})

export interface ViewportRootComponentProps
  extends ComponentProps<typeof AglynViewport> {}

export const ViewportRootComponent = forwardRef<
  any,
  ViewportRootComponentProps
>((props, ref) => {
  const { children, ...rest } = props

  return (
    <AglynViewport
      ref={ref}
      id="aglyn:viewport-root"
      aria-label="besigner viewport root"
      {...rest}
    >
      {children}
    </AglynViewport>
  )
})

ViewportRootComponent.displayName = 'ViewportRootComponent'
ViewportRootComponent.aglyn = true

export default ViewportRootComponent
