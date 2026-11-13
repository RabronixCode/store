

def sacuvaj_dobavljaca(konekcija, naziv):
    print("OVDE 2")
    veza = konekcija.cursor()
    upit = "INSERT INTO dobavljac (naziv) VALUES (?)"
    vrednosti = (naziv,)
    veza.execute(upit, vrednosti)