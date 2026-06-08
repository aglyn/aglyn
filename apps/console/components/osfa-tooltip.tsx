/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { Box, Popper } from '@mui/material'
import Tippy, { tippy } from '@tippyjs/react'
import { Fragment, useEffect, useState } from 'react'

export interface OsfaTooltipProps {}

export const OsfaTooltip = (props: OsfaTooltipProps) => {
  const { ...rest } = props
  const [anchorEl, setAnchorEl] = useState<Element>(null)
  const [tip, setTip] = useState(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const rightClickableArea = document.querySelector('[data-aglyn-tooltip]')

    const instance = tippy('[data-aglyn-tooltip]', {
      // content: 'Global content',
      trigger: 'mouseenter',
      onTrigger(instance, event) {
        console.log('ontrigger instance', instance)
        console.log('ontrigger event', event)
        const reference = instance.reference
        const content = reference.getAttribute('data-aglyn-tooltip')
        // instance.setContent(content)
        // setAnchorEl(instance.reference)
        // setTip(content)
      },
    })
    return () => {
      setAnchorEl(null)
      instance.forEach((i) => i.destroy())
    }
  })

  return (
    <Fragment>
      <Tippy content="Tooltip" reference={anchorEl} />
      <Popper open={Boolean(anchorEl)} anchorEl={anchorEl}>
        <Box sx={{ border: 1, p: 1, bgcolor: 'background.paper' }}>{tip}</Box>
      </Popper>
    </Fragment>
  )
}
OsfaTooltip.displayName = 'OsfaTooltip'

export default OsfaTooltip
