import { describe, it, expect } from 'vitest'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const order: string[] = []

function Child() {
  useEffect(() => {
    return () => order.push('child-cleanup')
  }, [])
  return <span>child</span>
}

function Parent() {
  useEffect(() => {
    return () => order.push('parent-cleanup')
  }, [])
  return <div><Child /></div>
}

describe('effect cleanup order on unmount', () => {
  it('records order', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<Parent />) })
    await act(async () => { root.unmount() })
    console.log('ORDER:', JSON.stringify(order))
    expect(order).toEqual(['MARKER'])
  })
})
