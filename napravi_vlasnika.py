import sqlite3
from lozinke import hash_password

username = "vlasnik"
password = hash_password("sifra123")
email = "vlasnik@gmail.com"
rola = "vlasnik"
aktivan = 1

konekcija = sqlite3.connect('prodavnica.db')
cursor = konekcija.cursor()
upit = "INSERT INTO korisnik (username, password_hash, email, rola, aktivan) VALUES (?,?,?,?,?)"
vrednosti = (username, password, email, rola, aktivan)
cursor.execute(upit, vrednosti)
konekcija.commit()
konekcija.close()