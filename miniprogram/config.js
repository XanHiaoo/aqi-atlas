"use strict";
module.exports = {
  provider: "AQI.in", standard: "AQI-US",
  apiOrigin: "https://apiserver.aqi.in",
  publicPage: "https://www.aqi.in/dashboard/china/zhejiang/hangzhou/historical-analysis",
  requestTimeout: 20000, realtimeTtl: 5 * 60 * 1000,
  // Anonymous website configuration is fetched by this client; never package a private API key.
  networkEnabled: true
};
