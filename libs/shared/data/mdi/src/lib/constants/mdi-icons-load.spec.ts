import { loadMdiIcons } from './mdi-icons'
describe('loadMdiIcons', () => {
  it('loads the catalog', async () => {
    const icons = await loadMdiIcons()
    expect(icons.size).toBeGreaterThan(6000)
  })
})
