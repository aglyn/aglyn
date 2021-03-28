import React, { cloneElement, ReactElement } from 'react';
import useScrollTrigger from '@material-ui/core/useScrollTrigger'

/* eslint-disable-next-line */
export interface ElevationScrollProps {
  target?: Node | Window
  children: ReactElement
}

export function ElevationScroll(props: ElevationScrollProps) {
  const { children, target } = props
  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 0,
    target: target ?? undefined,
  })

  return cloneElement(children, { elevation: trigger ? 4 : 0 })
}
ElevationScroll.displayName = 'ElevationScroll'

export default ElevationScroll;
