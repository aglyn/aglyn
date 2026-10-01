import { components } from '@aglyn/aglyn'
import { focus } from '@aglyn/besigner'
import { useReducer, useState } from 'react'
import { availableActions, commands, labelOf, outline } from './document.js'

/** Renders a node and its children with the components registered for them. */
function Preview({ node }) {
  const Component = components.getFactory(node.componentId)
  const children = node.children.map((child) => <Preview key={child.$id} node={child} />)
  if (!Component) return <>{children}</>
  const selected = focus.isNodeSelected(node)
  return (
    <div className={selected ? 'preview-node selected' : 'preview-node'}>
      <Component {...node.props}>{children}</Component>
    </div>
  )
}

const TOOLBAR = [
  ['copy', 'Copy'],
  ['paste', 'Paste'],
  ['moveOut', 'Move out'],
  ['moveIn', 'Move in'],
  ['undo', 'Undo'],
  ['redo', 'Redo'],
]

export function App() {
  // The canvas and the selection live in `@aglyn/aglyn` and `@aglyn/besigner`.
  // This component only redraws after it runs a command.
  const [, redraw] = useReducer((count) => count + 1, 0)
  const [status, setStatus] = useState('Select an element in the outline.')
  const run = (command, ...args) => {
    setStatus(commands[command](...args))
    redraw()
  }

  const rows = outline()
  const can = availableActions()

  return (
    <div className="editor">
      <header className="toolbar">
        {TOOLBAR.map(([command, label]) => (
          <button key={command} type="button" disabled={!can[command]} onClick={() => run(command)}>
            {label}
          </button>
        ))}
        <span className="status" role="status">
          {status}
        </span>
      </header>
      <nav className="outline" aria-label="Outline">
        <ul>
          {rows.slice(1).map(({ node, depth }) => (
            <li key={node.$id} style={{ paddingLeft: `${(depth - 1) * 16}px` }}>
              <button
                type="button"
                aria-pressed={focus.isNodeSelected(node)}
                onClick={() => run('select', node)}
              >
                {labelOf(node)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="preview">{rows[0] ? <Preview node={rows[0].node} /> : null}</div>
    </div>
  )
}
