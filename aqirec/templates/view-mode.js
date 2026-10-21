"use strict";
(() => {
  const layout=document.currentScript.dataset.layout;
  const key="aqirec:layout:v1",url=new URL(location.href),requested=url.searchParams.get("view");
  const valid=value=>value==="mobile"||value==="desktop";
  let saved;
  try{saved=localStorage.getItem(key);if(valid(requested)){saved=requested;localStorage.setItem(key,requested);}}catch{}
  const narrow=matchMedia("(max-width: 767px), (max-width: 960px) and (pointer: coarse)").matches||(matchMedia("(pointer: coarse)").matches&&screen.width<=960);
  const desired=valid(requested)?requested:valid(saved)?saved:narrow?"mobile":"desktop";
  const compare=/compare(?:\.html)?$/.test(url.pathname);
  function destination(mode){const target=new URL((mode==="desktop"?"desktop-":"")+(compare?"compare.html":"index.html"),url);target.search=url.search;if(mode==="desktop")target.hash="";else target.hash=url.hash;return target;}
  if(desired!==layout){location.replace(destination(desired));return;}
  document.documentElement.dataset.layout=layout;
  document.addEventListener("DOMContentLoaded",()=>{
    const controls=document.createElement("div"),link=document.createElement("a"),target=destination(layout==="desktop"?"mobile":"desktop");
    controls.className="layout-controls";target.searchParams.set("view",layout==="desktop"?"mobile":"desktop");link.href=target.href;link.textContent=layout==="desktop"?"切换手机版":"切换电脑版";link.className="layout-switch";controls.append(link);document.querySelector("main").append(controls);
  });
})();
