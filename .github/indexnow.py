#!/usr/bin/env python3
"""変わったページの URL を IndexNow（Bing・Yandex・Naver など）に送る。Google は IndexNow に対応していない。

.github/workflows/indexnow.yml から main への push のたびに実行する。
  python3 .github/indexnow.py diff <before> <after>   … 2つのコミットの間で追加・変更・削除された HTML
                                                       （鍵か CNAME が変わった push は全 URL）
  python3 .github/indexnow.py all                     … サイトマップに載っている全 URL（初回・手動用）

鍵はリポジトリ直下の <鍵>.txt（中身は鍵そのもの）。IndexNow の仕様で公開する値なので秘密ではない。
送り先のホストは CNAME があればその独自ドメイン、無ければ test190928.github.io。
"""
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://api.indexnow.org/indexnow"
SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
BATCH = 10000  # 1回に送れる上限


def origin():
    cname = ROOT / "CNAME"
    host = cname.read_text().strip() if cname.exists() else "test190928.github.io"
    return "https://" + host


def key():
    keys = [p for p in ROOT.glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem) and p.read_text().strip() == p.stem]
    if len(keys) != 1:
        sys.exit(f"鍵のファイルが1つに決まらない: {[p.name for p in keys]}")
    return keys[0].stem


def url_of(path, base):
    if path.startswith(".") or not path.endswith(".html"):
        return None
    return f"{base}/{path.removesuffix('index.html')}"


def changed(before, after, base):
    if not before or set(before) == {"0"}:
        return all_urls(base)
    out = subprocess.run(["git", "diff", "--name-only", "--no-renames", before, after],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout
    paths = out.splitlines()
    # 鍵を置いた最初の push と、独自ドメインへ移した push（CNAME）は全 URL を送る
    if "CNAME" in paths or any(re.fullmatch(r"[0-9a-f]{32}\.txt", p) for p in paths):
        return all_urls(base)
    return [u for u in (url_of(p, base) for p in paths) if u]


def all_urls(base):
    urls = []
    for sm in sorted(ROOT.rglob("sitemap*.xml")):
        if ".git" in sm.parts:
            continue
        root = ET.parse(sm).getroot()
        if root.tag == SM_NS + "urlset":
            urls += [e.text.strip() for e in root.iter(SM_NS + "loc") if e.text]
    return [u for u in dict.fromkeys(urls) if u.startswith(base + "/")]


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except OSError:
        return 0, ""


def wait_live(url, expect=None, limit=600):
    """GitHub Pages の反映（通常1〜2分）を待つ。"""
    end = time.time() + limit
    while time.time() < end:
        status, body = fetch(url)
        if status == 200 and (expect is None or body.strip() == expect):
            return True
        time.sleep(20)
    return False


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    base, k = origin(), key()
    urls = all_urls(base) if mode == "all" else changed(sys.argv[2], sys.argv[3], base)
    if not urls:
        print("送る URL なし")
        return
    key_url = f"{base}/{k}.txt"
    if not wait_live(key_url, k):
        sys.exit(f"鍵のファイルが公開されていない: {key_url}")
    wait_live(urls[0])  # 変更が反映されてから送る（削除されたページなら待ちきって送る）
    host = base.removeprefix("https://")
    for i in range(0, len(urls), BATCH):
        body = json.dumps({"host": host, "key": k, "keyLocation": key_url, "urlList": urls[i:i + BATCH]}).encode()
        req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                print(f"IndexNow: {len(urls[i:i + BATCH])} 件を送信 HTTP {r.status}")
        except urllib.error.HTTPError as e:
            # 403=鍵が無効 422=ホストと URL が合わない 429=送りすぎ
            sys.exit(f"IndexNow: HTTP {e.code} {e.read()[:200]!r}")


if __name__ == "__main__":
    main()
