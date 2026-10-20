# Public website snapshot

`snapshot.json` contains the published AQI.in US AQI report, its default city selection and the last available AQI snapshot. It is deliberately committed so GitHub Pages can build without accessing your computer or the data provider.

Export your current local data before pushing an update:

```shell
python -m aqirec.pages export
```

The exporter does not include `client.html`, provider tokens, browser profiles, cookies, update logs or raw realtime errors. All files here are public when this repository is public. The original local caches remain in the ignored `data/` directory.

The scheduled workflow refreshes this snapshot only after validating the new daily data. If fetching fails or previously available dates disappear, it keeps the existing snapshot and deployment.
