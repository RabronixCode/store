import sqlite3

konekcija = sqlite3.connect('prodavnica.db')
veza = konekcija.cursor()
veza.execute("PRAGMA foreign_keys = ON")
veza.executescript("""

DROP TABLE IF EXISTS stavka_racuna;
DROP TABLE IF EXISTS dobavljac_artikal;
DROP TABLE IF EXISTS stavka_ulaza;
DROP TABLE IF EXISTS artikal;


DROP TABLE IF EXISTS ulaz;
DROP TABLE IF EXISTS dobavljac;
DROP TABLE IF EXISTS racun;



CREATE TABLE dobavljac (
    dobavljac_id INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL
);

CREATE TABLE artikal (
    sifra INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL,
    kategorija TEXT,
    bar_kod TEXT,
    stanje REAL NOT NULL DEFAULT 0.000 CHECK (stanje >= 0),
    prodajna_cena REAL NOT NULL DEFAULT 0.00 CHECK (prodajna_cena >= 0),
    nabavna_cena_ponderisana REAL NOT NULL DEFAULT 0.0000 CHECK (nabavna_cena_ponderisana >= 0),
    jedinica_mere TEXT NOT NULL,
    aktivan INTEGER NOT NULL DEFAULT 0 CHECK (aktivan IN (0,1)),
    CONSTRAINT uq_artikal_bar_kod UNIQUE (bar_kod)
);

CREATE TABLE dobavljac_artikal (
    dobavljac_id INTEGER NOT NULL,
    sifra_artikal INTEGER NOT NULL,
    sifra_dobavljac TEXT NOT NULL,
    naziv TEXT,
    nabavna_cena_bez_pdv REAL NOT NULL DEFAULT 0.0000 CHECK (nabavna_cena_bez_pdv >= 0),
    pdv REAL NOT NULL DEFAULT 20.00 CHECK (pdv >= 0),
    PRIMARY KEY (dobavljac_id, sifra_artikal),
    CONSTRAINT fk_dob_art_dobavljac FOREIGN KEY (dobavljac_id) REFERENCES dobavljac(dobavljac_id),
    CONSTRAINT fk_dob_art_artikal FOREIGN KEY (sifra_artikal) REFERENCES artikal(sifra),
    CONSTRAINT uq_dobavljac_sifra_dob UNIQUE (dobavljac_id, sifra_dobavljac)
);

CREATE TABLE ulaz (
    ulaz_id INTEGER PRIMARY KEY AUTOINCREMENT,
    dobavljac_id INTEGER NOT NULL,
    racun_broj TEXT NOT NULL,
    racun_poziv_na_broj TEXT,
    datum_vreme TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    CONSTRAINT fk_ulaz_dobavljac FOREIGN KEY (dobavljac_id) REFERENCES dobavljac(dobavljac_id),
    CONSTRAINT uq_ulaz_racun UNIQUE (dobavljac_id, racun_broj)
);

CREATE TABLE stavka_ulaza (
    stavka_id INTEGER PRIMARY KEY AUTOINCREMENT,
    ulaz_id INTEGER NOT NULL,
    sifra_lokalna INTEGER NOT NULL,
    sifra_dobavljac TEXT,
    naziv_lokalni TEXT,
    naziv_dobavljac TEXT,
    nabavna_cena REAL NOT NULL CHECK (nabavna_cena >= 0),
    pdv REAL NOT NULL CHECK (pdv >= 0),
    nabavna_cena_pdv REAL GENERATED ALWAYS AS (nabavna_cena * (1 + pdv / 100.0)) STORED,
    kolicina REAL NOT NULL CHECK (kolicina > 0),
    CONSTRAINT fk_stavka_ulaza_ulaz FOREIGN KEY (ulaz_id) REFERENCES ulaz(ulaz_id),
    CONSTRAINT fk_stavka_ulaza_artikal FOREIGN KEY (sifra_lokalna) REFERENCES artikal(sifra)
);

CREATE TABLE racun (
    racun_id INTEGER PRIMARY KEY AUTOINCREMENT,
    datum_vreme TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    korisnik TEXT NOT NULL
);

CREATE TABLE stavka_racuna (
    stavka_id INTEGER PRIMARY KEY AUTOINCREMENT,
    racun_id INTEGER NOT NULL,
    sifra INTEGER NOT NULL,
    naziv TEXT NOT NULL,
    jedinica_mere TEXT NOT NULL,
    kolicina REAL NOT NULL CHECK (kolicina > 0),
    cena_po_komadu REAL NOT NULL CHECK (cena_po_komadu >= 0),
    nabavna_cena REAL NOT NULL CHECK (nabavna_cena >= 0),
    CONSTRAINT fk_stavka_racuna_racun FOREIGN KEY (racun_id) REFERENCES racun(racun_id),
    CONSTRAINT fk_stavka_racuna_artikal FOREIGN KEY (sifra) REFERENCES artikal(sifra)
);
""")
konekcija.commit()





