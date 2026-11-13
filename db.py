import sqlite3


def konektuj_se():
    konekcija = sqlite3.connect("prodavnica.db")
    konekcija.execute("PRAGMA foreign_keys = ON")
    konekcija.commit()
    return konekcija
