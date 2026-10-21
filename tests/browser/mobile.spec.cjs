const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, process.env.AQI_BROWSER_OUTPUT || 'test-results/mobile');
const base = 'http://aqi.test/aqi-atlas/';
const report = JSON.parse(fs.readFileSync(path.join(root, 'dist/report.json'), 'utf8'));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  try {
    for (const [width, height] of [[320, 740], [360, 800], [390, 844], [430, 932], [844, 390], [1440, 1000]]) {
      const mobile = width < 1000;
      const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, timezoneId: 'Asia/Shanghai' });
      const requests = [], errors = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url()); requests.push(url.pathname);
        const name = url.pathname === '/aqi-atlas/' ? 'index.html' : url.pathname.slice('/aqi-atlas/'.length);
        if (url.pathname.startsWith('/aqi-atlas/') && ['index.html', 'compare.html', 'source-policy.md'].includes(name)) {
          return route.fulfill({ body: fs.readFileSync(path.join(root, 'dist', name)), contentType: name.endsWith('.html') ? 'text/html' : 'text/plain' });
        }
        return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base);
      const selected = report.publication.selected_keys;
      await page.waitForSelector('#cities .city');
      assert.equal(await page.locator('#cities .city').count(), selected.length);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (mobile) {
        await page.screenshot({ path: path.join(output, `calendar-${width}.png`) });
        assert.equal(await page.locator('#city-picker').evaluate(n => n.parentElement.tagName), 'DIALOG');
        assert.equal(await page.locator('.site-navigation').evaluate(n => getComputedStyle(n).position), 'fixed');
        const firstCity = page.locator('#cities .city').first();
        assert.equal(await firstCity.locator('.stat:visible').count(), 4, 'All four annual statistics remain available');
        assert(await firstCity.locator('.mobile-calendar').isVisible());
        assert(await firstCity.locator('.calendar-wrap').isHidden());
        const month = page.locator('.mobile-month-switch select');
        assert.equal(await month.inputValue(), report.end_date.slice(0, 7));
        const day = firstCity.locator('.mobile-day:not(:disabled)').first();
        const date = await day.getAttribute('data-mobile-date');
        const city = report.cities.find(c => c.key === selected[0]), value = city.days.find(d => d.date === date)?.mean;
        assert.equal(await day.locator('strong').innerText(), value == null ? '\u2014' : value.toFixed(1));
        await day.click();
        assert.equal(await page.locator('.mobile-day.is-selected').count(), selected.length);
        assert((await firstCity.locator('.mobile-day-detail').innerText()).includes(date.replaceAll('-', '.')));
        const matchingFill = await page.evaluate(date => {
          const city = document.querySelector('#cities .city');
          return getComputedStyle(city.querySelector(`[data-mobile-date="${date}"]`)).backgroundColor === getComputedStyle(city.querySelector(`.calendar [data-date="${date}"]`)).fill;
        }, date);
        assert(matchingFill, 'Mobile day colors use the exact same AQI scale');
        await month.selectOption(report.start_date.slice(0, 7));
        assert(await page.locator('[data-month-prev]').isDisabled());
        assert(await firstCity.locator('.mobile-day').first().isDisabled(), 'Dates preceding the report range stay disabled');
        await page.locator('[data-calendar-view="year"]').click();
        assert(await firstCity.locator('.calendar-wrap').isHidden());
        const annual = firstCity.locator('.mobile-calendar');
        assert(await annual.isVisible());
        assert.equal(await annual.locator('.mobile-day:not(:disabled)').count(), 365, 'Annual month blocks preserve every day exactly once');
        assert(await annual.evaluate(n => n.scrollWidth <= n.clientWidth), 'Annual calendar fits the phone without horizontal scrolling');
        const monthBlocks = await annual.locator('.mobile-month').all();
        assert.equal(monthBlocks.length, await month.locator('option').count());
        for (let i = 1; i < monthBlocks.length; i++) {
          const previous = await monthBlocks[i - 1].boundingBox(), current = await monthBlocks[i].boundingBox();
          assert(current.y >= previous.y + previous.height, 'Annual months flow vertically');
        }
        const annualDay = annual.locator('.mobile-day:not(:disabled)').first();
        await annualDay.click();
        const annualDate = await annualDay.getAttribute('data-mobile-date');
        assert.equal(await annual.locator('.mobile-day-detail:visible').count(), 1);
        assert((await annual.locator('.mobile-day-detail:visible').innerText()).includes(annualDate.replaceAll('-', '.')));
        const yearValuesMatch = await firstCity.evaluate(city => [...city.querySelectorAll('.mobile-day:not(:disabled)')].every(day => getComputedStyle(day).backgroundColor === getComputedStyle(city.querySelector(`.calendar [data-date="${day.dataset.mobileDate}"]`)).fill));
        assert(yearValuesMatch, 'Every annual day retains the original AQI palette');
        await monthBlocks[0].screenshot({ path: path.join(output, `year-month-${width}.png`) });
        await page.locator('[data-calendar-view="month"]').click();
        await month.selectOption(report.end_date.slice(0, 7));
        assert(await page.locator('[data-month-next]').isDisabled());
        await firstCity.screenshot({ path: path.join(output, `month-card-${width}.png`) });

        await page.locator('[data-mobile-city-picker]').click();
        assert(await page.locator('dialog').evaluate(n => n.open));
        await page.locator('#city-query').fill(city.name);
        await page.locator('#city-search button').click();
        assert.equal(await page.locator('#search-results .search-result').count(), 1);
        const checkbox = page.locator(`input[name="city"][value="${selected[0]}"]`);
        await checkbox.uncheck(); await checkbox.check();
        assert.equal(await page.locator('#cities .city h2').last().innerText(), city.name, 'Reselection appends to city order');
        await page.locator('#city-query').fill('');
        await page.locator('dialog').screenshot({ path: path.join(output, `city-sheet-${width}.png`) });
        await page.locator('#clear-cities').click();
        assert.equal(await page.locator('#cities .city').count(), 0);
        assert(await page.locator('#mobile-calendar-tools').isHidden());
        assert(await page.locator('.mobile-section-jumps').isHidden());
        await page.locator('#select-all-cities').click();
        assert.equal(await page.locator('#cities .city').count(), selected.length);
        await page.locator('.mobile-sheet-close').click();
        assert.equal(await page.locator('dialog').evaluate(n => n.open), false);
        await page.locator('.mobile-section-jumps a[href="#monthly-section"]').click();
        await page.locator('[data-month-metric="good-share"]').click();
        assert.equal(await page.locator('#month-matrix tbody tr').count(), selected.length);
        const matrixBounds = await page.locator('.month-matrix-scroll').boundingBox();
        await page.locator('.month-matrix-scroll').evaluate(n => n.scrollLeft = 300);
        const moved = await page.locator('#month-matrix tbody th').first().boundingBox();
        assert(Math.abs(matrixBounds.x - moved.x) < 1, 'City labels remain pinned while swiping months');
        await page.locator('.month-matrix-scroll').evaluate(n => n.scrollLeft = 0);
        await page.locator('.mobile-section-jumps a[href="#ecdf-section"]').click();
        await page.locator('#ecdf-legend button').first().click();
        assert.equal(await page.locator('#ecdf-legend [aria-pressed="true"]').count(), 1);
        await page.locator('#ecdf-sort').selectOption('share-desc');
        const shares = await page.locator('#ecdf-results strong').allTextContents();
        assert.deepEqual(shares.map(parseFloat), shares.map(parseFloat).sort((a, b) => b - a));
        await page.locator('#ecdf-reset').click();

        if (width === 390) {
          await page.locator('[data-mobile-city-picker]').click();
          await page.setViewportSize({ width: 1200, height: 900 });
          await page.waitForFunction(() => document.querySelector('#city-picker').parentElement.tagName === 'MAIN');
          assert.equal(await page.locator('dialog').evaluate(n => n.open), false);
          await page.setViewportSize({ width, height });
          await page.waitForFunction(() => document.querySelector('#city-picker').parentElement.tagName === 'DIALOG');
        }
      } else {
        assert.equal(await page.locator('#city-picker').evaluate(n => n.parentElement.tagName), 'MAIN');
        assert(await page.locator('.mobile-calendar').first().isHidden());
        assert(await page.locator('.calendar-wrap').first().isVisible());
      }
      await page.locator('[data-site-page="compare"]').click();
      await page.waitForSelector('#mean-delta');
      const mean = Number(await page.locator('#mean-delta').innerText());
      await page.locator('#swap').click();
      assert.equal(Number(await page.locator('#mean-delta').innerText()), mean === 0 ? 0 : -mean);
      if (mobile) {
        const day = page.locator('#delta-calendar .mobile-day:not(:disabled)').first();
        await day.click();
        const date = await day.getAttribute('data-mobile-date');
        assert((await page.locator('#date-detail').innerText()).startsWith(date));
        const preservedFill = await page.evaluate(date => getComputedStyle(document.querySelector(`#delta-calendar [data-mobile-date="${date}"]`)).backgroundColor === getComputedStyle(document.querySelector(`#delta-calendar .calendar [data-date="${date}"]`)).fill, date);
        assert(preservedFill, 'Differences retain the shared diverging scale');
        await page.locator('[data-calendar-view="year"]').click();
        const annual = page.locator('#delta-calendar .mobile-calendar');
        assert(await page.locator('#delta-calendar > .calendar').isHidden());
        assert.equal(await annual.locator('.mobile-day:not(:disabled)').count(), 365);
        assert(await annual.evaluate(n => n.scrollWidth <= n.clientWidth));
        await annual.locator('.mobile-day:not(:disabled)').first().click();
        const annualDate = await annual.locator('.mobile-day.is-selected').getAttribute('data-mobile-date');
        assert((await page.locator('#date-detail').innerText()).startsWith(annualDate));
        assert.equal(await annual.locator('.mobile-day-detail:visible').count(), 1);
        await page.locator('[data-calendar-view="month"]').click();
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `compare-${width}.png`) });
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(requests.filter(url => url.includes('/api/')).length, 0);
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(`PASS ${width}x${height}: ${mobile ? 'touch layouts, city sheet, month/year, data/color equality, charts and navigation' : 'desktop layout and navigation'}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
