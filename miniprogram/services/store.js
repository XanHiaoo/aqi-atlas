"use strict";
const seed=require("../data/snapshot"),M=require("../utils/model"),config=require("../config");
const clone=value=>JSON.parse(JSON.stringify(value));
function createStore(storage,client,now=()=>Date.now()){
 const base=clone(seed),listeners=new Set();let cities=base.report.cities,selected=base.selected_keys.slice(),order=cities.map(c=>c.key),customOrder=false,live=base.realtime.cities.map(row=>Object.assign({},row,{status:"snapshot"})),pair=[],busy=false,historyDue={},liveDue={},error="";
 const read=key=>{try{return storage.getStorageSync("aqi-mini:"+key);}catch{return null;}},write=(key,value)=>{try{storage.setStorageSync("aqi-mini:"+key,value);return true;}catch{error="本机存储空间不足，部分数据未保存";return false;}};
 const saved=read("state");if(saved&&Array.isArray(saved.cities)&&saved.cities.every(c=>c&&typeof c.key==="string")){cities=saved.cities.map(city=>Object.assign({},city,{days:Array.isArray(city.days)?city.days:read("city:"+city.key)||(base.report.cities.find(c=>c.key===city.key)||{}).days||[]}));selected=Array.isArray(saved.selected)?saved.selected:[];order=Array.isArray(saved.order)?saved.order:[];customOrder=saved.customOrder===true;pair=Array.isArray(saved.pair)?saved.pair:[];historyDue=saved.historyDue&&typeof saved.historyDue==="object"?saved.historyDue:{};}
 const storedLive=read("live");if(Array.isArray(storedLive))live=storedLive;
 const ordered=()=>{const available=new Map(cities.map(c=>[c.key,c])),keys=[...new Set(order.concat(cities.map(c=>c.key)))].filter(key=>available.has(key)),arranged=customOrder?keys:selected.filter(key=>available.has(key)).concat(keys.filter(key=>!selected.includes(key)));return arranged.map(key=>available.get(key));};
 const persistedDays=new Map();
 function persist(){const metadata=cities.map(city=>{if(persistedDays.get(city.key)!==city.days){if(write("city:"+city.key,city.days))persistedDays.set(city.key,city.days);}const copy=Object.assign({},city);delete copy.days;return copy;});write("state",{cities:metadata,selected,order,customOrder,pair,historyDue});}
 function emit(){listeners.forEach(fn=>fn());}
 const store={
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  snapshot(){const p=M.period(now()),r=Object.assign({},base.report,{start_date:p.start,end_date:p.end,expected_days:365,cities:ordered()}),chosen=ordered().filter(c=>selected.includes(c.key));return {report:r,cities:chosen,available:ordered(),selected:chosen.map(c=>c.key),pair:pair.slice(),live:live.map(row=>Object.assign({},row,{status:row.status!=="snapshot"&&now()-Date.parse(row.fetched_at)>config.realtimeTtl?"stale":row.status})),today:p.today,busy,error,published:base.published_at};},
  select(keys){selected=[...new Set(keys)].filter(key=>cities.some(c=>c.key===key));persist();emit();},
  reorder(keys){customOrder=true;order=[...new Set(keys.concat(order))];persist();emit();},
  remove(key){cities=cities.filter(c=>c.key!==key);selected=selected.filter(k=>k!==key);order=order.filter(k=>k!==key);persist();emit();},
  setPair(keys){pair=keys.slice(0,2);persist();},
  async search(query){const text=query.trim().toLowerCase(),registry=Array.from(new Map(base.report.cities.concat(ordered()).map(c=>[c.key,c])).values()),local=registry.filter(c=>[c.name,c.english,c.province,c.country].some(v=>String(v||"").toLowerCase().indexOf(text)>=0));try{const remote=await client.search(query,cities),map=new Map(local.map(c=>[c.slug,c]));remote.forEach(c=>map.set(c.slug,c));return {rows:Array.from(map.values()),error:""};}catch(e){return {rows:local,error:e.message};}},
  async region(row){return client.region(row,cities);},
  async add(city){if(cities.some(c=>c.key===city.key)){store.select(selected.concat(city.key));return;}busy=true;emit();try{const p=M.period(now()),cached=Array.isArray(city.days)&&M.sample(city,p.start,p.end).length,days=cached?clone(city.days):await client.history(city,p.start,p.end);cities.push(Object.assign({},city,{days}));order.push(city.key);selected.push(city.key);if(!cached)historyDue[city.key]=p.today;persist();error="";}catch(e){error=e.message;throw e;}finally{busy=false;emit();}},
  async refresh(force=false){if(busy||!config.networkEnabled)return;const chosen=ordered().filter(c=>selected.includes(c.key));if(!chosen.length)return;busy=true;error="";emit();const p=M.period(now());let changed=false;
   try{if(client.ready)await client.ready();for(const city of chosen){if(force||historyDue[city.key]!==p.today){try{const fresh=await client.history(city,p.start,p.end),merged=new Map(city.days.map(d=>[d.date,d]));fresh.forEach(day=>merged.set(day.date,day));city.days=Array.from(merged.values()).filter(d=>d.date>=p.start&&d.date<=p.end).sort((a,b)=>a.date.localeCompare(b.date));historyDue[city.key]=p.today;changed=true;}catch(e){error=e.message;}}
    const old=live.find(row=>row.key===city.key);if(force||!old||old.status!=="ok"||now()-Date.parse(old.fetched_at)>=config.realtimeTtl){if(!force&&liveDue[city.key]&&now()-liveDue[city.key]<60000)continue;liveDue[city.key]=now();try{const row=await client.realtime(city);live=live.filter(v=>v.key!==city.key).concat(row);changed=true;}catch(e){if(old)old.status="stale";error=e.message;}}
   }}catch(e){error=e.message;}finally{if(changed)persist();write("live",live);busy=false;emit();}},
  async export(){const s=store.snapshot(),quote=v=>'"'+String(v).replace(/"/g,'""')+'"',lines=[["城市","日期","AQI(US)","标准","数据源"]];s.cities.forEach(c=>c.days.filter(d=>d.date>=s.report.start_date&&d.date<=s.report.end_date).forEach(d=>lines.push([c.name,d.date,M.valid(d.mean)?d.mean:"","AQI-US","AQI.in"])));return "\ufeff"+lines.map(row=>row.map(quote).join(",")).join("\r\n");}
 };
 return store;
}
module.exports={createStore};
