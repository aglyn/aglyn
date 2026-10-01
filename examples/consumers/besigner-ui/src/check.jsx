// `npm run check`: loads the sample document, renders the editor in Node, and
// renders its element tree and inspector with an element selected. It exits
// non-zero on the first thing that does not hold, so it can run in CI.

import { canvas, components, NODE_ROOT_ID } from '@aglyn/aglyn'
import { focus, initializeBesignerApp } from '@aglyn/besigner'
import { AsidePanelComponent, withBesignerContext } from '@aglyn/besigner-ui'
import { consoleThemeDark, consoleThemeLight, ThemeCssVarProvider } from '@aglyn/shared-ui-theme'
import { renderToString } from 'react-dom/server'
import { App } from './App.jsx'
import { currentDocument, loadDocument } from './document.js'

const failures = []
const expect = (holds, message) => {
  if (!holds) failures.push(message)
}

initializeBesignerApp()
loadDocument()
expect(canvas.getNode(NODE_ROOT_ID)?.nodes?.join() === 'hero', 'the sample document did not load')
expect(Object.keys(components.presets).length === 3, 'the Elements tab has nothing to offer')

// What the toolbar's Save writes is what loading takes back.
const saved = JSON.parse(JSON.stringify(currentDocument()))
loadDocument(saved)
expect(canvas.getNode('title')?.props?.text === 'Besigner, outside the console', 'a saved document did not load back')

const app = renderToString(<App />)
expect(app.includes('Besigner UI example'), 'the app did not render')
expect(app.includes('aglyn:besigner-workspace'), 'the editor workspace did not render')

// The side panels load on the client in the app; rendered here directly,
// with an element selected, they draw the element tree and the inspector.
focus.setSelectedNode(canvas.getNode('title'))
const Panels = withBesignerContext(function Panels() {
  return (
    <>
      <AsidePanelComponent panel="panelLeft" />
      <AsidePanelComponent panel="panelRight" />
    </>
  )
})
const panels = renderToString(
  <ThemeCssVarProvider theme={{ light: consoleThemeLight, dark: consoleThemeDark }}>
    <Panels />
  </ThemeCssVarProvider>,
)
for (const text of ['Section', 'Heading']) {
  expect(panels.includes(text), `the side panels do not name the ${text.toLowerCase()}`)
}

if (failures.length) {
  console.error(`check: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('check: the document loads and saves, and the editor renders with an element selected')
