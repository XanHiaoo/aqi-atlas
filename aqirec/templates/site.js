"use strict";
(() => {
  const online=["http:","https:"].includes(location.protocol);
  const calendarURL=()=>new URL(online?"/":"index.html",location.href);
  const comparisonURL=()=>new URL(online?"/compare":"compare.html",location.href);
  function storedPair(){try{const value=JSON.parse(localStorage.getItem("aqirec:comparison-pair:v1"));return Array.isArray(value)&&value.length===2?value:[];}catch{return [];}}
  function setCalendarSelection(keys){
    const selected=[...keys],last=storedPair();
    const a=selected.includes(last[0])?last[0]:selected[0];
    const b=selected.includes(last[1])&&last[1]!==a?last[1]:selected.find(key=>key!==a);
    const url=comparisonURL();if(a)url.searchParams.set("a",a);if(b)url.searchParams.set("b",b);
    document.querySelectorAll('[data-site-page="compare"]').forEach(link=>link.href=url.href);
  }
  function rememberPair(a,b){
    try{localStorage.setItem("aqirec:comparison-pair:v1",JSON.stringify([a,b]));}catch{}
    try{const url=new URL(location.href);url.searchParams.set("a",a);url.searchParams.set("b",b);history.replaceState(null,"",url);}catch{}
  }
  document.querySelectorAll('[data-site-page="calendar"]').forEach(link=>link.href=calendarURL().href);
  document.querySelectorAll('[data-site-page="compare"]').forEach(link=>link.href=comparisonURL().href);
  let revision,selection,ready=Promise.resolve(),dirty=false,saving=false,busy=false,polling=false,selectionGeneration=0;
  const embedded=()=>JSON.parse(document.getElementById("report-data")?.textContent||document.getElementById("data")?.textContent||"{}");
  function showStatus(payload){window.dispatchEvent(new CustomEvent("aqirec:status",{detail:payload}));}
  async function jsonRequest(url,body){
    const response=await fetch(url,{cache:"no-store",...(body===undefined?{}:{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
    const payload=await response.json();if(!response.ok)throw Error(payload.error||"后台服务暂不可用。");return payload;
  }
  async function flushSelection(){
    if(!online||!selection||saving||!dirty)return;
    saving=true;
    try{while(dirty){dirty=false;const payload=await jsonRequest("/api/selection",{keys:selection.get()});showStatus(payload);}}
    catch(error){dirty=true;showStatus({error:"勾选尚未同步到后台，将自动重试。"});}
    finally{saving=false;}
  }
  function syncSelection(){selectionGeneration++;dirty=true;ready.then(flushSelection);}
  function configureSelection(get,apply,hasLocal){
    selection={get,apply};
    if(!online){showStatus({error:"离线查看：自动更新需启动本地网站服务。"});return;}
    ready=(async()=>{
      try{const payload=await jsonRequest("/api/status");
        if(!hasLocal&&!dirty&&Array.isArray(payload.update.selected_keys))apply(payload.update.selected_keys);
        dirty=true;showStatus(payload);
      }catch{dirty=true;showStatus({error:"后台服务未连接，勾选尚未同步。"});}
    })();
    ready.then(flushSelection);
  }
  async function poll(){
    if(!online||polling)return;polling=true;
    try{await ready;await flushSelection();if(dirty)return;const generation=selectionGeneration,payload=await jsonRequest("/api/status");
      if(selection&&!dirty&&!saving&&generation===selectionGeneration&&Array.isArray(payload.update.selected_keys)&&JSON.stringify(selection.get())!==JSON.stringify(payload.update.selected_keys))selection.apply(payload.update.selected_keys);
      showStatus(payload);
      if(payload.revision&&payload.revision!==revision&&!busy&&!saving&&!dirty){location.reload();}
    }catch{showStatus({error:"后台服务未连接，恢复连接后重试。"});}
    finally{polling=false;}
  }
  document.addEventListener("DOMContentLoaded",()=>{revision=embedded().revision;poll();if(online)setInterval(poll,30000);});
  window.addEventListener("focus",poll);
  window.addEventListener("online",poll);
  window.aqiSite={setCalendarSelection,rememberPair,storedPair,configureSelection,syncSelection,
    setBusy:value=>busy=value,acceptRevision:value=>revision=value,jsonRequest};
})();
