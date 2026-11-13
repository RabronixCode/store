def sacuvaj_artikal(konekcija, a):
    veza = konekcija.cursor()
    upit = "INSERT INTO artikal (naziv, kategorija, bar_kod, stanje, prodajna_cena, nabavna_cena_ponderisana, jedinica_mere, aktivan) VALUES (?,?,?,?,?,?,?,?)"
    vrednosti = (a.naziv, a.kategorija, a.bar_kod, a.stanje, a.prodajna_cena, a.nabavna_cena_ponderisana, a.jedinica_mere, a.aktivan)
    veza.execute(upit, vrednosti)
    return veza.lastrowid

def sacuvaj_dobavljac_artikal(konekcija, sifra_artikal, sifra_dobavljac, dobavljac_id, naziv, nabavna_cena_ponderisana, pdv):
    veza = konekcija.cursor()
    upit = "INSERT INTO dobavljac_artikal (dobavljac_id, sifra_artikal, sifra_dobavljac, naziv, nabavna_cena_bez_pdv, pdv) VALUES (?,?,?,?,?,?)"
    vrednosti = (dobavljac_id, sifra_artikal, sifra_dobavljac, naziv, nabavna_cena_ponderisana, pdv)
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

    nova_nabavna_cena = (stanje*nabavna_cena_ponderisana + kolicina*nabavna_cena)/(stanje+kolicina)

    upit = "UPDATE artikal SET nabavna_cena_ponderisana = ? WHERE sifra = ?"
    vrednosti = (nova_nabavna_cena, sifra)
    veza.execute(upit, vrednosti)

    azuriraj_stanje(konekcija, kolicina, sifra)
