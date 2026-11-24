def sacuvaj_racun(konekcija, korisnik):
    veza = konekcija.cursor()
    upit = "INSERT INTO racun (korisnik) VALUES (?)"
    veza.execute(upit, (korisnik,))
    racun_id = veza.lastrowid
    datum_vreme = veza.execute("SELECT datum_vreme FROM racun WHERE racun_id = ?", (racun_id,)).fetchone()[0]
    return racun_id, datum_vreme

def vrati_artikal_za_racun(konekcija, sifra):
    veza = konekcija.cursor()
    upit = "SELECT sifra, naziv, jedinica_mere, prodajna_cena, nabavna_cena_ponderisana, aktivan FROM artikal WHERE sifra = ?"
    return veza.execute(upit, (sifra,)).fetchone()

def sacuvaj_stavka_racuna(konekcija, racun_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu, nabavna_cena):
    veza = konekcija.cursor()
    upit = "INSERT INTO stavka_racuna (racun_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu, nabavna_cena) VALUES (?,?,?,?,?,?,?)"
    vrednosti = (racun_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu, nabavna_cena)
    veza.execute(upit, vrednosti)
