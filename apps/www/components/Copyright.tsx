import React from 'react'
import Typography, { TypographyProps } from '@material-ui/core/Typography'
import { currentYear, APP } from '../const'

function Copyright(props: Props) {
  return (
    <Typography variant="subtitle2" {...props}>
      {currentYear} &copy; {APP.LEGAL_NAME}
    </Typography>
  )
}

Copyright.displayName = 'Copyright'

export interface Props extends TypographyProps { }

export default Copyright