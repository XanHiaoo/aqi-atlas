const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),base='http://aqi.test/aqi-atlas/';
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});
  try{
    for(const phone of [true,false]){
      const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1440,height:1000},isMobile:phone,hasTouch:phone});
      await context.route('**/*',route=>{const name=new URL(route.request().url()).pathname.split('/').pop()||'index.html';return ['index.html','compare.html','desktop-index.html','desktop-compare.html'].includes(name)?route.fulfill({body:fs.readFileSync(path.join(root,'dist',name)),contentType:'text/html'}):route.abort();});
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);await page.waitForSelector('#cities .city');
      assert.equal(await page.locator('html').getAttribute('data-layout'),phone?'mobile':'desktop');
      const initial=await page.locator('#cities .city h2').allTextContents();
      const frozen=await page.locator('#report-data').textContent();
      await page.locator('.layout-switch').click();await page.waitForSelector('#cities .city');
      assert.equal(await page.locator('html').getAttribute('data-layout'),phone?'desktop':'mobile');
      assert.deepEqual(await page.locator('#cities .city h2').allTextContents(),initial);
      assert.equal(await page.locator('#report-data').textContent(),frozen,'Both layouts embed exactly the same data');
      if(phone){assert(await page.locator('.calendar-wrap').first().isVisible());assert.equal(await page.locator('meta[name="viewport"]').getAttribute('content'),'width=1200');}
      else{assert(await page.locator('.mobile-calendar').first().isVisible());assert.equal(await page.locator('.site-navigation .site-tab:visible').count(),5);}
      await page.goto(base);await page.waitForSelector('#cities .city');
      assert.equal(await page.locator('html').getAttribute('data-layout'),phone?'desktop':'mobile','Manual preference survives revisiting home');
      await page.locator('[data-site-page="compare"]').click();await page.waitForSelector('#mean-delta');
      const pair=await page.locator('#city-a,#city-b').evaluateAll(nodes=>nodes.map(node=>node.value));
      await page.locator('.layout-switch').click();await page.waitForSelector('#mean-delta');
      assert.equal(await page.locator('html').getAttribute('data-layout'),phone?'mobile':'desktop');
      assert.deepEqual(await page.locator('#city-a,#city-b').evaluateAll(nodes=>nodes.map(node=>node.value)),pair,'Switching layouts preserves the comparison pair');
      assert.deepEqual(errors,[]);
      await context.close();console.log('PASS layout switching: '+(phone?'phone':'desktop')+', preference, shared data and comparison pair');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
