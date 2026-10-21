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
      node.querySelectorAll(".mobile-day-detail").forEach(detail=>{detail.textContent=entry.options.describe(entry.rows.get(date),date);});
    }
    callback?.(date);
  }
  function paint(node,entry){
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
        cell.addEventListener("click",()=>selectDate(date,options.onSelect));
        cell.addEventListener("keydown",event=>{const move={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(move){event.preventDefault();const key=iso(new Date(Date.UTC(year,month-1,day+move))),target=node.querySelector(`[data-mobile-date="${key}"]:not(:disabled)`);if(target){selectDate(key,options.onSelect);target.focus();}}});
        if(Number.isFinite(value))cell.style.background=options.color(value);else cell.classList.add("is-missing");grid.append(cell);
      }
      panel.append(grid);overview.append(panel);
    }
    node.append(overview);
    if(options.showDetail!==false){const detail=make("div","mobile-day-detail",options.describe(rows.get(state.date),state.date));detail.setAttribute("role","status");node.append(detail);}
  }
  let matrixSource=null;
  function paintMonthMatrix(){
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
          const original=city.cells[monthIndex+1].firstElementChild,cell=make("td",""),button=original.cloneNode(true);button.dataset.mobileMonthCell="";
          const show=()=>{
            document.getElementById("month-matrix-detail").textContent=original.title;
            output.querySelectorAll(".mobile-month-detail-row").forEach(node=>node.remove());output.querySelectorAll(".is-selected").forEach(node=>node.classList.remove("is-selected"));button.classList.add("is-selected");
            const detail=make("tr","mobile-month-detail-row"),text=make("td","",original.title);text.colSpan=cities.length+1;text.setAttribute("role","status");detail.append(text);row.after(detail);
          };
          button.addEventListener("click",show);button.addEventListener("focus",()=>{if(button.matches(":focus-visible"))show();});
          button.addEventListener("keydown",event=>{const move={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(move){event.preventDefault();table.querySelector(`[data-city-index="${Number(button.dataset.cityIndex)+move[0]}"][data-month-index="${monthIndex+move[1]}"]`)?.focus();}});
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
  function openPicker(){if(!sheet)return;sheet.showModal();document.documentElement.classList.add("mobile-sheet-open");sheet.querySelector(".mobile-sheet-close").focus();}
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
