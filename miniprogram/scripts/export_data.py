"""Package only the existing public snapshot and display metadata; no credentials."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from aqirec.colors import COLOR_SCALE
from aqirec.comparison import comparison_metadata
from aqirec.cities import ALIASES
from aqirec.aqiin_api import REGIONS

payload = json.loads((ROOT / "site-data/snapshot.json").read_text(encoding="utf-8"))
for city in payload["report"]["cities"]:
    if not city.get("slug"):
        city["slug"] = f"china/{REGIONS[city['key']]}/{city['key']}"
payload["report"]["color_scale"] = COLOR_SCALE
payload["report"]["comparison"] = comparison_metadata(payload["report"])
target = ROOT / "miniprogram/data"
target.mkdir(parents=True, exist_ok=True)
(target / "snapshot.js").write_text("module.exports=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + ";\n", encoding="utf-8")
(target / "aliases.js").write_text("module.exports=" + json.dumps(ALIASES, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
print("Exported public AQI snapshot and city name aliases.")
