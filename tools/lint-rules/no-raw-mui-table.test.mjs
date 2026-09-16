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

// Standalone RuleTester harness (run: `npm run test:eslint-rules`).
//
// The first invalid case is the AGL-3045 instance verbatim in shape: the staff
// org AI card's "Generation jobs" table, a bare `Table` inside a card that
// clipped its Started column. The rest are the other doors a raw table comes
// back through — an alias, the subpath default import the customer-page Table
// element used, a namespace, `styled()`, a component handed on as a value, a
// re-export, a lazy import, and a hand-rolled `TableContainer`.
//
// The valid cases are what looks like the violation and is not: the rows and
// cells a `ScrollTable` holds, `ScrollTable`'s own module, an import nothing
// renders, a type, a local component that happens to be called `Table`, and a
// raw HTML `<table>`. If the rule ever reports one of those, the next person
// will switch it off rather than argue with it.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule, { SCROLL_TABLE_MODULE } from './no-raw-mui-table.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const CARD = '/repo/libs/plugins/ai/src/lib/components/staff-org-ai-card.component.tsx'
const WRAPPER = `/repo/${SCROLL_TABLE_MODULE}`

const raw = (component) => ({ messageId: 'rawTable', data: { component } })

ruleTester.run('no-raw-mui-table', rule, {
  valid: [
    // THE FIX. Same rows and cells; the table is drawn through the wrapper.
    {
      filename: CARD,
      code: `import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
         import { TableBody, TableCell, TableHead, TableRow } from '@mui/material'
         const Tokens = ({ kinds }: any) => (
           <ScrollTable size="small">
             <TableHead><TableRow><TableCell>{'Kind'}</TableCell></TableRow></TableHead>
             <TableBody>{kinds.map((k: any) => (
               <TableRow key={k.kind}><TableCell>{k.kind}</TableCell></TableRow>
             ))}</TableBody>
           </ScrollTable>
         )`,
    },

    // A record list, through the grid.
    {
      filename: CARD,
      code: `import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
         const Jobs = ({ rows, columns }: any) => <ListTable rows={rows} columns={columns} hideFooter />`,
    },

    // The one module that draws MUI's Table, because it is where the scroll
    // box goes around it.
    {
      filename: WRAPPER,
      code: `import { Table, TableContainer } from '@mui/material'
         export const ScrollTable = (props: any) => (
           <TableContainer><Table {...props} /></TableContainer>
         )`,
    },

    // An import nothing renders draws nothing.
    {
      filename: CARD,
      code: `import { Alert, Table, Stack } from '@mui/material'
         const C = () => <Stack><Alert /></Stack>`,
    },

    // Types draw nothing either.
    {
      filename: CARD,
      code: `import type { TableProps } from '@mui/material'
         import { type TableContainerProps } from '@mui/material'
         import { Table } from '@mui/material'
         type Props = TableProps & TableContainerProps & React.ComponentProps<typeof Table>`,
    },

    // A component that happens to share the name, from somewhere else.
    {
      filename: CARD,
      code: `import { Table } from './pricing-table'
         const C = () => <Table plans={[]} />`,
    },

    // Shadowed: the JSX resolves to the local binding, not the import.
    {
      filename: CARD,
      code: `import { Table } from '@mui/material'
         const C = ({ Custom }: any) => {
           const Table = Custom
           return <Table />
         }`,
    },

    // Other MUI table parts, and other components on the subpath shape.
    {
      filename: CARD,
      code: `import TableBody from '@mui/material/TableBody'
         import { tableClasses } from '@mui/material/Table'
         import * as Mui from '@mui/material'
         const C = () => (
           <Mui.TableRow className={tableClasses.root}><TableBody /></Mui.TableRow>
         )`,
    },

    // A raw HTML table is not a MUI Table — an email template is built of them.
    {
      filename: CARD,
      code: `const C = () => <table><tbody><tr><td>{'Hello'}</td></tr></tbody></table>`,
    },
  ],

  invalid: [
    // AGL-3045. The card's own children never reach past its edge, and a
    // bare table is the one child that does.
    {
      filename: CARD,
      code: `import {
           Alert,
           Chip,
           Stack,
           Table,
           TableBody,
           TableCell,
           TableHead,
           TableRow,
           Typography,
         } from '@mui/material'
         function JobsSection({ jobs }: any) {
           return (
             <Stack spacing={1}>
               <Table size="small">
                 <TableHead>
                   <TableRow>
                     <TableCell>{'Job'}</TableCell>
                     <TableCell>{'Started'}</TableCell>
                   </TableRow>
                 </TableHead>
               </Table>
             </Stack>
           )
         }`,
      errors: [raw('Table')],
    },

    // An alias is the same component.
    {
      filename: CARD,
      code: `import { Table as MuiTable } from '@mui/material'
         const C = () => <MuiTable size="small" />`,
      errors: [raw('Table')],
    },

    // The subpath default import, as the customer-page Table element spelled
    // it — and the `{ default as … }` spelling of the same thing.
    {
      filename: CARD,
      code: `import Table from '@mui/material/Table'
         import { default as Container } from '@mui/material/TableContainer'
         const C = () => <Container><Table size="small" /></Container>`,
      errors: [raw('TableContainer'), raw('Table')],
    },

    // A namespace import, in JSX and as a value.
    {
      filename: CARD,
      code: `import * as Mui from '@mui/material'
         const Box = Mui.TableContainer
         const C = () => <Box><Mui.Table /></Box>`,
      errors: [raw('TableContainer'), raw('Table')],
    },

    // A hand-rolled scroll box beside the shared one.
    {
      filename: CARD,
      code: `import { Table, TableContainer } from '@mui/material'
         const C = () => (
           <TableContainer sx={{ overflowX: 'auto' }}>
             <Table size="small" aria-label="What the merge keeps" />
           </TableContainer>
         )`,
      errors: [raw('TableContainer'), raw('Table')],
    },

    // Every non-JSX way to use it still renders it somewhere.
    {
      filename: CARD,
      code: `import { styled } from '@mui/material/styles'
         import { Box, Table } from '@mui/material'
         const Dense = styled(Table)({ tableLayout: 'fixed' })
         const C = () => <Box component={Table} />`,
      errors: [raw('Table'), raw('Table')],
    },

    // A re-export hands the raw component to a module that never imports MUI.
    {
      filename: CARD,
      code: `export { Table, TableRow } from '@mui/material'
         export { default as Grid } from '@mui/material/Table'
         export * from '@mui/material/TableContainer'`,
      errors: [raw('Table'), raw('Table'), raw('TableContainer')],
    },

    // Deferred, it is still a raw table once it loads.
    {
      filename: CARD,
      code: `const Lazy = lazy(() => import('@mui/material/Table'))
         const Required = require('@mui/material/TableContainer')`,
      errors: [raw('Table'), raw('TableContainer')],
    },
  ],
})

// The one exempt module is named by path, so a rename must fail here rather
// than leave the rule exempting a file that no longer exists.
assert.ok(
  existsSync(join(ROOT, SCROLL_TABLE_MODULE)),
  `${SCROLL_TABLE_MODULE} exists — the one module the rule lets draw a table`,
)

console.log('no-raw-mui-table: all cases passed')
