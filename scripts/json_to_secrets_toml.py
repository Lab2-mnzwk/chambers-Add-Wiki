"""service_account.json → secrets.toml (TOML) 変換。Cloud Secrets 貼り付け用。"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
src = ROOT / ".streamlit" / "service_account.json"
dst = ROOT / ".streamlit" / "secrets.toml"

data = json.loads(src.read_text(encoding="utf-8"))
lines = ["[gcp_service_account]"]
for key, val in data.items():
    s = (
        str(val)
        .replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\r", "")
        .replace("\n", "\\n")
    )
    lines.append(f'{key} = "{s}"')
dst.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"Wrote {dst}")
