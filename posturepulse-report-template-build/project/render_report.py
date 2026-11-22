#!/usr/bin/env python3
"""Bind a JSON payload into report_template.html and export an A4 PDF.

    pip install jinja2 playwright && playwright install chromium
    python render_report.py report_data.json PosturePulse_Report.pdf
"""
import json, sys, pathlib
from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

HERE = pathlib.Path(__file__).parent
SLATE, BLUE = "#64748B", "#1D4ED8"   # interval overlaps 0 / stays off 0
BAR_H, W, HALF = 12, 90, 40          # px per bar row, svg width, half-plot width


def make_bars(series):
    """Return (svg_height, bars) for one row. Domain is symmetric about 0 and shared by the row."""
    if not series:
        return 0, []
    d = max(max(abs(s["v"] - s["u"]), abs(s["v"] + s["u"])) for s in series) * 1.12 or 1
    x = lambda t: round(W / 2 + max(-d, min(d, t)) / d * HALF, 1)
    bars = []
    for i, s in enumerate(series):
        lo, hi = s["v"] - s["u"], s["v"] + s["u"]
        y = BAR_H / 2 + i * BAR_H
        bars.append(dict(x1=x(lo), x2=x(hi), cx=x(s["v"]), y=y, yt=y - 3.5, yb=y + 3.5,
                         color=SLATE if lo <= 0 <= hi else BLUE))
    return BAR_H * len(series), bars


def enrich(data):
    for key in ("table_a", "table_b"):
        for row in data["p4"][key]:
            row["h"], row["bars"] = make_bars(row["series"])
    return data


def render(json_path, pdf_path, html_path=None):
    data = enrich(json.loads(pathlib.Path(json_path).read_text(encoding="utf-8")))
    env = Environment(loader=FileSystemLoader(HERE), autoescape=select_autoescape(["html"]),
                      undefined=StrictUndefined)   # a missing schema key fails loudly, never prints blank
    html = env.get_template("report_template.html").render(**data)
    html_file = pathlib.Path(html_path or pathlib.Path(pdf_path).with_suffix(".html"))
    html_file.write_text(html, encoding="utf-8")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(html_file.resolve().as_uri(), wait_until="networkidle")
        pg.evaluate("document.fonts.ready")
        overflow = pg.evaluate("""[...document.querySelectorAll('.page')].map((p,i)=>
            [...p.children].some(c=>c.scrollHeight>c.clientHeight+1)?i+1:0).filter(Boolean)""")
        if overflow:
            print("WARNING: content overflows on page(s)", overflow, file=sys.stderr)
        pg.pdf(path=str(pdf_path), format="A4", print_background=True, prefer_css_page_size=True,
               margin=dict(top="0", right="0", bottom="0", left="0"))
        b.close()
    return pdf_path


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "report_data.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "PosturePulse_Report.pdf"
    print("wrote", render(src, out))
