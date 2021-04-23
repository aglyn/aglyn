/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import React from 'react'

import styled from '@emotion/styled'

/* eslint-disable-next-line */
export interface UiCommonProps {}

const StyledUiCommon = styled.div`
  color: pink;
`

export function UiCommon(props: UiCommonProps) {
  return (
    <StyledUiCommon>
      <h1>Welcome to ui-common!</h1>
    </StyledUiCommon>
  )
}

export default UiCommon
