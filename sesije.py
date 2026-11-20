def napravi_sesiju(konekcija, korisnik_id, sesija_id, pocetak_sesije, kraj_sesije):
    try:
        veza = konekcija.cursor()
        upit = "INSERT INTO sesija (sesija_id, korisnik_id, pocetak_sesije, kraj_sesije) VALUES (?,?,?,?)"
        vrednosti = (sesija_id, korisnik_id, pocetak_sesije, kraj_sesije)
        veza.execute(upit, vrednosti)
    except Exception:
        raise

def proveri_kolacic_vrati_rolu(konekcija, trenutna_sesija):
    veza = konekcija.cursor()
    upit = "SELECT k.rola FROM korisnik k INNER JOIN sesija s ON k.korisnik_id = s.korisnik_id WHERE s.sesija_id = ? AND k.aktivan = 1 AND s.kraj_sesije > datetime('now', 'localtime')"
    vrednosti = (trenutna_sesija,)
    rola = veza.execute(upit, vrednosti).fetchone()
    if rola:
        return rola[0]
    else:
        return False

def sesija_gotova(konekcija, trenutna_sesija, sada):
    veza = konekcija.cursor()
    upit = "UPDATE sesija SET kraj_sesije = ? WHERE sesija_id = ?"
    vrednosti = (sada, trenutna_sesija)
    veza.execute(upit, vrednosti)