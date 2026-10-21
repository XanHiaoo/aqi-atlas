// Renders the real WeChat-compiled WXML tree in Chromium for visual inspection.
// This is a layout harness, not a substitute for WeChat simulator/real-device tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const {chromium}=require('../../tests/browser/node_modules/playwright');
const root=path.resolve(__dirname,'../..'),M=require('../utils/model'),VM=require('../utils/view-model'),{createStore}=require('../services/store'),{render:renderChart}=require('../components/chart/renderer');
const output=path.join(root,'.runtime/miniprogram-qa');fs.mkdirSync(output,{recursive:true});
const tools=process.env.WECHAT_DEVTOOLS||'D:/SoftWare/wechat_devtools_2.02.2608070_win32_x64';
const compiled=path.join(output,'compiled-wxml.js');
execFileSync(path.join(tools,'resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe'),['-o',compiled,'pages/calendar/index.wxml','templates/screen.wxml','custom-tab-bar/index.wxml','components/chart/index.wxml'],{cwd:path.join(root,'miniprogram')});
const context={window:{},console};vm.createContext(context);vm.runInContext(fs.readFileSync(compiled,'utf8'),context);
const render=context.$gwx('pages/calendar/index.wxml'),renderTabs=context.$gwx('custom-tab-bar/index.wxml');
const parse=vm.runInContext('JSON.parse',context),native=value=>parse(JSON.stringify(value));
const renderNativeChart=context.$gwx('components/chart/index.wxml');
const chartTags=(data)=>{const tags=[];const walk=n=>{if(n&&typeof n==='object'){tags.push(n.tag);(n.children||[]).forEach(walk);}};walk(renderNativeChart(native(data)));return tags;};
assert(!chartTags({spec:{kind:'ecdf'},height:280,unsupported:false,obscured:false}).includes('wx-text'));
assert(chartTags({spec:{kind:'ecdf'},height:280,unsupported:true,obscured:false}).includes('wx-text'));
assert(!chartTags({spec:{kind:'ecdf'},height:280,unsupported:false,obscured:true}).includes('wx-canvas'));
const state=createStore({getStorageSync(){},setStorageSync(){}},{},()=>Date.parse('2026-10-21T09:00:00+08:00')).snapshot();
const escape=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let charts=[];
function html(tree){if(tree===null||tree===undefined)return '';if(typeof tree!=='object')return escape(tree);const attr=tree.attr||{},tag=tree.tag,children=(tree.children||[]).map(html).join('');if(tag==='wx-page-meta')return '';if(tag==='wx-aqi-chart'){const id='chart-'+charts.length;charts.push({id,spec:attr.spec,height:Number(attr.height)||280});return '<canvas id="'+id+'" style="width:100%;height:'+(Number(attr.height)||280)+'px"></canvas>';}
 const realTag=tag==='wx-image'?'img':tag==='wx-input'?'input':tag==='wx-text'?'span':'div';let attributes='';for(const [key,value]of Object.entries(attr)){if(['class','style','placeholder','value'].includes(key))attributes+=' '+key+'="'+escape(value)+'"';if(key==='src'){const file=path.join(root,'miniprogram',value.replace(/^\//,''));attributes+=' src="data:image/png;base64,'+fs.readFileSync(file).toString('base64')+'"';}if(key==='bindtap')attributes+=' data-handler="'+escape(value)+'"';if(key.startsWith('data-'))attributes+=' '+key+'="'+escape(value)+'"';}
 if(tag==='wx-scroll-view')attributes+=' data-scroll="true"';return '<'+realTag+attributes+'>'+children+'</'+realTag+'>';
}
function page(ui,width){charts=[];const view=VM.build(state,ui),tabs=['calendar','realtime','monthly','statistics','compare'].map((page,i)=>({page,label:['日历','实时','月历','统计','对比'][i],icon:['calendar','clock','monthly','stats','compare'][i]})),body=html(render(native({view,navTop:24,navHeight:44})))+html(renderTabs(native({selected:tabs.findIndex(t=>t.page===ui.mode),tabs}))),css=fs.readFileSync(path.join(root,'miniprogram/app.wxss'),'utf8')+fs.readFileSync(path.join(root,'miniprogram/custom-tab-bar/index.wxss'),'utf8');
 const transform=text=>text.replace(/(-?[\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px');
 return {view,charts:charts.slice(),document:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}span{display:inline}div{box-sizing:border-box}img{display:block}input{font:inherit}'+transform(css.replace(/(^|[}\s])page(?=\{)/g,'$1body').replace(/view,scroll-view,text,input/g,'div,div,span,input').replace(/(^|[\s,>])view(?=[\s,{.:>])/g,'$1div').replace(/(^|[\s,>])text(?=[\s,{.:>])/g,'$1span'))+'[data-scroll]{overflow:auto}.live-inline,.series-inline{width:max-content}.brand-mark{flex-shrink:0}</style></head><body>'+transform(body)+'</body></html>'};
}
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{})});try{
 for(const width of [320,390,430]){
  const p=await browser.newPage({viewport:{width,height:844}});for(const mode of ['calendar','realtime','monthly','statistics','compare']){
   const ui={mode,visibleCities:1,threshold:50,metric:'median',sort:'default'},model=page(ui,width);await p.setContent(model.document);
   for(const chart of model.charts)await p.evaluate(({chart,source})=>{const canvas=document.getElementById(chart.id),rect=canvas.getBoundingClientRect();canvas.width=rect.width*2;canvas.height=rect.height*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);new Function('return ('+source+')')()(ctx,rect.width,rect.height,chart.spec);},{chart,source:renderChart.toString()});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' overflows '+width);
   await p.screenshot({path:path.join(output,mode+'-'+width+'.png')});
   if(mode==='calendar'){assert.equal(await p.locator('.day:not(.blank):not(.outside)').count(),365);assert(await p.locator('.city-card').evaluate(n=>n.offsetHeight<innerHeight-150));await p.locator('.city-card').screenshot({path:path.join(output,'city-card-'+width+'.png')});}
   if(mode==='monthly'){assert(await p.locator('.matrix-scroll').evaluate(n=>n.scrollWidth>n.clientWidth));}
   if(mode==='compare'){assert((await p.locator('.delta-labels').innerText()).includes(model.view.aName));assert((await p.locator('.delta-labels').innerText()).includes(model.view.bName));await p.locator('.delta-legend').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(output,'delta-legend-'+width+'.png')});}
  }
  for(const dialog of ['manager','popup']){const ui={mode:'calendar',visibleCities:1,threshold:50,metric:'median',sort:'default',manager:dialog==='manager',popup:dialog==='popup'?{title:'杭州 · 2026.10.20',lines:['AQI 21.0','良好']}:null};await p.setContent(page(ui,width).document);await p.screenshot({path:path.join(output,dialog+'-'+width+'.png')});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await p.close();console.log('PASS compiled WXML layout: '+width+'px, five screens, annual days, dialogs and delta legend');
 }
 // Browser's OKLab conversion is an independent color reference for the native RGB port.
 const p=await browser.newPage();const values=[0,10,20,30,50,51,75,100,101,150,151,200,201,300,301,450,500];
 for(const value of values){const rgb=M.color(value,state.report).match(/\d+/g).map(Number),band=state.report.color_scale.bands[M.categoryIndex(value,state.report)],a=M.rgbLab(band.start),b=M.rgbLab(band.end),t=Math.max(0,Math.min(1,(value-band.lower)/(band.upper-band.lower))),lab=a.map((v,i)=>v+(b[i]-v)*t),reference=await p.evaluate(lab=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle='oklab('+lab.join(' ')+')';c.fillRect(0,0,1,1);return Array.from(c.getImageData(0,0,1,1).data).slice(0,3);},lab);assert(rgb.every((v,i)=>Math.abs(v-reference[i])<=2),'Color drift at AQI '+value);}
 await p.close();console.log('PASS native RGB palette against browser OKLab reference');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
