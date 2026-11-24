"""Dodaje kolonu minimalno_stanje u tabelu artikal POSTOJEĆE baze, bez brisanja podataka.

napravi_bazu.py pravi bazu od nule (i briše sve), a ovo samo dopuni staru bazu.
Može da se pokrene više puta: ako kolona već postoji, ne radi ništa.

    python migracija_minimalno_stanje.py
"""

from db import konektuj_se

konekcija = konektuj_se()
kolone = [red[1] for red in konekcija.execute("PRAGMA table_info(artikal)")]

if "minimalno_stanje" in kolone:
    print("Kolona minimalno_stanje već postoji, nema izmena.")
else:
    konekcija.execute(
        "ALTER TABLE artikal ADD COLUMN minimalno_stanje REAL NOT NULL DEFAULT 0.000 "
        "CHECK (minimalno_stanje >= 0)"
    )
    konekcija.commit()
    print("Dodata kolona minimalno_stanje (svi postojeći artikli imaju 0).")

konekcija.close()
