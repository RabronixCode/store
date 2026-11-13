def sacuvaj_ulaz(konekcija, dobavljac_id, racun_broj, racun_poziv_na_broj, datum_vreme):
    veza = konekcija.cursor()
    upit = "INSERT INTO ulaz (dobavljac_id, racun_broj, racun_poziv_na_broj, datum_vreme) VALUES (?,?,?,?)"
    vrednosti = (dobavljac_id, racun_broj, racun_poziv_na_broj, datum_vreme)
    veza.execute(upit, vrednosti)
    return veza.lastrowid

def proveri_postojanje(konekcija, sifra_dobavljac):
    veza = konekcija.cursor()
    upit = "SELECT sifra_artikal FROM dobavljac_artikal WHERE sifra_dobavljac = ?"
    vrednosti = (sifra_dobavljac,)
    veza.execute(upit, vrednosti)
    return veza.fetchone()

def sacuvaj_stavka_ulaza(konekcija, ulaz_id, dobavljac_id, stavka, sifra_lokalna):
    veza = konekcija.cursor()

    upit = "SELECT naziv FROM artikal WHERE sifra = ?"
    vrednosti = (sifra_lokalna,)
    veza.execute(upit, vrednosti)
    red = veza.fetchone()
    naziv_lokalni = red[0] if red else None

    upit = "INSERT INTO stavka_ulaza (ulaz_id, sifra_lokalna, sifra_dobavljac, naziv_lokalni, naziv_dobavljac, nabavna_cena, pdv, kolicina) VALUES (?,?,?,?,?,?,?,?)"
    vrednosti = (ulaz_id, sifra_lokalna, stavka['sifra'], naziv_lokalni, "NAZIV DOB", stavka['nabavna_cena'], stavka['pdv'], stavka['kolicina'])
    veza.execute(upit, vrednosti)