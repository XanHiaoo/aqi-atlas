"use strict";
(() => {
  const source=JSON.parse(document.getElementById("report-data")?.textContent||document.getElementById("data")?.textContent||"{}");
  const media=matchMedia("(max-width: 767px), (max-width: 960px) and (pointer: coarse)"),months=[];
  let cursor=source.start_date.slice(0,7);
  while(cursor<=source.end_date.slice(0,7)){months.push(cursor);const [year,month]=cursor.split("-").map(Number);cursor=new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);}
  const state={month:months.at(-1),view:"month",date:source.end_date},entries=new Map();
  document.documentElement.dataset.mobileCalendarView=state.view;
  const iso=date=>date.toISOString().slice(0,10);
  const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  function contrast(fill){
    const canvas=contrast.canvas||(contrast.canvas=document.createElement("canvas")),ctx=canvas.getContext("2d");ctx.fillStyle=fill;ctx.fillRect(0,0,1,1);
    const rgb=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
    return rgb.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)>.179?"#000":"#fff";
  }
  function connected(){for(const [node] of entries)if(!node.isConnected)entries.delete(node);return [...entries];}
  function selectDate(date,callback){
    state.date=date;
    for(const [node,entry] of connected()){
      node.querySelectorAll("[data-mobile-date]").forEach(button=>{const active=button.dataset.mobileDate===date;button.classList.toggle("is-selected",active);button.setAttribute("aria-pressed",String(active));});
      const detail=node.querySelector(".mobile-day-detail");if(detail)detail.textContent=entry.options.describe(entry.rows.get(date),date);
    }
    callback?.(date);
  }
  function paint(node,entry){
    if(!media.matches)return;
    const {options,rows}=entry;node.replaceChildren();node.setAttribute("aria-label",options.label+" "+state.month.replace("-",".")+" 月历");
    const weekdays=make("div","mobile-weekdays");for(const label of["一","二","三","四","五","六","日"])weekdays.append(make("span","",label));node.append(weekdays);
    const grid=make("div","mobile-day-grid"),[year,month]=state.month.split("-").map(Number),first=new Date(Date.UTC(year,month-1,1)),count=new Date(Date.UTC(year,month,0)).getUTCDate();
    for(let i=0;i<(first.getUTCDay()+6)%7;i++){const blank=make("span","mobile-day-blank");blank.setAttribute("aria-hidden","true");grid.append(blank);}
    for(let day=1;day<=count;day++){
      const date=iso(new Date(Date.UTC(year,month-1,day))),row=rows.get(date),value=options.getValue(row),button=make("button","mobile-day");button.type="button";button.dataset.mobileDate=date;
      button.disabled=date<source.start_date||date>source.end_date;
      if(Number.isFinite(value)){const fill=options.color(value);button.style.background=fill;button.style.color=contrast(fill);}else button.classList.add("is-missing");
      button.append(make("span","mobile-day-number",day),make("strong","mobile-day-value",Number.isFinite(value)?options.format(value):"—"));
      button.title=options.describe(row,date);button.setAttribute("aria-label",button.title);button.classList.toggle("is-selected",date===state.date);button.setAttribute("aria-pressed",String(date===state.date));
      button.addEventListener("click",()=>selectDate(date,options.onSelect));
      button.addEventListener("keydown",event=>{const move={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(move){event.preventDefault();const key=iso(new Date(Date.UTC(year,month-1,day+move)));node.querySelector(`[data-mobile-date="${key}"]:not(:disabled)`)?.focus();}});
      grid.append(button);
    }
    node.append(grid);
    if(options.showDetail!==false){const detail=make("div","mobile-day-detail",options.describe(rows.get(state.date),state.date));detail.setAttribute("role","status");node.append(detail);}
  }
  function refresh(){
    document.documentElement.dataset.mobileCalendarView=state.view;
    document.querySelectorAll(".mobile-calendar-tools").forEach(node=>{
      node.querySelector("select").value=state.month;
      node.querySelector("[data-month-prev]").disabled=months.indexOf(state.month)===0;
      node.querySelector("[data-month-next]").disabled=months.indexOf(state.month)===months.length-1;
      node.querySelector(".mobile-month-switch").hidden=state.view!=="month";
      node.querySelectorAll("[data-calendar-view]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.calendarView===state.view)));
    });
    for(const [node,entry] of connected())paint(node,entry);
  }
  function changeMonth(month){
    state.month=month;
    const last=iso(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)));
    state.date=[last,source.end_date].sort()[0];if(state.date<source.start_date)state.date=source.start_date;
    refresh();connected()[0]?.[1].options.onSelect?.(state.date);
  }
  function toolbar(anchor,placement="before"){
    if(document.getElementById("mobile-calendar-tools"))return;
    const tools=make("div","mobile-calendar-tools");tools.id="mobile-calendar-tools";
    const heading=make("div","mobile-calendar-heading"),title=make("span","mobile-calendar-title",document.getElementById("report-data")?"城市日历":"差值日历"),views=make("div","mobile-calendar-views");views.setAttribute("role","group");views.setAttribute("aria-label","日历视图");
    for(const [value,label] of[["month","月历"],["year","全年"]]){const button=make("button","",label);button.type="button";button.dataset.calendarView=value;button.setAttribute("aria-pressed",String(value===state.view));button.addEventListener("click",()=>{state.view=value;refresh();});views.append(button);}
    heading.append(title,views);const chooser=make("div","mobile-month-switch"),previous=make("button","","‹"),next=make("button","","›"),select=make("select","");previous.type=next.type="button";previous.dataset.monthPrev="";next.dataset.monthNext="";previous.setAttribute("aria-label","上个月");next.setAttribute("aria-label","下个月");select.setAttribute("aria-label","选择日历月份");
    for(const month of months){const option=make("option","",month.replace("-","."));option.value=month;select.append(option);}select.value=state.month;
    previous.disabled=state.month===months[0];next.disabled=state.month===months.at(-1);
    previous.addEventListener("click",()=>changeMonth(months[months.indexOf(state.month)-1]));next.addEventListener("click",()=>changeMonth(months[months.indexOf(state.month)+1]));select.addEventListener("change",()=>changeMonth(select.value));
    chooser.append(previous,select,next);tools.append(heading,chooser);
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
  window.aqiMobile={calendar,toolbar,visibility};
  document.addEventListener("DOMContentLoaded",initialize);
})();
