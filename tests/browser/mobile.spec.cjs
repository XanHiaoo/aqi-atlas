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
    for (const [width, height] of [[320, 740], [360, 640], [360, 800], [390, 844], [430, 932], [844, 390], [1440, 1000]]) {
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
        assert.equal(await firstCity.locator('.mobile-mini-day[data-in-range="true"]').count(), 365, 'Mobile opens with the whole year');
        const city = report.cities.find(c => c.key === selected[0]);
        const annual = firstCity.locator('.mobile-calendar');
        assert(await annual.isVisible());
        assert.equal(await annual.locator('.mobile-mini-day[data-in-range="true"]').count(), 365, 'Annual month blocks preserve every day exactly once');
        assert(await annual.evaluate(n => n.scrollWidth <= n.clientWidth), 'Annual calendar fits the phone without horizontal scrolling');
        const monthBlocks = await annual.locator('.mobile-year-month').all();
        const monthNumber = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
        assert.equal(monthBlocks.length, monthNumber(report.end_date) - monthNumber(report.start_date) + 1);
        assert.equal(await page.locator('[data-calendar-view], .mobile-month-switch').count(), 0, 'No month expansion or view controls');
        assert(await annual.evaluate(n => n.getBoundingClientRect().height <= innerHeight - document.querySelector('.site-header').offsetHeight - document.querySelector('.site-navigation').offsetHeight - 16), 'The entire annual calendar fits within one phone screen');
        const yearValuesMatch = await firstCity.evaluate(city => [...city.querySelectorAll('.mobile-mini-day[data-in-range="true"]')].every(day => getComputedStyle(day).backgroundColor === getComputedStyle(city.querySelector(`.calendar [data-date="${day.dataset.mobileDate}"]`)).fill));
        assert(yearValuesMatch, 'Every annual day retains the original AQI palette');
        await annual.evaluate(n => scrollTo(0, n.getBoundingClientRect().top + scrollY - document.querySelector('.site-header').offsetHeight - 10));
        await annual.screenshot({ path: path.join(output, `year-overview-${width}.png`) });
        const annualDay = annual.locator('.mobile-mini-day[data-in-range="true"]').first();
        const annualDate = await annualDay.getAttribute('data-mobile-date');
        const cityHeight = await firstCity.evaluate(node => node.offsetHeight);
        await annualDay.click();
        assert.equal(await annual.locator('.mobile-mini-day:not(:disabled)').count(), 365, 'Day selection keeps the whole year visible');
        const popover = page.locator('#mobile-day-popover');
        assert(await popover.isVisible());
        assert.equal((await popover.locator('.mobile-day-popover-copy > *').allTextContents()).join(' · '), await annualDay.getAttribute('title'));
        assert.equal(await firstCity.evaluate(node => node.offsetHeight), cityHeight, 'Daily details float without changing the annual layout');
        assert.equal(await annual.locator('.mobile-day-detail').count(), 0);
        assert.equal(await page.locator('.mobile-mini-day.is-selected').count(), selected.length);
        const value = city.days.find(d => d.date === annualDate)?.mean;
        assert((await popover.innerText()).includes(value == null ? '数据缺失' : value.toFixed(1)));
        const popupBounds = await popover.boundingBox(), headerBounds = await page.locator('.site-header').boundingBox(), navBounds = await page.locator('.site-navigation').boundingBox();
        assert(popupBounds.x >= 0 && popupBounds.x + popupBounds.width <= width);
        assert(popupBounds.y >= headerBounds.y + headerBounds.height && popupBounds.y + popupBounds.height <= navBounds.y);
        await page.screenshot({ path: path.join(output, `daily-popover-${width}-${height}.png`) });
        await popover.locator('.mobile-day-popover-close').click();
        assert(await popover.isHidden());
        assert.equal(await annualDay.getAttribute('aria-expanded'), 'false');
        assert(await annualDay.evaluate(node => node.classList.contains('is-selected')));
        await annualDay.click();
        await page.keyboard.press('Escape');
        assert(await popover.isHidden());
        await annualDay.click();
        await page.mouse.click(5, 5);
        assert(await popover.isHidden(), 'A tap outside dismisses daily details');
        const citySizes = await page.locator('#cities .city').evaluateAll(cities => {
          const budget = innerHeight - document.querySelector('.site-header').offsetHeight - document.querySelector('.site-navigation').offsetHeight - 20;
          return cities.map(city => ({ name: city.querySelector('h2').textContent, height: city.getBoundingClientRect().height, budget }));
        });
        assert(citySizes.every(city => city.height <= city.budget), 'Every complete city card fits one phone screen: ' + JSON.stringify(citySizes));
        await firstCity.evaluate(n => scrollTo(0, n.getBoundingClientRect().top + scrollY - document.querySelector('.site-header').offsetHeight - 8));
        await page.screenshot({ path: path.join(output, `city-screen-${width}-${height}.png`) });
        await annualDay.press('ArrowRight');
        const nextDate = new Date(Date.parse(annualDate) + 86400000).toISOString().slice(0, 10);
        assert.equal(await annual.locator('.mobile-mini-day.is-selected').getAttribute('data-mobile-date'), nextDate);
        assert((await popover.innerText()).includes(nextDate.replaceAll('-', '.')));

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
        const monthly = page.locator('#mobile-month-matrix');
        assert(await page.locator('.month-matrix-scroll').isHidden());
        assert(await page.locator('.month-matrix-options').isHidden(), 'Monthly settings and coverage note stay out of the mobile layout');
        assert(await page.locator('#month-common-days').isChecked(), 'Removing settings preserves the existing statistics policy');
        assert.equal(await monthly.locator('.mobile-month-group').count(), Math.ceil(selected.length / 3));
        const groups = await monthly.locator('.mobile-month-group').all();
        for (const group of groups) {
          assert(await group.evaluate(n => n.scrollWidth <= n.clientWidth), 'All monthly city groups fit without horizontal scrolling');
          assert.equal(await group.locator('tbody tr[data-month]').count(), monthBlocks.length);
          assert(await group.locator('thead th').count() <= 4);
        }
        const snapshot = selector => page.locator(selector).evaluateAll(buttons => {
          const context = document.createElement('canvas').getContext('2d');
          return buttons.map(button => ({
          key: button.dataset.city + '/' + button.dataset.month,
          value: button.querySelector('strong').textContent,
          count: button.querySelector('small').textContent,
          fill: (() => { context.fillStyle = getComputedStyle(button).backgroundColor; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data); })(),
          detail: button.dataset.detail || button.title,
        })).sort((a, b) => a.key.localeCompare(b.key)); });
        assert.deepEqual(await snapshot('[data-mobile-month-cell]'), await snapshot('#month-matrix .month-matrix-cell'), 'Mobile months preserve every statistic, valid-day count, color and detail');
        const monthlyCell = monthly.locator('[data-mobile-month-cell]').nth(4);
        const matrixHeight = await monthly.evaluate(node => node.offsetHeight);
        await monthlyCell.click();
        assert.equal(await monthly.evaluate(node => node.offsetHeight), matrixHeight);
        assert(await popover.isHidden());
        assert.equal(await monthly.locator('button,[aria-haspopup]').count(), 0, 'Monthly values have no popover interaction');
        await page.locator('[data-month-metric="median"]').click();
        assert.deepEqual(await snapshot('[data-mobile-month-cell]'), await snapshot('#month-matrix .month-matrix-cell'));
        assert(await monthly.evaluate(n => n.scrollWidth <= n.clientWidth));
        const monthlyNames = await monthly.locator('thead th:not(:first-child)').allTextContents();
        assert.deepEqual(monthlyNames, await page.locator('#cities .city h2').allTextContents(), 'Monthly column order follows city selection');
        await groups[0].evaluate(n => scrollTo(0, n.getBoundingClientRect().top + scrollY - document.querySelector('.site-header').offsetHeight - 10));
        await page.screenshot({ path: path.join(output, `monthly-${width}-${height}.png`) });
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
        assert(await page.locator('.month-matrix-options').isVisible());
      }
      await page.locator('[data-site-page="compare"]').click();
      await page.waitForSelector('#mean-delta');
      const mean = Number(await page.locator('#mean-delta').innerText());
      await page.locator('#swap').click();
      assert.equal(Number(await page.locator('#mean-delta').innerText()), mean === 0 ? 0 : -mean);
      if (mobile) {
        const day = page.locator('#delta-calendar .mobile-mini-day:not(:disabled)').first();
        await day.click();
        const date = await day.getAttribute('data-mobile-date');
        assert(await page.locator('#date-detail').isHidden());
        assert((await page.locator('#mobile-day-popover').innerText()).includes(date.replaceAll('-', '.')));
        const preservedFill = await page.evaluate(date => getComputedStyle(document.querySelector(`#delta-calendar [data-mobile-date="${date}"]`)).backgroundColor === getComputedStyle(document.querySelector(`#delta-calendar .calendar [data-date="${date}"]`)).fill, date);
        assert(preservedFill, 'Differences retain the shared diverging scale');
        const annual = page.locator('#delta-calendar .mobile-calendar');
        assert(await page.locator('#delta-calendar > .calendar').isHidden());
        assert.equal(await annual.locator('.mobile-mini-day[data-in-range="true"]').count(), 365);
        assert(await annual.evaluate(n => n.scrollWidth <= n.clientWidth));
        assert.equal(await page.locator('[data-calendar-view], .mobile-month-switch').count(), 0);
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `compare-${width}.png`) });
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(requests.filter(url => url.includes('/api/')).length, 0);
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(`PASS ${width}x${height}: ${mobile ? 'complete city card in one screen, day selection, data/color equality, city sheet, charts and navigation' : 'desktop layout and navigation'}`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
