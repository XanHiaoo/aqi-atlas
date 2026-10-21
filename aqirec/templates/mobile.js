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
    output.replaceChildren();
    const rows=[...matrixSource.tBodies[0].rows],labels=[...matrixSource.tHead.rows[0].cells].slice(1).map(cell=>cell.textContent);
    for(let start=0;start<rows.length;start+=3){
      const cities=rows.slice(start,start+3),group=make("section","mobile-month-group"),table=make("table","mobile-month-table"),head=make("thead",""),heading=make("tr",""),body=make("tbody","");group.setAttribute("aria-label",cities.map(row=>row.cells[0].textContent).join("、"));
      const corner=make("th","","月份 / 城市");corner.scope="col";heading.append(corner);
      for(const city of cities){const name=make("th","",city.cells[0].textContent);name.scope="col";heading.append(name);}head.append(heading);table.append(head,body);
      labels.forEach((label,monthIndex)=>{
        const row=make("tr",""),month=make("th","",label);month.scope="row";row.dataset.month=cities[0].cells[monthIndex+1].firstElementChild.dataset.month;row.append(month);
        for(const city of cities){
          const original=city.cells[monthIndex+1].firstElementChild,cell=make("td",""),button=make("div",original.className);button.dataset.mobileMonthCell="";button.dataset.city=original.dataset.city;button.dataset.month=original.dataset.month;button.dataset.detail=original.title;button.style.cssText=original.style.cssText;button.setAttribute("role","img");button.setAttribute("aria-label",original.getAttribute("aria-label"));button.append(...[...original.childNodes].map(node=>node.cloneNode(true)));
          cell.append(button);row.append(cell);
        }
        body.append(row);
      });group.append(table);output.append(group);
    }
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
  let sheet=null,placeholder=null,picker=null;
  function closePicker(){if(sheet?.open)sheet.close();}
  function openPicker(){if(!sheet)return;closeDayPopover();sheet.showModal();document.documentElement.classList.add("mobile-sheet-open");sheet.querySelector(".mobile-sheet-close").focus();}
  function setupPicker(){
    if(!picker)picker=document.getElementById("city-picker");if(!picker)return;
    if(media.matches){
      if(!sheet){sheet=make("dialog","mobile-city-sheet");sheet.setAttribute("aria-label","管理对比城市");const bar=make("div","mobile-sheet-bar"),handle=make("i","mobile-sheet-handle"),close=make("button","mobile-sheet-close","×");close.type="button";close.setAttribute("aria-label","关闭城市选择");close.addEventListener("click",closePicker);bar.append(handle,close);sheet.append(bar);document.body.append(sheet);sheet.addEventListener("click",event=>{if(event.target===sheet){const rect=sheet.getBoundingClientRect();if(event.clientY<rect.top||event.clientX<rect.left||event.clientX>rect.right)closePicker();}});sheet.addEventListener("close",()=>{document.documentElement.classList.remove("mobile-sheet-open");if(location.hash==="#city-picker")history.replaceState(null,"",location.pathname+location.search);});}
      if(picker.parentNode!==sheet){placeholder=document.createComment("city picker desktop position");picker.before(placeholder);sheet.append(picker);}
    }else if(placeholder){closePicker();placeholder.replaceWith(picker);placeholder=null;}
  }
  function initialize(){
    setupPicker();
    document.querySelectorAll("[data-mobile-city-picker]").forEach(link=>link.addEventListener("click",event=>{if(media.matches&&picker){event.preventDefault();openPicker();}}));
    if(document.getElementById("report-data")){
      const jumps=make("nav","mobile-section-jumps");jumps.setAttribute("aria-label","统计区域");
      for(const [id,label] of[["mobile-calendar-tools","日历"],["monthly-section","月份"],["ecdf-section","分布"]]){const link=make("a","",label);link.href="#"+id;jumps.append(link);}
      document.getElementById("selected-comparison").after(jumps);jumps.hidden=!document.querySelector("#cities .city");
      const targets=["mobile-calendar-tools","monthly-section","ecdf-section"].map(id=>document.getElementById(id)).filter(Boolean);
      const observer=new IntersectionObserver(records=>{for(const record of records)if(record.isIntersecting){jumps.querySelectorAll("a").forEach(a=>a.classList.toggle("is-active",a.hash==="#"+record.target.id));}},{rootMargin:"-70px 0px -65% 0px",threshold:0});targets.forEach(node=>observer.observe(node));
      jumps.querySelector("a")?.classList.add("is-active");
    }
    if(media.matches&&location.hash==="#city-picker")openPicker();
  }
  media.addEventListener("change",()=>{setupPicker();refresh();});
  function visibility(visible){document.querySelectorAll(".mobile-calendar-tools,.mobile-section-jumps").forEach(node=>node.hidden=!visible);}
  window.aqiMobile={calendar,toolbar,visibility,monthMatrix};
  document.addEventListener("DOMContentLoaded",initialize);
})();
