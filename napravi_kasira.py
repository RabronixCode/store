import sqlite3
from lozinke import hash_password

username = "kasir"
password = hash_password("sifra123")
email = "kasir@gmail.com"
rola = "kasir"
aktivan = 1

konekcija = sqlite3.connect('prodavnica.db')
cursor = konekcija.cursor()
upit = "INSERT INTO korisnik (username, password_hash, email, rola, aktivan) VALUES (?,?,?,?,?)"
vrednosti = (username, password, email, rola, aktivan)
cursor.execute(upit, vrednosti)
konekcija.commit()
konekcija.close()