"""Izvoz tabele u Excel (.xlsx), lepo formatiran.

Podatke šalje stranica (static/izvoz.js): naslov, opis, kolone, redovi i redovi zbira.
Ćelija je tekst ili rečnik:
  {"t": "n", "v": 1234.5, "d": 2, "s": " %"}   broj (d = broj decimala, s = oznaka iza broja)
  {"t": "d", "v": "2026-11-27", "h": "14:05"}   datum (i vreme)
"""
from datetime import date, datetime
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BOJA_ZAGLAVLJA = "1B2436"     # kao zaglavlje aplikacije (tema.css: --boja-tamna)
BOJA_ZBIRA = "E8EEFB"
BOJA_PRUGE = "F5F7FB"


def _format_broja(d, oznaka):
    format_ = "#,##0" + ("." + "0" * min(int(d or 0), 6) if d else "")
    return format_ + (f'"{oznaka}"' if oznaka else "")


def _upisi(celija, vrednost):
    """Upiše vrednost u ćeliju sa odgovarajućim formatom; vrati dužinu prikaza (za širinu kolone)."""
    if isinstance(vrednost, dict) and vrednost.get("t") == "n":
        celija.value = vrednost.get("v")
        celija.number_format = _format_broja(vrednost.get("d"), vrednost.get("s", ""))
        celija.alignment = Alignment(horizontal="right")
        return len(str(vrednost.get("tekst") or vrednost.get("v")))
    if isinstance(vrednost, dict) and vrednost.get("t") == "d" and str(vrednost.get("v", ""))[:4] < "1900":
        vrednost = vrednost.get("tekst", "")         # Excel ne zna datume pre 1900. godine
    if isinstance(vrednost, dict) and vrednost.get("t") == "d":
        try:
            if vrednost.get("h"):
                celija.value = datetime.fromisoformat(f"{vrednost['v']}T{vrednost['h']}")
                celija.number_format = "dd.mm.yyyy. hh:mm"
            else:
                celija.value = date.fromisoformat(vrednost["v"])
                celija.number_format = "dd.mm.yyyy."
            celija.alignment = Alignment(horizontal="left")
            return 17 if vrednost.get("h") else 11
        except (KeyError, ValueError):
            vrednost = vrednost.get("tekst", "")
    tekst = "" if vrednost is None else str(vrednost)
    celija.value = tekst
    if tekst.startswith("="):
        celija.data_type = "s"       # tekst, ne formula (Excel ga ne izvršava)
    return len(tekst)


def napravi_xlsx(naslov, opis, kolone, redovi, zbir, izvezeno=""):
    wb = Workbook()
    ws = wb.active
    ws.title = (naslov or "Tabela")[:31].translate({ord(z): None for z in '[]:*?/\\'}) or "Tabela"
    n = max(1, len(kolone))

    ws.cell(1, 1, naslov).font = Font(size=15, bold=True)
    red = 2
    if opis:
        ws.cell(red, 1, opis).font = Font(italic=True, color="4A5568")
        red += 1
    ws.cell(red, 1, f"Izvezeno: {izvezeno}" if izvezeno else "").font = Font(size=9, color="737D8F")
    red += 2

    tanka = Side(style="thin", color="CFD6E1")
    zaglavlje = red
    sirine = [len(str(k)) for k in kolone]
    for i, k in enumerate(kolone, start=1):
        c = ws.cell(zaglavlje, i, k)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=BOJA_ZAGLAVLJA)
        c.alignment = Alignment(vertical="center", wrap_text=True)
        c.border = Border(bottom=tanka)
    ws.row_dimensions[zaglavlje].height = 30

    for j, r in enumerate(redovi):
        red += 1
        for i, v in enumerate(r[:n], start=1):
            c = ws.cell(red, i)
            sirine[i - 1] = max(sirine[i - 1], _upisi(c, v))
            c.border = Border(bottom=tanka)
            if j % 2:
                c.fill = PatternFill("solid", fgColor=BOJA_PRUGE)
    poslednji_red_podataka = red

    for r in zbir:
        red += 1
        for i, v in enumerate(r[:n], start=1):
            c = ws.cell(red, i)
            sirine[i - 1] = max(sirine[i - 1], _upisi(c, v))
            c.font = Font(bold=True)
            c.fill = PatternFill("solid", fgColor=BOJA_ZBIRA)
            c.border = Border(top=Side(style="medium", color="1B2436"))

    for i, s in enumerate(sirine, start=1):
        ws.column_dimensions[get_column_letter(i)].width = min(60, max(9, s + 3))
    ws.freeze_panes = ws.cell(zaglavlje + 1, 1)
    if redovi:
        ws.auto_filter.ref = f"A{zaglavlje}:{get_column_letter(n)}{poslednji_red_podataka}"
    ws.page_setup.orientation = "landscape" if n > 6 else "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{zaglavlje}:{zaglavlje}"

    izlaz = BytesIO()
    wb.save(izlaz)
    return izlaz.getvalue()
