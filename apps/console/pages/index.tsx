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

import {getApp} from '@aglyn/core-data-framework'
import {GridButtons} from '@aglyn/shared-ui-jsx'
import {mdiBug, MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import styled from '@emotion/styled'
import React from 'react'


const StyledPage = styled.div`
  .page {
  }
`

export function Index() {
  console.log('page:/index', getApp())

  /*
   * Replace the elements below with your own.
   *
   * Note: The corresponding styles are in the ./index.@emotion/styled file.
   */
  return (
    <StyledPage>
      <h2>Resources &amp; Tools</h2>
      <p>Thank you for using and showing some ♥ for Nx.</p>
      <MdiIcon path={mdiBug.path} />
      <GridButtons
        items={[
          {
            GridItemProps: {
              xs: 6,
            },
            children: 'Hello Button 1',
            variant: 'contained',
            color: 'primary',
            fullWidth: true,
          },
          {
            GridItemProps: {
              xs: 3,
            },
            children: 'Hello Button 1',
            variant: 'contained',
            color: 'primary',
            fullWidth: true,
          },
          {
            GridItemProps: {
              xs: 3,
            },
            children: 'Hello Button 1',
            variant: 'contained',
            color: 'primary',
            fullWidth: true,
          },
        ]}
      />
    </StyledPage>
  )
}

export default Index
