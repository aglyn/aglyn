// `npm run check`: loads the sample document, drives every command the
// toolbar offers, and renders the app in Node. It exits non-zero on the first
// thing that does not hold, so it can run in CI.

import { canvas, NODE_ROOT_ID } from '@aglyn/aglyn'
import { renderToString } from 'react-dom/server'
import { App } from './App.jsx'
import { availableActions, commands, loadDocument } from './document.js'

const failures = []
const expect = (holds, message) => {
  if (!holds) failures.push(message)
}
const childrenOf = (id) => [...(canvas.getNode(id)?.nodes ?? [])]

loadDocument()
expect(childrenOf(NODE_ROOT_ID).join() === 'hero,features', 'the sample document did not load')
expect(!availableActions().copy, 'copy was offered with nothing selected')

// Move the feature paragraph out of its section, then take it back.
commands.select(canvas.getNode('feature'))
expect(availableActions().moveOut, 'move out was not offered for a nested element')
commands.moveOut()
expect(childrenOf(NODE_ROOT_ID).join() === 'hero,features,feature', 'move out did not land after the container')
commands.undo()
expect(childrenOf('features').join() === 'feature', 'undo did not restore the move')
commands.redo()
expect(childrenOf(NODE_ROOT_ID).join() === 'hero,features,feature', 'redo did not repeat the move')
commands.undo()

// Copy the heading and paste it beside itself: a heading holds no children.
commands.select(canvas.getNode('title'))
commands.copy()
expect(availableActions().paste, 'paste was not offered after a copy')
const pasted = commands.paste()
const hero = childrenOf('hero')
expect(pasted === 'Pasted 1 element', `paste said "${pasted}"`)
expect(hero.length === 3 && hero[0] === 'title' && hero[2] === 'intro', 'the paste did not land beside the heading')
expect(canvas.getNode(hero[1])?.props?.text === 'Build your own editor', 'the pasted heading lost its text')

// The app renders the document it was given.
loadDocument()
const html = renderToString(<App />)
for (const text of ['Build your own editor', 'Select, move, copy, paste, undo and redo.', 'Section']) {
  expect(html.includes(text), `the rendered app is missing "${text}"`)
}

if (failures.length) {
  console.error(`check: ${failures.length} problem(s)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('check: the document loads, every command works, and the app renders')
