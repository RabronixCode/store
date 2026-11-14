import sqlite3


def konektuj_se():
    konekcija = sqlite3.connect("C:\\Users\\PC\\Desktop\\Testing\\test2\\prodavnica.db")
    konekcija.execute("PRAGMA foreign_keys = ON")
    konekcija.commit()
    return konekcija
