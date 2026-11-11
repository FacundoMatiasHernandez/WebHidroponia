"""Build the shareable guide from the versioned Markdown; not needed to run the web."""
import argparse
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageBreak, PageTemplate,
    Paragraph, Preformatted, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
FOREST = colors.HexColor("#183e32")
MUTED = colors.HexColor("#65776b")
LINE = colors.HexColor("#dce5dc")
PALE = colors.HexColor("#f0f5eb")


def build(source, destination):
    fonts = ROOT / "app/styles/fonts"
    for name, filename in [("Manrope", "manrope-regular.ttf"), ("ManropeBold", "manrope-extrabold.ttf"),
                           ("Plex", "plex-mono.ttf")]:
        pdfmetrics.registerFont(TTFont(name, str(fonts / filename)))
    pdfmetrics.registerFontFamily("Manrope", normal="Manrope", bold="ManropeBold", italic="Manrope", boldItalic="ManropeBold")
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle("GuideBody", fontName="Manrope", fontSize=10.3, leading=15.5,
                             textColor=FOREST, spaceAfter=6, splitLongWords=True))
    styles.add(ParagraphStyle("GuideTitle", parent=styles["GuideBody"], fontName="ManropeBold",
                             fontSize=23, leading=29, spaceAfter=14))
    styles.add(ParagraphStyle("GuideH2", parent=styles["GuideBody"], fontName="ManropeBold",
                             fontSize=16, leading=21, spaceBefore=3, spaceAfter=12, keepWithNext=True))
    styles.add(ParagraphStyle("GuideH3", parent=styles["GuideBody"], fontName="ManropeBold",
                             fontSize=11, leading=16, spaceBefore=8, spaceAfter=6, keepWithNext=True))
    styles.add(ParagraphStyle("GuideBullet", parent=styles["GuideBody"], leftIndent=12,
                             firstLineIndent=0, bulletIndent=1, spaceAfter=4))
    styles.add(ParagraphStyle("GuideCell", parent=styles["GuideBody"], fontSize=9, leading=13.5, spaceAfter=0))
    styles.add(ParagraphStyle("GuideCellHead", parent=styles["GuideCell"], fontName="ManropeBold", textColor=colors.white))
    styles.add(ParagraphStyle("GuideCode", fontName="Plex", fontSize=8.4, leading=12,
                             textColor=FOREST, backColor=PALE, borderColor=LINE, borderWidth=.5,
                             borderPadding=10, spaceBefore=5, spaceAfter=12, alignment=TA_LEFT))
    width, height = A4
    margin = 17 * mm
    document = BaseDocTemplate(str(destination), pagesize=A4, leftMargin=margin, rightMargin=margin,
                              topMargin=20 * mm, bottomMargin=17 * mm,
                              title="HydroVision - Guia de instalacion y transferencia",
                              author="HydroVision", subject="Entrega a un companero - 11 de noviembre de 2026")

    def decorate(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(FOREST)
        canvas.rect(0, height - 9 * mm, width, 9 * mm, fill=1, stroke=0)
        canvas.setFont("ManropeBold", 8)
        canvas.drawString(margin, height - 15 * mm, "HYDROVISION")
        canvas.setFillColor(MUTED)
        canvas.setFont("Manrope", 7)
        canvas.drawRightString(width - margin, height - 15 * mm, "INSTALACION Y TRANSFERENCIA")
        canvas.setStrokeColor(LINE)
        canvas.line(margin, 12 * mm, width - margin, 12 * mm)
        canvas.setFont("Manrope", 7)
        canvas.drawString(margin, 8 * mm, "11 de noviembre de 2026 | Sin credenciales ni datos privados")
        canvas.drawRightString(width - margin, 8 * mm, "Pagina " + str(doc.page))
        canvas.restoreState()

    document.addPageTemplates(PageTemplate(id="guide", frames=[Frame(
        margin, document.bottomMargin, document.width, document.height,
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=decorate))

    def inline(value):
        value = html.escape(value)
        value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
        value = re.sub(r"`([^`]+)`", r'<font name="Plex" size="8">\1</font>', value)
        return value

    lines = source.read_text(encoding="utf-8").splitlines()
    story, paragraph = [], []

    def flush():
        if paragraph:
            story.append(Paragraph(inline(" ".join(paragraph)), styles["GuideBody"]))
            paragraph.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            flush()
        elif line == "<!-- pagebreak -->":
            flush()
            story.append(PageBreak())
        elif line.startswith("```"):
            flush()
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            longest = max((pdfmetrics.stringWidth(text, "Plex", 8.4) for text in code), default=0)
            if longest > document.width - 20:
                raise ValueError("Code line too wide for PDF; split it in the Markdown source")
            story.append(Preformatted("\n".join(code), styles["GuideCode"]))
        elif line.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [cell.strip() for cell in lines[i].strip("|").split("|")]
                if not all(re.fullmatch(r"[: -]+", cell) for cell in cells):
                    rows.append(cells)
                i += 1
            i -= 1
            columns = len(rows[0])
            ratios = [.29, .71] if columns == 2 else [1 / columns] * columns
            data = [[Paragraph(inline(cell), styles["GuideCellHead" if row == 0 else "GuideCell"])
                     for cell in cells] for row, cells in enumerate(rows)]
            table = Table(data, colWidths=[document.width * ratio for ratio in ratios], repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), FOREST),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PALE, colors.white]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), .4, LINE),
                ("LINEBELOW", (0, 0), (-1, 0), .5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]))
            story.extend([table, Spacer(1, 10)])
        elif line.startswith("#"):
            flush()
            level = len(line) - len(line.lstrip("#"))
            style = "GuideTitle" if level == 1 else "GuideH2" if level == 2 else "GuideH3"
            story.append(Paragraph(inline(line.lstrip("# ")), styles[style]))
        elif line.startswith("- "):
            flush()
            story.append(Paragraph(inline(line[2:]), styles["GuideBullet"], bulletText="-"))
        else:
            paragraph.append(line.strip())
        i += 1
    flush()
    destination.parent.mkdir(parents=True, exist_ok=True)
    document.build(story)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "app/docs/new-notebook-setup.md")
    parser.add_argument("--output", type=Path, default=ROOT / "output/pdf/HydroVision_Guia_Companero.pdf")
    args = parser.parse_args()
    build(args.source, args.output)
    print(args.output)
