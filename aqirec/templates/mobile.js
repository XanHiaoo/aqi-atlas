"use strict";
(() => {
  const source=JSON.parse(document.getElementById("report-data")?.textContent||document.getElementById("data")?.textContent||"{}");
  const media=matchMedia("(max-width: 767px), (max-width: 960px) and (pointer: coarse)"),months=[];
  let cursor=source.start_date.slice(0,7);
  while(cursor<=source.end_date.slice(0,7)){months.push(cursor);const [year,month]=cursor.split("-").map(Number);cursor=new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);}
  const state={date:source.end_date},entries=new Map();
  const iso=date=>date.toISOString().slice(0,10);
  const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function connected(){for(const [node] of entries)if(!node.isConnected)entries.delete(node);return [...entries];}
  function selectDate(date,callback){
    state.date=date;
    for(const [node,entry] of connected()){
      node.querySelectorAll("[data-mobile-date]").forEach(button=>{const active=button.dataset.mobileDate===date;button.classList.toggle("is-selected",active);button.setAttribute("aria-pressed",String(active));button.tabIndex=active?0:-1;});
    }
    callback?.(date);
  }
  function paint(node,entry){
    closeDayPopover();
    if(!media.matches)return;
    node.replaceChildren();node.setAttribute("aria-label",entry.options.label+" 全年日历");
    const {options,rows}=entry,overview=make("div","mobile-year-grid");
    for(const monthKey of months){
      const panel=make("section","mobile-year-month");panel.dataset.month=monthKey;panel.setAttribute("aria-label",monthKey.replace("-","."));
      panel.append(make("span","mobile-month-title",monthKey.replace("-",".")));
      const weekdays=make("span","mobile-mini-weekdays");weekdays.setAttribute("aria-hidden","true");for(const label of["一","二","三","四","五","六","日"])weekdays.append(make("span","",label));panel.append(weekdays);
      const grid=make("span","mobile-mini-grid"),[year,month]=monthKey.split("-").map(Number),offset=(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7,count=new Date(Date.UTC(year,month,0)).getUTCDate();
      for(let i=0;i<offset;i++)grid.append(make("span","mobile-mini-blank"));
      for(let day=1;day<=count;day++){
        const date=iso(new Date(Date.UTC(year,month-1,day))),row=rows.get(date),value=options.getValue(row),cell=make("button","mobile-mini-day"),inRange=date>=source.start_date&&date<=source.end_date;cell.type="button";cell.disabled=!inRange;cell.dataset.mobileDate=date;cell.dataset.inRange=String(inRange);cell.title=options.describe(row,date);cell.setAttribute("aria-label",cell.title);cell.setAttribute("aria-pressed",String(date===state.date));cell.tabIndex=date===state.date?0:-1;cell.classList.toggle("is-selected",date===state.date);cell.classList.toggle("is-outside",!inRange);
        cell.setAttribute("aria-haspopup","dialog");cell.setAttribute("aria-controls","mobile-day-popover");cell.setAttribute("aria-expanded","false");
        cell.addEventListener("click",()=>{selectDate(date,options.onSelect);showDayPopover(cell,entry,date);});
        cell.addEventListener("keydown",event=>{const move={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(move){event.preventDefault();const key=iso(new Date(Date.UTC(year,month-1,day+move))),target=node.querySelector(`[data-mobile-date="${key}"]:not(:disabled)`);if(target){selectDate(key,options.onSelect);target.focus();showDayPopover(target,entry,key);}}});
        if(Number.isFinite(value))cell.style.background=options.color(value);else cell.classList.add("is-missing");grid.append(cell);
      }
      panel.append(grid);overview.append(panel);
    }
    node.append(overview);
  }
  let matrixSource=null;
  let dayPopover=null,dayAnchor=null;
  function clearDayAnchor(){if(dayAnchor){dayAnchor.setAttribute("aria-expanded","false");dayAnchor=null;}}
  function closeDayPopover(){if(dayPopover?.matches(":popover-open"))dayPopover.hidePopover();clearDayAnchor();}
  function ensureDayPopover(){
    if(dayPopover)return;
    dayPopover=make("div","mobile-day-popover");dayPopover.id="mobile-day-popover";dayPopover.setAttribute("popover","auto");dayPopover.setAttribute("role","dialog");dayPopover.setAttribute("aria-label","当日空气质量");
    const copy=make("div","mobile-day-popover-copy"),close=make("button","mobile-day-popover-close","×");close.type="button";close.setAttribute("aria-label","关闭详情");close.addEventListener("click",closeDayPopover);dayPopover.append(copy,close);document.body.append(dayPopover);
    dayPopover.addEventListener("toggle",()=>{if(!dayPopover.matches(":popover-open"))clearDayAnchor();});
    document.addEventListener("scroll",event=>{if(!dayPopover.contains(event.target))closeDayPopover();},{capture:true,passive:true});window.addEventListener("resize",closeDayPopover);
  }
  function showDayPopover(button,entry,date){
    ensureDayPopover();if(dayAnchor===button&&dayPopover.matches(":popover-open")){closeDayPopover();return;}closeDayPopover();
    const formatted=date.replaceAll("-","."),parts=entry.options.describe(entry.rows.get(date),date).split(" · "),copy=dayPopover.querySelector(".mobile-day-popover-copy");copy.replaceChildren();copy.append(make("strong","mobile-day-popover-title",entry.options.label+" · "+formatted));parts.slice(parts.indexOf(formatted)+1).forEach((part,index)=>copy.append(make("span",index===0?"mobile-day-popover-value":"",part)));
    dayAnchor=button;button.setAttribute("aria-expanded","true");dayPopover.showPopover();
    const rect=button.getBoundingClientRect(),top=document.querySelector(".site-header").getBoundingClientRect().bottom+8,bottom=innerHeight-document.querySelector(".site-navigation").offsetHeight-8;
    dayPopover.style.maxHeight=Math.max(100,bottom-top)+"px";
    const height=dayPopover.offsetHeight,width=dayPopover.offsetWidth,y=rect.top-height-10>=top?rect.top-height-10:rect.bottom+10+height<=bottom?rect.bottom+10:Math.max(top,Math.min(rect.top,bottom-height));
    dayPopover.style.top=y+"px";dayPopover.style.left=Math.max(12,Math.min(rect.left+rect.width/2-width/2,innerWidth-width-12))+"px";
  }
  function paintMonthMatrix(){
    closeDayPopover();
    if(!matrixSource||!media.matches)return;
    let output=document.getElementById("mobile-month-matrix");
    if(!output){output=make("div","mobile-month-matrix");output.id="mobile-month-matrix";matrixSource.closest(".month-matrix-scroll").after(output);}
    const rows=[...matrixSource.tBodies[0].rows],labels=[...matrixSource.tHead.rows[0].cells].slice(1).map(cell=>cell.textContent);
    const keys=rows.map(row=>row.cells[1].firstElementChild.dataset.city).join(","),previous=keys===output.dataset.cities?output.querySelector(".mobile-month-scroll")?.scrollLeft||0:0;output.dataset.cities=keys;output.replaceChildren();if(!rows.length)return;
    const cities=rows,columns=Math.max(3,cities.length),scroll=make("div","mobile-month-scroll"),table=make("table","mobile-month-table"),head=make("thead",""),heading=make("tr",""),body=make("tbody","");scroll.setAttribute("role","region");scroll.setAttribute("aria-label","城市月份比较，左右滑动查看更多城市");scroll.tabIndex=0;table.style.setProperty("--mobile-month-columns",columns);
    const widths=make("colgroup",""),monthWidth=make("col","");monthWidth.style.width="50px";widths.append(monthWidth);for(let i=0;i<columns;i++){const width=make("col","");width.style.width="var(--mobile-month-city-width)";widths.append(width);}table.append(widths);
      const corner=make("th","","月份 / 城市");corner.scope="col";heading.append(corner);
      for(const city of cities){const name=make("th","",city.cells[0].textContent);name.scope="col";name.dataset.city=city.cells[1].firstElementChild.dataset.city;heading.append(name);}for(let i=cities.length;i<columns;i++){const blank=make("th","mobile-month-empty");blank.setAttribute("aria-hidden","true");heading.append(blank);}head.append(heading);table.append(head,body);
      labels.forEach((label,monthIndex)=>{
        const row=make("tr",""),month=make("th","",label);month.scope="row";row.dataset.month=cities[0].cells[monthIndex+1].firstElementChild.dataset.month;row.append(month);
        for(const city of cities){
          const original=city.cells[monthIndex+1].firstElementChild,cell=make("td",""),button=make("div",original.className);button.dataset.mobileMonthCell="";button.dataset.city=original.dataset.city;button.dataset.month=original.dataset.month;button.dataset.detail=original.title;button.style.cssText=original.style.cssText;button.setAttribute("role","img");button.setAttribute("aria-label",original.getAttribute("aria-label"));button.append(...[...original.childNodes].map(node=>node.cloneNode(true)));
          cell.append(button);row.append(cell);
        }
        for(let i=cities.length;i<columns;i++){const blank=make("td","mobile-month-empty");blank.setAttribute("aria-hidden","true");row.append(blank);}body.append(row);
      });scroll.append(table);output.append(scroll);scroll.scrollLeft=previous;
  }
  function monthMatrix(table){matrixSource=table;paintMonthMatrix();}
  function refresh(){
    for(const [node,entry] of connected())paint(node,entry);
    paintMonthMatrix();
  }
  function toolbar(anchor,placement="before"){
    if(document.getElementById("mobile-calendar-tools")||!document.getElementById("report-data"))return;
    const tools=make("div","mobile-calendar-tools");tools.id="mobile-calendar-tools";
    const heading=make("div","mobile-calendar-heading");heading.append(make("span","mobile-calendar-title","城市日历"));tools.append(heading);
    if(placement==="prepend")anchor.prepend(tools);else anchor.before(tools);
  }
  function calendar(options){const node=make("div","mobile-calendar");const entry={options,rows:new Map(options.days.map(row=>[row.date,row]))};entries.set(node,entry);paint(node,entry);queueMicrotask(connected);return node;}
  let sortContainer=null,sortCallback=null,sortDrag=null,sortBlockClick=false,sortFrame=0;
  const sortKeys=()=>[...sortContainer.children].map(chip=>chip.dataset.city);
  function sortFinish(commit){
    const drag=sortDrag;if(!drag)return;sortDrag=null;clearTimeout(drag.timer);cancelAnimationFrame(sortFrame);
    if(drag.active){
      drag.ghost.remove();drag.chip.classList.remove("is-dragging");document.documentElement.classList.remove("city-sort-active");window.aqiSite.setBusy(false);sortBlockClick=true;
      if(!commit)for(const key of drag.before){const chip=[...sortContainer.children].find(node=>node.dataset.city===key);if(chip)sortContainer.append(chip);}
      if(sortContainer.hasPointerCapture(drag.pointerId))sortContainer.releasePointerCapture(drag.pointerId);
      if(commit&&JSON.stringify(drag.before)!==JSON.stringify(sortKeys())){sortCallback(sortKeys());document.getElementById("city-sort-status").textContent=drag.name+"已移动到第 "+(sortKeys().indexOf(drag.chip.dataset.city)+1)+" 位";}
    }
  }
  function sortMove(){
    const drag=sortDrag;if(!drag?.active)return;
    drag.ghost.style.left=(drag.x-drag.dx)+"px";drag.ghost.style.top=(drag.y-drag.dy)+"px";
    const target=document.elementFromPoint(drag.x,drag.y)?.closest(".city-option");
    if(target&&target!==drag.chip&&target.parentNode===sortContainer){const chips=[...sortContainer.children];sortContainer.insertBefore(drag.chip,chips.indexOf(target)<chips.indexOf(drag.chip)?target:target.nextSibling);}
  }
  function sortTick(){
    const drag=sortDrag;if(!drag?.active)return;
    const scroller=sortContainer.closest(".mobile-city-sheet"),rect=scroller.getBoundingClientRect(),edge=42;
    const speed=drag.y<rect.top+edge?-(rect.top+edge-drag.y)/4:drag.y>rect.bottom-edge?(drag.y-rect.bottom+edge)/4:0;
    if(speed){scroller.scrollTop+=Math.max(-14,Math.min(14,speed));sortMove();}sortFrame=requestAnimationFrame(sortTick);
  }
  function sortStart(){
    const drag=sortDrag;if(!drag)return;
    const rect=drag.chip.getBoundingClientRect();drag.active=true;drag.dx=drag.x-rect.left;drag.dy=drag.y-rect.top;drag.ghost=drag.chip.cloneNode(true);drag.ghost.classList.add("city-sort-ghost");drag.ghost.setAttribute("aria-hidden","true");drag.ghost.inert=true;drag.ghost.style.width=rect.width+"px";drag.ghost.style.height=rect.height+"px";
    sortContainer.closest(".mobile-city-sheet").append(drag.ghost);drag.chip.classList.add("is-dragging");document.documentElement.classList.add("city-sort-active");sortContainer.setPointerCapture(drag.pointerId);window.aqiSite.setBusy(true);sortMove();sortTick();
  }
  function citySorting(container,callback){
    sortCallback=callback;
    for(const chip of container.children){
      if(chip.querySelector(".city-drag-handle"))continue;
      const handle=make("button","city-drag-handle"),name=chip.querySelector("input").getAttribute("aria-label");handle.type="button";handle.setAttribute("aria-label","拖动排序："+name);handle.setAttribute("aria-describedby","city-sort-help");handle.setAttribute("aria-keyshortcuts","ArrowLeft ArrowRight ArrowUp ArrowDown");chip.insertBefore(handle,chip.querySelector(".city-delete"));
    }
    if(sortContainer===container)return;sortContainer=container;
    const help=make("span","sr-only","按住城市卡片或拖动手柄排序；手柄获得焦点后可用方向键调整顺序。"),status=make("span","sr-only");help.id="city-sort-help";status.id="city-sort-status";status.setAttribute("role","status");container.after(help,status);
    container.addEventListener("pointerdown",event=>{
      sortBlockClick=false;if(!media.matches||!event.isPrimary||event.button!==0||event.target.closest(".city-delete,input"))return;
      const chip=event.target.closest(".city-option");if(!chip||chip.parentNode!==container)return;
      sortDrag={chip,pointerId:event.pointerId,x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,before:sortKeys(),name:chip.querySelector("input").getAttribute("aria-label"),active:false};
      if(event.target.closest(".city-drag-handle")){event.preventDefault();event.target.closest(".city-drag-handle").focus({preventScroll:true});sortStart();}else sortDrag.timer=setTimeout(sortStart,350);
    });
    container.addEventListener("click",event=>{if(sortBlockClick){sortBlockClick=false;event.preventDefault();event.stopImmediatePropagation();}},true);
    document.addEventListener("pointermove",event=>{const drag=sortDrag;if(!drag||event.pointerId!==drag.pointerId)return;drag.x=event.clientX;drag.y=event.clientY;if(drag.active){event.preventDefault();sortMove();}else if(Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>8)sortFinish(false);},{passive:false});
    document.addEventListener("touchmove",event=>{if(sortDrag?.active)event.preventDefault();},{passive:false});
    document.addEventListener("pointerup",event=>{if(sortDrag?.pointerId===event.pointerId)sortFinish(true);});
    document.addEventListener("pointercancel",event=>{if(sortDrag?.pointerId===event.pointerId)sortFinish(false);});
    document.addEventListener("keydown",event=>{if(event.key==="Escape"&&sortDrag){event.preventDefault();event.stopImmediatePropagation();sortFinish(false);}},{capture:true});
    container.addEventListener("lostpointercapture",event=>{if(event.target===container)sortFinish(false);});
    container.addEventListener("contextmenu",event=>{if(sortDrag)event.preventDefault();});
    container.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&sortDrag){event.preventDefault();event.stopPropagation();sortFinish(false);return;}
      const handle=event.target.closest(".city-drag-handle");if(!handle||!media.matches)return;
      const chips=[...container.children],columns=chips.filter(chip=>Math.abs(chip.getBoundingClientRect().top-chips[0].getBoundingClientRect().top)<2).length,move={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key];
      if(move){event.preventDefault();const chip=handle.closest(".city-option"),from=chips.indexOf(chip),to=Math.max(0,Math.min(chips.length-1,from+move));if(from!==to){const keys=sortKeys(),key=keys.splice(from,1)[0];keys.splice(to,0,key);sortCallback(keys);handle.focus({preventScroll:true});status.textContent=chip.querySelector("input").getAttribute("aria-label")+"已移动到第 "+(to+1)+" 位";}}
    });
  }
  let sheet=null,placeholder=null,picker=null;
  function closePicker(){sortFinish(false);if(sheet?.open)sheet.close();}
  function openPicker(){if(!sheet)return;closeDayPopover();sheet.showModal();document.documentElement.classList.add("mobile-sheet-open");sheet.querySelector(".mobile-sheet-close").focus();}
  function setupPicker(){
    if(!picker)picker=document.getElementById("city-picker");if(!picker)return;
    if(media.matches){
      if(!sheet){sheet=make("dialog","mobile-city-sheet");sheet.setAttribute("aria-label","管理对比城市");const bar=make("div","mobile-sheet-bar"),handle=make("i","mobile-sheet-handle"),close=make("button","mobile-sheet-close","×");close.type="button";close.setAttribute("aria-label","关闭城市选择");close.addEventListener("click",closePicker);bar.append(handle,close);sheet.append(bar);document.body.append(sheet);sheet.addEventListener("click",event=>{if(event.target===sheet){const rect=sheet.getBoundingClientRect();if(event.clientY<rect.top||event.clientX<rect.left||event.clientX>rect.right)closePicker();}});sheet.addEventListener("close",()=>{sortFinish(false);document.documentElement.classList.remove("mobile-sheet-open");if(location.hash==="#city-picker")history.replaceState(null,"",location.pathname+location.search);});}
      if(picker.parentNode!==sheet){placeholder=document.createComment("city picker desktop position");picker.before(placeholder);sheet.append(picker);}
    }else if(placeholder){closePicker();placeholder.replaceWith(picker);placeholder=null;}
  }
  const cityViews=[["calendar","mobile-calendar-tools","日历"],["realtime","selected-comparison","实时"],["monthly","monthly-section","月历"],["stats","ecdf-section","统计"]];
  let cityView="calendar";
  function showCityView(view){
    cityView=cityViews.some(row=>row[0]===view)?view:"calendar";
    document.documentElement.dataset.mobileCityView=cityView;
    closeDayPopover();
    document.querySelectorAll(".mobile-section-jumps a").forEach(link=>{const active=link.dataset.view===cityView;link.classList.toggle("is-active",active);link.setAttribute("aria-current",active?"page":"false");});
  }
  function realtime(){
    const strip=document.getElementById("mobile-realtime-strip"),values=document.getElementById("selected-values");if(!strip||!values)return;
    strip.replaceChildren();
    const label=make("a","mobile-live-label",window.aqiSite.isStatic?"AQI 快照":"实时 AQI");label.href="#selected-comparison";label.title=document.getElementById("selected-date").textContent;label.addEventListener("click",event=>{event.preventDefault();navigateCityView("realtime");});
    const items=make("div","mobile-live-values");items.append(...[...values.children].map(node=>node.cloneNode(true)));strip.append(label,items);strip.hidden=!values.children.length;
  }
  function navigateCityView(view){
    showCityView(view);
    const target=cityViews.find(row=>row[0]===cityView)[1];history.pushState(null,"","#"+target);
    window.scrollTo({top:0,behavior:"instant"});
  }
  function restoreCityView(){showCityView(cityViews.find(row=>"#"+row[1]===location.hash)?.[0]||"calendar");}
  function initialize(){
    setupPicker();
    document.querySelectorAll("[data-mobile-city-picker]").forEach(link=>link.addEventListener("click",event=>{if(media.matches&&picker){event.preventDefault();openPicker();}}));
    if(document.getElementById("report-data")){
      const jumps=make("nav","mobile-section-jumps");jumps.setAttribute("aria-label","城市视图");
      for(const [view,id,label] of cityViews){const link=make("a","",label);link.href="#"+id;link.dataset.view=view;link.addEventListener("click",event=>{event.preventDefault();navigateCityView(view);});jumps.append(link);}
      document.getElementById("selected-comparison").after(jumps);jumps.hidden=!document.querySelector("#cities .city");
      const strip=make("div","mobile-realtime-strip");strip.id="mobile-realtime-strip";strip.setAttribute("aria-label","城市最新 AQI");jumps.before(strip);realtime();restoreCityView();
      window.addEventListener("hashchange",restoreCityView);window.addEventListener("popstate",restoreCityView);
    }
    if(media.matches&&location.hash==="#city-picker")openPicker();
  }
  media.addEventListener("change",()=>{sortFinish(false);setupPicker();refresh();});
  function visibility(visible){document.querySelectorAll(".mobile-calendar-tools,.mobile-section-jumps,.mobile-realtime-strip").forEach(node=>node.hidden=!visible);}
  window.aqiMobile={calendar,toolbar,visibility,monthMatrix,citySorting,realtime};
  document.addEventListener("DOMContentLoaded",initialize);
})();
