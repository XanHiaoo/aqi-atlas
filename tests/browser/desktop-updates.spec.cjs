const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),base='http://aqi.test/aqi-atlas/';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop()||'index.html';return ['index.html','compare.html','desktop-index.html','desktop-compare.html'].includes(name)?route.fulfill({body:fs.readFileSync(path.join(root,'dist',name)),contentType:'text/html'}):route.abort();});
  await page.goto(base);await page.waitForSelector('#cities .city');
  assert(await page.locator('#city-subtitle').isHidden());assert.equal(await page.locator('#quality-note,#coordinates').count(),0);
  const chips=page.locator('#city-options .city-option'),order=()=>chips.evaluateAll(nodes=>nodes.map(n=>n.dataset.city)),checked=()=>page.locator('#city-options input:checked').evaluateAll(nodes=>nodes.map(n=>n.value).sort());
  const initial=await order(),states=await checked(),expected=[...initial];[expected[0],expected[1]]=[expected[1],expected[0]];
  await chips.first().locator('.desktop-sort-handle').press('ArrowRight');assert.deepEqual(await order(),expected);assert.deepEqual(await checked(),states);
  async function verifyCharts(){
   const names=await chips.locator('input:checked').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
   assert.deepEqual(await page.locator('#cities .city h2').allTextContents(),names);
   assert.deepEqual(await page.locator('#selected-values > span').evaluateAll(nodes=>nodes.map(n=>n.firstChild.textContent)),names);
   assert.deepEqual(await page.locator('#month-matrix tbody tr').evaluateAll(nodes=>nodes.map(n=>n.cells[0].textContent)),names);
   assert.deepEqual(await page.locator('#ecdf-results .ecdf-result-name').allTextContents(),names);
  }
  await verifyCharts();
  const last=expected.pop();expected.unshift(last);
  await chips.last().locator('.desktop-sort-handle').dragTo(chips.first());assert.deepEqual(await order(),expected);assert.deepEqual(await checked(),states);await verifyCharts();
  await page.reload();await page.waitForSelector('#cities .city');assert.deepEqual(await order(),expected);await verifyCharts();
  await page.locator('.layout-switch').click();await page.waitForSelector('.mobile-calendar');
  assert.equal(await page.locator('html').getAttribute('data-layout'),'mobile');
  await page.locator('[data-mobile-city-picker]').click();assert.deepEqual(await order(),expected);await page.locator('.mobile-sheet-close').click();
  await page.locator('.layout-switch').click();await page.waitForSelector('.desktop-sort-handle');assert.deepEqual(await order(),expected);await verifyCharts();
  await page.locator('[data-site-page="compare"]').click();await page.waitForSelector('#mean-delta');
  assert.equal(await page.locator('.notes').evaluate(n=>n.open),false);assert.equal(await page.locator('.notes li').count(),4);assert.equal(await page.locator('.foot,#source,#generated').count(),0);
  await page.locator('.notes summary').click();assert(await page.locator('.notes li').first().isVisible());
  assert.deepEqual(errors,[]);console.log('PASS desktop updates: keyboard/drag sorting, saved cross-layout order, all charts, hidden names, concise collapsed notes and removed links/footer.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
