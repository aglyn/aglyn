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
'use client'

// import { EmotionCacheProvider } from '@aglyn/shared-ui-jsx'
// import { Experimental_CssVarsProvider as MuiCssVarsProvider } from
// '@mui/material/styles'  export default function ThemeRegistry({ children })
// { return ( <EmotionCacheProvider> <MuiCssVarsProvider
// defaultMode="system">{children}</MuiCssVarsProvider> </EmotionCacheProvider>
// ) }

import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles'
import EmotionCacheProvider from './emotion-cache-provider'
import defaultTheme from './theme-config'

export interface ThemeProviderProps {
  children?: JSX.Children
}

export default function ThemeProvider(props: ThemeProviderProps) {
  const { children } = props
  return (
    <EmotionCacheProvider options={{ key: 'mui' }}>
      <MuiThemeProvider theme={defaultTheme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </EmotionCacheProvider>
  )
}
