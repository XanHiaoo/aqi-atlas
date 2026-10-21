"use strict";
const M=require("./model");
const dot=date=>String(date||"").replace(/-/g,".");
function citySeries(cities,report){return cities.map((c,i)=>({key:c.key,name:c.name,color:M.palette[i%M.palette.length],values:M.sample(c,report.start_date,report.end_date).map(d=>d.mean)}));}
function build(state,ui){const r=state.report,cities=state.cities,start=r.start_date,end=r.end_date,range=M.limits(state.available,start,end),series=citySeries(cities,r),days=M.dates(start,end);
 const live=cities.map(city=>{const row=state.live.find(row=>row.key===city.key),value=row&&row.aqi,time=row&&(row.observed_at||row.fetched_at),status=row&&row.status;return {key:city.key,name:city.name,value:M.valid(value)?String(value):"—",color:M.blend(M.color(value,r),[25,62,84],0.3),background:M.blend(M.color(value,r),[255,255,255],0.08),border:M.blend(M.color(value,r),[210,224,234],0.35),status:status==="snapshot"?"快照":status==="stale"?"上次数据":M.valid(value)?"已更新":"暂无数据",time:time?new Date(Date.parse(time)+8*3600000).toISOString().slice(5,16).replace("T"," "):"",stale:status==="stale"};});
 const view={mode:ui.mode,period:dot(start)+" - "+dot(end),today:dot(state.today),busy:state.busy,error:state.error,live,liveLabel:live.some(row=>row.status==="快照")?"AQI 快照":"实时 AQI",selectedCount:cities.length,totalCount:state.available.length,empty:!cities.length,notes:ui.notes,manager:ui.manager,popup:ui.popup||null,query:ui.query||"",searchRows:ui.searchRows||[],searchError:ui.searchError||"",searching:ui.searching||false,dragKey:ui.dragKey||"",available:state.available.map(c=>({key:c.key,name:c.name,province:c.province,selected:state.selected.includes(c.key)})),legend:r.categories.map((c,i)=>({name:c.name,range:c.range,gradient:"linear-gradient(90deg,"+r.color_scale.bands[i].start+","+r.color_scale.bands[i].end+")"})),weekdays:["一","二","三","四","五","六","日"],threshold:ui.threshold,metric:ui.metric,focus:ui.focus,sort:ui.sort};
 if(ui.mode==="calendar")view.cards=cities.slice(0,ui.visibleCities).map((city,i)=>({key:city.key,name:city.name,english:city.english,province:city.province,index:i+1,stats:M.stats(city,start,end,r),months:M.calendar(city.days,start,end,value=>M.color(value,r),ui.selectedDate),distribution:M.stats(city,start,end,r).counts.map((width,j)=>({width,color:r.categories[j].color}))}));
 if(ui.mode==="monthly"){view.monthCities=cities.map(c=>({key:c.key,name:c.name}));view.monthRows=M.matrix(cities,start,end,r,ui.metric);view.monthWidth=144+Math.max(3,cities.length)*176;view.monthBlanks=Array.from({length:Math.max(0,3-cities.length)},(_,i)=>i);}
 if(ui.mode==="statistics"){
  view.ecdf={kind:"ecdf",max:range.absolute,threshold:ui.threshold,focus:ui.focus,series:series.map(s=>Object.assign({},s,{points:M.distribution(s.values)}))};
  view.series=series.map(s=>({key:s.key,name:s.name,color:s.color,active:ui.focus===s.key}));
  view.shares=series.map(s=>{const count=s.values.filter(v=>v<=ui.threshold).length;return {key:s.key,name:s.name,color:s.color,count,total:s.values.length,share:s.values.length?(count/s.values.length*100).toFixed(1)+"%":"—",ratio:s.values.length?count/s.values.length:-1};});
  if(ui.sort!=="default")view.shares.sort((a,b)=>(ui.sort==="desc"?-1:1)*(a.ratio-b.ratio));
 }
 if(ui.mode==="compare"){
  const list=state.available,valid=key=>list.some(c=>c.key===key),aKey=valid(ui.a)?ui.a:valid(state.pair[0])?state.pair[0]:state.selected[0]||list[0]&&list[0].key,bKey=[ui.b,state.pair[1]].concat(state.selected,list.map(c=>c.key)).find(key=>valid(key)&&key!==aKey),a=list.find(c=>c.key===aKey),b=list.find(c=>c.key===bKey),rows=M.paired(a,b,start,end),values=rows.map(row=>row.delta),avg=M.mean(values),low=values.filter(v=>v<0).length,ties=values.filter(v=>v===0).length,good=rows.filter(v=>v.a<=50).length-rows.filter(v=>v.b<=50).length;
  view.pairCities=list.map(c=>c.name);view.aIndex=list.indexOf(a);view.bIndex=list.indexOf(b);view.aKey=aKey;view.bKey=bKey;view.aName=a?a.name:"城市 A";view.bName=b?b.name:"城市 B";view.pairCount=rows.length;view.noPair=!rows.length;view.deltaLimit=range.delta;
  if(rows.length){view.takeaway="在共同的 "+rows.length+" 天里，"+a.name+"平均日 AQI 为 "+M.fmt(M.mean(rows.map(v=>v.a)))+"，"+b.name+"为 "+M.fmt(M.mean(rows.map(v=>v.b)))+"；"+a.name+"平均"+(avg<0?"低":"高")+" "+Math.abs(avg).toFixed(1)+" 个 AQI 点。";view.pairStats=[{label:"平均同日差值 A − B",value:M.signed(avg),sub:"AQI 点"},{label:"同日差值的中位数",value:M.signed(M.median(values)),sub:""},{label:a.name+"指数更低的天数",value:low+" 天",sub:"相同 "+ties+" 天"},{label:"良好天数差 A − B",value:(good>0?"+":"")+good+" 天",sub:"美标 AQI ≤ 50"}];
   view.deltaMonths=M.calendar(rows.map(v=>({date:v.date,value:v.delta})),start,end,v=>M.deltaColor(v,range.delta),ui.selectedDate);
   view.monthlyGap={kind:"monthly",max:range.absolute,rows:M.monthSlots(start,end).map(month=>{const group=rows.filter(v=>v.date.slice(0,7)===month.key);return {label:month.key.slice(2).replace("-","."),a:M.mean(group.map(v=>v.a)),b:M.mean(group.map(v=>v.b)),count:group.length,delta:group.length?M.signed(M.mean(group.map(v=>v.delta))):"—"};})};
   view.pairEcdf={kind:"ecdf",max:range.absolute,threshold:ui.threshold,series:[{key:a.key,name:a.name,color:"#236c9b",points:M.distribution(rows.map(v=>v.a))},{key:b.key,name:b.name,color:"#c56635",points:M.distribution(rows.map(v=>v.b))}]};
   const ca=rows.filter(v=>v.a<=ui.threshold).length,cb=rows.filter(v=>v.b<=ui.threshold).length;view.pairShare=a.name+"："+ca+" / "+rows.length+" 天（"+(ca/rows.length*100).toFixed(1)+"%）；"+b.name+"："+cb+" / "+rows.length+" 天（"+(cb/rows.length*100).toFixed(1)+"%）。";
  }
 }
 return view;
}
module.exports={build,citySeries};
