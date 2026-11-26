"""Izdavanje računa kao PDF fajla.

Odvojeno od main.py namerno: kada se način izdavanja računa promeni
(fiskalni štampač, e-račun...), menja se samo ovaj fajl, a ostatak
programa i dalje poziva istu funkciju: izdaj_racun(racun_id, datum_vreme, korisnik, stavke).
Storno dokument: izdaj_storno(podaci) (podaci iz racuni.storno_za_pdf).

stavke: lista rečnika sa ključevima
    sifra, naziv, jedinica_mere, kolicina, cena_po_komadu
"""

from pathlib import Path

from fpdf import FPDF

FOLDER_PDF = Path(__file__).resolve().parent / "pdfs"

# Arial iz Windows-a, da bi radila slova č, ć, š, đ, ž
FONT_OBICAN = Path("C:/Windows/Fonts/arial.ttf")
FONT_PODEBLJAN = Path("C:/Windows/Fonts/arialbd.ttf")

NAZIV_RADNJE = "PRODAVNICA"
NAZIV_NACINA = {"gotovina": "Gotovina (keš)", "kartica": "Kartica", "cek": "Ček"}
VALUTA = "RSD"


def format_broj(broj, decimala=2):
    """1234.5 -> '1.234,50' (srpski zapis)."""
    tekst = f"{broj:,.{decimala}f}"
    return tekst.replace(",", "X").replace(".", ",").replace("X", ".")


def format_kolicina(kolicina):
    """Ceo broj bez decimala, inače do 3 decimale."""
    if float(kolicina).is_integer():
        return str(int(kolicina))
    return format_broj(kolicina, 3).rstrip("0").rstrip(",")


def _novi_pdf():
    FOLDER_PDF.mkdir(exist_ok=True)
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_font("Arial", "", str(FONT_OBICAN))
    pdf.add_font("Arial", "B", str(FONT_PODEBLJAN))
    pdf.add_page()
    return pdf


def izdaj_racun(racun_id, datum_vreme, korisnik, stavke, nacin_placanja=None):
    """Napravi PDF račun u folderu pdfs/ i vrati putanju do fajla."""
    pdf = _novi_pdf()

    # Zaglavlje
    pdf.set_font("Arial", "B", 18)
    pdf.cell(0, 10, NAZIV_RADNJE, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Arial", "", 11)
    pdf.cell(0, 6, f"Račun br. {racun_id}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Datum i vreme: {datum_vreme}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Kasir: {korisnik}", align="C", new_x="LMARGIN", new_y="NEXT")
    if nacin_placanja:
        pdf.cell(0, 6, f"Način plaćanja: {NAZIV_NACINA.get(nacin_placanja, nacin_placanja)}",
                 align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    # Tabela stavki
    ukupno = 0.0
    pdf.set_font("Arial", "", 10)
    with pdf.table(
        col_widths=(14, 50, 12, 14, 22, 24),
        text_align=("LEFT", "LEFT", "CENTER", "RIGHT", "RIGHT", "RIGHT"),
        line_height=7,
    ) as tabela:
        zaglavlje = tabela.row()
        for naslov in ("Šifra", "Naziv", "JM", "Količina", "Cena", "Ukupno"):
            zaglavlje.cell(naslov)

        for s in stavke:
            iznos = s["kolicina"] * s["cena_po_komadu"]
            ukupno += iznos
            red = tabela.row()
            red.cell(str(s["sifra"]))
            red.cell(str(s["naziv"]))
            red.cell(str(s["jedinica_mere"]))
            red.cell(format_kolicina(s["kolicina"]))
            red.cell(format_broj(s["cena_po_komadu"]))
            red.cell(format_broj(iznos))

    # Ukupno
    pdf.ln(4)
    pdf.set_font("Arial", "B", 14)
    pdf.cell(0, 10, f"UKUPNO: {format_broj(ukupno)} {VALUTA}", align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(8)
    pdf.set_font("Arial", "", 10)
    pdf.cell(0, 6, "Hvala na kupovini!", align="C")

    putanja = FOLDER_PDF / f"racun_{racun_id}.pdf"
    pdf.output(str(putanja))
    return putanja


def izdaj_storno(p):
    """PDF storno dokumenta. p: racuni.storno_za_pdf(...). Vraća putanju do fajla."""
    pdf = _novi_pdf()

    pdf.set_font("Arial", "B", 18)
    pdf.cell(0, 10, NAZIV_RADNJE, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(179, 38, 30)
    pdf.set_font("Arial", "B", 22)
    pdf.cell(0, 12, "STORNIRANO", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Arial", "", 11)
    pdf.cell(0, 6, f"Storno br. {p['storno_id']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Datum i vreme storna: {p['datum_vreme']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Stornirao: {p['korisnik']}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # Šta je urađeno, rečima
    racuni = sorted({s["racun_id"] for s in p["stavke"]})
    celi = sorted({s["racun_id"] for s in p["stavke"] if s["status"] == "storniran"})
    pdf.set_font("Arial", "", 10)
    opis = [
        f"Stornirano je {len(p['stavke'])} stavki sa {len(racuni)} računa "
        f"(br. {', '.join(str(r) for r in racuni)}).",
        "Stornirane količine su vraćene na zalihe (stanje artikala je povećano).",
        f"Iznos za povraćaj kupcu: {format_broj(p['ukupno'])} {VALUTA}"
        + "".join(f"; {NAZIV_NACINA[n]}: {format_broj(v)} {VALUTA}" for n, v in p["po_nacinu"].items() if v) + ".",
    ]
    if celi:
        opis.append(f"Potpuno stornirani računi (posle ovog storna): br. {', '.join(str(r) for r in celi)}.")
    for red in opis:
        pdf.multi_cell(0, 5.5, red, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    with pdf.table(
        col_widths=(14, 12, 40, 10, 22, 18, 22),
        text_align=("CENTER", "LEFT", "LEFT", "CENTER", "RIGHT", "RIGHT", "RIGHT"),
        line_height=7,
    ) as tabela:
        zaglavlje = tabela.row()
        for naslov in ("Račun", "Šifra", "Naziv", "JM", "Stornirano / od", "Cena", "Iznos"):
            zaglavlje.cell(naslov)
        for s in p["stavke"]:
            red = tabela.row()
            red.cell(str(s["racun_id"]))
            red.cell(str(s["sifra"]))
            red.cell(str(s["naziv"]))
            red.cell(str(s["jedinica_mere"]))
            red.cell(f"{format_kolicina(s['kolicina'])} / {format_kolicina(s['kolicina_na_racunu'])}")
            red.cell(format_broj(s["cena_po_komadu"]))
            red.cell("-" + format_broj(s["kolicina"] * s["cena_po_komadu"]))

    pdf.ln(4)
    pdf.set_font("Arial", "B", 14)
    pdf.cell(0, 10, f"UKUPNO STORNIRANO: -{format_broj(p['ukupno'])} {VALUTA}", align="R",
             new_x="LMARGIN", new_y="NEXT")

    putanja = FOLDER_PDF / f"storno_{p['storno_id']}.pdf"
    pdf.output(str(putanja))
    return putanja
