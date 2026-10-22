"use strict";
const {createStore}=require("./services/store"),{createClient}=require("./services/provider");
App({onLaunch(){this.store=createStore(wx,createClient(options=>wx.request(options)));},onShow(){if(this.store)this.store.refresh();}});
