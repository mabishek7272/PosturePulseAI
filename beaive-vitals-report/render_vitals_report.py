#!/usr/bin/env python3
"""Bind vitals_data.json into vitals_template.html and export an A4 PDF.
Mirrors posturepulse-report-template-build/project/render_report.py's approach exactly.

    python3 render_vitals_report.py vitals_data.json beAIve_Vitals_Report.pdf
"""
import json
import pathlib
import sys

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

HERE = pathlib.Path(__file__).parent


def render(json_path, pdf_path, html_path=None):
    data = json.loads(pathlib.Path(json_path).read_text(encoding="utf-8"))
    env = Environment(loader=FileSystemLoader(HERE), autoescape=select_autoescape(["html"]),
                       undefined=StrictUndefined)
    html = env.get_template("vitals_template.html").render(**data)
    html_file = pathlib.Path(html_path or pathlib.Path(pdf_path).with_suffix(".html"))
    html_file.write_text(html, encoding="utf-8")

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(html_file.resolve().as_uri(), wait_until="networkidle")
        pg.evaluate("document.fonts.ready")
        # Unlike posturepulse's template (fixed-height .page divs, one per physical page — overflow
        # there is a real bug), this template is a single naturally-flowing div that Chromium paginates
        # itself across as many physical PDF pages as needed. There is no fixed height to overflow.
        pg.pdf(path=str(pdf_path), format="A4", print_background=True, prefer_css_page_size=True,
               margin=dict(top="0", right="0", bottom="0", left="0"))
        b.close()
    return pdf_path


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "vitals_data.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "beAIve_Vitals_Report.pdf"
    print("wrote", render(src, out))
