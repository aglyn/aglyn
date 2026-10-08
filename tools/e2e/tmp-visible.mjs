import { chromium } from 'playwright-core'
import { chromeExecutable } from './lib/console-session.mjs'
const [sub, ...paths] = process.argv.slice(2)
const browser = await chromium.launch({ headless: true, ...chromeExecutable() })
const page = await browser.newPage()
for (const path of paths) {
  const r = await page.goto(`http://${sub}.localhost:4500${path}`, { waitUntil: 'load', timeout: 300000 }).catch((e) => ({ status: () => e.message.split('\n')[0] }))
  const text = await page.locator('body').innerText().catch(() => '')
  const prices = text.match(/[$€£]\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? []
  console.log(`${path} ${r.status()} | visible prices: ${prices.join(' ') || 'none'} | brackets: ${(text.match(/\[[^\]]+\]/g) ?? []).join(' ') || 'none'}`)
  if (process.env.SHOW === path) console.log(text.slice(0, 2500))
}
await browser.close()
