"""
training/dictionary/fetch.py — download the pinned dictionary sources (T70)

Description:
    Downloads every source in configs/dictionary.yaml → sources that has no
    local file yet, then checks each file's SHA-256 against the pinned value.
    Large files are fetched as parallel byte ranges (kaikki.org serves each
    connection slowly) and joined; every part is retried. `--pin` writes the
    SHA-256 of files whose pin is PENDING (first download of a new source)
    and the Wiktionary download date into the YAML.

Usage (from training/):
    .venv/bin/python -m dictionary.fetch [--pin] [--only wiktionary] [--parts 12]

Dependencies: Python standard library, pyyaml. Network: dev-time downloads only.
Status: implemented (T70).
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import re
import sys
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import yaml

TRAINING = Path(__file__).resolve().parent.parent
CONFIG = TRAINING / "configs" / "dictionary.yaml"
USER_AGENT = "enparse-dictionary-build (dev-time download)"
#: Files larger than this are downloaded as parallel ranges.
RANGED_MIN_BYTES = 4 * 1024 * 1024


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _request(
    url: str, headers: dict[str, str] | None = None, method: str = "GET"
) -> urllib.request.Request:
    return urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, **(headers or {})}, method=method
    )


def remote_size(url: str) -> tuple[int, bool]:
    """Content length and whether byte ranges are accepted."""
    with urllib.request.urlopen(_request(url, method="HEAD"), timeout=60) as r:
        return int(r.headers.get("Content-Length", "0")), r.headers.get("Accept-Ranges") == "bytes"


def _fetch_range(url: str, start: int, end: int, part: Path, tries: int = 8) -> None:
    for attempt in range(tries):
        have = part.stat().st_size if part.exists() else 0
        if have == end - start + 1:
            return
        try:
            req = _request(url, {"Range": f"bytes={start + have}-{end}"})
            with urllib.request.urlopen(req, timeout=120) as r, part.open("ab") as f:
                for chunk in iter(lambda: r.read(1 << 16), b""):
                    f.write(chunk)
        except OSError as e:  # network errors: resume the part
            print(f"  part {part.name}: {e}; retry {attempt + 1}", file=sys.stderr)
            time.sleep(2 + attempt * 3)
    if part.stat().st_size != end - start + 1:
        raise RuntimeError(f"part {part.name} incomplete")


def download(url: str, dest: Path, parts: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    size, ranges = remote_size(url)
    tmp = dest.with_suffix(dest.suffix + ".part")
    if not ranges or size < RANGED_MIN_BYTES:
        with urllib.request.urlopen(_request(url), timeout=120) as r, tmp.open("wb") as f:
            for chunk in iter(lambda: r.read(1 << 16), b""):
                f.write(chunk)
    else:
        step = -(-size // parts)
        pieces = [(i * step, min(size, (i + 1) * step) - 1) for i in range(parts)]
        part_files = [dest.with_name(f"{dest.name}.{i:02d}") for i in range(parts)]
        print(f"  {size / 1e6:.0f} MB in {parts} ranges")
        with cf.ThreadPoolExecutor(parts) as pool:
            for fut in [
                pool.submit(_fetch_range, url, a, b, p)
                for (a, b), p in zip(pieces, part_files, strict=True)
            ]:
                fut.result()
        with tmp.open("wb") as out:
            for p in part_files:
                out.write(p.read_bytes())
                p.unlink()
    if size and tmp.stat().st_size != size:
        raise RuntimeError(f"{dest.name}: got {tmp.stat().st_size} bytes, expected {size}")
    tmp.rename(dest)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--pin", action="store_true", help="write SHA-256 for PENDING pins")
    ap.add_argument("--only", nargs="*", help="source keys")
    ap.add_argument("--parts", type=int, default=12)
    args = ap.parse_args()
    text = CONFIG.read_text(encoding="utf8")
    cfg = yaml.safe_load(text)
    for key, src in cfg["sources"].items():
        if args.only and key not in args.only:
            continue
        path = TRAINING / src["file"]
        if not path.exists():
            print(f"{key}: downloading {src['url']}")
            download(src["url"], path, args.parts)
            if key == "wiktionary" and args.pin:
                today = datetime.now(UTC).strftime("%Y-%m-%d")
                text = re.sub(r"(\n    downloaded: )PENDING", rf'\g<1>"{today}"', text, count=1)
        digest = sha256(path)
        pin = src["sha256"]
        if pin == "PENDING":
            if not args.pin:
                raise SystemExit(f"{key}: SHA-256 not pinned (run with --pin): {digest}")
            text = re.sub(
                rf"(\n  {key}:\n(?:    .*\n)*?    sha256: )PENDING",
                rf"\g<1>{digest}",
                text,
                count=1,
            )
            print(f"{key}: pinned {digest}")
        elif pin != digest:
            raise SystemExit(f"{key}: SHA-256 mismatch for {src['file']}: {digest} (pinned {pin})")
        else:
            print(f"{key}: ok")
    CONFIG.write_text(text, encoding="utf8")


if __name__ == "__main__":
    main()
