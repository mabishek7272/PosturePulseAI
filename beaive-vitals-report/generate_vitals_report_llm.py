#!/usr/bin/env python3
"""Generate the AI-interpretation section of a beAIve Vitals report via a real OpenRouter call,
then drop it into vitals_template.html (same template used for the deterministic report — the
template design never changes, only an additive "ai" block is filled in).

Same approach and the same reasoning as posturepulse-report-template-build/project's
generate_report_llm.py: the model sees ONLY the raw indicator/result/desired values (never a
pre-written answer to paraphrase), a system prompt encodes the product's own disclaimer
("for general wellness and fitness purposes only, not for medical diagnosis"), and a
negation-aware validator refuses to write anything that crosses into diagnostic language before
it ever reaches the template.

Usage:
    OPENROUTER_API_KEY=... python3 generate_vitals_report_llm.py --model <openrouter-model-slug>
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
SRC_JSON = HERE / "vitals_data.json"
OUT_JSON = HERE / "vitals_data_llm.json"
OUT_PDF = HERE / "beAIve_Vitals_Report_LLM.pdf"

BANNED_PHRASES_ALWAYS = [
    "you have diabetes", "you are diabetic", "you have hypertension", "you are hypertensive",
    "you have anemia", "clinically normal", "healthy heart", "no risk", "perfectly healthy",
    "confirms normal", "excellent health", "nothing to worry",
    "you are healthy", "you're healthy", "normal cardiovascular function", "all clear",
]
# Required by the mandated disclaimer sentence ("not for medical diagnosis", "should be confirmed
# with validated clinical equipment or a licensed clinician") — cannot be banned outright, only
# when used WITHOUT a negation/safe-context nearby. "confirmed"/"cleared" are the recommended,
# SAFE way to say "go get this checked" (rule 5's own required wording) — only unsafe when the
# sentence claims the AI ITSELF confirmed/cleared something, i.e. with no clinician/lab/device
# context nearby.
BANNED_WORDS_UNLESS_NEGATED = ["diabet", "hypertens", "anemi", "disease", "disorder", "pathology", "diagnos"]
BANNED_WORDS_UNLESS_SAFE_CONTEXT = ["confirmed", "cleared"]
SAFE_CONTEXT_MARKERS = ["clinician", "clinical", "laborator", "licensed", "validated", "physician", "doctor", "medical equipment", "device"]
NEGATION_MARKERS = ["not ", "n't", "never", "no ", "without", "cannot", "does not", "rather than", "instead of", "isn't", "is not"]

SYSTEM_PROMPT = """You are a wellness-report interpretation assistant for beAIve, a consumer \
face-scan vitals estimator (PPG/rPPG-based, NOT a validated medical device). You are given ONLY \
the supplied indicator values, their desired/reference ranges, and whether each is flagged High/\
Low/Normal. These are wellness estimates, not laboratory or clinical measurements.

Absolute rules, no exceptions:
1. NEVER state or imply a diagnosis of any disease or condition (diabetes, hypertension, anemia, \
cardiovascular disease, etc.) — these values can only describe whether a measured estimate is \
inside or outside the app's own preset wellness range.
2. NEVER say "healthy", "normal" (as a conclusion about the person), "clinically clear", or give \
reassurance ("nothing to worry about") — describe only what the preset comparison shows.
3. Every indicator flagged High or Low relative to its desired range must be named explicitly, \
with a plain-language note that it exceeds/falls outside the app's preset wellness threshold —  \
never softened into "slightly elevated" or similar minimizing language, and never left out.
4. Values marked as still-under-research (A1c, fasting glucose, cholesterol, hemoglobin risk) \
must be described as experimental estimates, not as equivalent to a laboratory result.
5. Always close with a line stating this is a wellness estimate, not a diagnosis, and that any \
flagged value should be confirmed with validated clinical equipment or a licensed clinician.

Return ONLY a single JSON object with exactly these keys:
{
  "synthesis": "2-4 sentences summarizing the overall pattern across sections, hedged per rules above",
  "findings": [{"label": "short label, e.g. a section or indicator group", "text": "1-2 sentence factual, hedged description"}, ...],
  "next_steps": ["short actionable sentence", ... 3-5 items, e.g. confirm with a clinician/validated device, repeat under standardized conditions, do not adjust medication based on this alone],
  "limitations": "1-2 sentences on what a single face-scan wellness estimate cannot establish"
}
No markdown, no prose outside the JSON."""


def call_openrouter(model: str, data_view: dict, api_key: str) -> dict:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "Supplied vitals sections:\n" + json.dumps(data_view, indent=2)},
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
    return json.loads(payload["choices"][0]["message"]["content"])


REQUIRED_KEYS = {"synthesis", "findings", "next_steps", "limitations"}


def _sentences(text: str) -> list[str]:
    return re.split(r"(?<=[.!?])\s+", text)


def validate(llm: dict) -> list[str]:
    problems = []
    missing = REQUIRED_KEYS - llm.keys()
    if missing:
        problems.append(f"missing required keys: {sorted(missing)}")
    if not isinstance(llm.get("findings"), list) or not llm["findings"]:
        problems.append("'findings' must be a non-empty array")
    if not isinstance(llm.get("next_steps"), list) or not llm["next_steps"]:
        problems.append("'next_steps' must be a non-empty array")

    strings: list[str] = []
    for k, v in llm.items():
        if isinstance(v, str):
            strings.append(v)
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    strings.extend(str(x) for x in item.values() if isinstance(x, str))
                elif isinstance(item, str):
                    strings.append(item)
    all_sentences = [s for text in strings for s in _sentences(text)]

    for sentence in all_sentences:
        low = sentence.lower()
        for phrase in BANNED_PHRASES_ALWAYS:
            if phrase in low:
                problems.append(f"banned phrase found: {phrase!r} in: {sentence!r}")
        for word in BANNED_WORDS_UNLESS_NEGATED:
            if word in low and not any(neg in low for neg in NEGATION_MARKERS):
                problems.append(f"affirmative use of {word!r} without a negation in the same sentence: {sentence!r}")
        for word in BANNED_WORDS_UNLESS_SAFE_CONTEXT:
            if word in low and not any(ctx in low for ctx in SAFE_CONTEXT_MARKERS):
                problems.append(f"use of {word!r} without a clinician/lab/device context in the same sentence: {sentence!r}")
    return problems


def build_data_view(src: dict) -> dict:
    return {
        "sections": [
            {"title": s["title"], "rows": [
                {k: v for k, v in r.items()} for r in s["rows"]
            ]} for s in src["sections"]
        ]
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--input", default=str(SRC_JSON), help="vitals data JSON to interpret (default: vitals_data.json)")
    ap.add_argument("--output-stem", default=None, help="write <stem>.json and <stem>.pdf (default: the fixed names, which overwrite the previous run)")
    args = ap.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("OPENROUTER_API_KEY is not set. Refusing to proceed without an explicit key.", file=sys.stderr)
        sys.exit(1)

    src = json.loads(pathlib.Path(args.input).read_text(encoding="utf-8"))
    out_json = pathlib.Path(args.output_stem + ".json") if args.output_stem else OUT_JSON
    out_pdf = pathlib.Path(args.output_stem + ".pdf") if args.output_stem else OUT_PDF
    data_view = build_data_view(src)

    print(f"Calling OpenRouter model '{args.model}' with {sum(len(s['rows']) for s in data_view['sections'])} indicator rows...", file=sys.stderr)
    llm_out = call_openrouter(args.model, data_view, api_key)

    problems = validate(llm_out)
    if problems:
        print("REFUSING to write output — the model's response failed validation:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(2)

    out = copy.deepcopy(src)
    out["ai"] = {
        "synthesis": llm_out["synthesis"],
        "findings": llm_out["findings"],
        "next_steps": llm_out["next_steps"],
        "limitations": llm_out["limitations"],
        "model": args.model,
    }
    out_json.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"wrote {out_json}", file=sys.stderr)

    if args.render:
        from render_vitals_report import render
        render(str(out_json), str(out_pdf))
        print(f"wrote {out_pdf}", file=sys.stderr)


if __name__ == "__main__":
    main()
