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
import type { Theme, ThemeOptions } from '../vendor/mui'
import { consoleOptions, consoleOptionsDark } from './console.theme'
import createResponsiveTheme from './util/create-responsive-theme'

/**
 * Dialogs on a phone, for the console's own chrome only.
 *
 * MUI keeps 32px around every dialog paper, which leaves a 375px phone a
 * 311px column — and a `md`/`lg` dialog, laid out for a table or an editor,
 * squeezed into it. Below `sm` the margin halves, and the wide dialogs take
 * the whole screen: the same paper `fullScreen` draws, which is MUI's
 * responsive full-screen dialog arrived at once instead of per call site.
 * A dialog that asked for `fullScreen` is left alone.
 *
 * Kept off `consoleOptions`, which customer sites inherit for component
 * behavior: a customer site's dialogs are its author's to lay out.
 */
const consoleChromeComponents: ThemeOptions['components'] = {
  /*
   * An alert carrying an action button — an upsell's "View add-ons", a
   * notice's "Open" — on a phone. MUI lays message and action in one row,
   * so the button squeezed to a word per line beside a paragraph. Below
   * `sm` the action takes its own line under the message instead. A bare
   * close button (`onClose` with no `action`) keeps its corner.
   */
  MuiAlert: {
    styleOverrides: {
      root: ({ theme, ownerState }: any) =>
        ownerState?.action
          ? { [theme.breakpoints.down('sm')]: { flexWrap: 'wrap' } }
          : {},
      action: ({ theme, ownerState }: any) =>
        ownerState?.action
          ? {
              [theme.breakpoints.down('sm')]: {
                flexBasis: '100%',
                marginLeft: 0,
                marginRight: 0,
                paddingLeft: 0,
                paddingTop: 0,
                justifyContent: 'flex-end',
              },
            }
          : {},
    },
  },
  /*
   * Every list footer on a phone — the DataGrid's, `ListPagination` and the
   * bare ones. "Rows per page", its select and the range are one ~420px
   * line, so on a 375px screen the footer scrolled sideways inside its own
   * card. Below `sm` the label and the spacer before it go; the select and
   * the range stay, and the select keeps the label as its accessible name.
   */
  MuiTablePagination: {
    styleOverrides: {
      toolbar: ({ theme }: any) => ({
        [theme.breakpoints.down('sm')]: { paddingLeft: theme.spacing(1) },
      }),
      spacer: ({ theme }: any) => ({
        [theme.breakpoints.down('sm')]: { display: 'none' },
      }),
      selectLabel: ({ theme }: any) => ({
        [theme.breakpoints.down('sm')]: { display: 'none' },
      }),
      input: ({ theme }: any) => ({
        [theme.breakpoints.down('sm')]: {
          marginLeft: 0,
          marginRight: theme.spacing(1),
        },
      }),
      actions: ({ theme }: any) => ({
        [theme.breakpoints.down('sm')]: { marginLeft: theme.spacing(0.5) },
      }),
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: ({ theme, ownerState }: any) => {
        if (ownerState?.fullScreen) return {}
        const wide = !['xs', 'sm'].includes(ownerState?.maxWidth)
        return {
          [theme.breakpoints.down('sm')]: wide
            ? {
                margin: 0,
                width: '100%',
                maxWidth: '100%',
                height: '100%',
                maxHeight: 'none',
                borderRadius: 0,
              }
            : {
                margin: theme.spacing(2),
                maxWidth: `calc(100% - ${theme.spacing(4)})`,
                maxHeight: `calc(100% - ${theme.spacing(4)})`,
              },
        }
      },
      paperFullWidth: ({ theme, ownerState }: any) =>
        ownerState?.fullScreen || !['xs', 'sm'].includes(ownerState?.maxWidth)
          ? {}
          : {
              [theme.breakpoints.down('sm')]: {
                width: `calc(100% - ${theme.spacing(4)})`,
              },
            },
    },
  },
}

const withConsoleChrome = (options: ThemeOptions): ThemeOptions => ({
  ...options,
  components: { ...options.components, ...consoleChromeComponents },
})

/**
 * The console app's own themes: `consoleThemeLight`/`consoleThemeDark` plus
 * the phone chrome above. A module of its own, outside the package barrel, so
 * a published page — which reaches `console.theme` for the brand themes —
 * never carries it. Import it as `@aglyn/shared-ui-theme/console-app.theme`.
 */
export const consoleAppThemeLight: Theme = createResponsiveTheme({
  themeOptions: withConsoleChrome(consoleOptions),
})
export const consoleAppThemeDark: Theme = createResponsiveTheme({
  themeOptions: withConsoleChrome(consoleOptionsDark),
})
