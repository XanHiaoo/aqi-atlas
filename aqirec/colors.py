"""Fixed, auditable display mapping; never changes AQI values or categories."""

COLOR_SCALE = {
    "method": "fixed-absolute-aqi-within-epa-categories",
    "interpolation": "OKLab; linear in published AQI within each official category",
    "statistical_rebinning": False,
    "health_thresholds_changed": False,
    "category_source": "https://www.airnow.gov/aqi/aqi-basics/",
    "interpolation_source": "https://www.w3.org/TR/css-color-4/#interpolation-space",
    "bands": [
        {"lower": 0, "upper": 50, "start": "#075c32", "end": "#c8e6ad"},
        {"lower": 51, "upper": 100, "start": "#fff3ae", "end": "#d6a611"},
        {"lower": 101, "upper": 150, "start": "#ffd49b", "end": "#ed770e"},
        {"lower": 151, "upper": 200, "start": "#ffb1aa", "end": "#d82c40"},
        {"lower": 201, "upper": 300, "start": "#dcb7e8", "end": "#753c98"},
        {"lower": 301, "upper": 500, "start": "#bd607b", "end": "#530e28"},
    ],
    "over_500": "#530e28",
    "note": "Display interpolation only. Does not imply proportional health risk. Values above 500 retain their original number and share the darkest hazardous color.",
}
