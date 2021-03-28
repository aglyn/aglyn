import { MouseEventHandler, useState, useCallback } from 'react'


export type MouseX = MouseEvent['clientX']
export type MouseY = MouseEvent['clientY']
export type MousePosition = { x: MouseX, y: MouseY }

export function useMousePosition (initialValue = { x: 0, y: 0 }): [MousePosition, MouseEventHandler<any>] {
  const [position, setPosition] = useState(initialValue)
  const handleMouseMove = useCallback((event) => (
    setPosition({
      x: (event || {}).clientX,
      y: (event || {}).clientY
    })
  ), [setPosition])

  return [position, handleMouseMove]
}

export default useMousePosition
