from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Flowable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)


OUTPUT = "/Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1/output/pdf/priya_nexarch_3d_posture_landmark_analysis_report.pdf"
AVATAR = "/Users/reainmaker/Downloads/posture-analysis-claude-kind-galileo-qcm0y1/output/assets/priya_wireframe_3d_posture_avatar-4view-v3.png"

NAVY = colors.HexColor("#14213D")
BLUE = colors.HexColor("#275D8C")
PALE = colors.HexColor("#EAF1F7")
PALE2 = colors.HexColor("#F5F7FA")
TEXT = colors.HexColor("#17202A")
MUTED = colors.HexColor("#536273")
GREEN = colors.HexColor("#2E6B57")
AMBER = colors.HexColor("#9A6700")
RED = colors.HexColor("#9B2C2C")
RING_GREEN = colors.HexColor("#35A66F")
RING_RED = colors.HexColor("#E14B4B")
RING_BLUE = colors.HexColor("#49A7D8")
LINE = colors.HexColor("#CAD4DF")


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="ReportTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=20, leading=24, textColor=NAVY, alignment=TA_LEFT, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="Subtitle", parent=styles["Normal"], fontName="Helvetica",
    fontSize=9.4, leading=13, textColor=MUTED, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=13.5, leading=17, textColor=NAVY, spaceBefore=7, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=10.5, leading=13, textColor=BLUE, spaceBefore=5, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="Bodyx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8.65, leading=12.1, textColor=TEXT, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Smallx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.3, leading=9.6, textColor=MUTED, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9.1, leading=12.6, textColor=NAVY, spaceAfter=0,
))
styles.add(ParagraphStyle(
    name="Cell", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.5, leading=9.5, textColor=TEXT,
))
styles.add(ParagraphStyle(
    name="CellSmall", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=6.8, leading=8.4, textColor=TEXT,
))
styles.add(ParagraphStyle(
    name="CellHead", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.2, leading=8.5, textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="Footer", parent=styles["Normal"], fontName="Helvetica",
    fontSize=7, leading=8, textColor=MUTED, alignment=TA_CENTER,
))


def P(text, style="Bodyx"):
    return Paragraph(text, styles[style])


def bullet(text):
    return Paragraph("&#8226; " + text, ParagraphStyle(
        name="bullet-temp", parent=styles["Bodyx"], leftIndent=10,
        firstLineIndent=-7, spaceAfter=3,
    ))


def callout(title, body, color=BLUE):
    t = Table([[P(title, "Callout")], [P(body, "Bodyx")]], colWidths=[174 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("BOX", (0, 0), (-1, -1), 0.7, color),
        ("LINEBEFORE", (0, 0), (0, -1), 3, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 7),
    ]))
    return t


def data_table(rows, widths, header=True, small=False):
    cell_style = "CellSmall" if small else "Cell"
    cooked = []
    for ri, row in enumerate(rows):
        cooked.append([P(str(x), "CellHead" if header and ri == 0 else cell_style) for x in row])
    table = Table(cooked, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [("BACKGROUND", (0, 0), (-1, 0), NAVY)]
        for i in range(1, len(rows)):
            if i % 2 == 0:
                commands.append(("BACKGROUND", (0, i), (-1, i), PALE2))
    table.setStyle(TableStyle(commands))
    return table


class PostureVisualization(Flowable):
    """Generic 3D-style avatar with deterministic, non-diagnostic overlays."""

    def __init__(self, width=174 * mm, height=112 * mm):
        super().__init__()
        self.width = width
        self.height = height
        self.avatar = ImageReader(AVATAR)

    def draw(self):
        c = self.canv
        w, h = self.width, self.height
        c.saveState()
        c.setFillColor(colors.HexColor("#071B28"))
        c.setStrokeColor(colors.HexColor("#18BFD0"))
        c.roundRect(0, 0, w, h, 4 * mm, fill=1, stroke=1)

        # Avatar source contains matching front, back, left and right profile views.
        image_x, image_y = 7 * mm, 8 * mm
        image_w, image_h = 160 * mm, 96 * mm
        c.drawImage(self.avatar, image_x, image_y, width=image_w, height=image_h,
                    preserveAspectRatio=True, anchor="c", mask="auto")

        # Reference axes and joint lines are deterministic overlays, not model output.
        c.setDash(3, 2)
        c.setStrokeColor(colors.white)
        c.setLineWidth(0.7)
        c.line(156 * mm, 14 * mm, 156 * mm, 96 * mm)
        c.line(30 * mm, 75 * mm, 50 * mm, 75 * mm)
        c.line(34 * mm, 53 * mm, 46 * mm, 53 * mm)
        c.line(35 * mm, 34 * mm, 46 * mm, 34 * mm)
        c.setDash()

        # Red guides denote supplied differences selected for review, not pathology.
        c.setStrokeColor(RING_RED)
        c.setLineWidth(1.8)
        c.line(145 * mm, 88 * mm, 157 * mm, 91 * mm)
        c.line(31 * mm, 74 * mm, 49 * mm, 76 * mm)
        c.line(35 * mm, 52 * mm, 46 * mm, 54 * mm)
        c.line(149 * mm, 19 * mm, 153 * mm, 73 * mm)

        def ring(x, y, color, label=None, radius=2.0):
            c.setStrokeColor(color)
            c.setFillColor(colors.HexColor("#071B28"))
            c.setLineWidth(1.5)
            c.circle(x * mm, y * mm, radius * mm, fill=1, stroke=1)
            c.setFillColor(colors.white)
            c.circle(x * mm, y * mm, 0.55 * mm, fill=1, stroke=0)
            if label:
                c.setFillColor(color)
                c.setFont("Helvetica-Bold", 5.5)
                c.drawString((x + 2.6) * mm, (y + 1.2) * mm, label)

        # Red review points: head, shoulders, pelvis and trunk.
        ring(145, 89, RING_RED, "R1")
        ring(31, 75, RING_RED, "R2")
        ring(49, 75, RING_RED)
        ring(35, 53, RING_RED, "R3")
        ring(46, 53, RING_RED)
        ring(150, 62, RING_RED, "R4")

        # Green points: supplied knee comparator and captured thermal symmetry regions.
        ring(35, 34, RING_GREEN, "G1")
        ring(46, 34, RING_GREEN)
        ring(72, 74, RING_GREEN, "G2")
        ring(84, 74, RING_GREEN)
        ring(74, 57, RING_GREEN, "G3")
        ring(82, 57, RING_GREEN)

        # Blue/white reference landmark chain for positional orientation.
        for x, y in [(40, 90), (40, 64), (36, 15), (44, 15),
                     (122, 88), (119, 72), (122, 52), (119, 31), (122, 14),
                     (145, 14)]:
            ring(x, y, RING_BLUE, radius=1.3)

        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawCentredString(27 * mm, h - 7 * mm, "FRONT")
        c.drawCentredString(72 * mm, h - 7 * mm, "BACK")
        c.drawCentredString(119 * mm, h - 7 * mm, "LEFT PROFILE")
        c.drawCentredString(153 * mm, h - 7 * mm, "RIGHT PROFILE")
        # Compact status legend: base palette is white, black and blue.
        c.setFont("Helvetica-Bold", 5.6)
        legend = [
            (RING_RED, "RED: review point"),
            (RING_GREEN, "GREEN: supplied comparator/symmetry"),
            (RING_BLUE, "BLUE/WHITE: reference landmark"),
        ]
        lx = 7 * mm
        for color, text_value in legend:
            c.setStrokeColor(color)
            c.setFillColor(colors.HexColor("#071B28"))
            c.circle(lx, 4.2 * mm, 1.25 * mm, fill=1, stroke=1)
            c.setFillColor(colors.white)
            c.drawString(lx + 2.3 * mm, 3.25 * mm, text_value)
            lx += (42 if color != RING_BLUE else 0) * mm
        c.restoreState()


def page_header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, height - 15 * mm, width - 18 * mm, height - 15 * mm)
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.drawString(18 * mm, height - 11.5 * mm, "POWERED BY NEXARCH")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(width - 18 * mm, height - 11.5 * mm, "Clinical posture intelligence | Technical review")
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(18 * mm, 9.5 * mm, "Patient: Priya | Source record: Priyw | Scan: 19 Nov 2026 | Technical interpretation only")
    canvas.drawRightString(width - 18 * mm, 9.5 * mm, f"Page {doc.page} of 4")
    canvas.restoreState()


doc = BaseDocTemplate(
    OUTPUT,
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=20 * mm,
    bottomMargin=18 * mm,
    title="NexArch 3D Posture Landmark Analysis Report - Priya",
    author="NexArch clinical posture intelligence - generated from supplied measurement records",
    subject="Posture landmark geometry and bilateral thermal symmetry",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
doc.addPageTemplates([PageTemplate(id="clinical", frames=[frame], onPage=page_header_footer)])

story = []

# PAGE 1 - 3D BASELINE VISUALIZATION
story += [
    Spacer(1, 2 * mm),
    P("NexArch 3D Posture Landmark Analysis", "ReportTitle"),
    P("Measured baseline | Priya | Source record: Priyw | Four-view landmark visualization", "Subtitle"),
]

visual_meta = data_table([
    ["Acquisition", "Session", "Visualization status", "Clinical status"],
    ["19 Nov 2026, 22:19", "9339f15b", "Illustrative mapping", "Technical review - not a diagnosis"],
], [44 * mm, 34 * mm, 47 * mm, 49 * mm])

story += [
    visual_meta,
    Spacer(1, 2.5 * mm),
    PostureVisualization(),
    Spacer(1, 2.5 * mm),
]

visual_rows = [
    ["Code", "Mapped region", "Recorded value", "Point note"],
    ["R1", "Head / ear", "80.7 deg vs 90 deg", "System difference selected for review; not a universal cutoff."],
    ["R2", "Shoulders", "87.4 deg vs 90 deg", "Direction and side were not supplied."],
    ["R3", "Pelvis", "87.0 deg vs 90 deg", "Anatomical plane was not supplied."],
    ["R4", "Trunk", "85.5 deg vs 90 deg", "Qualitatively consistent with small inclination; definitions differ."],
    ["G1", "Left / right knees", "1.9 / 2.2 deg", "Within the supplied 0-5 deg comparison band only."],
    ["G2-G3", "Trapezius / lumbar", "+0.0 / +0.0 C Delta T", "Bilateral thermal symmetry at capture; not a health clearance."],
    ["Blue", "Reference chain", "Landmark locations", "Orientation points only; no diagnostic classification."],
]
story += [
    data_table(visual_rows, [16 * mm, 43 * mm, 39 * mm, 76 * mm], small=True),
    Spacer(1, 1.8 * mm),
    callout(
        "Colour and visualization boundary",
        "White, black and blue form the NexArch report palette. Red means review the supplied measurement; it does not mean disease. Green means within a supplied comparator or bilateral symmetry at capture; it does not mean clinically normal. The avatar is generic, and no sole effect or corrected 'after' state is shown.",
        BLUE,
    ),
    PageBreak(),
]

# PAGE 2
story += [
    Spacer(1, 3 * mm),
    P("Clinical Technical Posture and Thermal Symmetry Report", "ReportTitle"),
    P("Three-page interpretive report | Non-SOAP format | Prepared from the supplied PosturePulse assessment and supplemental metric summaries", "Subtitle"),
]

meta = data_table([
    ["Patient", "Acquisition", "Session", "Data reviewed"],
    ["Priyw", "19 Nov 2026, 22:19", "9339f15b", "21/21 video-derived posture metrics; supplemental posture and bilateral thermal summaries"],
], [29 * mm, 42 * mm, 32 * mm, 71 * mm])
story += [meta, Spacer(1, 3 * mm)]

story += [
    callout(
        "Clinical synthesis",
        "The supplied measurements show small static alignment differences, most evident in sagittal trunk inclination and side-specific landmark offsets. Several frontal-plane findings overlap their stated reference once measurement uncertainty is considered. The bilateral trapezius and lumbar thermal differences are 0.0 C in the supplemental summary, indicating no measured side-to-side thermal asymmetry at that capture. These data do not establish a structural disorder, pain generator, neurologic deficit, vascular abnormality, or diagnosis.",
        BLUE,
    ),
    P("Key findings", "H1x"),
    bullet("<b>Trunk position:</b> left and right trunk inclination were -2.9 +/- 2.4 degrees and -4.0 +/- 2.3 degrees relative to the source system's 0-degree reference. Their uncertainty intervals remain below 0 degrees, supporting a small measured inclination during this recording."),
    bullet("<b>Lateral translation:</b> lateral body shift was -1.2 +/- 1.0% of stature. This is small in magnitude, but its stated interval does not cross the 0% reference."),
    bullet("<b>Frontal alignment:</b> head tilt, shoulder-line tilt, hip-line tilt and trunk lateral lean each overlapped the source reference after uncertainty was applied; no definite frontal-plane deviation can be inferred from those individual measures."),
    bullet("<b>Side-specific offsets:</b> left ear, shoulder and hip offsets were greater than corresponding right-side values. These are geometric observations without source reference ranges and require correlation with stance, camera position and examination."),
    bullet("<b>Knees:</b> knee extension overlapped 0 degrees bilaterally. Knee frontal alignment was explicitly labeled a proxy, carried wide uncertainty, and had no source reference value."),
    bullet("<b>Thermal summary:</b> trapezius Delta T and lumbar Delta T were both +0.0 C against the supplied <0.5 C comparison criterion. This supports bilateral surface-temperature symmetry only under the conditions of that capture."),
]

story += [
    P("Data integrity and reconciliation", "H1x"),
    P("The primary PDF reports raw landmark geometry and uncertainty. The supplemental posture table reports transformed values against a 90-degree 'ideal' (forward head 80.7 degrees, shoulder elevation 87.4 degrees, pelvic tilt 87.0 degrees, trunk lean 85.5 degrees, and knee values 1.9/2.2 degrees). The definitions, processing version and uncertainty for those transformed metrics are not provided. They should therefore be treated as a separate summary layer, not substituted for or averaged with the primary PDF values."),
    callout(
        "Important qualification",
        "The labels 'textbook perfect', 'optimal neurovascular symmetry' and 'excellent' exceed what these measurements can establish. A 0.0 C side-to-side difference does not prove normal neurovascular function, and a single static posture value does not determine pathology or clinical risk.",
        AMBER,
    ),
    PageBreak(),
]

# PAGE 3
story += [
    P("Quantitative Measurement Review", "ReportTitle"),
    P("Primary source values are shown with the uncertainty supplied by the acquisition system. Interpretation is limited to the measurement model used in the report.", "Subtitle"),
    P("A. Frontal-plane and translation measures", "H1x"),
]

rows_a = [
    ["Measure", "Recorded value", "Source reference", "Technical interpretation"],
    ["Head lateral tilt", "-0.7 +/- 8.9 deg", "0 deg", "Uncertainty overlaps reference; no definite tilt."],
    ["Shoulder-line tilt (proxy)", "-0.6 +/- 3.5 deg", "0 deg", "Uncertainty overlaps reference; landmark geometry only."],
    ["Hip-line tilt (proxy)", "-0.6 +/- 7.0 deg", "0 deg", "Uncertainty overlaps reference; landmark geometry only."],
    ["Trunk lateral lean", "-0.8 +/- 1.8 deg", "0 deg", "Uncertainty overlaps reference."],
    ["Lateral body shift", "-1.2 +/- 1.0% stature", "0% stature", "Small negative translation; stated interval -2.2 to -0.2%."],
    ["Knee frontal alignment L/R (proxy)", "+4.9 +/- 4.8 / +1.3 +/- 4.9 deg", "No reference set", "Wide uncertainty; asymmetry cannot be classified diagnostically."],
]
story += [data_table(rows_a, [39 * mm, 39 * mm, 28 * mm, 68 * mm]), Spacer(1, 2 * mm)]

story += [P("B. Sagittal and side-specific measures", "H1x")]
rows_b = [
    ["Measure", "Left", "Right", "Technical interpretation"],
    ["Ear offset from ankle", "+5.0 +/- 1.5% stature", "+2.6 +/- 1.5% stature", "Left-right difference 2.4% stature; no source reference."],
    ["Shoulder offset from ankle", "+2.6 +/- 1.5% stature", "-1.7 +/- 1.5% stature", "Opposite signs; verify stance and camera calibration before clinical attribution."],
    ["Hip offset from ankle", "+4.2 +/- 1.5% stature", "+0.7 +/- 1.5% stature", "Left-right difference 3.5% stature; no source reference."],
    ["Knee offset from ankle", "+1.8 +/- 1.5% stature", "+0.1 +/- 1.6% stature", "Small side difference; no source reference."],
    ["Head-shoulder angle (proxy)", "+80.1 +/- 5.5 deg", "+73.6 +/- 5.5 deg", "6.5-degree side difference, smaller than combined uncertainty; proxy only."],
    ["Trunk inclination", "-2.9 +/- 2.4 deg", "-4.0 +/- 2.3 deg", "Both stated intervals remain below the 0-degree reference."],
    ["Knee extension", "+0.8 +/- 5.1 deg", "+1.4 +/- 5.1 deg", "Both uncertainty intervals overlap 0 degrees."],
]
story += [data_table(rows_b, [40 * mm, 36 * mm, 36 * mm, 62 * mm], small=True), Spacer(1, 2 * mm)]

story += [
    P("C. Supplemental transformed posture and thermal summary", "H1x"),
]
rows_c = [
    ["Metric", "Supplied value", "Supplied comparator", "Bounded interpretation"],
    ["Forward-head metric", "80.7 deg", "90 deg", "9.3-degree difference within that system; not a universal diagnostic cutoff."],
    ["Shoulder-elevation metric", "87.4 deg", "90 deg", "2.6-degree difference; direction and side are not specified."],
    ["Pelvic-tilt metric", "87.0 deg", "90 deg", "3.0-degree difference; plane and anatomical definition are not specified."],
    ["Knee valgus L/R", "1.9 / 2.2 deg", "0-5 deg", "Within supplied band; does not match the primary proxy values and should not be merged."],
    ["Trunk-lean metric", "85.5 deg", "90 deg", "4.5-degree difference; qualitatively consistent with small inclination, but definitions differ."],
    ["Trapezius / lumbar Delta T", "+0.0 / +0.0 C", "<0.5 C", "No bilateral thermal asymmetry detected at capture; no inference on tissue diagnosis."],
]
story += [data_table(rows_c, [38 * mm, 34 * mm, 34 * mm, 68 * mm], small=True)]

story += [
    P("Measurement uncertainty", "H2x"),
    P("An uncertainty-overlap result means the measured interval includes the reference and should not be called definitively abnormal. For side-to-side differences, the source does not provide covariance or a validated minimum detectable change; arithmetic differences are descriptive only."),
    PageBreak(),
]

# PAGE 4
story += [
    P("Clinical Implications and Management Framework", "ReportTitle"),
    P("This section translates the measured pattern into a safe clinical workflow. It is not a diagnosis or treatment prescription.", "Subtitle"),
    P("Clinical significance", "H1x"),
    P("The pattern is best characterized as <b>minor static postural asymmetry with small sagittal trunk inclination</b>. Relevant frontal-plane uncertainty intervals overlap the source reference. Side-specific offsets may reflect stance, camera perspective, landmark localization, natural asymmetry or a reproducible strategy; significance depends on symptoms and repeatability. Equal bilateral trapezius and lumbar surface temperatures are neutral rather than diagnostic: they neither exclude inflammation nor establish normal perfusion, nerve function or tissue health."),
    P("Recommended clinical follow-up", "H1x"),
]

follow_rows = [
    ["Priority", "Action", "Purpose / decision rule"],
    ["1", "Correlate with symptoms and function", "Record pain, aggravating tasks, neurologic symptoms, work exposure, tolerance and prior injury."],
    ["2", "Perform focused physical examination", "Assess relaxed stance/gait, regional motion, landmarks, strength, sensation, reflexes and relevant provocation."],
    ["3", "Repeat under standardized conditions", "Match camera setup, stance, clothing, lighting and software; obtain at least two trials."],
    ["4", "Conservative movement plan", "If symptomatic, use position changes, ergonomic adjustment and graded mobility/strength work."],
    ["5", "Escalate when clinically indicated", "Prompt assessment for progressive deficit, gait change, bowel/bladder or saddle symptoms, severe night pain, fever, trauma or systemic illness."],
]
story += [data_table(follow_rows, [16 * mm, 58 * mm, 100 * mm], small=True)]

story += [
    P("Suggested reassessment outcomes", "H2x"),
    P("Prioritize symptoms and task tolerance. Secondary outcomes are repeatable changes in trunk inclination and lateral shift beyond expected variability, supported by functional tests and standardized side-offset or thermal measurements."),
    P("Technical limitations", "H1x"),
    bullet("Single static video-derived observation; no direct assessment of bone, joint pathology, muscle activation or dynamic control. Several values are unreferenced proxies, not disease thresholds."),
    bullet("The source is marked draft and not clinically validated. Age, history, symptoms, examination and validated patient-reported outcomes were not provided."),
    bullet("The supplemental posture convention lacks uncertainty and algorithm provenance; thermal data lack absolute temperatures and acquisition protocol."),
    P("Evidence note", "H1x"),
    P("Photogrammetry can provide repeatable quantitative posture measurements when acquisition and landmarks are standardized, but validity varies by method and metric. Thermal measurement reliability likewise depends on equipment and protocol; symmetry alone is not a diagnosis."),
]

refs = data_table([
    ["Reference", "Relevance"],
    ["Gadotti IC, Biasotto-Gonzalez DA. J Eval Clin Pract. 2010. PMID 20367826. https://pubmed.ncbi.nlm.nih.gov/20367826/", "Photogrammetry can detect less evident sagittal head-posture differences better than visual classification."],
    ["Mylonas K et al. J Phys Ther Sci. 2025. PMID 40171184. https://pubmed.ncbi.nlm.nih.gov/40171184/", "Reliability of standardized photogrammetric measures; does not validate every proprietary metric."],
    ["Calvo-Lobo C et al. Sensors. 2023. PMID 36919164. https://pubmed.ncbi.nlm.nih.gov/36919164/", "Infrared skin-temperature reliability and minimum detectable change depend on protocol and device."],
], [112 * mm, 62 * mm], small=True)
story += [refs, Spacer(1, 2 * mm)]

story += [
    callout(
        "Conclusion",
        "The available evidence supports documenting a small, non-acute static alignment pattern and bilateral thermal symmetry at one time point. It does not support a diagnosis, a claim of neurovascular normality, or a universal posture correction target. Clinical decisions should be driven by symptoms, examination, function and standardized repeat measurement.",
        GREEN,
    ),
]

doc.build(story)
print(OUTPUT)
