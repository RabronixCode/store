import sqlite3

konekcija = sqlite3.connect('prodavnica.db')
veza = konekcija.cursor()
veza.execute("PRAGMA foreign_keys = ON")
veza.executescript("""

DROP TABLE IF EXISTS stavka_racuna;
DROP TABLE IF EXISTS stavka_ulaza;
DROP TABLE IF EXISTS dobavljac_artikal;
DROP TABLE IF EXISTS racun;
DROP TABLE IF EXISTS ulaz;
DROP TABLE IF EXISTS sesija;
DROP TABLE IF EXISTS artikal;
DROP TABLE IF EXISTS dobavljac;
DROP TABLE IF EXISTS korisnik;
DROP TABLE IF EXISTS tarifa;


CREATE TABLE tarifa (
    tarifa_id INTEGER PRIMARY KEY CHECK (tarifa_id BETWEEN 0 AND 99),
    naziv TEXT NOT NULL,
    stopa REAL NOT NULL CHECK (stopa >= 0 AND stopa <= 100),
    vrsta TEXT NOT NULL CHECK (vrsta IN ('dobra', 'usluge'))
);
INSERT INTO tarifa (tarifa_id, naziv, stopa, vrsta) VALUES
    (0, 'Dobra bez PDV-a', 0, 'dobra'), (1, 'Dobra opšta stopa', 20, 'dobra'),
    (2, 'Dobra niža stopa', 10, 'dobra'), (3, 'Dobra poljop. otkup', 8, 'dobra'),
    (4, 'Dobra van PDV-a', 0, 'dobra'), (5, 'Usluge bez PDV-a', 0, 'usluge'),
    (6, 'Usluge opšta stopa', 20, 'usluge'), (7, 'Usluge niža stopa', 10, 'usluge'),
    (8, 'Usluge poljop. otkup', 8, 'usluge'), (9, 'Usluge van PDV-a', 0, 'usluge');

CREATE TABLE korisnik (
    korisnik_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    rola TEXT NOT NULL CHECK (rola IN ('vlasnik', 'kasir')),
    aktivan INTEGER NOT NULL DEFAULT 1 CHECK (aktivan IN (0, 1)),
    CONSTRAINT uq_username UNIQUE (username),
    CONSTRAINT uq_email UNIQUE (email)
);

CREATE TABLE sesija (
    sesija_id TEXT PRIMARY KEY,
    korisnik_id INTEGER NOT NULL,
    pocetak_sesije TEXT NOT NULL DEFAULT (datetime('now')),
    kraj_sesije TEXT NOT NULL,
    CONSTRAINT fk_korisnik FOREIGN KEY (korisnik_id) REFERENCES korisnik(korisnik_id)
);

CREATE TABLE dobavljac (
    dobavljac_id INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL
);

CREATE TABLE artikal (
    sifra INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL,
    kategorija TEXT,
    bar_kod TEXT,
    stanje REAL NOT NULL DEFAULT 0.000,
    minimalno_stanje REAL NOT NULL DEFAULT 0.000 CHECK (minimalno_stanje >= 0),
    prodajna_cena REAL NOT NULL DEFAULT 0.00 CHECK (prodajna_cena >= 0),
    nabavna_cena_ponderisana REAL NOT NULL DEFAULT 0.0000 CHECK (nabavna_cena_ponderisana >= 0),
    jedinica_mere TEXT NOT NULL,
    aktivan INTEGER NOT NULL DEFAULT 0 CHECK (aktivan IN (0,1))
);

CREATE TABLE dobavljac_artikal (
    dobavljac_id INTEGER NOT NULL,
    sifra_artikal INTEGER NOT NULL,
    sifra_dobavljac TEXT,                -- šifra kod dobavljača (može biti nepoznata)
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
    racun_broj TEXT,                     -- broj računa (ili otpremnice, bar jedno)
    racun_poziv_na_broj TEXT,
    ulaz_datum TEXT,                     -- datum računa
    otpremnica_broj TEXT,
    otpremnica_datum TEXT,
    valuta_datum TEXT,                   -- rok plaćanja
    datum_vreme TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),   -- kad je unet u program
    CONSTRAINT fk_ulaz_dobavljac FOREIGN KEY (dobavljac_id) REFERENCES dobavljac(dobavljac_id),
    CONSTRAINT uq_ulaz_racun UNIQUE (dobavljac_id, racun_broj),
    CONSTRAINT uq_ulaz_otpremnica UNIQUE (dobavljac_id, otpremnica_broj),
    CONSTRAINT ck_ulaz_dokument CHECK (racun_broj IS NOT NULL OR otpremnica_broj IS NOT NULL),
    CONSTRAINT ck_ulaz_datum CHECK (ulaz_datum IS NOT NULL OR otpremnica_datum IS NOT NULL)
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
    -- nabavna_cena = NETO (posle rabata), bez PDV; cena_pre_rabata = cena sa računa pre rabata
    cena_pre_rabata REAL CHECK (cena_pre_rabata >= 0),
    rabat_osnovni REAL NOT NULL DEFAULT 0 CHECK (rabat_osnovni >= 0 AND rabat_osnovni <= 100),
    rabat_posebni REAL NOT NULL DEFAULT 0 CHECK (rabat_posebni >= 0 AND rabat_posebni <= 100),
    rabat_dodatni REAL NOT NULL DEFAULT 0 CHECK (rabat_dodatni >= 0 AND rabat_dodatni <= 100),
    tarifa_id INTEGER REFERENCES tarifa(tarifa_id),
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






# Dobavljači: dodatne kolone, kontakti, tekući računi, radne jedinice i šifarnici (opštine, PTT, banke)
import migracija_dobavljaci_detalji
konekcija.isolation_level = None
migracija_dobavljaci_detalji.migriraj(konekcija)

# Tarifa (PDV) pripada artiklu
import migracija_tarifa_artikla
migracija_tarifa_artikla.migriraj(konekcija)
