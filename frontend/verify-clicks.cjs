const { chromium } = require('playwright')
const BASE = process.env.BASE || 'http://127.0.0.1:8093'

const log = []
const step = (ok, msg) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); return ok }

async function clickTab(page, label) {
  await page.evaluate((lbl) => {
    const nodes = [...document.querySelectorAll('.app-bottomnav-item, .app-nav-item')]
    for (const el of nodes) { const r = el.getBoundingClientRect(); if ((el.textContent || '').trim() === lbl && r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1) { el.click(); return } }
  }, label)
  await page.waitForTimeout(500)
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)

  // 1. Status tab: count stepper +/-, Start/Stop buttons exist and are wired.
  step(await page.locator('.status-stepper-btn').first().isVisible(), 'Status: count stepper visible')
  const before = await page.locator('.status-count-input').inputValue()
  await page.locator('.status-stepper-btn').last().click()
  await page.waitForTimeout(150)
  const after = await page.locator('.status-count-input').inputValue()
  step(Number(after) === Number(before) + 1, `Status: "+" increments count (${before} -> ${after})`)
  await page.locator('.status-stepper-btn').first().click()
  await page.waitForTimeout(150)
  step((await page.locator('.status-count-input').inputValue()) === before, 'Status: "-" decrements count')

  // 2. Log terminal: Clear button empties lines.
  const linesBefore = await page.locator('.log-line').count()
  await page.locator('.log-toolbar .ui-button').click()
  await page.waitForTimeout(300)
  const linesAfter = await page.locator('.log-line').count()
  step(linesAfter === 0, `Log: Clear empties terminal (${linesBefore} -> ${linesAfter})`)
  step(await page.locator('.log-terminal .ui-empty-state').isVisible(), 'Log: empty state shown after clear')

  // 3. Auto-scroll checkbox toggles.
  await page.locator('.log-follow input[type=checkbox]').click()
  await page.waitForTimeout(100)
  step(!(await page.locator('.log-follow input[type=checkbox]').isChecked()), 'Log: auto-scroll checkbox toggles')

  // 4. Accounts tab.
  await clickTab(page, 'Accounts')
  step(await page.locator('.accounts-head').isVisible(), 'Accounts: header renders')
  const exportBtn = page.locator('.export-wrap .ui-button')
  step(await exportBtn.isVisible(), 'Accounts: Export button visible')
  await exportBtn.click()
  await page.waitForTimeout(250)
  step(await page.locator('.action-menu-inline').isVisible(), 'Accounts: Export menu opens')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  step(!(await page.locator('.action-menu-inline').isVisible()), 'Accounts: Export menu closes on Escape')

  // 5. Config tab: provider radios switch fields.
  await clickTab(page, 'Config')
  step(await page.locator('.cfg-columns').isVisible(), 'Config: layout renders')
  const litensi = page.locator('label:has-text("Litensi")').first()
  await litensi.click()
  await page.waitForTimeout(300)
  step(await page.locator('text=Litensi API ID').isVisible(), 'Config: switching to Litensi shows its fields')
  await page.locator('label:has-text("Mail.cx")').first().click()
  await page.waitForTimeout(300)
  step(await page.locator('text=Mail.cx Domain').first().isVisible(), 'Config: switching back to Mail.cx shows its fields')

  // 6. Zones modal (uses the design-system modal) opens + closes.
  await page.locator('label:has-text("Litensi")').first().click()
  await page.waitForTimeout(250)
  const zonesBtn = page.locator('button:has-text("Zones")').first()
  if (await zonesBtn.isVisible()) {
    await zonesBtn.click()
    await page.waitForTimeout(1200)
    const modalOpen = await page.locator('.glass').first().isVisible()
    step(modalOpen, 'Config: Zones modal opens')
    if (modalOpen) {
      await page.locator('.glass button:has-text("Close")').click()
      await page.waitForTimeout(300)
      step(!(await page.locator('.glass').first().isVisible()), 'Config: Zones modal closes')
    }
  }

  // 7. New group dialog: open, type, cancel.
  await page.locator('.app-nav-add').click()
  await page.waitForTimeout(300)
  step(await page.locator('.ui-dialog').isVisible(), 'Group: New group dialog opens')
  await page.locator('.ui-dialog input').fill('TestGroup')
  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  step(!(await page.locator('.ui-dialog').isVisible()), 'Group: dialog closes on Escape')

  // 8. Sidebar collapse toggle (desktop).
  await page.locator('.app-sidebar-toggle').click()
  await page.waitForTimeout(300)
  const collapsed = await page.locator('.app-shell-collapsed').count()
  step(collapsed > 0, 'Sidebar: collapse toggle works')
  await page.locator('.app-sidebar-toggle').click()
  await page.waitForTimeout(300)

  // 9. Keyboard: Tab reaches a focusable control with visible focus.
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  step(['BUTTON', 'A', 'INPUT'].includes(focused), `Keyboard: Tab focuses a control (${focused})`)

  await ctx.close()

  // Mobile pass: drawer open/close, bottom nav switches.
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const mp = await mctx.newPage()
  mp.on('console', (m) => m.type() === 'error' && errs.push('[mobile] ' + m.text()))
  mp.on('pageerror', (e) => errs.push('[mobile] pageerror: ' + e.message))
  await mp.goto(BASE, { waitUntil: 'domcontentloaded' })
  await mp.waitForTimeout(900)

  await mp.locator('.app-menu-btn').click()
  await mp.waitForTimeout(350)
  step(await mp.locator('.app-sidebar').isVisible(), 'Mobile: Menu opens drawer')
  await mp.locator('.app-drawer-scrim').click({ position: { x: 380, y: 400 } })
  await mp.waitForTimeout(350)
  const drawerGone = await mp.locator('.app-sidebar').evaluate((el) => el.getBoundingClientRect().right <= 0)
  step(drawerGone, 'Mobile: scrim click closes drawer')
  await clickTab(mp, 'Accounts')
  step(await mp.locator('.accounts-head').isVisible(), 'Mobile: bottom nav switches to Accounts')
  await clickTab(mp, 'Status')
  step(await mp.locator('.status-metrics').isVisible(), 'Mobile: bottom nav switches back to Status')

  // Bottom nav must be fixed and content must clear it.
  const clear = await mp.evaluate(() => {
    const nav = document.querySelector('.app-bottomnav')
    const main = document.querySelector('.app-main')
    const navR = nav.getBoundingClientRect()
    const pad = parseFloat(getComputedStyle(main).paddingBottom)
    return { navTop: Math.round(navR.top), viewportH: window.innerHeight, pad: Math.round(pad), navH: Math.round(navR.height) }
  })
  step(clear.pad >= clear.navH, `Mobile: content padding (${clear.pad}) >= bottom nav height (${clear.navH})`)
  await mctx.close()
  await browser.close()

  console.log('=== CLICK-THROUGH ===')
  log.forEach((l) => console.log('  ' + l))
  console.log('\n=== CONSOLE ERRORS ===')
  console.log(errs.length ? errs.join('\n') : '(none)')
  const fails = log.filter((l) => l.startsWith('FAIL')).length
  console.log(`\nFailures: ${fails}, console errors: ${errs.length}`)
  process.exit(fails || errs.length ? 1 : 0)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
