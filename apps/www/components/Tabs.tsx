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

import React from 'react'
import { fade, makeStyles, Theme } from '@material-ui/core/styles'
import AppBar from '@material-ui/core/AppBar'
import MuiTabs from '@material-ui/core/Tabs'
import MuiTab from '@material-ui/core/Tab'
import Typography from '@material-ui/core/Typography'
import Box from '@material-ui/core/Box'
import { GridButtons, SvgPathIcon } from '@aglyn/shared/ui/react'


interface TabPanelProps {
  children?: React.ReactNode
  index: any
  value: any
}

function TabPanel(props: TabPanelProps) {
  const {children, value, index, ...other} = props

  return (
    <div
      aria-labelledby={`simple-tab-${index}`}
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      role="tabpanel"
      {...other}
    >
      {value === index && (
        <Box p={3}>
          <Typography>{children}</Typography>
        </Box>
      )}
    </div>
  )
}

function a11yProps(index: any) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`,
  }
}

const useStyles = makeStyles((theme: Theme) => ({
  root: {
    flexGrow: 1,
    // backgroundColor: theme.palette.background.paper,
    backgroundColor: fade(theme.palette.primary.light, 0.12),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
}))

export default function Tabs() {
  const classes = useStyles()
  const [value, setValue] = React.useState(0)

  const handleChange = (event: React.ChangeEvent<{}>, newValue: number) => {
    setValue(newValue)
  }

  return (
    <div className={classes.root}>
      <AppBar color="primary" elevation={1} position="static">
        <MuiTabs
          aria-label="simple tabs example"
          indicatorColor="secondary"
          scrollButtons="auto"
          textColor="inherit"
          value={value}
          variant="scrollable"
          onChange={handleChange}
        >
          <MuiTab label="Home" {...a11yProps(0)} icon={<SvgPathIcon iconId="home" />} />
          <MuiTab label="View" {...a11yProps(1)} icon={<SvgPathIcon iconId="eye" />} />
          {/* <MuiTab label="Item Two" {...a11yProps(2)} />
           <MuiTab label="Item Three" {...a11yProps(3)} /> */}
        </MuiTabs>
      </AppBar>
      <TabPanel index={0} value={value}>
        <GridButtons
          items={[
            {
              component: Box,
              height: 100, width: 100,
              variant: 'contained',
              color: 'secondary',
              children: (
                <div align="center">
                  <div><SvgPathIcon fontSize="large" iconId="file-document-multiple" /></div>
                  <div>Entries</div>
                </div>
              ),
            },
          ]}
          spacing={3}
        />
      </TabPanel>
      <TabPanel index={1} value={value}>
        <GridButtons
          items={[
            {
              component: Box,
              height: 100, width: 100,
              variant: 'contained',
              color: 'secondary',
              children: (
                <div align="center">
                  <div><SvgPathIcon fontSize="large" iconId="variable" /></div>
                  <div>Fields</div>
                </div>
              ),
            },
            {
              component: Box,
              height: 100, width: 100,
              variant: 'contained',
              color: 'secondary',
              children: (
                <div align="center">
                  <div><SvgPathIcon fontSize="large" iconId="check-network" /></div>
                  <div>Rules</div>
                </div>
              ),
            },
            {
              component: Box,
              height: 100, width: 100,
              variant: 'contained',
              color: 'secondary',
              children: (
                <div align="center">
                  <div><SvgPathIcon fontSize="large" iconId="chart-sankey-variant" /></div>
                  <div>Workflows</div>
                </div>
              ),
            },
          ]}
          spacing={3}
        />
      </TabPanel>
      <TabPanel index={2} value={value}>
        Item Two
      </TabPanel>
      <TabPanel index={3} value={value}>
        Item Three
      </TabPanel>
    </div>
  )
}
