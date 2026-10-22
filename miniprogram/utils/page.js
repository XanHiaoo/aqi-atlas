"use strict";
const VM=require("./view-model"),M=require("./model");
const modes=["calendar","realtime","monthly","statistics","compare"];
module.exports=mode=>({
 data:{view:{mode,available:[],cards:[],live:[],weekdays:[],ecdf:{},monthlyGap:{},pairEcdf:{}},navTop:24,navHeight:44},
 onLoad(){this.store=getApp().store;this.ui={mode,threshold:50,metric:"median",notes:false,manager:false,visibleCities:3,sort:"default",focus:null,selectedDate:this.store.snapshot().report.end_date};let info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();const capsule=wx.getMenuButtonBoundingClientRect();this.setData({navTop:info.statusBarHeight||24,navHeight:Math.max(44,capsule.bottom-(info.statusBarHeight||24)+8)});this.unsubscribe=this.store.subscribe(()=>this.paint());this.paint();},
 onShow(){if(this.getTabBar&&this.getTabBar())this.getTabBar().setData({selected:modes.indexOf(mode)});if(this.store){this.paint();this.store.refresh();}clearInterval(this.timer);this.timer=setInterval(()=>this.store.refresh(),60000);},
 onHide(){clearInterval(this.timer);},onUnload(){this.destroyed=true;this.searchVersion=(this.searchVersion||0)+1;clearInterval(this.timer);clearTimeout(this.searchTimer);if(this.unsubscribe)this.unsubscribe();},
 onPullDownRefresh(){this.store.refresh(true).finally(()=>wx.stopPullDownRefresh());},
 onReachBottom(){if(mode==="calendar"){const count=this.store.snapshot().cities.length;if(this.ui.visibleCities>=count)return;this.ui.visibleCities=Math.min(count,this.ui.visibleCities+3);this.paint();}},
 onShareAppMessage(){return {title:"城市 AQI 年度概览",path:"/pages/"+mode+"/index"};},
 paint(){if(!this.ui||this.destroyed)return;if(this.getTabBar&&this.getTabBar())this.getTabBar().setData({hidden:!!this.ui.manager});const view=VM.build(this.store.snapshot(),this.ui);if(mode==="calendar"){
  const current=this.data.view,patch={},cards=view.cards||[],previous=current.cards||[];
  Object.keys(view).filter(key=>key!=="cards").forEach(key=>{if(JSON.stringify(current[key])!==JSON.stringify(view[key]))patch["view."+key]=view[key];});
  // Keep existing cards mounted while appending or refreshing: clearing the list collapses the page and clamps scrollTop to zero.
  if(cards.length<previous.length)patch["view.cards"]=cards;
  if(Object.keys(patch).length)this.setData(patch);
  if(cards.length>=previous.length)cards.forEach((card,i)=>{if(JSON.stringify(previous[i])!==JSON.stringify(card))this.setData({["view.cards["+i+"]"]:card});});
 }else this.setData({view});if(mode==="compare"&&view.aKey&&view.bKey)this.store.setPair([view.aKey,view.bKey]);},
 noop(){},openManager(){this.ui.manager=true;this.paint();},closeManager(){this.ui.manager=false;this.ui.dragKey=null;this.paint();},
 toggleCity(event){const key=event.currentTarget.dataset.key,s=this.store.snapshot(),keys=s.selected.slice(),i=keys.indexOf(key);if(i<0)keys.push(key);else keys.splice(i,1);this.store.select(keys);this.store.refresh();},
 allCities(){this.store.select(this.store.snapshot().available.map(c=>c.key));this.store.refresh();},clearCities(){this.store.select([]);},
 deleteCity(event){const key=event.currentTarget.dataset.key;wx.showModal({title:"删除城市",content:"从城市列表移除，之后可搜索重新添加。",success:result=>{if(result.confirm)this.store.remove(key);}});},
 searchInput(event){this.searchVersion=(this.searchVersion||0)+1;this.ui.query=event.detail.value;clearTimeout(this.searchTimer);if(!this.ui.query.trim()){this.ui.searchRows=[];this.ui.searchError="";this.paint();return;}this.searchTimer=setTimeout(()=>this.searchCities(),400);},
 async searchCities(){const query=(this.ui.query||"").trim();if(!query)return;const version=this.searchVersion=(this.searchVersion||0)+1;this.ui.searching=true;this.paint();const result=await this.store.search(query);if(version!==this.searchVersion)return;this.ui.searchRows=result.rows.map(c=>Object.assign({},c,{selected:this.store.snapshot().selected.includes(c.key)}));this.ui.searchError=result.error||(!result.rows.length?"未找到城市，请尝试中文或英文名称":"");this.ui.searching=false;this.paint();},
 async addSearchCity(event){const city=this.ui.searchRows.find(c=>c.key===event.currentTarget.dataset.key);if(!city)return;if(city.region){this.ui.searching=true;this.paint();try{this.ui.searchRows=await this.store.region(city);this.ui.searchError=this.ui.searchRows.length?"":"未找到下辖城市，请输入具体城市名";}catch(e){this.ui.searchError=e.message;}this.ui.searching=false;this.paint();return;}try{await this.store.add(city);this.ui.searchRows=this.ui.searchRows.map(c=>Object.assign({},c,{selected:this.store.snapshot().selected.includes(c.key)}));this.paint();this.store.refresh();}catch(e){wx.showToast({title:e.message,icon:"none"});}},
 startDrag(event){this.ui.dragKey=event.currentTarget.dataset.key;wx.vibrateShort({type:"light"});this.paint();wx.createSelectorQuery().selectAll(".manager-chip").boundingClientRect(rects=>{this.dragRects=rects;this.dragOrder=this.store.snapshot().available.map(c=>c.key);}).exec();},
 dragMove(event){if(!this.ui.dragKey||!this.dragRects)return;const touch=event.touches[0],target=this.dragRects.findIndex(r=>touch.clientX>=r.left&&touch.clientX<=r.right&&touch.clientY>=r.top&&touch.clientY<=r.bottom);if(target<0)return;const order=this.store.snapshot().available.map(c=>c.key),from=order.indexOf(this.ui.dragKey);if(from!==target&&from>=0){order.splice(target,0,order.splice(from,1)[0]);this.store.reorder(order);}},
 endDrag(){this.ui.dragKey=null;this.dragRects=null;this.paint();},
 dayTap(event){const {date,key}=event.currentTarget.dataset,s=this.store.snapshot();this.ui.selectedDate=date;if(mode==="compare"){const a=s.available.find(c=>c.key===this.data.view.aKey),b=s.available.find(c=>c.key===this.data.view.bKey),row=M.paired(a,b,s.report.start_date,s.report.end_date).find(row=>row.date===date);this.ui.popup={title:date.replace(/-/g,"."),lines:row?[a.name+" "+M.fmt(row.a),b.name+" "+M.fmt(row.b),"差值 "+M.signed(row.delta)+" AQI"]:["未形成有效配对"]};}else{const c=s.available.find(c=>c.key===key),row=c&&c.days.find(d=>d.date===date),value=row&&row.mean;this.ui.popup={title:(c?c.name:"")+" · "+date.replace(/-/g,"."),lines:M.valid(value)?["AQI "+M.fmt(value),s.report.categories[M.categoryIndex(value,s.report)].name]:["数据缺失"]};}this.paint();},
 closePopup(){this.ui.popup=null;this.paint();},setMetric(event){this.ui.metric=event.currentTarget.dataset.metric;this.paint();},
 setThreshold(event){this.ui.threshold=Number(event.detail.value);this.paint();},preset(event){this.ui.threshold=Number(event.currentTarget.dataset.value);this.paint();},
 focusSeries(event){const key=event.currentTarget.dataset.key;this.ui.focus=this.ui.focus===key?null:key;this.paint();},resetFocus(){this.ui.focus=null;this.paint();},
 sortShares(event){this.ui.sort=["default","desc","asc"][Number(event.detail.value)];this.paint();},
 pickA(event){const s=this.store.snapshot(),key=s.available[Number(event.detail.value)].key;if(key===this.data.view.bKey){this.ui.b=this.data.view.aKey;}this.ui.a=key;this.paint();},pickB(event){const s=this.store.snapshot(),key=s.available[Number(event.detail.value)].key;if(key===this.data.view.aKey)this.ui.a=this.data.view.bKey;this.ui.b=key;this.paint();},swap(){this.ui.a=this.data.view.bKey;this.ui.b=this.data.view.aKey;this.paint();},
 toggleNotes(){this.ui.notes=!this.ui.notes;this.paint();},goRealtime(){wx.switchTab({url:"/pages/realtime/index"});},
});
