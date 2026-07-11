import { loadMdiIcons } from '@aglyn/shared-data-mdi'
describe('loadMdiIcons', () => {
  it('loads the catalog', async () => {
    const icons = await loadMdiIcons()
    expect(icons.size).toBeGreaterThan(6000)
  })
})
