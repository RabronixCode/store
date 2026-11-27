"""Računi kase: izdavanje, pregled po periodu i storno.

Funkcije rade samo sa bazom (primaju otvorenu konekciju); commit/rollback radi main.py.

Storno: količina iz stavke računa se vraća na zalihe, a u stavka_racuna.stornirano se pamti
koliko je od nje već stornirano. Svaki storno je jedan dokument (tabela storno) sa svojim
stavkama (stavka_storna), pa se zna šta je, kad i ko stornirao. Status računa:
  izdat               ništa nije stornirano
  delimicno_storniran deo stavki / količine je storniran
  storniran           cela količina svih stavki je stornirana
"""
from Errors.BadInput import BadInput
from artikli import azuriraj_ponderisanu_cenu

NACINI_PLACANJA = ("gotovina", "kartica", "cek")
NAZIV_NACINA = {"gotovina": "Gotovina (keš)", "kartica": "Kartica", "cek": "Ček"}
STATUSI = {"izdat": "Izdat", "delimicno_storniran": "Delimično storniran", "storniran": "Storniran"}

# Male razlike u decimalama (npr. 0.1 + 0.2) ne smeju da ostave "ostatak" za storno
EPS = 1e-9


def sacuvaj_racun(konekcija, korisnik, nacin_placanja="gotovina"):
    veza = konekcija.cursor()
    veza.execute("INSERT INTO racun (korisnik, nacin_placanja) VALUES (?, ?)", (korisnik, nacin_placanja))
    racun_id = veza.lastrowid
    datum_vreme = veza.execute("SELECT datum_vreme FROM racun WHERE racun_id = ?", (racun_id,)).fetchone()[0]
    return racun_id, datum_vreme

def vrati_artikal_za_racun(konekcija, sifra):
    veza = konekcija.cursor()
    upit = "SELECT sifra, naziv, jedinica_mere, prodajna_cena, nabavna_cena_ponderisana, aktivan FROM artikal WHERE sifra = ?"
    return veza.execute(upit, (sifra,)).fetchone()

def sacuvaj_stavka_racuna(konekcija, racun_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu, nabavna_cena):
    veza = konekcija.cursor()
    # pdv: stopa iz tarife artikla u trenutku prodaje (za porez u Finansijama)
    upit = """INSERT INTO stavka_racuna (racun_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu, nabavna_cena, pdv)
              VALUES (?,?,?,?,?,?,?, COALESCE((SELECT t.stopa FROM artikal a JOIN tarifa t ON t.tarifa_id = a.tarifa_id
                                                WHERE a.sifra = ?), 20))"""
    vrednosti = (racun_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu, nabavna_cena, sifra)
    veza.execute(upit, vrednosti)


# ---------- Pregled ----------

ZBIROVI_RACUNA = """
    (SELECT COUNT(*) FROM stavka_racuna s WHERE s.racun_id = r.racun_id) AS broj_stavki,
    (SELECT COALESCE(SUM(s.kolicina * s.cena_po_komadu), 0) FROM stavka_racuna s WHERE s.racun_id = r.racun_id) AS iznos,
    (SELECT COALESCE(SUM(s.stornirano * s.cena_po_komadu), 0) FROM stavka_racuna s WHERE s.racun_id = r.racun_id) AS stornirano
"""


def _zaokruzi_racun(r):
    r = dict(r)
    r["iznos"] = round(r["iznos"], 2)
    r["stornirano"] = round(r["stornirano"], 2)
    r["neto"] = round(r["iznos"] - r["stornirano"], 2)
    return r


def lista_racuna(konekcija, od, do):
    """Računi izdati od `od` do `do` (tekst 'YYYY-MM-DD HH:MM:SS', obe granice uključene) i zbirovi.

    Zbir po načinu plaćanja je NETO (iznos računa minus stornirano), jer je to novac koji je ostao.
    """
    redovi = konekcija.execute(f"""
        SELECT r.racun_id, r.datum_vreme, r.korisnik, r.nacin_placanja, r.status, {ZBIROVI_RACUNA}
        FROM racun r
        WHERE r.datum_vreme BETWEEN ? AND ?
        ORDER BY r.datum_vreme DESC, r.racun_id DESC""", (od, do)).fetchall()
    racuni = [_zaokruzi_racun(r) for r in redovi]
    zbir = {n: 0.0 for n in NACINI_PLACANJA}
    for r in racuni:
        zbir[r["nacin_placanja"]] += r["neto"]
    zbir = {n: round(v, 2) for n, v in zbir.items()}
    zbir["ukupno"] = round(sum(r["neto"] for r in racuni), 2)
    zbir["bruto"] = round(sum(r["iznos"] for r in racuni), 2)
    zbir["stornirano"] = round(sum(r["stornirano"] for r in racuni), 2)
    zbir["broj_racuna"] = len(racuni)
    return {"od": od, "do": do, "racuni": racuni, "zbir": zbir}


def jedan_racun(konekcija, racun_id):
    r = konekcija.execute(f"""
        SELECT r.racun_id, r.datum_vreme, r.korisnik, r.nacin_placanja, r.status, {ZBIROVI_RACUNA}
        FROM racun r WHERE r.racun_id = ?""", (racun_id,)).fetchone()
    if not r:
        return None
    rezultat = _zaokruzi_racun(r)
    rezultat["stavke"] = [
        {**dict(s), "iznos": round(s["kolicina"] * s["cena_po_komadu"], 2),
         "preostalo": round(s["kolicina"] - s["stornirano"], 3),
         "stornirano_iznos": round(s["stornirano"] * s["cena_po_komadu"], 2)}
        for s in konekcija.execute("""
            SELECT stavka_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu, stornirano
            FROM stavka_racuna WHERE racun_id = ? ORDER BY stavka_id""", (racun_id,)).fetchall()]
    rezultat["storna"] = [dict(s) for s in konekcija.execute("""
        SELECT st.storno_id, st.datum_vreme, st.korisnik,
               ROUND(SUM(ss.kolicina * ss.cena_po_komadu), 2) AS iznos
        FROM stavka_storna ss JOIN storno st ON st.storno_id = ss.storno_id
        WHERE ss.racun_id = ? GROUP BY st.storno_id ORDER BY st.storno_id""", (racun_id,)).fetchall()]
    return rezultat


# ---------- Storno ----------

def _osvezi_status(konekcija, racun_id):
    ukupno, stornirano = konekcija.execute(
        "SELECT SUM(kolicina), SUM(stornirano) FROM stavka_racuna WHERE racun_id = ?", (racun_id,)).fetchone()
    if not stornirano or stornirano <= EPS:
        status = "izdat"
    elif stornirano >= ukupno - EPS:
        status = "storniran"
    else:
        status = "delimicno_storniran"
    konekcija.execute("UPDATE racun SET status = ? WHERE racun_id = ?", (status, racun_id))


def storniraj(konekcija, korisnik, racuni=(), stavke=()):
    """Stornira cele račune (`racuni`: lista racun_id) i/ili pojedinačne stavke
    (`stavke`: lista (stavka_id, kolicina ili None = sve što je preostalo)).

    Sve ide u JEDAN storno dokument. Vraća storno_id. Baca BadInput ako nema šta da se stornira.
    """
    zahtevi = {}            # stavka_id -> količina za storno (None = sve preostalo)
    for racun_id in racuni:
        if not konekcija.execute("SELECT 1 FROM racun WHERE racun_id = ?", (racun_id,)).fetchone():
            raise BadInput(f"Račun br. {racun_id} ne postoji.", 404)
        for (stavka_id,) in konekcija.execute(
                "SELECT stavka_id FROM stavka_racuna WHERE racun_id = ? AND kolicina - stornirano > ?",
                (racun_id, EPS)).fetchall():
            zahtevi[stavka_id] = None
    for stavka_id, kolicina in stavke:
        if stavka_id in zahtevi and zahtevi[stavka_id] is None:
            continue        # već ide cela (ceo račun je izabran)
        zahtevi[stavka_id] = kolicina

    if not zahtevi:
        raise BadInput("Nema ništa za storniranje: izabrani računi su već potpuno stornirani.", 409)

    veza = konekcija.cursor()
    veza.execute("INSERT INTO storno (korisnik) VALUES (?)", (korisnik,))
    storno_id = veza.lastrowid
    racuni_za_status = set()
    for stavka_id, kolicina in zahtevi.items():
        s = konekcija.execute("""
            SELECT stavka_id, racun_id, sifra, naziv, jedinica_mere, kolicina, stornirano, cena_po_komadu, nabavna_cena
            FROM stavka_racuna WHERE stavka_id = ?""", (stavka_id,)).fetchone()
        if not s:
            raise BadInput(f"Stavka računa {stavka_id} ne postoji.", 404)
        preostalo = s["kolicina"] - s["stornirano"]
        if preostalo <= EPS:
            raise BadInput(f"„{s['naziv']}“ sa računa br. {s['racun_id']} je već potpuno storniran.", 409)
        kolicina = preostalo if kolicina is None else kolicina
        if kolicina <= 0 or kolicina > preostalo + EPS:
            raise BadInput(f"„{s['naziv']}“ (račun br. {s['racun_id']}): može da se stornira najviše "
                           f"{round(preostalo, 3)} {s['jedinica_mere']}.", 400)
        kolicina = min(kolicina, preostalo)
        veza.execute("""
            INSERT INTO stavka_storna (storno_id, racun_id, stavka_id, sifra, naziv, jedinica_mere,
                                       kolicina, cena_po_komadu, nabavna_cena)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (storno_id, s["racun_id"], s["stavka_id"], s["sifra"], s["naziv"], s["jedinica_mere"],
             kolicina, s["cena_po_komadu"], s["nabavna_cena"]))
        veza.execute("UPDATE stavka_racuna SET stornirano = stornirano + ? WHERE stavka_id = ?", (kolicina, stavka_id))
        # Roba se vraća na zalihe po nabavnoj ceni iz trenutka prodaje (stanje + prosečna nabavna cena)
        azuriraj_ponderisanu_cenu(konekcija, s["sifra"], kolicina, s["nabavna_cena"])
        racuni_za_status.add(s["racun_id"])
    for racun_id in racuni_za_status:
        _osvezi_status(konekcija, racun_id)
    return storno_id


def storno_za_pdf(konekcija, storno_id):
    """Podaci za PDF storna: zaglavlje, stavke (sa računom i načinom plaćanja) i zbirovi."""
    st = konekcija.execute("SELECT storno_id, datum_vreme, korisnik FROM storno WHERE storno_id = ?",
                           (storno_id,)).fetchone()
    if not st:
        return None
    stavke = [dict(s) for s in konekcija.execute("""
        SELECT ss.racun_id, r.datum_vreme AS datum_racuna, r.nacin_placanja, r.status,
               ss.sifra, ss.naziv, ss.jedinica_mere, ss.kolicina, ss.cena_po_komadu,
               sr.kolicina AS kolicina_na_racunu
        FROM stavka_storna ss
        JOIN racun r ON r.racun_id = ss.racun_id
        JOIN stavka_racuna sr ON sr.stavka_id = ss.stavka_id
        WHERE ss.storno_id = ? ORDER BY ss.racun_id, ss.stavka_storna_id""", (storno_id,)).fetchall()]
    po_nacinu = {n: 0.0 for n in NACINI_PLACANJA}
    for s in stavke:
        po_nacinu[s["nacin_placanja"]] += s["kolicina"] * s["cena_po_komadu"]
    return {**dict(st), "stavke": stavke,
            "ukupno": round(sum(po_nacinu.values()), 2),
            "po_nacinu": {n: round(v, 2) for n, v in po_nacinu.items()}}


def racun_za_pdf(konekcija, racun_id):
    r = konekcija.execute("SELECT racun_id, datum_vreme, korisnik, nacin_placanja FROM racun WHERE racun_id = ?",
                          (racun_id,)).fetchone()
    if not r:
        return None
    stavke = [dict(s) for s in konekcija.execute("""
        SELECT sifra, naziv, jedinica_mere, kolicina, cena_po_komadu FROM stavka_racuna
        WHERE racun_id = ? ORDER BY stavka_id""", (racun_id,)).fetchall()]
    return {**dict(r), "stavke": stavke}
