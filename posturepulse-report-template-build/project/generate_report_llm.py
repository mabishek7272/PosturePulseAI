#!/usr/bin/env python3
"""Generate the NARRATIVE sections of a PosturePulse report (p3 synthesis/findings, p5
implications) via a real OpenRouter LLM call, then drop the result into the same
report_template.html the deterministic pipeline (render_report.py) already uses.

This is a comparison tool: same raw measurements, two authors (a human-written template vs.
an LLM), same template, same rendering path. It does NOT replace render_report.py — it produces
a second data file (report_data_llm.json) and a second PDF, side by side with the original.

Non-negotiable, not a suggestion (root CLAUDE.md, rule 1): "Never imply a diagnosis, validated
clinical accuracy, or a medically-meaningful score." The LLM is handed ONLY the raw numbers
(src/p2 regions + p4 table_a/table_b + meta) — never the existing human-written narrative, so it
cannot just paraphrase a pre-approved answer — and its system prompt encodes the same hedging
rules the template enforces by construction. Its JSON output is validated against the exact
schema render_report.py needs AND scanned for banned diagnostic/absolute language before
anything is written to disk. A model that won't follow the rules produces no output at all;
it is never "softened" after the fact by this script.

Usage:
    OPENROUTER_API_KEY=... python3 generate_report_llm.py --model <openrouter-model-slug>

Reads report_data.json (for meta/p2/p4/p6 — copied through verbatim, never regenerated) and
writes report_data_llm.json + PosturePulse_AI_Branded_Report_Priya_LLM.pdf alongside it.
"""
import argparse
import copy
import json
import os
import pathlib
import re
import sys
import urllib.request

HERE = pathlib.Path(__file__).parent
SRC_JSON = HERE / "report_data.json"
OUT_JSON = HERE / "report_data_llm.json"
OUT_PDF = HERE / "PosturePulse_AI_Branded_Report_Priya_LLM.pdf"

# Mirrors the qualification already in the human-authored report (p3.qualification) — the LLM is
# told the same boundary, not left to infer it.
# These are NEVER acceptable in any context — no hedged phrasing uses them.
BANNED_PHRASES_ALWAYS = [
    "textbook perfect", "optimal neurovascular", "excellent", "clinically normal",
    "you have", "patient has", "confirmed", "cleared", "no issue",
    "healthy posture", "perfect posture",
]
# Rule 5 REQUIRES sentences like "does not support a diagnosis" / "no structural disorder" — so
# these words can't be banned outright, only flagged when they appear WITHOUT a negation nearby
# (an affirmative diagnostic claim, which rule 1 forbids).
BANNED_WORDS_UNLESS_NEGATED = ["diagnos", "disorder", "pathology"]
NEGATION_MARKERS = ["not ", "n't", "never", "no ", "without", "cannot", "does not", "absence of", "rather than", "instead of"]

SYSTEM_PROMPT = """You are a technical interpretation assistant for PosturePulse AI, a posture \
measurement review tool. You are given ONLY raw, supplied numeric measurements with their \
stated uncertainty (never ground truth, never validated against a clinical outcome). Your job is \
to describe what the numbers show and do NOT show — nothing more.

Absolute rules, no exceptions:
1. Never state or imply a diagnosis, a structural disorder, a pathology, a neurologic or vascular \
finding, or any disease label.
2. Never say a measurement is "normal", "healthy", "excellent", "perfect", or "clinically \
clear" — a hedged, uncertainty-aware description only ("overlaps the reference", "uncertainty \
interval includes zero", etc.).
3. Whenever a value's uncertainty interval overlaps its stated reference, you MUST say so \
explicitly and say that no definite deviation can be inferred — never drop this caveat even if \
it feels repetitive.
4. Never invent a number, a reference range, or a clinical correlation that was not supplied.
5. Always include a line noting these are supplied measurements, not a diagnosis, and that \
clinical decisions require symptoms, examination and standardized repeat measurement.

Return ONLY a single JSON object with exactly these keys (all strings except "findings" and \
"steps", which are arrays of objects — see schema below). No markdown, no prose outside the JSON.

{
  "synthesis": "2-4 sentence overview, matching rule 1-5 above",
  "findings": [{"label": "short label", "text": "1-2 sentence hedged description"}, ...one per notable measurement group...],
  "integrity": "1-2 sentences on how to treat this data (e.g. don't average across layers if asked)",
  "qualification": "1-2 sentences restating what these numbers cannot establish",
  "significance": "2-3 sentences translating the pattern into plain, hedged language",
  "outcomes": "1-2 sentences on what a repeat measurement should look for",
  "limitations": "1-2 sentences on what this single capture cannot assess",
  "evidence": "1-2 sentences on general measurement-method reliability caveats",
  "conclusion": "2-3 sentences, explicitly stating this does not support a diagnosis or clearance"
}"""


def call_openrouter(model: str, data_view: dict, api_key: str) -> dict:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "Supplied measurements:\n" + json.dumps(data_view, indent=2)},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    content = payload["choices"][0]["message"]["content"]
    return json.loads(content)


REQUIRED_KEYS = {"synthesis", "findings", "integrity", "qualification", "significance", "outcomes", "limitations", "evidence", "conclusion"}


def _sentences(text: str) -> list[str]:
    return re.split(r"(?<=[.!?])\s+", text)


def validate(llm: dict) -> list[str]:
    """Returns a list of problems. Empty list = safe to use."""
    problems = []
    missing = REQUIRED_KEYS - llm.keys()
    if missing:
        problems.append(f"missing required keys: {sorted(missing)}")
    if not isinstance(llm.get("findings"), list) or not llm["findings"]:
        problems.append("'findings' must be a non-empty array")

    # Flatten every string value (including nested findings[].text) into individual sentences so
    # a negation in one sentence can't "cover" a risky word in an unrelated sentence elsewhere.
    strings: list[str] = []
    for k, v in llm.items():
        if isinstance(v, str):
            strings.append(v)
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    strings.extend(str(x) for x in item.values() if isinstance(x, str))
    all_sentences = [s for text in strings for s in _sentences(text)]

    for sentence in all_sentences:
        low = sentence.lower()
        for phrase in BANNED_PHRASES_ALWAYS:
            if phrase in low:
                problems.append(f"banned phrase found: {phrase!r} in: {sentence!r}")
        for word in BANNED_WORDS_UNLESS_NEGATED:
            if word in low and not any(neg in low for neg in NEGATION_MARKERS):
                problems.append(f"affirmative use of {word!r} without a negation in the same sentence: {sentence!r}")
    return problems


def build_data_view(src: dict) -> dict:
    return {
        "meta": src["meta"],
        "regions": src["p2"]["regions"],
        "table_a": [{k: v for k, v in r.items() if k != "series"} for r in src["p4"]["table_a"]],
        "table_b": [{k: v for k, v in r.items() if k != "series"} for r in src["p4"]["table_b"]],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="OpenRouter model slug, e.g. 'vendor/model-name'")
    ap.add_argument("--render", action="store_true", help="also render the PDF via render_report.py after writing report_data_llm.json")
    args = ap.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY is not set. Refusing to proceed without an explicit key — never a default/fallback.", file=sys.stderr)
        sys.exit(1)

    src = json.loads(SRC_JSON.read_text(encoding="utf-8"))
    data_view = build_data_view(src)

    print(f"Calling OpenRouter model '{args.model}' with {len(data_view['regions'])} regions, "
          f"{len(data_view['table_a'])} + {len(data_view['table_b'])} table rows...", file=sys.stderr)
    llm_out = call_openrouter(args.model, data_view, api_key)

    problems = validate(llm_out)
    if problems:
        print("REFUSING to write output — the model's response failed validation:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(2)

    out = copy.deepcopy(src)
    out["p3"]["synthesis"] = llm_out["synthesis"]
    out["p3"]["findings"] = llm_out["findings"]
    out["p3"]["integrity"] = llm_out["integrity"]
    out["p3"]["qualification"] = llm_out["qualification"]
    out["p5"]["significance"] = llm_out["significance"]
    out["p5"]["outcomes"] = llm_out["outcomes"]
    out["p5"]["limitations"] = llm_out["limitations"]
    out["p5"]["evidence"] = llm_out["evidence"]
    out["p5"]["conclusion"] = llm_out["conclusion"]
    out["classification"] = src["classification"] + " · NARRATIVE DRAFTED BY " + args.model.upper()

    OUT_JSON.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"wrote {OUT_JSON}", file=sys.stderr)

    if args.render:
        from render_report import render
        render(str(OUT_JSON), str(OUT_PDF))
        print(f"wrote {OUT_PDF}", file=sys.stderr)


if __name__ == "__main__":
    main()
