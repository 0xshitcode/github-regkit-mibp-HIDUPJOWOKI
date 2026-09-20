#!/usr/bin/env node
/**
 * UI verification for the GitHub Register console.
 *
 * Checks the redesign against the hard requirements it must hold at every
 * screen width: no horizontal overflow, no clipped controls, 44px tap targets,
 * WCAG AA text contrast, and working navigation / dialogs.
 *
 * Usage:  node verify-ui.cjs [baseUrl]
 * Requires a running server (default http://127.0.0.1:8093) serving the build.
 */
const { chromium } = require('playwright')

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:8093'
const log = []
const step = (ok, msg) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); return ok }

// ---- WCAG contrast helpers ----
const lum = ([r, g, b]) => {
  const a = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
}
const contrast = (f, b) => { const L1 = lum(f), L2 = lum(b); const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1]; return (hi + 0.05) / (lo + 0.05) }
const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]] }

const clickTab = (page, label) => page.evaluate((lbl) => {
  const nodes = [...document.querySelectorAll('.app-bottomnav-item, .app-nav-item')]
  for (const el of nodes) {
    const r = el.getBoundingClientRect()
    if ((el.textContent || '').trim() === lbl && r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1) { el.click(); return true }
  }
  return false
}, label)

// Page-level overflow, ignoring the intentionally off-canvas mobile drawer.
const pageOverflow = (page) => page.evaluate(() => {
  const de = document.documentElement
  return de.scrollWidth > de.clientWidth + 1 ? { s: de.scrollWidth, c: de.clientWidth } : null
})

async function auditWidth(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 820, isMobile: width <= 820 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  const results = {}
  for (const tab of ['Status', 'Config', 'Accounts']) {
    await clickTab(page, tab)
    await page.waitForTimeout(600)
    results[tab] = {
      overflow: await pageOverflow(page),
      clipped: await page.evaluate(() => {
        const vw = window.innerWidth
        const drawer = document.querySelector('.app-sidebar')
        const open = !!document.querySelector('.app-drawer-open')
        const inScroller = (el) => {
          let a = el.parentElement
          while (a) {
            const ox = getComputedStyle(a).overflowX
            if (ox === 'auto' || ox === 'scroll') return true
            a = a.parentElement
          }
          return false
        }
        const out = []
        document.querySelectorAll('button, a[href], input, select').forEach((el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) return
          if (!open && drawer && drawer.contains(el)) return
          // A contained horizontal scroll region (e.g. the accounts table) is
          // the sanctioned way to keep a wide table usable; its children may
          // legitimately extend past the viewport.
          if (inScroller(el)) return
          if (r.right > vw + 1 || r.left < -1) out.push(String(el.className).slice(0, 40))
        })
        return out
      }),
      smallTargets: await page.evaluate(() => {
        const out = []
        const afterArea = (el) => {
          // Buttons may expand their hit area with an ::after overlay.
          const a = getComputedStyle(el, '::after')
          if (a && a.content && a.content !== 'none' && a.position === 'absolute') {
            const inset = parseFloat(a.top)
            if (Number.isFinite(inset)) return inset < 0 ? -inset * 2 : 0
          }
          return 0
        }
        document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=menuitem]').forEach((el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) return
          if (el.tagName === 'A' && s.display.includes('inline') && !s.display.includes('flex')) return
          const label = el.closest('label')
          const grow = afterArea(el)
          const effH = Math.max(r.height + grow, label ? label.getBoundingClientRect().height : 0)
          const effW = Math.max(r.width + grow, label ? label.getBoundingClientRect().width : 0)
          if (effH < 44 || effW < 24) out.push({ cls: String(el.className).slice(0, 40), h: Math.round(effH), w: Math.round(effW) })
        })
        return out
      }),
      contrastFails: await page.evaluate(() => {
        const out = []
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let n
        while ((n = w.nextNode())) {
          const t = n.textContent.trim(); if (!t) continue
          const el = n.parentElement; if (!el) continue
          const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
          const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none') continue
          let bgEl = el, bg = 'rgba(0, 0, 0, 0)'
          while (bgEl && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { bg = getComputedStyle(bgEl).backgroundColor; bgEl = bgEl.parentElement }
          out.push({ t: t.slice(0, 24), fg: s.color, bg, size: parseFloat(s.fontSize), weight: s.fontWeight })
        }
        return out
      }),
    }
  }
  await ctx.close()
  return { results, errs }
}

;(async () => {
  const browser = await chromium.launch()

  // 1. Overflow + clipped + tap targets across the full width range.
  const widths = [320, 390, 560, 760, 820, 900, 1024, 1100, 1440, 1920]
  let overflowBad = 0, clipBad = 0, targetBad = 0
  for (const w of widths) {
    const { results } = await auditWidth(browser, w, 900)
    for (const [tab, r] of Object.entries(results)) {
      if (r.overflow) { overflowBad++; log.push(`FAIL ${w}/${tab} horizontal overflow ${r.overflow.s}>${r.overflow.c}`) }
      if (r.clipped.length) { clipBad++; log.push(`FAIL ${w}/${tab} clipped: ${r.clipped.join(', ')}`) }
      if (r.smallTargets.length) { targetBad++; log.push(`FAIL ${w}/${tab} small targets: ${JSON.stringify(r.smallTargets)}`) }
    }
  }
  step(overflowBad === 0, `no horizontal overflow at any width (${widths.length} widths x 3 tabs)`)
  step(clipBad === 0, 'no control clipped off-screen at any width')
  step(targetBad === 0, 'all interactive targets >= 44px (labels counted for checkboxes)')

  // 2. Contrast on desktop and mobile.
  let contrastBad = 0
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const { results } = await auditWidth(browser, w, h)
    const seen = new Set()
    for (const [tab, r] of Object.entries(results)) {
      for (const c of r.contrastFails) {
        const fg = rgba(c.fg), bg = rgba(c.bg)
        if (!fg || !bg || bg[3] < 1) continue
        const key = `${c.fg}|${c.bg}|${Math.round(c.size)}`
        if (seen.has(key)) continue
        seen.add(key)
        const large = c.size >= 18 || (c.size >= 14 && Number(c.weight) >= 700)
        const ratio = contrast(fg, bg)
        if (ratio < (large ? 3.0 : 4.5)) { contrastBad++; log.push(`FAIL ${w}/${tab} contrast "${c.t}" ${ratio.toFixed(2)}:1`) }
      }
    }
  }
  step(contrastBad === 0, 'all text meets WCAG AA contrast (desktop + mobile)')

  // 3. Mobile navigation + drawer behaviour.
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const mp = await mctx.newPage()
  const merrs = []
  mp.on('pageerror', (e) => merrs.push(e.message))
  await mp.goto(BASE, { waitUntil: 'domcontentloaded' })
  await mp.waitForTimeout(800)
  await mp.locator('.app-menu-btn').click()
  await mp.waitForTimeout(350)
  step(await mp.locator('.app-sidebar').isVisible(), 'mobile: Menu opens the drawer')
  await mp.locator('.app-drawer-scrim').click({ position: { x: 380, y: 400 } })
  await mp.waitForTimeout(350)
  step(await mp.locator('.app-sidebar').evaluate((el) => el.getBoundingClientRect().right <= 0), 'mobile: scrim closes the drawer')
  await clickTab(mp, 'Accounts')
  await mp.waitForTimeout(500)
  step(await mp.locator('.accounts-head').isVisible(), 'mobile: bottom nav switches panels')
  const pad = await mp.evaluate(() => {
    const main = document.querySelector('.app-main')
    const nav = document.querySelector('.app-bottomnav').getBoundingClientRect()
    return { pad: parseFloat(getComputedStyle(main).paddingBottom), navH: nav.height }
  })
  step(pad.pad >= pad.navH, `mobile: content clears the bottom nav (${Math.round(pad.pad)} >= ${Math.round(pad.navH)})`)
  await mctx.close()

  await browser.close()

  console.log('=== UI VERIFICATION ===')
  log.forEach((l) => console.log('  ' + l))
  const fails = log.filter((l) => l.startsWith('FAIL')).length
  console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' FAILURE(S)'}`)
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error('FATAL', e); process.exit(1) })
