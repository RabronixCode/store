"""Ulaz robe: upis novog ulaza, pretraga artikala za stavke, spisak i izmena ulaza.

Funkcije ovde rade samo sa bazom (primaju otvorenu konekciju); commit/rollback radi main.py,
da bi ceo ulaz (zaglavlje, novi artikli, stavke, stanje) bio sačuvan u JEDNOJ transakciji.
"""

import unicodedata

from Errors.BadInput import BadInput
from artikli import azuriraj_ponderisanu_cenu, dodaj_jedan_artikal


# ---------- Pomoćne ----------

def _normalizuj(tekst):
    tekst = str(tekst or "").lower().replace("đ", "dj")
    return "".join(c for c in unicodedata.normalize("NFD", tekst) if not unicodedata.combining(c))


# ---------- Pretraga artikala za stavke ----------

def pretrazi_artikle_za_ulaz(konekcija, tekst, limit=50):
    """Prazan tekst: prvih `limit` artikala po šifri. Inače prvo poklapanja po šifri, pa po nazivu.

    Za razliku od kase, ovde se vide i NEAKTIVNI artikli (i njih je moguće ponovo nabaviti).
    Pretraga ne razlikuje mala/velika slova ni kvačice ("cokolada" nađe "Čokolada").
    """
    limit = max(1, min(int(limit), 50))
    redovi = [dict(r) for r in konekcija.execute(
        "SELECT sifra, naziv, jedinica_mere, stanje, aktivan, prodajna_cena, nabavna_cena_ponderisana "
        "FROM artikal ORDER BY sifra"
    ).fetchall()]
    tekst = _normalizuj(tekst).strip()
    if not tekst:
        return redovi[:limit]

    def rang(a):
        sifra = str(a["sifra"])
        naziv = _normalizuj(a["naziv"])
        if sifra == tekst: return 1
        if sifra.startswith(tekst): return 2
        if tekst in sifra: return 3
        if naziv.startswith(tekst): return 4
        if tekst in naziv: return 5
        return None

    pogodci = [(rang(a), a) for a in redovi]
    pogodci = [(r, a) for r, a in pogodci if r is not None]
    pogodci.sort(key=lambda p: (p[0], p[1]["sifra"]))
    return [a for _, a in pogodci[:limit]]


def veza_sa_dobavljacem(konekcija, dobavljac_id, sifra_artikal=None, sifra_dobavljac=None):
    """Podaci za automatsko popunjavanje stavke.

    Traži artikal po NAŠOJ šifri ili po šifri DOBAVLJAČA. Vraća artikal i, ako je povezan
    sa ovim dobavljačem, njegovu šifru kod dobavljača i poslednju nabavnu cenu i PDV
    (iz poslednjeg ulaza; ako ulaza nema, iz same veze). None ako artikal nije nađen.
    """
    if sifra_artikal is not None:
        artikal = konekcija.execute(
            "SELECT sifra, naziv, jedinica_mere, stanje, aktivan, prodajna_cena, nabavna_cena_ponderisana "
            "FROM artikal WHERE sifra = ?",
            (sifra_artikal,)).fetchone()
    else:
        artikal = konekcija.execute("""
            SELECT a.sifra, a.naziv, a.jedinica_mere, a.stanje, a.aktivan, a.prodajna_cena, a.nabavna_cena_ponderisana
            FROM dobavljac_artikal da JOIN artikal a ON a.sifra = da.sifra_artikal
            WHERE da.dobavljac_id = ? AND da.sifra_dobavljac = ?""",
            (dobavljac_id, sifra_dobavljac)).fetchone()
    if not artikal:
        return None

    rezultat = dict(artikal)
    veza = konekcija.execute(
        "SELECT sifra_dobavljac, nabavna_cena_bez_pdv, pdv FROM dobavljac_artikal WHERE dobavljac_id = ? AND sifra_artikal = ?",
        (dobavljac_id, rezultat["sifra"])).fetchone()
    poslednja = konekcija.execute("""
        SELECT s.nabavna_cena, s.pdv FROM stavka_ulaza s JOIN ulaz u ON u.ulaz_id = s.ulaz_id
        WHERE u.dobavljac_id = ? AND s.sifra_lokalna = ?
        ORDER BY s.ulaz_id DESC, s.stavka_id DESC LIMIT 1""",
        (dobavljac_id, rezultat["sifra"])).fetchone()

    rezultat["povezan"] = veza is not None
    rezultat["sifra_dobavljac"] = veza["sifra_dobavljac"] if veza else None
    if poslednja:
        rezultat["nabavna_cena"], rezultat["pdv"] = poslednja["nabavna_cena"], poslednja["pdv"]
    elif veza:
        rezultat["nabavna_cena"], rezultat["pdv"] = veza["nabavna_cena_bez_pdv"], veza["pdv"]
    else:
        rezultat["nabavna_cena"], rezultat["pdv"] = None, None
    return rezultat


# ---------- Provere ----------

def dobavljac_postoji(konekcija, dobavljac_id):
    return konekcija.execute("SELECT 1 FROM dobavljac WHERE dobavljac_id = ?", (dobavljac_id,)).fetchone() is not None


def zauzeti_dokumenti(konekcija, dobavljac_id, racun_broj, otpremnica_broj, osim_ulaz_id=None):
    """Poruke za brojeve računa/otpremnice koji kod ovog dobavljača već postoje (prazna lista = sve ok)."""
    poruke = []
    if racun_broj:
        red = konekcija.execute(
            "SELECT ulaz_id FROM ulaz WHERE dobavljac_id = ? AND racun_broj = ? AND ulaz_id IS NOT ?",
            (dobavljac_id, racun_broj, osim_ulaz_id)).fetchone()
        if red:
            poruke.append(f"Račun broj „{racun_broj}“ od ovog dobavljača je već unet (ulaz #{red[0]}).")
    if otpremnica_broj:
        red = konekcija.execute(
            "SELECT ulaz_id FROM ulaz WHERE dobavljac_id = ? AND otpremnica_broj = ? AND ulaz_id IS NOT ?",
            (dobavljac_id, otpremnica_broj, osim_ulaz_id)).fetchone()
        if red:
            poruke.append(f"Otpremnica broj „{otpremnica_broj}“ od ovog dobavljača je već uneta (ulaz #{red[0]}).")
    return poruke


# ---------- Upis novog ulaza ----------

def povezi_sa_dobavljacem(konekcija, dobavljac_id, sifra_artikal, sifra_dobavljac, nabavna_cena, pdv):
    """Napravi ili osveži vezu artikal-dobavljač (šifra kod dobavljača, poslednja cena i PDV).

    Ako je šifra dobavljača zadata, ne sme već pripadati DRUGOM artiklu istog dobavljača.
    Prazna šifra ne briše postojeću.
    """
    if sifra_dobavljac:
        tudji = konekcija.execute("""
            SELECT a.sifra, a.naziv FROM dobavljac_artikal da JOIN artikal a ON a.sifra = da.sifra_artikal
            WHERE da.dobavljac_id = ? AND da.sifra_dobavljac = ? AND da.sifra_artikal != ?""",
            (dobavljac_id, sifra_dobavljac, sifra_artikal)).fetchone()
        if tudji:
            raise BadInput(
                f"Šifra dobavljača „{sifra_dobavljac}“ je kod ovog dobavljača već dodeljena artiklu "
                f"{tudji['sifra']} ({tudji['naziv'] or 'bez naziva'}).", 409)

    postoji = konekcija.execute(
        "SELECT 1 FROM dobavljac_artikal WHERE dobavljac_id = ? AND sifra_artikal = ?",
        (dobavljac_id, sifra_artikal)).fetchone()
    if postoji:
        konekcija.execute("""
            UPDATE dobavljac_artikal
            SET sifra_dobavljac = COALESCE(?, sifra_dobavljac), nabavna_cena_bez_pdv = ?, pdv = ?
            WHERE dobavljac_id = ? AND sifra_artikal = ?""",
            (sifra_dobavljac, nabavna_cena, pdv, dobavljac_id, sifra_artikal))
    else:
        naziv = konekcija.execute("SELECT naziv FROM artikal WHERE sifra = ?", (sifra_artikal,)).fetchone()[0]
        konekcija.execute("""
            INSERT INTO dobavljac_artikal (dobavljac_id, sifra_artikal, sifra_dobavljac, naziv, nabavna_cena_bez_pdv, pdv)
            VALUES (?,?,?,?,?,?)""",
            (dobavljac_id, sifra_artikal, sifra_dobavljac, naziv, nabavna_cena, pdv))


def sacuvaj_ulaz(konekcija, u):
    """u: NoviUlaz (main.py). Upisuje zaglavlje, nove artikle, veze, stavke i menja stanje.

    Vraća ulaz_id. Baca BadInput za sve što ne sme da prođe; pozivalac radi rollback.
    """
    if not dobavljac_postoji(konekcija, u.dobavljac_id):
        raise BadInput("Izabrani dobavljač ne postoji. Osveži stranicu.", 404)
    zauzeto = zauzeti_dokumenti(konekcija, u.dobavljac_id, u.racun_broj, u.otpremnica_broj)
    if zauzeto:
        raise BadInput(" ".join(zauzeto), 409)

    veza = konekcija.cursor()
    veza.execute("""
        INSERT INTO ulaz (dobavljac_id, racun_broj, racun_poziv_na_broj, ulaz_datum,
                          otpremnica_broj, otpremnica_datum, valuta_datum)
        VALUES (?,?,?,?,?,?,?)""",
        (u.dobavljac_id, u.racun_broj, u.racun_poziv_na_broj, _datum(u.ulaz_datum),
         u.otpremnica_broj, _datum(u.otpremnica_datum), _datum(u.valuta_datum)))
    ulaz_id = veza.lastrowid

    for i, s in enumerate(u.stavke, start=1):
        if s.novi_artikal is not None:
            n = s.novi_artikal
            # Prodajna cena novog artikla dolazi iz stavke (polje u redu), ne iz popupa
            prodajna = s.prodajna_cena if s.prodajna_cena is not None else n.prodajna_cena
            sifra = dodaj_jedan_artikal(konekcija, n.naziv, n.kategorija or None, n.bar_kod or None,
                                        prodajna, n.jedinica_mere, 1, n.minimalno_stanje)
        else:
            sifra = s.sifra_artikal
            if not konekcija.execute("SELECT 1 FROM artikal WHERE sifra = ?", (sifra,)).fetchone():
                raise BadInput(f"Stavka {i}: artikal sa šifrom {sifra} ne postoji.", 404)
            # Nova nabavna cena često znači i novu prodajnu: prazno polje = prodajna ostaje ista
            if s.prodajna_cena is not None:
                konekcija.execute("UPDATE artikal SET prodajna_cena = ? WHERE sifra = ?", (s.prodajna_cena, sifra))

        povezi_sa_dobavljacem(konekcija, u.dobavljac_id, sifra, s.sifra_dobavljac, s.nabavna_cena, s.pdv)
        naziv = konekcija.execute("SELECT naziv FROM artikal WHERE sifra = ?", (sifra,)).fetchone()[0]
        konekcija.execute("""
            INSERT INTO stavka_ulaza (ulaz_id, sifra_lokalna, sifra_dobavljac, naziv_lokalni, naziv_dobavljac,
                                      nabavna_cena, pdv, kolicina)
            VALUES (?,?,?,?,?,?,?,?)""",
            (ulaz_id, sifra, s.sifra_dobavljac, naziv, None, s.nabavna_cena, s.pdv, s.kolicina))
        # stanje + prosečna (ponderisana) nabavna cena
        azuriraj_ponderisanu_cenu(konekcija, sifra, s.kolicina, s.nabavna_cena)

    return ulaz_id


def _datum(d):
    return d.isoformat() if d else None


# ---------- Spisak i jedan ulaz ----------

UKUPNO_BEZ_PDV = "COALESCE((SELECT SUM(s.kolicina * s.nabavna_cena) FROM stavka_ulaza s WHERE s.ulaz_id = u.ulaz_id), 0)"
UKUPNO_SA_PDV = "COALESCE((SELECT SUM(s.kolicina * s.nabavna_cena_pdv) FROM stavka_ulaza s WHERE s.ulaz_id = u.ulaz_id), 0)"


def lista_ulaza(konekcija):
    upit = f"""
        SELECT u.ulaz_id, u.dobavljac_id, d.naziv AS dobavljac, u.racun_broj, u.racun_poziv_na_broj,
               u.ulaz_datum, u.otpremnica_broj, u.otpremnica_datum, u.valuta_datum, u.datum_vreme,
               (SELECT COUNT(*) FROM stavka_ulaza s WHERE s.ulaz_id = u.ulaz_id) AS broj_stavki,
               {UKUPNO_BEZ_PDV} AS ukupno_bez_pdv,
               {UKUPNO_SA_PDV} AS ukupno_sa_pdv
        FROM ulaz u JOIN dobavljac d ON d.dobavljac_id = u.dobavljac_id
        ORDER BY u.ulaz_id DESC
    """
    return [dict(r) for r in konekcija.execute(upit).fetchall()]


def jedan_ulaz(konekcija, ulaz_id):
    zaglavlje = konekcija.execute(f"""
        SELECT u.ulaz_id, u.dobavljac_id, d.naziv AS dobavljac, u.racun_broj, u.racun_poziv_na_broj,
               u.ulaz_datum, u.otpremnica_broj, u.otpremnica_datum, u.valuta_datum, u.datum_vreme,
               {UKUPNO_BEZ_PDV} AS ukupno_bez_pdv, {UKUPNO_SA_PDV} AS ukupno_sa_pdv
        FROM ulaz u JOIN dobavljac d ON d.dobavljac_id = u.dobavljac_id
        WHERE u.ulaz_id = ?""", (ulaz_id,)).fetchone()
    if not zaglavlje:
        return None
    stavke = konekcija.execute("""
        SELECT s.stavka_id, s.sifra_lokalna AS sifra, COALESCE(a.naziv, s.naziv_lokalni) AS naziv,
               a.jedinica_mere, s.sifra_dobavljac, s.kolicina, s.nabavna_cena, s.pdv, s.nabavna_cena_pdv
        FROM stavka_ulaza s LEFT JOIN artikal a ON a.sifra = s.sifra_lokalna
        WHERE s.ulaz_id = ? ORDER BY s.stavka_id""", (ulaz_id,)).fetchall()
    rezultat = dict(zaglavlje)
    rezultat["stavke"] = [dict(s) for s in stavke]
    return rezultat


# ---------- Izmena postojećeg ulaza ----------

def izmeni_zaglavlje(konekcija, ulaz_id, z):
    """z: IzmenaUlaza (main.py). Dobavljač se NE menja (artikli su vezani za njega)."""
    red = konekcija.execute("SELECT dobavljac_id FROM ulaz WHERE ulaz_id = ?", (ulaz_id,)).fetchone()
    if not red:
        raise BadInput("Taj ulaz ne postoji.", 404)
    zauzeto = zauzeti_dokumenti(konekcija, red["dobavljac_id"], z.racun_broj, z.otpremnica_broj, ulaz_id)
    if zauzeto:
        raise BadInput(" ".join(zauzeto), 409)
    konekcija.execute("""
        UPDATE ulaz SET racun_broj = ?, racun_poziv_na_broj = ?, ulaz_datum = ?,
                        otpremnica_broj = ?, otpremnica_datum = ?, valuta_datum = ?
        WHERE ulaz_id = ?""",
        (z.racun_broj, z.racun_poziv_na_broj, _datum(z.ulaz_datum),
         z.otpremnica_broj, _datum(z.otpremnica_datum), _datum(z.valuta_datum), ulaz_id))
    return red["dobavljac_id"]


def izmeni_stavku(konekcija, ulaz_id, dobavljac_id, s):
    """s: IzmenaStavke (main.py). Menja stavku i sve što od nje zavisi:

    - artikal.stanje: dodaje se razlika u količini
    - artikal.nabavna_cena_ponderisana: stari ulaz se "poništi" iz vrednosti zaliha, pa se
      upiše novi (vrednost = stanje × prosečna cena − stara količina × stara cena + nova × nova)
    - dobavljac_artikal: šifra kod dobavljača i poslednja cena/PDV
    Vraća True ako je nešto promenjeno.
    """
    stara = konekcija.execute("""
        SELECT sifra_lokalna, kolicina, nabavna_cena, pdv, sifra_dobavljac
        FROM stavka_ulaza WHERE stavka_id = ? AND ulaz_id = ?""", (s.stavka_id, ulaz_id)).fetchone()
    if not stara:
        raise BadInput(f"Stavka {s.stavka_id} ne pripada ovom ulazu.", 404)

    sifra = stara["sifra_lokalna"]
    promena_kolicine_cene = (stara["kolicina"] != s.kolicina or stara["nabavna_cena"] != s.nabavna_cena)
    promena_pdv = stara["pdv"] != s.pdv
    promena_sifre = (stara["sifra_dobavljac"] or None) != s.sifra_dobavljac
    if not (promena_kolicine_cene or promena_pdv or promena_sifre):
        return False

    if promena_kolicine_cene:
        artikal = konekcija.execute(
            "SELECT stanje, nabavna_cena_ponderisana FROM artikal WHERE sifra = ?", (sifra,)).fetchone()
        stanje, prosek = artikal["stanje"], artikal["nabavna_cena_ponderisana"]
        novo_stanje = stanje - stara["kolicina"] + s.kolicina
        if stanje > 0 and novo_stanje > 0:
            vrednost = stanje * prosek - stara["kolicina"] * stara["nabavna_cena"] + s.kolicina * s.nabavna_cena
            novi_prosek = vrednost / novo_stanje if vrednost >= 0 else s.nabavna_cena
        else:
            # Nema zaliha po kojima bi se računao prosek: važi cena iz ovog ulaza
            novi_prosek = s.nabavna_cena
        konekcija.execute(
            "UPDATE artikal SET stanje = ?, nabavna_cena_ponderisana = ? WHERE sifra = ?",
            (novo_stanje, novi_prosek, sifra))

    if promena_sifre and s.sifra_dobavljac:
        tudji = konekcija.execute("""
            SELECT a.sifra, a.naziv FROM dobavljac_artikal da JOIN artikal a ON a.sifra = da.sifra_artikal
            WHERE da.dobavljac_id = ? AND da.sifra_dobavljac = ? AND da.sifra_artikal != ?""",
            (dobavljac_id, s.sifra_dobavljac, sifra)).fetchone()
        if tudji:
            raise BadInput(
                f"Šifra dobavljača „{s.sifra_dobavljac}“ je već dodeljena artiklu {tudji['sifra']} "
                f"({tudji['naziv'] or 'bez naziva'}).", 409)

    konekcija.execute("""
        UPDATE stavka_ulaza SET kolicina = ?, nabavna_cena = ?, pdv = ?, sifra_dobavljac = ?
        WHERE stavka_id = ?""", (s.kolicina, s.nabavna_cena, s.pdv, s.sifra_dobavljac, s.stavka_id))

    if promena_sifre and s.sifra_dobavljac:
        konekcija.execute(
            "UPDATE dobavljac_artikal SET sifra_dobavljac = ? WHERE dobavljac_id = ? AND sifra_artikal = ?",
            (s.sifra_dobavljac, dobavljac_id, sifra))
    osvezi_cenu_veze(konekcija, dobavljac_id, sifra)
    return True


def osvezi_cenu_veze(konekcija, dobavljac_id, sifra_artikal):
    """Cena i PDV u vezi artikal-dobavljač = vrednosti iz POSLEDNJEG ulaza tog dobavljača."""
    poslednja = konekcija.execute("""
        SELECT s.nabavna_cena, s.pdv FROM stavka_ulaza s JOIN ulaz u ON u.ulaz_id = s.ulaz_id
        WHERE u.dobavljac_id = ? AND s.sifra_lokalna = ?
        ORDER BY s.ulaz_id DESC, s.stavka_id DESC LIMIT 1""", (dobavljac_id, sifra_artikal)).fetchone()
    if poslednja:
        konekcija.execute("""
            UPDATE dobavljac_artikal SET nabavna_cena_bez_pdv = ?, pdv = ?
            WHERE dobavljac_id = ? AND sifra_artikal = ?""",
            (poslednja["nabavna_cena"], poslednja["pdv"], dobavljac_id, sifra_artikal))
