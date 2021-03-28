import React from 'react';
import styled from '@emotion/styled';
import { SvgPathIcon, GridButtons } from '@aglyn/ui-common';

const StyledPage = styled.div`
  .page {
  }
`;

export function Index() {
  /*
   * Replace the elements below with your own.
   *
   * Note: The corresponding styles are in the ./index.@emotion/styled file.
   */
  return (
    <StyledPage>
      <h2>Resources &amp; Tools</h2>
      <p>Thank you for using and showing some ♥ for Nx.</p>
      <SvgPathIcon iconId={'bug'}/>
      <GridButtons
        items={[
          {
            GridItemProps: {
              xs: 6
            },
            children: 'Hello Button 1',
            variant: 'contained',
            color: 'primary',
            fullWidth: true
          },
          {
            GridItemProps: {
              xs: 3
            },
            children: 'Hello Button 1',
            variant: 'contained',
            color: 'primary',
            fullWidth: true
          },
          {
            GridItemProps: {
              xs: 3
            },
            children: 'Hello Button 1',
            variant: 'contained',
            color: 'primary',
            fullWidth: true
          }
        ]}
      />
    </StyledPage>
  );
}

export default Index;
