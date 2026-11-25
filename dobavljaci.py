

def sacuvaj_dobavljaca(konekcija, naziv):
    print("OVDE 2")
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
               (SELECT u.datum_vreme FROM ulaz u WHERE u.dobavljac_id = d.dobavljac_id
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
                   u.datum_vreme, u.racun_broj,
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
               p.datum_vreme AS poslednji_ulaz,
               p.racun_broj AS poslednji_racun,
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
