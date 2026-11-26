from Errors.BadInput import BadInput




def sacuvaj_dobavljaca(konekcija, naziv):

    veza = konekcija.cursor()
    upit = "INSERT INTO dobavljac (naziv) VALUES (?)"
    vrednosti = (naziv,)
    veza.execute(upit, vrednosti)

# ---------- Stranica "Dobavljači" (vlasnik) ----------

def pregled_dobavljaca(konekcija):
    """Svi dobavljači sa brojem artikala, brojem ulaza i datumom poslednjeg ulaza."""
    veza = konekcija.cursor()
    upit = """
        SELECT d.dobavljac_id,
               d.naziv,
               (SELECT COUNT(*) FROM dobavljac_artikal da WHERE da.dobavljac_id = d.dobavljac_id) AS broj_artikala,
               (SELECT COUNT(*) FROM ulaz u WHERE u.dobavljac_id = d.dobavljac_id) AS broj_ulaza,
               (SELECT COALESCE(u.ulaz_datum, u.otpremnica_datum) FROM ulaz u WHERE u.dobavljac_id = d.dobavljac_id
                 ORDER BY u.ulaz_id DESC LIMIT 1) AS poslednji_ulaz
        FROM dobavljac d
        ORDER BY d.naziv COLLATE NOCASE
    """
    return [dict(red) for red in veza.execute(upit).fetchall()]

def jedan_dobavljac(konekcija, dobavljac_id):
    veza = konekcija.cursor()
    red = veza.execute("SELECT dobavljac_id, naziv FROM dobavljac WHERE dobavljac_id = ?", (dobavljac_id,)).fetchone()
    return dict(red) if red else None

def naziv_zauzet(konekcija, naziv, osim_id=None):
    """Da li drugi dobavljač već ima ovaj naziv (bez obzira na mala/velika slova)."""
    veza = konekcija.cursor()
    upit = "SELECT 1 FROM dobavljac WHERE naziv = ? COLLATE NOCASE AND dobavljac_id IS NOT ?"
    return veza.execute(upit, (naziv, osim_id)).fetchone() is not None

def promeni_naziv_dobavljaca(konekcija, dobavljac_id, naziv):
    veza = konekcija.cursor()
    veza.execute("UPDATE dobavljac SET naziv = ? WHERE dobavljac_id = ?", (naziv, dobavljac_id))
    return veza.rowcount

def artikli_dobavljaca(konekcija, dobavljac_id):
    """Svi artikli koje ovaj dobavljač isporučuje.

    Nabavna cena: iz POSLEDNJEG ulaza ovog dobavljača za taj artikal (poslednji unet,
    po ulaz_id, jer datum na računu može biti upisan pogrešno). Ako artikal još nije
    stigao kroz ulaz, uzima se cena iz dobavljac_artikal (upisana pri povezivanju).
    """
    veza = konekcija.cursor()
    upit = """
        WITH stavke AS (
            SELECT s.sifra_lokalna, s.ulaz_id, s.nabavna_cena, s.pdv, s.kolicina,
                   COALESCE(u.ulaz_datum, u.otpremnica_datum) AS datum_dokumenta,
                   CASE WHEN u.racun_broj IS NOT NULL THEN 'račun ' || u.racun_broj
                        ELSE 'otpremnica ' || u.otpremnica_broj END AS dokument,
                   ROW_NUMBER() OVER (PARTITION BY s.sifra_lokalna ORDER BY s.ulaz_id DESC, s.stavka_id DESC) AS rb
            FROM stavka_ulaza s
            JOIN ulaz u ON u.ulaz_id = s.ulaz_id
            WHERE u.dobavljac_id = ?
        ),
        zbir AS (
            SELECT sifra_lokalna, SUM(kolicina) AS ukupno_nabavljeno, COUNT(DISTINCT ulaz_id) AS broj_ulaza
            FROM stavke GROUP BY sifra_lokalna
        )
        SELECT a.sifra,
               a.naziv,
               da.sifra_dobavljac,
               a.jedinica_mere,
               a.stanje,
               a.prodajna_cena,
               a.nabavna_cena_ponderisana,
               a.aktivan,
               COALESCE(p.nabavna_cena, da.nabavna_cena_bez_pdv) AS nabavna_cena,
               COALESCE(p.pdv, da.pdv) AS pdv,
               p.datum_dokumenta AS poslednji_ulaz,
               p.dokument AS poslednji_dokument,
               COALESCE(z.ukupno_nabavljeno, 0) AS ukupno_nabavljeno,
               COALESCE(z.broj_ulaza, 0) AS broj_ulaza
        FROM dobavljac_artikal da
        JOIN artikal a ON a.sifra = da.sifra_artikal
        LEFT JOIN stavke p ON p.sifra_lokalna = da.sifra_artikal AND p.rb = 1
        LEFT JOIN zbir z ON z.sifra_lokalna = da.sifra_artikal
        WHERE da.dobavljac_id = ?
        ORDER BY a.sifra
    """
    redovi = [dict(red) for red in veza.execute(upit, (dobavljac_id, dobavljac_id)).fetchall()]
    for r in redovi:
        r["nabavna_cena_pdv"] = round(r["nabavna_cena"] * (1 + r["pdv"] / 100), 4)
    return redovi


# ---------- Svi podaci dobavljača (osnovno + kontakti, tekući računi, radne jedinice) ----------

KOLONE_DOBAVLJACA = [
    "tip", "pib", "naziv", "dugi_naziv", "vlasnik", "zemlja", "opstina", "ptt_broj", "adresa", "mesto",
    "maticni_broj", "broj_gazdinstva", "registarski_broj", "sifra_delatnosti", "pdv_zona", "pdv_obveznik",
    "e_faktura", "telefon", "fax", "el_dostava", "email", "web", "aktivan",
]

# vrsta -> (tabela, kolona ID-a, kolone koje se upisuju, redosled)
PODTABELE = {
    "kontakti": ("dobavljac_kontakt", "kontakt_id",
                 ["naziv", "telefon", "mobilni", "fax", "web", "email", "sluzba", "funkcija"], "naziv COLLATE NOCASE"),
    "racuni": ("dobavljac_racun", "racun_id",
               ["valuta", "banka_sifra", "banka_naziv", "broj_racuna", "kontrolni_broj", "dug_konto", "pot_konto"], "racun_id"),
    "jedinice": ("dobavljac_jedinica", "jedinica_id",
                 ["naziv", "adresa", "mesto", "ptt_broj", "gln", "dostava", "email", "aktivan"], "naziv COLLATE NOCASE"),
}


def pregled_dobavljaca_detaljno(konekcija):
    """Spisak za stranicu Dobavljači: osnovni podaci + broj artikala, broj ulaza, poslednji ulaz."""
    upit = """
        SELECT d.dobavljac_id, d.naziv, d.dugi_naziv, d.pib, d.tip, d.mesto, d.telefon, d.email, d.aktivan,
               (SELECT COUNT(*) FROM dobavljac_artikal da WHERE da.dobavljac_id = d.dobavljac_id) AS broj_artikala,
               (SELECT COUNT(*) FROM ulaz u WHERE u.dobavljac_id = d.dobavljac_id) AS broj_ulaza,
               (SELECT COALESCE(u.ulaz_datum, u.otpremnica_datum) FROM ulaz u WHERE u.dobavljac_id = d.dobavljac_id
                 ORDER BY u.ulaz_id DESC LIMIT 1) AS poslednji_ulaz
        FROM dobavljac d
        ORDER BY d.naziv COLLATE NOCASE
    """
    return [dict(r) for r in konekcija.execute(upit).fetchall()]


def dobavljac_ceo(konekcija, dobavljac_id):
    red = konekcija.execute(
        f"SELECT dobavljac_id, {', '.join(KOLONE_DOBAVLJACA)} FROM dobavljac WHERE dobavljac_id = ?",
        (dobavljac_id,)).fetchone()
    if not red:
        return None
    rezultat = dict(red)
    for vrsta, (tabela, kljuc, kolone, redosled) in PODTABELE.items():
        rezultat[vrsta] = [dict(r) for r in konekcija.execute(
            f"SELECT {kljuc} AS id, {', '.join(kolone)} FROM {tabela} WHERE dobavljac_id = ? ORDER BY {redosled}",
            (dobavljac_id,)).fetchall()]
    statistika = konekcija.execute("""
        SELECT (SELECT COUNT(*) FROM dobavljac_artikal WHERE dobavljac_id = ?) AS broj_artikala,
               (SELECT COUNT(*) FROM ulaz WHERE dobavljac_id = ?) AS broj_ulaza,
               (SELECT COALESCE(ulaz_datum, otpremnica_datum) FROM ulaz WHERE dobavljac_id = ?
                 ORDER BY ulaz_id DESC LIMIT 1) AS poslednji_ulaz""",
        (dobavljac_id, dobavljac_id, dobavljac_id)).fetchone()
    rezultat.update(dict(statistika))
    return rezultat


def _proveri_jedinstveno(konekcija, podaci, osim_id=None):
    if podaci["pib"] and konekcija.execute(
            "SELECT 1 FROM dobavljac WHERE pib = ? AND dobavljac_id IS NOT ?", (podaci["pib"], osim_id)).fetchone():
        raise BadInput(f"Dobavljač sa PIB-om {podaci['pib']} već postoji.", 409)
    if naziv_zauzet(konekcija, podaci["naziv"], osim_id):
        raise BadInput(f"Dobavljač „{podaci['naziv']}“ već postoji. Promeni kratki naziv.", 409)


def dodaj_dobavljaca(konekcija, podaci):
    """podaci: dict sa ključevima iz KOLONE_DOBAVLJACA (već provereni). Vraća novi ID."""
    _proveri_jedinstveno(konekcija, podaci)
    kolone = [k for k in KOLONE_DOBAVLJACA if k in podaci]
    kursor = konekcija.execute(
        f"INSERT INTO dobavljac ({', '.join(kolone)}) VALUES ({', '.join('?' for _ in kolone)})",
        [podaci[k] for k in kolone])
    return kursor.lastrowid


def izmeni_dobavljaca(konekcija, dobavljac_id, podaci):
    if not konekcija.execute("SELECT 1 FROM dobavljac WHERE dobavljac_id = ?", (dobavljac_id,)).fetchone():
        raise BadInput("Taj dobavljač ne postoji.", 404)
    _proveri_jedinstveno(konekcija, podaci, dobavljac_id)
    kolone = [k for k in KOLONE_DOBAVLJACA if k in podaci]
    konekcija.execute(
        f"UPDATE dobavljac SET {', '.join(f'{k} = ?' for k in kolone)} WHERE dobavljac_id = ?",
        [podaci[k] for k in kolone] + [dobavljac_id])
    # naziv se čuva i u vezi artikal-dobavljač (stari prikazi): ne menja se ovde, samo dobavljac.naziv


def dodaj_podstavku(konekcija, vrsta, dobavljac_id, podaci):
    tabela, kljuc, kolone, _ = PODTABELE[vrsta]
    if not konekcija.execute("SELECT 1 FROM dobavljac WHERE dobavljac_id = ?", (dobavljac_id,)).fetchone():
        raise BadInput("Taj dobavljač ne postoji.", 404)
    kursor = konekcija.execute(
        f"INSERT INTO {tabela} (dobavljac_id, {', '.join(kolone)}) VALUES (?, {', '.join('?' for _ in kolone)})",
        [dobavljac_id] + [podaci.get(k) for k in kolone])
    return kursor.lastrowid


def izmeni_podstavku(konekcija, vrsta, dobavljac_id, stavka_id, podaci):
    tabela, kljuc, kolone, _ = PODTABELE[vrsta]
    kursor = konekcija.execute(
        f"UPDATE {tabela} SET {', '.join(f'{k} = ?' for k in kolone)} WHERE {kljuc} = ? AND dobavljac_id = ?",
        [podaci.get(k) for k in kolone] + [stavka_id, dobavljac_id])
    if kursor.rowcount == 0:
        raise BadInput("Taj zapis ne postoji (možda je već obrisan).", 404)


def obrisi_podstavku(konekcija, vrsta, dobavljac_id, stavka_id):
    tabela, kljuc, _, _ = PODTABELE[vrsta]
    kursor = konekcija.execute(f"DELETE FROM {tabela} WHERE {kljuc} = ? AND dobavljac_id = ?", (stavka_id, dobavljac_id))
    if kursor.rowcount == 0:
        raise BadInput("Taj zapis ne postoji (možda je već obrisan).", 404)


def sifarnici(konekcija):
    return {
        "opstine": [dict(r) for r in konekcija.execute(
            "SELECT naziv, okrug, sifra, ptt FROM sif_opstina ORDER BY okrug, naziv").fetchall()],
        "ptt": [dict(r) for r in konekcija.execute("SELECT broj, mesto FROM sif_ptt ORDER BY broj, mesto").fetchall()],
        "banke": [dict(r) for r in konekcija.execute("SELECT sifra, naziv FROM sif_banka ORDER BY sifra").fetchall()],
    }


def naziv_banke(konekcija, sifra):
    red = konekcija.execute("SELECT naziv FROM sif_banka WHERE sifra = ?", (sifra,)).fetchone()
    return red[0] if red else None
