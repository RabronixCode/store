

def sacuvaj_korisnika(konekcija, ime, datum_rodjenja):
    veza = konekcija.cursor()
    upit = "INSERT INTO korisnici (ime, datum_rodjenja) VALUES (?, ?)"
    vrednosti = (ime, datum_rodjenja)
    veza.execute(upit, vrednosti)