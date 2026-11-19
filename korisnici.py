def proveri_korisnika(konekcija, k):
    veza = konekcija.cursor()
    upit = "SELECT korisnik_id, password_hash FROM korisnik WHERE username = ?"
    vrednosti = (k.username,)
    rezultat = veza.execute(upit, vrednosti).fetchall()
    return rezultat