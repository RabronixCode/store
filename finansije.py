"""Finansije (vlasnik): prodaja po artiklima, po danima (transakcije), po dobavljačima i mini bilans.

Sve se računa iz stavki izdatih računa. Stornirana količina se oduzima od prodaje na datum
RAČUNA (prodaja = količina − stornirano); potpuno stornirane stavke se ne prikazuju.

Vrednosti po stavci (količina = neto, posle storna):
  prodajna vrednost = količina × prodajna cena (sa PDV, kako je naplaćeno)
  porez (PDV)       = prodajna vrednost × stopa / (100 + stopa)
  nabavna vrednost  = količina × nabavna cena (prosečna nabavna bez PDV u trenutku prodaje)
  razlika (zarada)  = prodajna vrednost − (nabavna vrednost + porez)
"""
import calendar
import unicodedata
from collections import defaultdict
from datetime import date

NACINI = ("gotovina", "kartica", "cek")
EPS = 1e-9


def _normalizuj(tekst):
    tekst = str(tekst or "").lower().replace("đ", "dj")
    return "".join(c for c in unicodedata.normalize("NFD", tekst) if not unicodedata.combining(c))


def _odgovara_artiklu(s, trazi):
    """Pretraga po artiklu: samo cifre = tačna šifra, inače deo naziva (bez obzira na kvačice)."""
    if not trazi:
        return True
    trazi = trazi.strip()
    if trazi.isdigit() and int(trazi) == s["sifra"]:
        return True
    return _normalizuj(trazi) in _normalizuj(s["naziv"])


def dobavljaci_artikala(konekcija):
    """šifra artikla -> (dobavljac_id, naziv dobavljača): dobavljač iz POSLEDNJEG ulaza tog artikla,
    a ako ulaza nema, dobavljač sa kojim je artikal povezan."""
    mapa = {}
    for r in konekcija.execute("""
            SELECT da.sifra_artikal, d.dobavljac_id, d.naziv FROM dobavljac_artikal da
            JOIN dobavljac d ON d.dobavljac_id = da.dobavljac_id ORDER BY da.dobavljac_id DESC"""):
        mapa[r[0]] = (r[1], r[2])
    for r in konekcija.execute("""
            SELECT s.sifra_lokalna, d.dobavljac_id, d.naziv FROM stavka_ulaza s
            JOIN ulaz u ON u.ulaz_id = s.ulaz_id JOIN dobavljac d ON d.dobavljac_id = u.dobavljac_id
            ORDER BY u.ulaz_id, s.stavka_id"""):
        mapa[r[0]] = (r[1], r[2])          # kasniji ulaz prepisuje raniji
    return mapa


def stavke_prodaje(konekcija, od, do, artikal="", dobavljac_id=None, kategorija="", nacin=""):
    """Prodate stavke (posle storna) u periodu [od, do] ('YYYY-MM-DD HH:MM:SS'), sa filterima."""
    redovi = konekcija.execute("""
        SELECT r.racun_id, r.datum_vreme, r.nacin_placanja,
               s.sifra, s.naziv, s.jedinica_mere, a.kategorija,
               s.kolicina - s.stornirano AS kolicina, s.cena_po_komadu, s.nabavna_cena, COALESCE(s.pdv, 20) AS pdv
        FROM stavka_racuna s JOIN racun r ON r.racun_id = s.racun_id
        LEFT JOIN artikal a ON a.sifra = s.sifra
        WHERE r.datum_vreme BETWEEN ? AND ? AND s.kolicina - s.stornirano > ?
        ORDER BY r.datum_vreme, r.racun_id, s.stavka_id""", (od, do, EPS)).fetchall()
    dobavljaci = dobavljaci_artikala(konekcija)
    rezultat = []
    for r in redovi:
        s = dict(r)
        dob = dobavljaci.get(s["sifra"])
        s["dobavljac_id"], s["dobavljac"] = dob if dob else (None, None)
        s["kategorija"] = s["kategorija"] or None
        if not _odgovara_artiklu(s, artikal):
            continue
        if dobavljac_id is not None and s["dobavljac_id"] != dobavljac_id:
            continue
        if kategorija and (s["kategorija"] or "") != kategorija:
            continue
        if nacin and s["nacin_placanja"] != nacin:
            continue
        s["prodajna"] = s["kolicina"] * s["cena_po_komadu"]
        s["porez"] = s["prodajna"] * s["pdv"] / (100 + s["pdv"])
        s["nabavna"] = s["kolicina"] * s["nabavna_cena"]
        rezultat.append(s)
    return rezultat


def _vrednosti(stavke):
    prodajna = sum(s["prodajna"] for s in stavke)
    nabavna = sum(s["nabavna"] for s in stavke)
    porez = sum(s["porez"] for s in stavke)
    return {"prodajna": round(prodajna, 2), "nabavna": round(nabavna, 2), "porez": round(porez, 2),
            "razlika": round(prodajna - nabavna - porez, 2)}


def po_artiklima(stavke):
    """Isti artikal sa RAZLIČITOM prodajnom cenom je posebna stavka (šifra + cena)."""
    grupe = defaultdict(list)
    for s in stavke:
        grupe[(s["sifra"], round(s["cena_po_komadu"], 4))].append(s)
    redovi = []
    for (sifra, cena), lista in grupe.items():
        prva = lista[-1]                  # naziv i JM sa poslednje prodaje
        redovi.append({
            "sifra": sifra, "naziv": prva["naziv"], "jedinica_mere": prva["jedinica_mere"],
            "kategorija": prva["kategorija"], "dobavljac": prva["dobavljac"], "cena": cena,
            "kolicina": round(sum(s["kolicina"] for s in lista), 3),
            "broj_racuna": len({s["racun_id"] for s in lista}),
            "pdv": prva["pdv"],
            **_vrednosti(lista),
        })
    # broj cena po artiklu: da se u tabeli vidi da je isti artikal prodavan po više cena
    cena_po_sifri = defaultdict(int)
    for r in redovi:
        cena_po_sifri[r["sifra"]] += 1
    for r in redovi:
        r["vise_cena"] = cena_po_sifri[r["sifra"]] > 1
    redovi.sort(key=lambda r: (r["sifra"], r["cena"]))
    return {"artikli": redovi, "zbir": {**_vrednosti(stavke), "broj_stavki": len(redovi),
                                         "broj_racuna": len({s["racun_id"] for s in stavke})}}


def po_danima(stavke):
    dani = defaultdict(list)
    for s in stavke:
        dani[s["datum_vreme"][:10]].append(s)
    redovi = []
    for datum in sorted(dani, reverse=True):
        lista = dani[datum]
        red = {"datum": datum, "broj_racuna": len({s["racun_id"] for s in lista}),
               "ukupno": round(sum(s["prodajna"] for s in lista), 2)}
        for n in NACINI:
            red[n] = round(sum(s["prodajna"] for s in lista if s["nacin_placanja"] == n), 2)
        redovi.append(red)
    zbir = {"ukupno": round(sum(s["prodajna"] for s in stavke), 2),
            "broj_racuna": len({s["racun_id"] for s in stavke})}
    for n in NACINI:
        zbir[n] = round(sum(s["prodajna"] for s in stavke if s["nacin_placanja"] == n), 2)
    return {"dani": redovi, "zbir": zbir}


def po_dobavljacima(stavke):
    grupe = defaultdict(list)
    for s in stavke:
        grupe[(s["dobavljac_id"], s["dobavljac"])].append(s)
    ukupno = sum(s["prodajna"] for s in stavke) or 1
    redovi = []
    for (dob_id, naziv), lista in grupe.items():
        artikli = po_artiklima(lista)["artikli"]
        redovi.append({"dobavljac_id": dob_id, "dobavljac": naziv or "Bez dobavljača",
                       "broj_artikala": len({s["sifra"] for s in lista}),
                       "broj_racuna": len({s["racun_id"] for s in lista}),
                       "udeo": round(sum(s["prodajna"] for s in lista) / ukupno * 100, 2),
                       **_vrednosti(lista), "artikli": artikli})
    redovi.sort(key=lambda r: -r["prodajna"])
    return {"dobavljaci": redovi, "zbir": _vrednosti(stavke)}


def bilans(stavke, od_mesec, do_mesec, danas=None):
    """Po mesecima od `od_mesec` do `do_mesec` ('YYYY-MM'), i meseci bez prodaje (nule).
    broj_dana: dana u mesecu; za tekući mesec do danas; budući meseci se ne prikazuju."""
    danas = danas or date.today()
    po_mesecu = defaultdict(list)
    for s in stavke:
        po_mesecu[s["datum_vreme"][:7]].append(s)
    g, m = map(int, od_mesec.split("-"))
    kraj = tuple(map(int, do_mesec.split("-")))
    redovi = []
    while (g, m) <= kraj and (g, m) <= (danas.year, danas.month):
        kljuc = f"{g:04d}-{m:02d}"
        dana = danas.day if (g, m) == (danas.year, danas.month) else calendar.monthrange(g, m)[1]
        redovi.append({"mesec": kljuc, "broj_dana": dana, "tekuci": (g, m) == (danas.year, danas.month),
                       "broj_racuna": len({s["racun_id"] for s in po_mesecu[kljuc]}),
                       **_vrednosti(po_mesecu[kljuc])})
        g, m = (g + 1, 1) if m == 12 else (g, m + 1)
    return {"meseci": redovi, "zbir": {**_vrednosti(stavke), "broj_dana": sum(r["broj_dana"] for r in redovi)}}


def filteri(konekcija):
    return {
        "dobavljaci": [dict(r) for r in konekcija.execute(
            "SELECT dobavljac_id, naziv FROM dobavljac ORDER BY naziv COLLATE NOCASE").fetchall()],
        "kategorije": [r[0] for r in konekcija.execute(
            "SELECT DISTINCT kategorija FROM artikal WHERE kategorija IS NOT NULL AND kategorija != '' "
            "ORDER BY kategorija COLLATE NOCASE").fetchall()],
    }
