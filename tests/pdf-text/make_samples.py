"""Write the small public sample PDFs for the PDF text comparison check.

Standard library only. Each PDF is written by hand, so its content is known
and can be public. Run it again only when a sample must change:

    python3 tests/pdf-text/make_samples.py
"""
import os
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "samples")

# A ToUnicode map for the font F2: the printable ASCII codes map to themselves,
# and code 0x80 maps to a private-use character. This is the shape of a
# ligature glyph that has no real Unicode value in a PDF.
TOUNICODE = b"""/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Sample-UCS def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
1 beginbfrange
<20> <7E> <0020>
endbfrange
1 beginbfchar
<80> <E000>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
"""


def esc(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def line(font, size, x, y, text):
    """One text line. Text is latin-1; the byte 0x80 is the ligature glyph."""
    return b"BT /%s %d Tf %.1f %.1f Td (" % (font.encode(), size, x, y) + \
        esc(text).encode("latin-1") + b") Tj ET\n"


def write_pdf(name, pages, rotate=0):
    """pages: a list of content streams (bytes). Writes samples/<name>.
    rotate: the /Rotate of every page (0 writes no /Rotate)."""
    objects = []

    def add(body):
        objects.append(body)
        return len(objects)

    tounicode = add(b"<< /Length %d >>\nstream\n" % len(TOUNICODE) + TOUNICODE + b"endstream")
    f1 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    f2 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding "
             b"/ToUnicode %d 0 R >>" % tounicode)
    f3 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    pages_id = len(objects) + 1 + 2 * len(pages)
    kids = []
    for content in pages:
        c = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream")
        kids.append(add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Contents %d 0 R "
            b"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R /F3 %d 0 R >> >>%s >>"
            % (pages_id, c, f1, f2, f3, b" /Rotate %d" % rotate if rotate else b"")))
    assert add(b"<< /Type /Pages /Kids [%s] /Count %d >>"
               % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))) == pages_id
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1, catalog, xref)
    with open(os.path.join(OUT, name), "wb") as fh:
        fh.write(bytes(out))


def column(lines, x, top=700, lead=13, font="F1", size=10):
    return b"".join(line(font, size, x, top - i * lead, t) for i, t in enumerate(lines))


LEFT = (
    "The left column starts the story. A reader who listens to a page wants "
    "the voice to finish one column before it starts the next one. When the "
    "voice jumps from the left column to the right column on every line, the "
    "sentences break into pieces and nobody can follow them. This column has "
    "enough lines to look like the body of a real page in a journal, so the "
    "reader can learn the size of the body type from it. The last sentence of "
    "the left column goes on at the top of the right column, and the reader "
    "must join the two halves into one"
)
RIGHT = (
    "sentence without a break. The right column then gives its own ideas. It "
    "talks about the gap between the columns, which is wide and empty from "
    "the top of the page to the bottom. A good reader finds this gap and "
    "reads each column from top to bottom. A weak reader reads straight "
    "across the page and mixes the two columns. This sample exists so that "
    "a change in the column rules shows at once in the comparison check."
)


def two_columns():
    title = line("F3", 16, 72, 740, "Two Columns on One Page")
    body = column(textwrap.wrap(LEFT, 46), 72) + column(textwrap.wrap(RIGHT, 46), 324)
    return [title + body]


def number_start():
    lines = [
        "The first trial of the method began in the spring, and it ran from",
        "1996 to 2004 in three clinics. Each clinic measured the same teeth",
        "with a gauge that reads to 0.5 mm, and the mean depth was",
        "2.5 mm at the start of the trial. The team counted",
        "120 patients in the first year and 340 patients in the last year.",
        "Class II cavities were the most common finding, and Class IV",
        "cavities were rare. The report has two short lists of findings.",
        "",
        "1. The depth did not change in the first two years.",
        "2. The depth became less after the change of method.",
        "",
        "The text after the list goes on as a normal paragraph. It has no",
        "numbers at the start of its lines, so the reader must keep it as",
        "one paragraph and must not cut it into pieces at each line end.",
    ]
    return [b"".join(line("F1", 10, 72, 700 - i * 13, t) for i, t in enumerate(lines) if t)]


def ligature():
    # 0x80 is the ligature glyph that maps to a private-use character.
    lines = [
        "This page tests the repair of words that lost letters. The font of",
        "some books draws two letters as one sign, and the PDF has no letter",
        "for that sign. The reader must put the letters back. The words",
        "emo\x80ons and condi\x80on lost the letters t and i in this way. The",
        "words emoons and uncondional lost the same letters with no mark",
        "at all. A short word such as the or and must stay as it is, and a",
        "real word such as station must also stay as it is.",
    ]
    return [b"".join(line("F2", 10, 72, 700 - i * 13, t) for i, t in enumerate(lines))]


def hyphen():
    lines = [
        "A printed book often cuts a long word at the end of a line and puts",
        "a hyphen after the first part. The reader must join the two parts",
        "again, so that the voice says one word. For example, the word rep-",
        "resentation is cut here, and the word endo-",
        "dontic is cut here. A real compound such as well-",
        "known keeps its hyphen in the dictionary, and the reader can keep it.",
        "The last line of this page has no hyphen at its end.",
    ]
    return [b"".join(line("F1", 10, 72, 700 - i * 13, t) for i, t in enumerate(lines))]


ROTATED = (
    "This page is a landscape page. Its text is turned a quarter, and the page is turned back "
    "a quarter, so the text stands upright on the screen. In the file, each line runs up the "
    "sheet and the next line sits to its right. Each line here is drawn in two pieces, so a "
    "reader that sorts the pieces by their height on the sheet mixes the lines. A good reader "
    "turns the page first: the reader must read each line from its start to its end, and the "
    "lines from the top down."
)


def rotated():
    """A /Rotate 90 page whose text is drawn turned (0 1 -1 0 Tm), so it reads upright."""
    out = b""
    for i, t in enumerate(textwrap.wrap(ROTATED, 60)):
        cut = t.find(" ", len(t) // 2) + 1
        out += b"BT 0 1 -1 0 %.1f 72 Tm /F1 10 Tf (" % (72 + i * 14) + esc(t[:cut]).encode("latin-1") + \
            b") Tj /F2 10 Tf (" + esc(t[cut:]).encode("latin-1") + b") Tj ET\n"
    return [out]


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_pdf("two-columns.pdf", two_columns())
    write_pdf("number-start.pdf", number_start())
    write_pdf("ligature.pdf", ligature())
    write_pdf("hyphen.pdf", hyphen())
    write_pdf("rotated.pdf", rotated(), rotate=90)
    print("wrote", ", ".join(sorted(os.listdir(OUT))), "in", OUT)
