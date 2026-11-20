def napravi_sesiju(konekcija, korisnik_id, sesija_id, pocetak_sesije, kraj_sesije):
    try:
        veza = konekcija.cursor()
        upit = "INSERT INTO sesija (sesija_id, korisnik_id, pocetak_sesije, kraj_sesije) VALUES (?,?,?,?)"
        vrednosti = (sesija_id, korisnik_id, pocetak_sesije, kraj_sesije)
        veza.execute(upit, vrednosti)
    except Exception:
        raise

def proveri_kolacic(konekcija, trenutna_sesija, sada):
    veza = konekcija.cursor()
    upit = "SELECT kraj_sesije FROM sesija WHERE sesija_id = ?"
    vrednosti = (trenutna_sesija,)
    kraj_sesije = veza.execute(upit, vrednosti).fetchone()
    zavrsetak_sesije = kraj_sesije[0] if kraj_sesije is not None else None
    if zavrsetak_sesije is None:
        return False
    elif zavrsetak_sesije < sada:
        return False
    else:
        return True

def vrati_rolu(konekcija, trenutna_sesija):
    veza = konekcija.cursor()
    upit = "SELECT rola FROM korisnik INNER JOIN sesija ON korisnik.korisnik_id = sesija.korisnik_id AND korisnik.aktivan = 1 WHERE sesija_id = ?"
    vrednosti = (trenutna_sesija,)
    podaci = veza.execute(upit, vrednosti).fetchone()
    if podaci is None:
        return False
    else:
        return podaci[0]

def sesija_gotova(konekcija, trenutna_sesija, sada):
    veza = konekcija.cursor()
    upit = "UPDATE sesija SET kraj_sesije = ? WHERE sesija_id = ?"
    vrednosti = (sada, trenutna_sesija)
    veza.execute(upit, vrednosti)