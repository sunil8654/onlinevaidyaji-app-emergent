"""Three-way table audit: live shared DB vs web schema dump vs app msdb usage.

Outputs:
- WEB-owned (in dump) -> mirrored by app via msdb (verify two-way at runtime)
- APP-created only (NOT in dump) -> app reads/writes exclusively (like blogs:
  keep per user rule, zero web conflict)
- FOREIGN leftovers -> in dump + DB but NOT referenced by app COLMAP/aliases
  (web-only tables the app just ignores — leave alone)
"""
import re, subprocess, sys

DUMP = r"C:\Users\91701\Desktop\OnlineVaidhyaJi.com\onlinevaidyaji-app-emergent-main\backend\onlinevaidyaji-full-database.sql"

def sh(cmd: str) -> str:
    import asyncio
    return run_sync(cmd)

def run_sync(cmd: str) -> str:
    # run via node-style direct shell (we're on win — use subprocess)
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout or ""

# 1) web dump table names
dump = open(DUMP, encoding="utf-8", errors="replace").read()
web_tables = set(re.findall(r"CREATE TABLE [`\"]?(\w+)[`\"]?\s*\(", dump))
# also catch `CREATE TABLE IF NOT EXISTS`
web_tables |= set(re.findall(r"CREATE TABLE IF NOT EXISTS [`\"]?(\w+)", dump))

# 2) live DB table names (from earlier established XAMPP mysql)
import os
mysql = r"C:\xampp\mysql\bin\mysql.exe"
out = subprocess.run([mysql, "-u", "root", "onlinevaidyaji", "-e", "SHOW TABLES;"],
                     capture_output=True, text=True).stdout
live_tables = set()
for ln in out.splitlines():
    m = re.search(r"^onlinevaidyaji\.(\w+)\s*$", ln.strip()) or re.search(r"^\|?\s*(\w+)\s*\|?$", ln.strip())
    if m and m.group(1) != "Tables_in_onlinevaidyaji":
        live_tables.add(m.group(1))

# 3) app msdb references: TABLE_ALIASES keys, COLUMN_MAPS keys, table names in msdb
app_ms = open(r"C:\Users\91701\Desktop\OnlineVaidhyaJi.com\onlinevaidyaji-app-emergent-main\backend\msdb.py",
              encoding="utf-8", errors="replace").read()
app_tables = set(re.findall(r"['\"]([\w]+)['\"]\s*:\s*\{", app_ms))
# collect our TABLE_ALIASES dict keys too (app collection -> web table)
alias_map = {}
mm = re.search(r"TABLE_ALIASES\s*[:=]\s*\{(.*?)\n\}", app_ms, re.S)
if mm:
    for k, v in re.findall(r"['\"]([\w]+)['\"]\s*:\s*['\"]([\w]+)['\"]", mm.group(1)):
        alias_map[k] = v

print("WEB dump tables: %d" % len(web_tables))
print("LIVE DB tables:  %d" % len(live_tables))
print("App alias map (collection -> web table): %d" % len(alias_map))
print()
print("=== APP-ONLY (live but NOT in web dump) — like blogs, keep per user rule ===")
app_only = sorted(live_tables - web_tables)
print("\n".join("  " + t for t in app_only) if app_only else "  (none)")
print()
print("=== IN DUMP but MISSING from LIVE DB (web schema not yet imported) ===")
miss = sorted(web_tables - live_tables)
print("\n".join("  " + t for t in miss) if miss else "  (none)")
print()
print("=== WEB tables the app maps (aliases resolved) ===")
for coll, web in sorted(alias_map.items()):
    flag = "OK" if web in live_tables else "MISSING-BUT-OK(mirrors live)"
    print(f"  {coll} -> {web} [{flag}]")
