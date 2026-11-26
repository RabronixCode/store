def sacuvaj_artikal(konekcija, a):
    veza = konekcija.cursor()
    bar_kod = None if a.bar_kod == "" else a.bar_kod
    upit = "INSERT INTO artikal (naziv, kategorija, bar_kod, stanje, minimalno_stanje, prodajna_cena, nabavna_cena_ponderisana, jedinica_mere, aktivan) VALUES (?,?,?,?,?,?,?,?,?)"
    vrednosti = (a.naziv, a.kategorija, bar_kod, 0, a.minimalno_stanje, a.prodajna_cena, 0, a.jedinica_mere, 1)
    veza.execute(upit, vrednosti)
    return veza.lastrowid

def sacuvaj_dobavljac_artikal(konekcija, sifra_artikal, sifra_dobavljac, dobavljac_id, naziv, nabavna_cena, pdv):
    veza = konekcija.cursor()
    upit = "INSERT INTO dobavljac_artikal (dobavljac_id, sifra_artikal, sifra_dobavljac, naziv, nabavna_cena_bez_pdv, pdv) VALUES (?,?,?,?,?,?)"
    vrednosti = (dobavljac_id, sifra_artikal, sifra_dobavljac, naziv, nabavna_cena, pdv)
    veza.execute(upit, vrednosti)

def azuriraj_stanje(konekcija, kolicina, sifra):
    veza = konekcija.cursor()
    upit = "UPDATE artikal SET stanje = stanje + ? WHERE sifra = ?"
    vrednosti = (kolicina, sifra)
    veza.execute(upit, vrednosti)

def azuriraj_ponderisanu_cenu(konekcija, sifra, kolicina, nabavna_cena):
    veza = konekcija.cursor()
    upit = "SELECT stanje, nabavna_cena_ponderisana FROM artikal WHERE sifra = ?"
    vrednosti = (sifra,)
    veza.execute(upit, vrednosti)

    red = veza.fetchone()
    stanje = red[0] if red else None
    nabavna_cena_ponderisana = red[1] if red else None

    # Posle prodaje stanje može biti 0 ili u minusu. Tada nema "stare" robe po staroj ceni,
    # pa se uzima cena iz ovog ulaza. (Bez ovoga: deljenje nulom kad je stanje = -kolicina,
    # ili pogrešna, čak negativna cena kad je stanje u minusu.)
    if stanje <= 0:
        nova_nabavna_cena = nabavna_cena
    else:
        nova_nabavna_cena = (stanje*nabavna_cena_ponderisana + kolicina*nabavna_cena)/(stanje+kolicina)

    upit = "UPDATE artikal SET nabavna_cena_ponderisana = ? WHERE sifra = ?"
    vrednosti = (nova_nabavna_cena, sifra)
    veza.execute(upit, vrednosti)

    azuriraj_stanje(konekcija, kolicina, sifra)

def prikazi_artikle(konekcija, text, limit):
    veza = konekcija.cursor()
    if int(limit) > 50:
        limit = 50
    if text == "":
        # Kasa vidi samo aktivne artikle (aktivan = 1)
        upit = "SELECT sifra, naziv, stanje, jedinica_mere, prodajna_cena FROM artikal WHERE aktivan = 1 ORDER BY sifra ASC, naziv ASC LIMIT ?"
        vrednosti = (limit,)
        veza.execute(upit, vrednosti)
        redovi  = [dict(red) for red in veza.fetchall()]
        return redovi
    pocinje = f"{text}%"  # "123%"  (Starts with)
    sadrzi = f"%{text}%"    # "%123%" (Contains anywhere)
    upit = "SELECT sifra, naziv, stanje, jedinica_mere, prodajna_cena FROM artikal WHERE aktivan = 1 AND (sifra LIKE ? OR naziv LIKE ?) ORDER BY CASE WHEN sifra = ? THEN 1 WHEN sifra LIKE ? THEN 2 WHEN sifra LIKE ? THEN 3 WHEN naziv LIKE ? THEN 4 ELSE 5 END, sifra ASC, naziv ASC LIMIT ?"
    vrednosti = (sadrzi, sadrzi, text, pocinje, sadrzi, pocinje, limit)
    veza.execute(upit, vrednosti)
    redovi  = [dict(red) for red in veza.fetchall()]
    return redovi

# ---------- Stranica "Artikli" (vlasnik) ----------

# Kolone koje vlasnik sme da menja direktno u tabeli. Sve ostalo (stanje, cene) menja se
# kroz ulaz robe i prodaju, ne ručno.
IZMENJIVE_KOLONE = ("naziv", "jedinica_mere", "kategorija", "bar_kod", "minimalno_stanje", "aktivan", "tarifa_id")

def svi_artikli(konekcija):
    veza = konekcija.cursor()
    upit = "SELECT sifra, naziv, kategorija, bar_kod, stanje, minimalno_stanje, prodajna_cena, nabavna_cena_ponderisana, jedinica_mere, aktivan, tarifa_id FROM artikal ORDER BY sifra ASC"
    veza.execute(upit)
    return [dict(red) for red in veza.fetchall()]

def jedan_artikal(konekcija, sifra):
    veza = konekcija.cursor()
    upit = "SELECT sifra, naziv, kategorija, bar_kod, stanje, minimalno_stanje, prodajna_cena, nabavna_cena_ponderisana, jedinica_mere, aktivan, tarifa_id FROM artikal WHERE sifra = ?"
    red = veza.execute(upit, (sifra,)).fetchone()
    return dict(red) if red else None

def izmeni_artikal(konekcija, sifra, izmene):
    """izmene: rečnik {kolona: nova_vrednost}, samo kolone iz IZMENJIVE_KOLONE."""
    kolone = [k for k in izmene if k in IZMENJIVE_KOLONE]
    if not kolone:
        return 0
    # Imena kolona dolaze iz našeg spiska (ne od korisnika), pa je f-string ovde bezbedan.
    postavi = ", ".join(f"{k} = ?" for k in kolone)
    vrednosti = [izmene[k] for k in kolone] + [sifra]
    veza = konekcija.cursor()
    veza.execute(f"UPDATE artikal SET {postavi} WHERE sifra = ?", vrednosti)
    return veza.rowcount

def dodaj_jedan_artikal(konekcija, naziv, kategorija, bar_kod, prodajna_cena, jedinica_mere, aktivan, minimalno_stanje=0,
                        tarifa_id=1):
    """Novi artikal uvek kreće sa stanjem 0 i nabavnom cenom 0 (to menja tek ulaz robe)."""
    veza = konekcija.cursor()
    upit = "INSERT INTO artikal (naziv, kategorija, bar_kod, stanje, minimalno_stanje, prodajna_cena, nabavna_cena_ponderisana, jedinica_mere, aktivan, tarifa_id) VALUES (?,?,?,?,?,?,?,?,?,?)"
    vrednosti = (naziv, kategorija, bar_kod, 0, minimalno_stanje, prodajna_cena, 0, jedinica_mere, aktivan, tarifa_id)
    veza.execute(upit, vrednosti)
    return veza.lastrowid

def artikal_postoji(konekcija, sifra):
    veza = konekcija.cursor()
    return veza.execute("SELECT 1 FROM artikal WHERE sifra = ?", (sifra,)).fetchone() is not None
