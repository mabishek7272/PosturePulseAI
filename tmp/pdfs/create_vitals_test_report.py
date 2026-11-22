from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether,
)
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pathlib import Path


OUT = Path("output/pdf/vitals_clinical_test_report.pdf")
OUT.parent.mkdir(parents=True, exist_ok=True)

INK = HexColor("#172033")
MUTED = HexColor("#5E6A7D")
PURPLE = HexColor("#7652E8")
PURPLE_LIGHT = HexColor("#EEE9FF")
TEAL = HexColor("#168C8C")
TEAL_LIGHT = HexColor("#E6F6F4")
AMBER = HexColor("#A45B00")
AMBER_LIGHT = HexColor("#FFF3D6")
RED = HexColor("#A92727")
RED_LIGHT = HexColor("#FDEAEA")
LINE = HexColor("#DDE2EA")
PALE = HexColor("#F7F8FA")


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleCustom", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=23, leading=27, textColor=INK, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Subtitle", parent=styles["Normal"], fontName="Helvetica",
    fontSize=10, leading=14, textColor=MUTED, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="H1Custom", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=15, leading=19, textColor=INK, spaceBefore=7, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="H2Custom", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11, leading=14, textColor=PURPLE, spaceBefore=7, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="BodyCustom", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.2, leading=13.2, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Small", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.6, leading=10.5, textColor=MUTED, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="Box", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9, leading=13, textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.8, leading=9.5, textColor=colors.white, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="TableCell", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.7, leading=10, textColor=INK,
))
styles.add(ParagraphStyle(
    name="TableCellBold", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.7, leading=10, textColor=INK,
))
styles.add(ParagraphStyle(
    name="Footer", parent=styles["Normal"], fontName="Helvetica",
    fontSize=7.2, leading=9, textColor=MUTED, alignment=TA_CENTER,
))


def P(text, style="BodyCustom"):
    return Paragraph(text, styles[style])


def info_box(title, body, fill=PURPLE_LIGHT, border=PURPLE):
    content = [[P(title, "TableCellBold")], [P(body, "Box")]]
    t = Table(content, colWidths=[170 * mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.7, border),
        ("LINEBELOW", (0, 0), (-1, 0), 0.4, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def bullet(text):
    return P(f"- {text}", "BodyCustom")


def section_title(text):
    return P(text, "H1Custom")


def draw_header_footer(canv: canvas.Canvas, doc):
    canv.saveState()
    w, h = A4
    canv.setStrokeColor(LINE)
    canv.setLineWidth(0.5)
    canv.line(20 * mm, h - 16 * mm, w - 20 * mm, h - 16 * mm)
    canv.setFont("Helvetica-Bold", 8)
    canv.setFillColor(PURPLE)
    canv.drawString(20 * mm, h - 12 * mm, "ANUClaw - Clinical Documentation Test")
    canv.setFont("Helvetica", 7.5)
    canv.setFillColor(MUTED)
    page_text = f"Page {doc.page}"
    canv.drawRightString(w - 20 * mm, 11 * mm, page_text)
    canv.drawString(20 * mm, 11 * mm, "Non-diagnostic draft - clinician verification required")
    canv.restoreState()


doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    rightMargin=20 * mm, leftMargin=20 * mm,
    topMargin=22 * mm, bottomMargin=18 * mm,
    title="Vitals Clinical Test Report",
    author="ANUClaw test workflow",
    subject="Local non-diagnostic analysis of two supplied wellness reports",
)

story = []

story += [
    P("Vitals Clinical Test Report", "TitleCustom"),
    P("Comparison, SOAP-style draft, and patient-friendly explanation", "Subtitle"),
    info_box(
        "TEST RESULT: DOCUMENT PROCESSING SUCCESSFUL",
        "Both PDFs were readable and visually inspected. The workflow extracted the measurement tables, identified two distinct scans, compared them, and generated this structured draft locally. No health measurements from the PDFs were transmitted to OpenRouter during this test.",
        TEAL_LIGHT, TEAL,
    ),
    Spacer(1, 8),
    section_title("Executive summary"),
    P(
        "The reports contain two face-scan measurement sets recorded about two minutes apart on 17 October 2026. Several values differ too much to represent plausible biological change over that interval, especially estimated HbA1c and hemoglobin. The safest interpretation is <b>measurement or algorithm variability</b>, not a rapid change in health.",
    ),
    info_box(
        "KEY SAFETY CONCLUSION",
        "Do not use either scan alone to diagnose hypertension, diabetes, anemia, low oxygen, or another condition. Confirm blood pressure, pulse, breathing rate, oxygen saturation, HbA1c/glucose, and hemoglobin with validated clinical equipment or laboratory testing.",
        AMBER_LIGHT, AMBER,
    ),
    Spacer(1, 8),
    P("Measurement comparison", "H2Custom"),
]

rows = [
    [P("Measure", "TableHead"), P("Scan A - 05:51 UTC", "TableHead"), P("Scan B - 05:53 UTC", "TableHead"), P("Clinical reading", "TableHead")],
    [P("Blood pressure", "TableCellBold"), P("124/84 mmHg", "TableCell"), P("150/94 mmHg", "TableCell"), P("AHA Stage 1 by diastolic vs Stage 2, if confirmed", "TableCell")],
    [P("Heart rate", "TableCellBold"), P("113 bpm", "TableCell"), P("105 bpm", "TableCell"), P("Both above the usual adult resting range", "TableCell")],
    [P("Breathing rate", "TableCellBold"), P("20/min", "TableCell"), P("29/min", "TableCell"), P("Upper end vs clearly above resting reference", "TableCell")],
    [P("Oxygen saturation", "TableCellBold"), P("95%", "TableCell"), P("97%", "TableCell"), P("Single wellness estimates; trend and symptoms matter", "TableCell")],
    [P("Estimated HbA1c", "TableCellBold"), P("5.75%", "TableCell"), P("6.53%", "TableCell"), P("Straddles standard prediabetes/diabetes cutoffs; must be lab-confirmed", "TableCell")],
    [P("Estimated hemoglobin", "TableCellBold"), P("11.6 g/dL", "TableCell"), P("14 g/dL", "TableCell"), P("Large two-minute difference supports poor reproducibility", "TableCell")],
    [P("ASCVD estimate", "TableCellBold"), P("1%", "TableCell"), P("1%", "TableCell"), P("Consistent, but depends on valid inputs and model applicability", "TableCell")],
    [P("Heart age / wellness", "TableCellBold"), P("20 years / 6", "TableCell"), P("23 years / 5", "TableCell"), P("Proprietary wellness outputs, not diagnoses", "TableCell")],
]

t = Table(rows, colWidths=[34 * mm, 34 * mm, 34 * mm, 68 * mm], repeatRows=1, hAlign="LEFT")
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), PURPLE),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
    ("GRID", (0, 0), (-1, -1), 0.35, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story += [t, Spacer(1, 7), P("Scan A is the standalone formatted report. Scan B is the later result shown in the email-print PDF. The email-print PDF also includes the earlier lower-risk table as part of the message thread/attachment content.", "Small")]

story += [PageBreak(), section_title("SOAP-style clinical documentation draft")]

soap_data = [
    ("S - Subjective", "No symptoms, medical history, medications, activity before scanning, fasting status, age, biological sex, pregnancy status, or device-validation information were provided. Subjective assessment is therefore unavailable."),
    ("O - Objective", "Two 60-second face scans approximately two minutes apart produced discordant values. Scan A: BP 124/84, pulse 113, respirations 20, SpO2 95%, estimated HbA1c 5.75%, estimated hemoglobin 11.6 g/dL. Scan B: BP 150/94, pulse 105, respirations 29, SpO2 97%, estimated HbA1c 6.53%, estimated hemoglobin 14 g/dL. Both reports state that outputs are for wellness only, remain under research, and are not for diagnosis."),
    ("A - Assessment", "1) Major short-interval discordance makes the face-scan outputs unsuitable for diagnostic conclusions. 2) Both pulse estimates are above the usual resting adult reference range if the person was truly at rest. 3) The two blood-pressure readings map to different AHA categories and require standardized cuff confirmation. 4) The later breathing-rate estimate is above the usual resting adult range. 5) Camera-derived HbA1c and hemoglobin estimates conflict and require laboratory confirmation. 6) SpO2 estimates should be interpreted with device limitations, symptoms, and repeat measurements."),
    ("P - Plan", "Repeat vital signs under standardized resting conditions using validated equipment. Arrange clinician review if high pulse, rapid breathing, or high blood pressure persists. Obtain a laboratory HbA1c or fasting plasma glucose and a complete blood count if clinically appropriate. Bring both reports to the clinician and note the two-minute disagreement. Do not change medication or treatment based on these wellness scans."),
]

for title, body in soap_data:
    story += [
        KeepTogether([
            P(title, "H2Custom"),
            info_box(title.split(" - ")[0], body, PALE, LINE),
            Spacer(1, 5),
        ])
    ]

story += [
    section_title("Clinical interpretation notes"),
    bullet("Blood pressure 124/84 is not fully normal under current AHA categories because the diastolic value is in the 80-89 range. The 150/94 result is in the Stage 2 range if confirmed with proper measurements."),
    bullet("Heart rates of 105 and 113 bpm exceed the usual adult resting reference of 60-100 bpm. Exercise, anxiety, fever, dehydration, stimulants, and measurement error can affect pulse."),
    bullet("A resting breathing rate of 29/min is above the usual adult range. Context is essential: recent movement, talking, anxiety, fever, lung disease, and scan error can change the result."),
    bullet("Standard laboratory HbA1c cutoffs are below 5.7% normal, 5.7-6.4% prediabetes, and 6.5% or above diabetes. These camera estimates are not equivalent to a validated blood test."),
    bullet("The hemoglobin estimates differ by 2.4 g/dL within two minutes. This cannot be treated as a true biological trend; a complete blood count is the appropriate confirmation test."),
]

story += [PageBreak(), section_title("Plain-language explanation")]
story += [
    P("What the reports are saying", "H2Custom"),
    P("The scans attempted to estimate heart, breathing, oxygen, blood-sugar, blood-count, stress, and cardiovascular-risk measures from a one-minute face scan. One scan looked lower risk overall, while the other showed much higher blood pressure, faster breathing, and a higher estimated HbA1c."),
    P("What matters most", "H2Custom"),
    P("Your body cannot realistically change its three-month average blood sugar or hemoglobin concentration this much in two minutes. That difference strongly suggests the estimates are unstable. The reports themselves say the technology is still under research and is not intended for diagnosis."),
    P("What to confirm", "H2Custom"),
    bullet("Blood pressure: repeat with a validated upper-arm cuff while seated and rested."),
    bullet("Pulse and breathing: recheck after at least 10 minutes of quiet rest."),
    bullet("Oxygen: if needed, recheck with a reliable pulse oximeter and consider symptoms, not only one number."),
    bullet("Blood sugar: ask for a laboratory HbA1c and/or fasting plasma glucose."),
    bullet("Hemoglobin: ask for a complete blood count if a clinician considers it appropriate."),
    Spacer(1, 6),
    info_box(
        "WHEN TO SEEK URGENT HELP",
        "Seek urgent medical assessment if rapid breathing or a fast pulse is currently present at rest, especially with chest pain, shortness of breath, fainting, confusion, blue lips, severe weakness, or new neurologic symptoms. A blood pressure above 180/120 mmHg with concerning symptoms is an emergency. Local emergency numbers should be used for severe or rapidly worsening symptoms.",
        RED_LIGHT, RED,
    ),
    Spacer(1, 9),
    P("Questions to take to a clinician", "H2Custom"),
    bullet("Could you repeat my blood pressure, pulse, breathing rate, and oxygen saturation with clinical equipment?"),
    bullet("Should I have a laboratory HbA1c or fasting glucose test?"),
    bullet("Is a complete blood count appropriate to check hemoglobin?"),
    bullet("Could medicines, caffeine, recent exercise, anxiety, illness, or dehydration explain the pulse or breathing results?"),
    bullet("How should I monitor these measurements at home, and what thresholds should prompt follow-up?"),
]

story += [PageBreak(), section_title("Data quality and test validation")]
story += [
    P("Workflow checks completed", "H2Custom"),
    bullet("Both PDFs opened successfully and were not encrypted."),
    bullet("All seven pages across the two files were rendered and visually inspected."),
    bullet("The standalone two-page PDF is cleaner and internally consistent in layout."),
    bullet("The five-page email-print PDF contains message-thread content and two different measurement sets, which could confuse automated extraction unless scan sections are separated."),
    bullet("Document text was treated as report data only; no embedded text was followed as an instruction."),
    bullet("The resulting report separates source facts, clinical interpretation, uncertainty, and follow-up."),
    Spacer(1, 7),
    P("Recommended application behavior", "H2Custom"),
    bullet("Detect and split multiple scan events before summarization."),
    bullet("Show measurement time and acquisition method beside every value."),
    bullet("Run a consistency check and visibly flag implausible short-interval changes."),
    bullet("Never convert wellness-camera HbA1c or hemoglobin estimates into a diagnosis."),
    bullet("Require clinician confirmation for the Assessment and Plan sections of SOAP output."),
    bullet("De-identify documents before sending them to any external model unless the user explicitly approves the destination and appropriate privacy agreements are in place."),
    Spacer(1, 8),
    P("Reference standards used for this interpretation", "H2Custom"),
    P("American Heart Association - Understanding Blood Pressure Readings: https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings", "Small"),
    P("CDC - A1C Test for Diabetes and Prediabetes: https://www.cdc.gov/diabetes/diabetes-testing/prediabetes-a1c-test.html", "Small"),
    P("MedlinePlus - Vital Signs: https://medlineplus.gov/ency/article/002341.htm", "Small"),
    P("FDA - Pulse Oximeter Basics: https://www.fda.gov/consumers/consumer-updates/pulse-oximeter-basics", "Small"),
    Spacer(1, 8),
    info_box(
        "LIMITATIONS",
        "This is an AI-assisted documentation test, not a diagnosis, medical clearance, or substitute for an examination. It is based only on the supplied wellness reports. No independent measurement, laboratory result, medical record, or symptom history was available. A licensed clinician must verify any clinical use.",
        PURPLE_LIGHT, PURPLE,
    ),
]

doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
print(OUT.resolve())
