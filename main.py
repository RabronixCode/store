import traceback

from fastapi import Cookie, Depends, FastAPI, File, Form, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response as OdgovorFajl
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator
from typing import Annotated
import sqlite3
from datetime import date, datetime, timedelta
import secrets
import unicodedata

from Errors.NotAdultError import NotAdultError
from Errors.DuplicateInputError import DuplicateInputError
from Errors.BadCredentials import BadCredentials
from Errors.ForbiddenAccess import ForbiddenAccess
from Errors.NotLoggedIn import NotLoggedIn
from Errors.BadInput import BadInput

from db import konektuj_se
from dobavljaci import sacuvaj_dobavljaca, pregled_dobavljaca, jedan_dobavljac, naziv_zauzet, promeni_naziv_dobavljaca, artikli_dobavljaca
from korisnici import proveri_korisnika
from ulazi import (pretrazi_artikle_za_ulaz, veza_sa_dobavljacem, zauzeti_dokumenti, sacuvaj_ulaz,
                   lista_ulaza, jedan_ulaz, izmeni_zaglavlje, izmeni_stavku, sve_tarife)
from artikli import prikazi_artikle, azuriraj_stanje
from artikli import svi_artikli, jedan_artikal, izmeni_artikal, dodaj_jedan_artikal
from lozinke import hash_password, verifikuj
from sesije import napravi_sesiju, sesija_gotova, proveri_kolacic_vrati_rolu
from racuni import sacuvaj_racun, vrati_artikal_za_racun, sacuvaj_stavka_racuna
import racuni as racuni_db
import izvoz as izvoz_db
from urllib.parse import quote as _url_quote
import finansije as finansije_db
from racun_pdf import izdaj_racun, izdaj_storno, FOLDER_PDF
import asistent
import dobavljaci as dobavljaci_db


# ---------- Dobavljači: osnovni podaci, kontakti, tekući računi, radne jedinice ----------
from typing import Literal
import re as _re


def _prazno_u_none(v):
    """'  ' -> None, ' x ' -> 'x'. Brojevi se prihvataju kao tekst."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    if isinstance(v, str):
        return v.strip() or None
    return v


def Tekst(duzina):
    return Annotated[str | None, StringConstraints(max_length=duzina)]


EMAIL = _re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _cifre(v, naziv, najmanje, najvise):
    if v is not None and not (v.isdigit() and najmanje <= len(v) <= najvise):
        duzina = f"{najmanje}" if najmanje == najvise else f"{najmanje} do {najvise}"
        raise ValueError(f"{naziv} mora imati {duzina} cifara (samo brojevi).")


def _email(v):
    if v is not None and not EMAIL.match(v):
        raise ValueError("E-mail nije ispravan (npr. ime@firma.rs).")


def pib_ispravan(pib):
    """Kontrolna cifra PIB-a (ISO 7064, MOD 11,10)."""
    s = 10
    for c in pib[:8]:
        t = (s + int(c)) % 10 or 10
        s = (2 * t) % 11
    return (11 - s) % 10 == int(pib[8])


def kontrolni_broj_racuna(banka, racun):
    """Domaći tekući račun: kontrolni broj = 98 - (banka + račun na 13 cifara + '00') mod 97."""
    return f"{98 - int(banka + racun.zfill(13)) * 100 % 97:02d}"


def rastavi_racun(tekst, banka=None, kb=None):
    """Domaći račun upisan od početka do kraja -> (banka, srednji deo, Kb ili None).
    Primaju se: 160-12345-95, 160-12345 (Kb se računa), 160000000001234595 (18 cifara),
    16012345 (bez Kb) i 1601234595 (poslednje dve cifre se uzimaju kao Kb samo ako su tačan Kb).
    Ista pravila su u dobavljac-forma.js (rastaviRacun)."""
    delovi = tekst.split("-")
    if len(delovi) in (2, 3):
        banka, broj = delovi[0], delovi[1]
        kb = delovi[2] if len(delovi) == 3 and delovi[2] else None
    elif len(delovi) != 1 or not tekst.isdigit():
        raise ValueError("Broj računa upiši kao 160-12345-95 (banka - račun - kontrolni broj).")
    elif banka:                          # banka poslata posebno: ovo je samo srednji deo
        broj = tekst
    elif len(tekst) == 18:
        banka, broj, kb = tekst[:3], tekst[3:16], tekst[16:]
    elif len(tekst) >= 4:
        banka, ostatak = tekst[:3], tekst[3:]
        sredina = ostatak[:-2]
        if 1 <= len(sredina) <= 13 and kontrolni_broj_racuna(banka, sredina) == ostatak[-2:]:
            broj, kb = sredina, ostatak[-2:]
        else:
            broj = ostatak
    else:
        raise ValueError("Broj računa je prekratak. Upiši ceo broj, npr. 160-12345-95.")
    _cifre(banka, "Šifra banke (prve 3 cifre računa)", 3, 3)
    if not banka:
        raise ValueError("Upiši ceo broj računa, sa šifrom banke na početku (npr. 160-12345-95).")
    _cifre(broj, "Srednji deo računa", 1, 13)
    return banka, broj, kb


class PodaciDobavljaca(BaseModel):
    """Sva polja su opciona osim PIB-a. Podrazumevane vrednosti su kao u formi za unos."""
    tip: Literal["P", "F", "R", "J", "L"] = "P"
    pib: Annotated[str, StringConstraints(max_length=30)]
    naziv: Tekst(100) = None                 # kratki naziv (prikazuje se svuda)
    dugi_naziv: Tekst(255) = None
    vlasnik: Tekst(100) = None
    zemlja: Tekst(100) = None
    opstina: Tekst(100) = "Mladenovac"
    ptt_broj: Tekst(10) = "11400"
    adresa: Tekst(255) = None
    mesto: Tekst(100) = None
    maticni_broj: Tekst(13) = None
    broj_gazdinstva: Tekst(30) = None
    registarski_broj: Tekst(50) = None
    sifra_delatnosti: Tekst(10) = None
    pdv_zona: Annotated[int, Field(ge=0, le=3)] = 0
    pdv_obveznik: bool = True
    e_faktura: bool = False                  # za sada se ne menja iz forme
    telefon: Tekst(50) = None
    fax: Tekst(50) = None
    el_dostava: bool = False
    email: Tekst(255) = None
    web: Tekst(255) = None
    aktivan: bool = True

    @field_validator("pib", "naziv", "dugi_naziv", "vlasnik", "zemlja", "opstina", "ptt_broj", "adresa", "mesto",
                     "maticni_broj", "broj_gazdinstva", "registarski_broj", "sifra_delatnosti", "telefon", "fax",
                     "email", "web", mode="before")
    @classmethod
    def _ocisti(cls, v):
        return _prazno_u_none(v)

    @model_validator(mode="after")
    def _pravila(self):
        if not self.pib:
            raise ValueError("PIB je obavezan.")
        pib = self.pib.replace(" ", "")
        if self.pdv_zona != 3:           # domaći dobavljač
            if not pib.isdigit() or len(pib) not in (9, 13):
                raise ValueError("PIB mora imati 9 cifara (ili 13 za fizičko lice: JMBG).")
            if len(pib) == 9 and not pib_ispravan(pib):
                raise ValueError(f"PIB {pib} nije ispravan (kontrolna cifra se ne slaže). Proveri unos.")
        self.pib = pib
        _cifre(self.maticni_broj, "Matični broj", 8, 13)
        _cifre(self.sifra_delatnosti, "Šifra delatnosti", 4, 5)
        _email(self.email)
        if not self.naziv:               # kratki naziv nije obavezan, ali je potreban za prikaz
            self.naziv = (self.dugi_naziv or f"PIB {self.pib}")[:100]
        return self


class KontaktDobavljaca(BaseModel):
    naziv: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    telefon: Tekst(50) = None
    mobilni: Tekst(50) = None
    fax: Tekst(50) = None
    web: Tekst(255) = None
    email: Tekst(255) = None
    sluzba: Tekst(100) = None
    funkcija: Tekst(100) = None

    @field_validator("telefon", "mobilni", "fax", "web", "email", "sluzba", "funkcija", mode="before")
    @classmethod
    def _ocisti(cls, v):
        return _prazno_u_none(v)

    @model_validator(mode="after")
    def _pravila(self):
        _email(self.email)
        return self


class RacunDobavljaca(BaseModel):
    valuta: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")] = "RSD"
    banka_sifra: Tekst(3) = None
    banka_naziv: Tekst(150) = None
    broj_racuna: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    kontrolni_broj: Tekst(2) = None
    dug_konto: Tekst(10) = "43500"
    pot_konto: Tekst(10) = "20410"

    @field_validator("banka_sifra", "banka_naziv", "kontrolni_broj", "dug_konto", "pot_konto", mode="before")
    @classmethod
    def _ocisti(cls, v):
        return _prazno_u_none(v)

    @model_validator(mode="after")
    def _pravila(self):
        broj = self.broj_racuna.replace(" ", "")
        if self.valuta == "RSD":         # domaći račun: 3 + do 13 + 2 cifre, kontrola mod 97
            self.banka_sifra, broj, self.kontrolni_broj = rastavi_racun(broj, self.banka_sifra, self.kontrolni_broj)
            broj = broj.zfill(13)
            tacan = kontrolni_broj_racuna(self.banka_sifra, broj)
            if self.kontrolni_broj is None:
                self.kontrolni_broj = tacan
            else:
                _cifre(self.kontrolni_broj, "Kontrolni broj", 2, 2)
                if self.kontrolni_broj != tacan:
                    raise ValueError(f"Kontrolni broj ne odgovara računu {self.banka_sifra}-{broj} "
                                     f"(treba {tacan}). Proveri broj računa.")
        self.broj_racuna = broj
        _cifre(self.dug_konto, "Dug konto", 3, 10)
        _cifre(self.pot_konto, "Pot konto", 3, 10)
        return self


class JedinicaDobavljaca(BaseModel):
    naziv: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
    adresa: Tekst(255) = None
    mesto: Tekst(100) = None
    ptt_broj: Tekst(10) = None
    gln: Tekst(13) = None
    dostava: bool = False
    email: Tekst(255) = None
    aktivan: bool = True

    @field_validator("adresa", "mesto", "ptt_broj", "gln", "email", mode="before")
    @classmethod
    def _ocisti(cls, v):
        return _prazno_u_none(v)

    @model_validator(mode="after")
    def _pravila(self):
        _cifre(self.gln, "GLN", 13, 13)
        _email(self.email)
        return self

TekstObavezan = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
TekstNeobavezan = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]

class NoviArtikal(BaseModel):
    naziv: TekstObavezan
    kategorija: TekstNeobavezan = ""
    bar_kod: TekstNeobavezan = ""
    prodajna_cena: Annotated[float, Field(ge=0)] = 0
    jedinica_mere: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]
    minimalno_stanje: Annotated[float, Field(ge=0)] = 0
    aktivan: bool = True
    tarifa_id: Annotated[int, Field(ge=0, le=99)] = 1   # PDV tarifa artikla (1 = dobra, opšta stopa 20%)

class IzmenaArtikla(BaseModel):
    # Šalje se samo polje koje se menja; ostala ostaju kakva jesu.
    naziv: TekstObavezan | None = None
    kategorija: TekstNeobavezan | None = None
    bar_kod: TekstNeobavezan | None = None
    jedinica_mere: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)] | None = None
    minimalno_stanje: Annotated[float, Field(ge=0)] | None = None
    aktivan: bool | None = None
    tarifa_id: Annotated[int, Field(ge=0, le=99)] | None = None

# ---------- Ulaz robe ----------

NAJRANIJI_DATUM = date(2000, 1, 1)
KratakTekst = Annotated[str, StringConstraints(max_length=100)]
Kolicina = Annotated[float, Field(gt=0, le=1_000_000, allow_inf_nan=False)]
Cena = Annotated[float, Field(ge=0, le=100_000_000, allow_inf_nan=False)]
Pdv = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
Rabat = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
TarifaId = Annotated[int, Field(ge=0, le=99)]


def _tekst_ili_none(v):
    """'  ' -> None, ' 123 ' -> '123'. Brojevi se prihvataju kao tekst."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    if isinstance(v, str):
        return v.strip() or None
    return v


class DokumentUlaza(BaseModel):
    """Zaglavlje ulaza: pravila važe i za novi ulaz i za izmenu postojećeg."""
    racun_broj: KratakTekst | None = None
    racun_poziv_na_broj: KratakTekst | None = None
    ulaz_datum: date | None = None            # datum računa
    otpremnica_broj: KratakTekst | None = None
    otpremnica_datum: date | None = None
    valuta_datum: date | None = None          # rok plaćanja

    @field_validator("racun_broj", "racun_poziv_na_broj", "otpremnica_broj", mode="before")
    @classmethod
    def _prazan_tekst(cls, v):
        return _tekst_ili_none(v)

    @field_validator("ulaz_datum", "otpremnica_datum", "valuta_datum", mode="before")
    @classmethod
    def _prazan_datum(cls, v):
        return None if v == "" else v

    @model_validator(mode="after")
    def _pravila_dokumenta(self):
        if not (self.racun_broj or self.otpremnica_broj):
            raise ValueError("Unesi broj računa ili broj otpremnice (bar jedno).")
        if not (self.ulaz_datum or self.otpremnica_datum):
            raise ValueError("Unesi datum računa ili datum otpremnice (bar jedan).")
        if self.racun_poziv_na_broj and not self.racun_broj:
            raise ValueError("Poziv na broj se odnosi na račun: unesi i broj računa.")
        danas = date.today()
        for ime, d in (("Datum računa", self.ulaz_datum), ("Datum otpremnice", self.otpremnica_datum)):
            if d and d > danas:
                raise ValueError(f"{ime} ne može biti u budućnosti.")
            if d and d < NAJRANIJI_DATUM:
                raise ValueError(f"{ime} je pre 2000. godine. Proveri unos.")
        if self.valuta_datum:
            najraniji = min(d for d in (self.ulaz_datum, self.otpremnica_datum) if d)
            if self.valuta_datum < najraniji:
                raise ValueError("Valuta (rok plaćanja) ne može biti pre datuma računa/otpremnice.")
        return self


class StavkaUlaza(BaseModel):
    # Tačno jedno od ova dva: postojeći artikal (naša šifra) ILI podaci za novi artikal
    sifra_artikal: Annotated[int, Field(gt=0)] | None = None
    novi_artikal: NoviArtikal | None = None
    sifra_dobavljac: Annotated[str, StringConstraints(max_length=50)] | None = None
    kolicina: Kolicina
    # Nabavna cena JEDNOG artikla bez PDV, PRE rabata (sa računa). Neto cenu (posle rabata) računa server.
    nabavna_cena: Cena
    rabat_osnovni: Rabat = 0
    rabat_posebni: Rabat = 0
    rabat_dodatni: Rabat = 0
    # Ne koristi se: tarifa (PDV) je tarifa artikla. Nov artikal: novi_artikal.tarifa_id. Ostaje radi starih klijenata.
    tarifa_id: TarifaId | None = None
    # Prodajna cena (sa PDV). Postojeći artikal: None = ne menja se. Nov artikal: None = 0.
    prodajna_cena: Cena | None = None

    @field_validator("sifra_dobavljac", mode="before")
    @classmethod
    def _prazna_sifra(cls, v):
        return _tekst_ili_none(v)

    @field_validator("prodajna_cena", mode="before")
    @classmethod
    def _prazna_prodajna(cls, v):
        return None if isinstance(v, str) and not v.strip() else v

    @model_validator(mode="after")
    def _artikal(self):
        if (self.sifra_artikal is None) == (self.novi_artikal is None):
            raise ValueError("izaberi postojeći artikal ili unesi podatke za novi artikal.")
        return self


class NoviUlaz(DokumentUlaza):
    dobavljac_id: Annotated[int, Field(gt=0)]
    stavke: Annotated[list[StavkaUlaza], Field(min_length=1, max_length=500)]

    @model_validator(mode="after")
    def _bez_duplikata(self):
        vidjeno = set()
        for i, st in enumerate(self.stavke, start=1):
            if st.sifra_artikal is not None:
                if st.sifra_artikal in vidjeno:
                    raise ValueError(f"Artikal {st.sifra_artikal} je unet više puta (stavka {i}). Spoji ih u jednu stavku.")
                vidjeno.add(st.sifra_artikal)
        sifre = [st.sifra_dobavljac for st in self.stavke if st.sifra_dobavljac]
        if len(sifre) != len(set(sifre)):
            raise ValueError("Ista šifra dobavljača je upisana u više stavki.")
        return self


class IzmenaStavke(BaseModel):
    stavka_id: Annotated[int, Field(gt=0)]
    sifra_dobavljac: Annotated[str, StringConstraints(max_length=50)] | None = None
    kolicina: Kolicina
    nabavna_cena: Cena                      # pre rabata, kao u StavkaUlaza
    rabat_osnovni: Rabat = 0
    rabat_posebni: Rabat = 0
    rabat_dodatni: Rabat = 0
    tarifa_id: TarifaId | None = None       # None = ostaje tarifa stavke

    @field_validator("sifra_dobavljac", mode="before")
    @classmethod
    def _prazna_sifra(cls, v):
        return _tekst_ili_none(v)


class IzmenaUlaza(DokumentUlaza):
    stavke: Annotated[list[IzmenaStavke], Field(max_length=500)] = []

    @model_validator(mode="after")
    def _bez_duplikata(self):
        ids = [st.stavka_id for st in self.stavke]
        if len(ids) != len(set(ids)):
            raise ValueError("Ista stavka je poslata dva puta.")
        return self


class Korisnik(BaseModel):
    username: str
    password: str

class StavkaKorpe(BaseModel):
    sifra: int
    kolicina: float

class Kupovina(BaseModel):
    stavke: list[StavkaKorpe]
    nacin_placanja: Literal["gotovina", "kartica", "cek"] = "gotovina"


class StavkaZaStorno(BaseModel):
    stavka_id: Annotated[int, Field(gt=0)]
    kolicina: Annotated[float, Field(gt=0, allow_inf_nan=False)] | None = None   # None = sve preostalo


class Storno(BaseModel):
    """Šta se stornira: celi računi i/ili pojedinačne stavke (artikli) sa računa."""
    racuni: Annotated[list[Annotated[int, Field(gt=0)]], Field(max_length=1000)] = []
    stavke: Annotated[list[StavkaZaStorno], Field(max_length=1000)] = []

    @model_validator(mode="after")
    def _nesto(self):
        if not self.racuni and not self.stavke:
            raise ValueError("Izaberi bar jedan račun ili artikal za storno.")
        return self


app = FastAPI()
app.frontend("/", directory="static", check_dir=True, fallback=None)


origins = [
    "http://localhost:8000"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def proveri_kes_statike(request: Request, call_next):
    """JS/CSS bez Cache-Control pregledač kešira po svom nahođenju, pa posle izmene ume da
    koristi stari .js uz novi .html (npr. prazan spisak tarifa). "no-cache" = sme da čuva,
    ali pre upotrebe uvek pita server (ETag), pa se izmena vidi odmah."""
    response = await call_next(request)
    if request.url.path.endswith((".js", ".css", ".html")) and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    return response

# @app.middleware("http")
# async def add_no_cache_headers(request: Request, call_next):
#     response = await call_next(request)
#     response.headers["Cache-Control"] = (
#         "no-store"
#     )
#     return response

def trenutni_korisnik(trenutna_sesija: str | None = Cookie(default=None)):
    if trenutna_sesija:
        konekcija = konektuj_se()
        rola = proveri_kolacic_vrati_rolu(konekcija, trenutna_sesija)
        if rola:
            return rola
        else:
            raise ForbiddenAccess()
    else:
        raise NotLoggedIn()
    # kolacic = proveri_kolacic(konekcija, trenutna_sesija, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    # print(kolacic, "KOLACIC")
    # if kolacic:
    #     rola = vrati_rolu(konekcija, trenutna_sesija)
    #     print(rola, "ROLA")
    #     if rola:
    #         return rola
    #     else:
    #         raise ForbiddenAccess()
    # else:
    #     raise ForbiddenAccess()



def samo_vlasnik(korisnik = Depends(trenutni_korisnik)):
    """Zavisnost za rute koje sme da koristi samo vlasnik (kasir dobija 403 / preusmerenje)."""
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return korisnik


# PREUSMERAVANJE

@app.get("/vlasnik/dobavljaci.html")
async def stranica_dobavljaci(korisnik = Depends(samo_vlasnik)):
    return FileResponse("vlasnik/dobavljaci.html", headers={"Cache-Control": "no-store"})

@app.get("/vlasnik/ulaz.html")
async def stranica_ulaz(korisnik = Depends(samo_vlasnik)):
    return FileResponse("vlasnik/ulaz.html", headers={"Cache-Control": "no-store"})

@app.get("/vlasnik/ulazi.html")
async def stranica_svi_ulazi(korisnik = Depends(samo_vlasnik)):
    return FileResponse("vlasnik/ulazi.html", headers={"Cache-Control": "no-store"})

@app.get("/vlasnik/dobavljac.html")
async def stranica_dobavljac(korisnik = Depends(trenutni_korisnik)):
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/dobavljac.html", headers={"Cache-Control": "no-store"})
    else:
        raise ForbiddenAccess()

@app.get("/vlasnik/artikli.html")
async def stranica_artikli(korisnik = Depends(trenutni_korisnik)):
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/artikli.html", headers={"Cache-Control": "no-store"})
    else:
        raise ForbiddenAccess()

@app.get("/pocetna.html")
async def stranica_pocetna(korisnik = Depends(trenutni_korisnik)):
    # Kasir nema početnu stranu: uvek ide na kasu
    if korisnik == 'kasir':
        return RedirectResponse('/kasa/kasa.html')
    return FileResponse("static/pocetna.html", headers={"Cache-Control": "no-store"})

@app.get("/vlasnik/finansije.html")
async def stranica_finansije(korisnik = Depends(samo_vlasnik)):
    return FileResponse("vlasnik/finansije.html", headers={"Cache-Control": "no-store"})

@app.get("/kasa/kasa.html")
async def stranica_kasa(korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'kasir':
        return RedirectResponse('/pocetna.html')
    return FileResponse("kasa/kasa.html", headers={"Cache-Control": "no-store"})

@app.get("/kasa/racuni.html")
async def stranica_izdati_racuni(korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'kasir':
        return RedirectResponse('/pocetna.html')
    return FileResponse("kasa/racuni.html", headers={"Cache-Control": "no-store"})
# RUTE

@app.get("/dobavljaci")
async def lista_dobavljaca(korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(lambda k: [dict(r) for r in k.execute(
        "SELECT dobavljac_id, naziv FROM dobavljac ORDER BY naziv COLLATE NOCASE").fetchall()])

# Stranica Dobavljači (samo vlasnik). Ostale rute za dobavljače su niže, u bloku "Dobavljači: detalji".

@app.get("/dobavljaci/pregled")
async def pregled_svih_dobavljaca(korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(dobavljaci_db.pregled_dobavljaca_detaljno)

@app.get("/dobavljaci/{dobavljac_id}/artikli")
async def artikli_jednog_dobavljaca(dobavljac_id: int, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    dobavljac = citaj_iz_baze(jedan_dobavljac, dobavljac_id)
    if not dobavljac:
        return JSONResponse(status_code=404, content="Taj dobavljač ne postoji.")
    return {"dobavljac": dobavljac, "artikli": citaj_iz_baze(artikli_dobavljaca, dobavljac_id)}

# Ulaz robe (samo vlasnik). Rute sa stalnim imenom idu PRE /ulazi/{ulaz_id}.

@app.get("/tarife")
async def tarife(korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(sve_tarife)

@app.get("/ulazi/artikli")
async def artikli_za_ulaz(q: Annotated[str, Query(max_length=100)] = "",
                          limit: Annotated[int, Query(ge=1, le=50)] = 50,
                          korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(pretrazi_artikle_za_ulaz, q, limit)

@app.get("/ulazi/veza")
async def veza_artikla_i_dobavljaca(dobavljac_id: Annotated[int, Query(gt=0)],
                                    sifra_artikal: Annotated[int | None, Query(gt=0)] = None,
                                    sifra_dobavljac: Annotated[str | None, Query(max_length=50)] = None,
                                    korisnik = Depends(samo_vlasnik)):
    if sifra_artikal is None and not (sifra_dobavljac or "").strip():
        raise BadInput("Zadaj našu šifru artikla ili šifru dobavljača.")
    return citaj_iz_baze(veza_sa_dobavljacem, dobavljac_id, sifra_artikal, (sifra_dobavljac or "").strip() or None)

@app.get("/ulazi/provera-dokumenta")
async def provera_dokumenta(dobavljac_id: Annotated[int, Query(gt=0)],
                            racun_broj: Annotated[str, Query(max_length=100)] = "",
                            otpremnica_broj: Annotated[str, Query(max_length=100)] = "",
                            osim_ulaz_id: Annotated[int | None, Query(gt=0)] = None,
                            korisnik = Depends(samo_vlasnik)):
    poruke = citaj_iz_baze(zauzeti_dokumenti, dobavljac_id,
                           racun_broj.strip() or None, otpremnica_broj.strip() or None, osim_ulaz_id)
    return {"poruke": poruke}

@app.post("/ulazi")
async def kreiraj_ulaz(ulaz: NoviUlaz, korisnik = Depends(samo_vlasnik)):
    ulaz_id = pisi_u_bazu(sacuvaj_ulaz, ulaz)
    return {"ulaz_id": ulaz_id}

@app.get("/ulazi")
async def svi_ulazi(korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(lista_ulaza)

@app.get("/ulazi/{ulaz_id}")
async def jedan_ulaz_detalji(ulaz_id: int, korisnik = Depends(samo_vlasnik)):
    ulaz = citaj_iz_baze(jedan_ulaz, ulaz_id)
    if not ulaz:
        raise BadInput("Taj ulaz ne postoji.", 404)
    return ulaz

@app.put("/ulazi/{ulaz_id}")
async def izmeni_ulaz(ulaz_id: int, izmena: IzmenaUlaza, korisnik = Depends(samo_vlasnik)):
    return pisi_u_bazu(sacuvaj_izmene_ulaza, ulaz_id, izmena)

@app.get('/artikli')
async def pretrazi_artikle(q: Annotated[str, Query(max_length=100)] = "",
                           limit: Annotated[int, Query(ge=1, le=50)] = 50,
                           korisnik = Depends(trenutni_korisnik)):
    return vrati_artikle(q, limit)

# Stranica Artikli (samo vlasnik)

@app.get('/artikli/svi')
async def lista_svih_artikala(korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return vrati_sve_artikle()

@app.post('/artikli')
async def kreiraj_jedan_artikal(artikal: NoviArtikal, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return unesi_jedan_artikal(artikal)

@app.patch('/artikli/{sifra}')
async def promeni_artikal(sifra: int, izmena: IzmenaArtikla, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return sacuvaj_izmenu_artikla(sifra, izmena)

# ---------- Dobavljači: detalji (samo vlasnik) ----------
# Osnovni podaci + tri vezane tabele (kontakti, tekući računi, radne jedinice).

@app.get("/sifarnici")
async def sifarnici_dobavljaca(korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(dobavljaci_db.sifarnici)

@app.post("/dobavljaci")
async def kreiraj_dobavljaca(podaci: PodaciDobavljaca, korisnik = Depends(samo_vlasnik)):
    novi_id = pisi_u_bazu(dobavljaci_db.dodaj_dobavljaca, podaci.model_dump())
    return citaj_iz_baze(dobavljaci_db.dobavljac_ceo, novi_id)

@app.get("/dobavljaci/{dobavljac_id}")
async def jedan_dobavljac_ceo(dobavljac_id: int, korisnik = Depends(samo_vlasnik)):
    d = citaj_iz_baze(dobavljaci_db.dobavljac_ceo, dobavljac_id)
    if not d:
        raise BadInput("Taj dobavljač ne postoji.", 404)
    return d

@app.put("/dobavljaci/{dobavljac_id}")
async def izmeni_dobavljaca_ceo(dobavljac_id: int, podaci: PodaciDobavljaca, korisnik = Depends(samo_vlasnik)):
    pisi_u_bazu(dobavljaci_db.izmeni_dobavljaca, dobavljac_id, podaci.model_dump())
    return citaj_iz_baze(dobavljaci_db.dobavljac_ceo, dobavljac_id)


def _podaci_racuna(konekcija, r):
    """Naziv banke iz šifarnika za domaći račun (ako nije upisan ručno)."""
    podaci = r.model_dump()
    if podaci["valuta"] == "RSD" and podaci["banka_sifra"]:
        podaci["banka_naziv"] = dobavljaci_db.naziv_banke(konekcija, podaci["banka_sifra"]) or podaci["banka_naziv"]
    return podaci


def _dodaj(vrsta, dobavljac_id, podaci):
    def upis(konekcija):
        p = _podaci_racuna(konekcija, podaci) if vrsta == "racuni" else podaci.model_dump()
        return dobavljaci_db.dodaj_podstavku(konekcija, vrsta, dobavljac_id, p)
    pisi_u_bazu(upis)
    return citaj_iz_baze(dobavljaci_db.dobavljac_ceo, dobavljac_id)


def _izmeni(vrsta, dobavljac_id, stavka_id, podaci):
    def upis(konekcija):
        p = _podaci_racuna(konekcija, podaci) if vrsta == "racuni" else podaci.model_dump()
        dobavljaci_db.izmeni_podstavku(konekcija, vrsta, dobavljac_id, stavka_id, p)
    pisi_u_bazu(upis)
    return citaj_iz_baze(dobavljaci_db.dobavljac_ceo, dobavljac_id)


def _obrisi(vrsta, dobavljac_id, stavka_id):
    pisi_u_bazu(dobavljaci_db.obrisi_podstavku, vrsta, dobavljac_id, stavka_id)
    return citaj_iz_baze(dobavljaci_db.dobavljac_ceo, dobavljac_id)


@app.post("/dobavljaci/{dobavljac_id}/kontakti")
async def dodaj_kontakt(dobavljac_id: int, podaci: KontaktDobavljaca, korisnik = Depends(samo_vlasnik)):
    return _dodaj("kontakti", dobavljac_id, podaci)

@app.put("/dobavljaci/{dobavljac_id}/kontakti/{stavka_id}")
async def izmeni_kontakt(dobavljac_id: int, stavka_id: int, podaci: KontaktDobavljaca, korisnik = Depends(samo_vlasnik)):
    return _izmeni("kontakti", dobavljac_id, stavka_id, podaci)

@app.delete("/dobavljaci/{dobavljac_id}/kontakti/{stavka_id}")
async def obrisi_kontakt(dobavljac_id: int, stavka_id: int, korisnik = Depends(samo_vlasnik)):
    return _obrisi("kontakti", dobavljac_id, stavka_id)

@app.post("/dobavljaci/{dobavljac_id}/racuni")
async def dodaj_racun(dobavljac_id: int, podaci: RacunDobavljaca, korisnik = Depends(samo_vlasnik)):
    return _dodaj("racuni", dobavljac_id, podaci)

@app.put("/dobavljaci/{dobavljac_id}/racuni/{stavka_id}")
async def izmeni_racun(dobavljac_id: int, stavka_id: int, podaci: RacunDobavljaca, korisnik = Depends(samo_vlasnik)):
    return _izmeni("racuni", dobavljac_id, stavka_id, podaci)

@app.delete("/dobavljaci/{dobavljac_id}/racuni/{stavka_id}")
async def obrisi_racun(dobavljac_id: int, stavka_id: int, korisnik = Depends(samo_vlasnik)):
    return _obrisi("racuni", dobavljac_id, stavka_id)

@app.post("/dobavljaci/{dobavljac_id}/jedinice")
async def dodaj_jedinicu(dobavljac_id: int, podaci: JedinicaDobavljaca, korisnik = Depends(samo_vlasnik)):
    return _dodaj("jedinice", dobavljac_id, podaci)

@app.put("/dobavljaci/{dobavljac_id}/jedinice/{stavka_id}")
async def izmeni_jedinicu(dobavljac_id: int, stavka_id: int, podaci: JedinicaDobavljaca, korisnik = Depends(samo_vlasnik)):
    return _izmeni("jedinice", dobavljac_id, stavka_id, podaci)

@app.delete("/dobavljaci/{dobavljac_id}/jedinice/{stavka_id}")
async def obrisi_jedinicu(dobavljac_id: int, stavka_id: int, korisnik = Depends(samo_vlasnik)):
    return _obrisi("jedinice", dobavljac_id, stavka_id)


# ---------- AI asistent (samo vlasnik) ----------
# Rute su obične (def, ne async def): poziv modela traje, pa ih FastAPI izvršava u posebnoj niti.

@app.post("/asistent/poruka")
def asistent_poruka(tekst: Annotated[str, Form(max_length=4000)] = "",
                    fajlovi: Annotated[list[UploadFile], File()] = [],
                    trenutna_sesija: str | None = Cookie(default=None),
                    korisnik = Depends(samo_vlasnik)):
    if len(fajlovi) > asistent.MAX_PRILOGA:
        raise BadInput(f"Najviše {asistent.MAX_PRILOGA} priloga odjednom.")
    prilozi = []
    for f in fajlovi:
        sadrzaj = f.file.read(asistent.MAX_VELICINA_PRILOGA + 1)
        prilozi.append(asistent.pripremi_prilog(f.filename or "prilog", f.content_type, sadrzaj))
    return asistent.posalji_poruku(trenutna_sesija, tekst, prilozi)

@app.post("/asistent/novi")
def asistent_novi(trenutna_sesija: str | None = Cookie(default=None), korisnik = Depends(samo_vlasnik)):
    asistent.novi_razgovor(trenutna_sesija)
    return True

@app.get("/asistent/fajl/{ime}")
def asistent_fajl(ime: str, korisnik = Depends(samo_vlasnik)):
    putanja = asistent.putanja_izvestaja(ime)
    if not putanja:
        raise BadInput("Taj fajl ne postoji (možda je obrisan).", 404)
    return FileResponse(putanja, filename=ime, headers={"Cache-Control": "no-store"},
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

@app.get("/asistent/nacrt/{token}")
def asistent_nacrt(token: str, trenutna_sesija: str | None = Cookie(default=None),
                   korisnik = Depends(samo_vlasnik)):
    podaci = asistent.procitaj_nacrt(token, trenutna_sesija)
    if podaci is None:
        raise BadInput("Nacrt ulaza ne postoji ili je istekao. Pošalji dokument asistentu ponovo.", 404)
    return podaci

@app.post('/racuni')
async def kreiraj_racun(kupovina: Kupovina, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'kasir':
        raise ForbiddenAccess()
    return unesi_racun(kupovina, korisnik)

# ---------- Izdati računi i storno (kasir i vlasnik) ----------

def kasir_ili_vlasnik(korisnik = Depends(trenutni_korisnik)):
    if korisnik not in ('kasir', 'vlasnik'):
        raise ForbiddenAccess()
    return korisnik

def _granica_perioda(tekst, kraj):
    """'2026-11-26T08:30' -> '2026-11-26 08:30:00' (početak) ili '... 08:30:59' (kraj, minut je uključen).
    Prazno: danas od 00:00 do 23:59."""
    if not tekst:
        return date.today().isoformat() + (" 23:59:59" if kraj else " 00:00:00")
    try:
        d = datetime.fromisoformat(tekst)
    except ValueError:
        raise BadInput(f"Neispravan datum i vreme: {tekst}", 400)
    return d.strftime("%Y-%m-%d %H:%M:") + ("59" if kraj else "00")

@app.get('/racuni')
async def izdati_racuni(od: Annotated[str, Query(max_length=30)] = "",
                        do: Annotated[str, Query(max_length=30)] = "",
                        korisnik = Depends(kasir_ili_vlasnik)):
    pocetak, kraj = _granica_perioda(od, False), _granica_perioda(do, True)
    if pocetak > kraj:
        raise BadInput("Početak perioda je posle kraja. Proveri datume „od“ i „do“.", 400)
    return citaj_iz_baze(racuni_db.lista_racuna, pocetak, kraj)

@app.get('/racuni/{racun_id}')
async def jedan_izdat_racun(racun_id: int, korisnik = Depends(kasir_ili_vlasnik)):
    racun = citaj_iz_baze(racuni_db.jedan_racun, racun_id)
    if not racun:
        raise BadInput(f"Račun br. {racun_id} ne postoji.", 404)
    return racun

@app.get('/racuni/{racun_id}/pdf')
async def pdf_racuna(racun_id: int, korisnik = Depends(kasir_ili_vlasnik)):
    putanja = FOLDER_PDF / f"racun_{racun_id}.pdf"
    if not putanja.exists():            # npr. PDF nije napravljen pri prodaji: napravi ga sada
        r = citaj_iz_baze(racuni_db.racun_za_pdf, racun_id)
        if not r:
            raise BadInput(f"Račun br. {racun_id} ne postoji.", 404)
        putanja = izdaj_racun(r["racun_id"], r["datum_vreme"], r["korisnik"], r["stavke"], r["nacin_placanja"])
    return FileResponse(putanja, media_type="application/pdf", filename=putanja.name,
                        content_disposition_type="inline")

@app.post('/storna')
async def napravi_storno(storno: Storno, korisnik = Depends(kasir_ili_vlasnik)):
    stavke = [(s.stavka_id, s.kolicina) for s in storno.stavke]
    storno_id = pisi_u_bazu(racuni_db.storniraj, korisnik, storno.racuni, stavke)
    podaci = citaj_iz_baze(racuni_db.storno_za_pdf, storno_id)
    try:                                # storno je već upisan; ako PDF ne uspe, pravi se kad se otvori
        izdaj_storno(podaci)
    except Exception as e:
        print(type(e).__name__, e)
        traceback.print_exc()
    return {"storno_id": storno_id, "pdf": f"/storna/{storno_id}/pdf", "ukupno": podaci["ukupno"],
            "po_nacinu": podaci["po_nacinu"], "broj_stavki": len(podaci["stavke"]),
            "racuni": sorted({s["racun_id"] for s in podaci["stavke"]})}

# ---------- Finansije (samo vlasnik) ----------

Tekst = Annotated[str, Query(max_length=100)]

def _datum_granica(tekst, kraj):
    """'2026-11-27' -> '2026-11-27 00:00:00' ili '2026-11-27 23:59:59'. Prazno: danas."""
    try:
        d = date.fromisoformat(tekst) if tekst else date.today()
    except ValueError:
        raise BadInput(f"Neispravan datum: {tekst}", 400)
    return d.isoformat() + (" 23:59:59" if kraj else " 00:00:00")

def _period(pocetak, kraj):
    if pocetak > kraj:
        raise BadInput("Početak perioda je posle kraja. Proveri „od“ i „do“.", 400)
    return pocetak, kraj

# ---------- Izvoz tabela u Excel (svaki prijavljen korisnik; podatke šalje stranica) ----------

Celija = str | int | float | dict | None

class IzvozTabele(BaseModel):
    naslov: Annotated[str, StringConstraints(max_length=200)] = "Tabela"
    opis: Annotated[str, StringConstraints(max_length=500)] = ""
    izvezeno: Annotated[str, StringConstraints(max_length=40)] = ""
    kolone: Annotated[list[Annotated[str, StringConstraints(max_length=200)]], Field(min_length=1, max_length=80)]
    redovi: Annotated[list[Annotated[list[Celija], Field(max_length=80)]], Field(max_length=50_000)]
    zbir: Annotated[list[Annotated[list[Celija], Field(max_length=80)]], Field(max_length=20)] = []

@app.post('/izvoz/xlsx')
async def izvoz_xlsx(podaci: IzvozTabele, korisnik = Depends(trenutni_korisnik)):
    sadrzaj = izvoz_db.napravi_xlsx(podaci.naslov, podaci.opis, podaci.kolone, podaci.redovi, podaci.zbir, podaci.izvezeno)
    ime = f"{podaci.naslov or 'tabela'}.xlsx"
    ascii_ime = "".join(z if z.isascii() and (z.isalnum() or z in "._- ") else "_" for z in ime)
    return OdgovorFajl(sadrzaj, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       headers={"Content-Disposition": f"attachment; filename=\"{ascii_ime}\"; filename*=UTF-8''{_url_quote(ime)}"})

@app.get('/finansije/filteri')
async def finansije_filteri(korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(finansije_db.filteri)

@app.get('/finansije/artikli')
async def finansije_artikli(od: Tekst = "", do: Tekst = "", artikal: Tekst = "", kategorija: Tekst = "",
                            nacin: Tekst = "", dobavljac_id: Annotated[int | None, Query(gt=0)] = None,
                            korisnik = Depends(samo_vlasnik)):
    p = _period(_granica_perioda(od, False), _granica_perioda(do, True))
    stavke = citaj_iz_baze(finansije_db.stavke_prodaje, *p, artikal, dobavljac_id, kategorija, nacin)
    return {"od": p[0], "do": p[1], **finansije_db.po_artiklima(stavke)}

@app.get('/finansije/dani')
async def finansije_dani(od: Tekst = "", do: Tekst = "", artikal: Tekst = "", korisnik = Depends(samo_vlasnik)):
    p = _period(_datum_granica(od, False), _datum_granica(do, True))
    stavke = citaj_iz_baze(finansije_db.stavke_prodaje, *p, artikal)
    return {"od": p[0], "do": p[1], **finansije_db.po_danima(stavke)}

@app.get('/finansije/dan')
async def finansije_dan(datum: Tekst, artikal: Tekst = "", korisnik = Depends(samo_vlasnik)):
    p = (_datum_granica(datum, False), _datum_granica(datum, True))
    stavke = citaj_iz_baze(finansije_db.stavke_prodaje, *p, artikal)
    return {"datum": p[0][:10], **finansije_db.po_artiklima(stavke), **{"po_nacinu": finansije_db.po_danima(stavke)["zbir"]}}

@app.get('/finansije/dobavljaci')
async def finansije_dobavljaci(od: Tekst = "", do: Tekst = "", artikal: Tekst = "",
                               dobavljac_id: Annotated[int | None, Query(gt=0)] = None,
                               korisnik = Depends(samo_vlasnik)):
    p = _period(_granica_perioda(od, False), _granica_perioda(do, True))
    stavke = citaj_iz_baze(finansije_db.stavke_prodaje, *p, artikal, dobavljac_id)
    return {"od": p[0], "do": p[1], **finansije_db.po_dobavljacima(stavke)}

@app.get('/finansije/bilans')
async def finansije_bilans(od: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")] = "",
                           do: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")] = "",
                           artikal: Tekst = "", korisnik = Depends(samo_vlasnik)):
    danas = date.today()
    od = od or f"{danas.year}-01"
    do = do or f"{danas.year}-{danas.month:02d}"
    if od > do:
        raise BadInput("Početni mesec je posle krajnjeg.", 400)
    g, m = map(int, do.split("-"))
    if not (1 <= m <= 12 and 1 <= int(od[5:]) <= 12):
        raise BadInput("Neispravan mesec.", 400)
    poslednji = (date(g + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).isoformat()
    stavke = citaj_iz_baze(finansije_db.stavke_prodaje, f"{od}-01 00:00:00", f"{poslednji} 23:59:59", artikal)
    return {"od": od, "do": do, **finansije_db.bilans(stavke, od, do, danas)}

@app.get('/storna/{storno_id}/pdf')
async def pdf_storna(storno_id: int, korisnik = Depends(kasir_ili_vlasnik)):
    putanja = FOLDER_PDF / f"storno_{storno_id}.pdf"
    if not putanja.exists():
        podaci = citaj_iz_baze(racuni_db.storno_za_pdf, storno_id)
        if not podaci:
            raise BadInput(f"Storno br. {storno_id} ne postoji.", 404)
        putanja = izdaj_storno(podaci)
    return FileResponse(putanja, media_type="application/pdf", filename=putanja.name,
                        content_disposition_type="inline")

@app.post('/login')
async def proveri_login(korisnik: Korisnik, response: Response):
    sesija_id = korisnik_postoji(korisnik)
    if sesija_id:
        response.set_cookie(
            key="trenutna_sesija",
            value=sesija_id,
            httponly=True,
            samesite="lax",
            max_age=28800,
            secure=False #ovo mora da se promeni u produkciji
        )
        return "AAAA"

@app.get('/logout')
async def odjavi_se(request: Request, response: Response):
    zavrsi_sesiju(request.cookies.get('trenutna_sesija'))
    response.delete_cookie(key="trenutna_sesija")
    
    return True

# @app.get('/ja')
# async def autentikacija(request: Request):
#     proveri_autentikaciju(request)

# EXCEPTION-i

@app.exception_handler(BadInput)
def obradjivac_losog_unosa(request, e: BadInput):
    return JSONResponse(status_code=e.status, content=e.message)

# Greške provere podataka (pydantic) pretvaramo u jednu čitljivu rečenicu na srpskom,
# npr. "Stavka 2, količina: mora biti veće od 0."
NAZIVI_POLJA = {
    "dobavljac_id": "dobavljač", "racun_broj": "broj računa", "racun_poziv_na_broj": "poziv na broj",
    "ulaz_datum": "datum računa", "otpremnica_broj": "broj otpremnice", "otpremnica_datum": "datum otpremnice",
    "valuta_datum": "valuta", "stavke": "stavke", "sifra_artikal": "artikal", "sifra_dobavljac": "šifra dobavljača",
    "kolicina": "količina", "nabavna_cena": "nabavna cena", "pdv": "PDV",
    "rabat_osnovni": "rabat osnovni", "rabat_posebni": "rabat posebni", "rabat_dodatni": "rabat dodatni",
    "tarifa_id": "tarifa", "novi_artikal": "novi artikal", "nacin_placanja": "način plaćanja",
    "racuni": "računi",
    "naziv": "naziv", "jedinica_mere": "jedinica mere", "prodajna_cena": "prodajna cena",
    "minimalno_stanje": "minimalno stanje", "kategorija": "kategorija", "bar_kod": "bar kod", "q": "pretraga", "limit": "broj rezultata",
}

def _broj(x):
    try:
        x = float(x)
        return str(int(x)) if x.is_integer() else str(x)
    except (TypeError, ValueError):
        return str(x)

def _opis_greske(g):
    tip, ctx = g.get("type", ""), g.get("ctx") or {}
    if tip == "value_error":
        return str(g.get("msg", "")).removeprefix("Value error, ")
    if g.get("input", "") is None:
        return "je obavezno"
    poruke = {
        "missing": "je obavezno",
        "greater_than": f"mora biti veće od {_broj(ctx.get('gt'))}",
        "greater_than_equal": f"ne sme biti manje od {_broj(ctx.get('ge'))}",
        "less_than_equal": f"ne sme biti veće od {_broj(ctx.get('le'))}",
        "string_too_long": f"je predugačko (najviše {ctx.get('max_length')} znakova)",
        "string_too_short": "ne sme biti prazno",
        "too_short": "mora imati bar jednu stavku",
        "too_long": "ima previše stavki",
        "finite_number": "mora biti broj",
    }
    if tip in poruke:
        return poruke[tip]
    if "date" in tip:
        return "nije ispravan datum"
    if "int" in tip or "float" in tip or "number" in tip:
        return "mora biti broj"
    if "json" in tip:
        return "zahtev nije ispravan"
    return "nije ispravno"

def _mesto_greske(loc):
    delovi, i = [], 0
    loc = [x for x in loc if x not in ("body", "query", "path")]
    while i < len(loc):
        x = loc[i]
        if x == "stavke" and i + 1 < len(loc) and isinstance(loc[i + 1], int):
            delovi.append(f"Stavka {loc[i + 1] + 1}")
            i += 2
            continue
        if isinstance(x, str) and x in NAZIVI_POLJA:
            delovi.append(NAZIVI_POLJA[x])
        i += 1
    return ", ".join(delovi)

@app.exception_handler(RequestValidationError)
def obradjivac_provere(request, e: RequestValidationError):
    g = e.errors()[0] if e.errors() else {}
    mesto, opis = _mesto_greske(g.get("loc", ())), _opis_greske(g)
    if g.get("type") == "value_error":
        # Naše poruke su već cele rečenice; ispred dodajemo samo "Stavka N:" ako se odnose na stavku
        stavka = mesto.split(",")[0] if mesto.startswith("Stavka ") else ""
        poruka = f"{stavka}: {opis}" if stavka else opis
    else:
        poruka = f"{mesto[:1].upper() + mesto[1:]}: {opis}." if mesto else f"Neispravan unos: {opis}."
    return JSONResponse(status_code=422, content=poruka)

@app.exception_handler(NotAdultError)
def obradjivac_godina(request, e: NotAdultError):
    return JSONResponse(status_code=409, content=e.message)

@app.exception_handler(DuplicateInputError)
def obradjivac_duplikata(request, e: DuplicateInputError):
    return JSONResponse(status_code=409, content=e.message)

@app.exception_handler(BadCredentials)
def obradjivac_nepostojecih_korisnika(request, e: BadCredentials):
    return JSONResponse(status_code=401, content=e.message)

@app.exception_handler(ForbiddenAccess)
def obradjivac_zabrane_pristupa(request, e: ForbiddenAccess):
    if request.url.path.endswith(".html"):
        return RedirectResponse('/login.html?greska=sesija')
    return JSONResponse(status_code=403, content=e.message)

@app.exception_handler(NotLoggedIn)
def obradjivac_korisnickog_logovanja(request, e: NotLoggedIn):
    if request.url.path.endswith(".html"):
        return RedirectResponse('/login.html?greska=korisnik')
    return JSONResponse(status_code=401, content=e.message)

# FUNKCIJE

# Nazivi polja dobavljača u porukama o greškama (dopuna NAZIVI_POLJA)
NAZIVI_POLJA.update({
    "tip": "tip", "pib": "PIB", "dugi_naziv": "dugi naziv", "vlasnik": "vlasnik", "zemlja": "zemlja",
    "opstina": "opština", "ptt_broj": "PTT broj", "adresa": "adresa", "mesto": "mesto", "maticni_broj": "matični broj",
    "broj_gazdinstva": "broj gazdinstva", "registarski_broj": "registarski broj", "sifra_delatnosti": "šifra delatnosti",
    "pdv_zona": "PDV zona", "pdv_obveznik": "PDV obveznik", "telefon": "telefon", "fax": "fax", "email": "e-mail",
    "web": "web", "mobilni": "mobilni", "sluzba": "služba", "funkcija": "funkcija", "valuta": "valuta",
    "banka_sifra": "šifra banke", "banka_naziv": "banka", "broj_racuna": "broj računa", "kontrolni_broj": "kontrolni broj",
    "dug_konto": "dug konto", "pot_konto": "pot konto", "gln": "GLN",
})

def punoletan(datum_rodjenja: date):
    now = datetime.now()
    godine = now.year - datum_rodjenja.year
    if godine < 18:
        raise NotAdultError()
    elif godine == 18 and (datum_rodjenja.month, datum_rodjenja.day) > (now.month, now.day):
        raise NotAdultError()
    else:
        return True

def korisnik_postoji(k):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        rezultat = proveri_korisnika(konekcija, k)
        if len(rezultat) > 0 and verifikuj(k.password, rezultat[0][1]):
            sesija_id = secrets.token_urlsafe(64)
            napravi_sesiju(konekcija, rezultat[0][0], sesija_id, datetime.now(), datetime.now() + timedelta(hours=8))
            konekcija.commit()
            return sesija_id
        else:
            raise BadCredentials()
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise
    finally:
        konekcija.close()

def zavrsi_sesiju(trenutna_sesija):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        sesija_gotova(konekcija, trenutna_sesija, datetime.now())
        konekcija.commit()
    except Exception:
        raise
    finally:
        konekcija.close()

def vrati_artikle(text, limit):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row

        artikli = prikazi_artikle(konekcija, za_like(text), limit)
        return artikli
    except:
        raise
    finally:
        konekcija.close()

def citaj_iz_baze(funkcija, *argumenti):
    """Otvori konekciju, pozovi funkciju koja samo čita, zatvori konekciju."""
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        return funkcija(konekcija, *argumenti)
    finally:
        konekcija.close()

def pisi_u_bazu(funkcija, *argumenti):
    """Otvori konekciju, pozovi funkciju koja menja bazu, commit; ako bilo šta pukne, rollback (ništa se ne upiše)."""
    konekcija = konektuj_se()
    konekcija.row_factory = sqlite3.Row
    try:
        rezultat = funkcija(konekcija, *argumenti)
        konekcija.commit()
        return rezultat
    except sqlite3.IntegrityError as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        raise BadInput("Podaci su u sukobu sa postojećim (npr. isti broj računa ili šifra). Osveži stranicu i pokušaj ponovo.", 409)
    except Exception:
        konekcija.rollback()
        raise
    finally:
        konekcija.close()

def sacuvaj_izmene_ulaza(konekcija, ulaz_id, izmena: IzmenaUlaza):
    dobavljac_id = izmeni_zaglavlje(konekcija, ulaz_id, izmena)
    for stavka in izmena.stavke:
        izmeni_stavku(konekcija, ulaz_id, dobavljac_id, stavka)
    return jedan_ulaz(konekcija, ulaz_id)

def vrati_sve_artikle():
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        return svi_artikli(konekcija)
    finally:
        konekcija.close()

def _postojeca_tarifa(konekcija, tarifa_id):
    if not konekcija.execute("SELECT 1 FROM tarifa WHERE tarifa_id = ?", (tarifa_id,)).fetchone():
        raise BadInput(f"Tarifa {tarifa_id} ne postoji.", 400)
    return tarifa_id

def unesi_jedan_artikal(a: NoviArtikal):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        sifra = dodaj_jedan_artikal(
            konekcija, a.naziv, a.kategorija or None, a.bar_kod or None,
            a.prodajna_cena, a.jedinica_mere, 1 if a.aktivan else 0, a.minimalno_stanje,
            _postojeca_tarifa(konekcija, a.tarifa_id)
        )
        konekcija.commit()
        return jedan_artikal(konekcija, sifra)
    except Exception as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        traceback.print_exc()
        raise
    finally:
        konekcija.close()

def sacuvaj_izmenu_artikla(sifra, izmena: IzmenaArtikla):
    izmene = izmena.model_dump(exclude_unset=True)
    # Kolone koje ne smeju biti prazne: null znači "nije poslato", ne "obriši"
    izmene = {k: v for k, v in izmene.items() if not (v is None and k in ("naziv", "jedinica_mere", "minimalno_stanje", "aktivan", "tarifa_id"))}
    if "aktivan" in izmene:
        izmene["aktivan"] = 1 if izmene["aktivan"] else 0
    for k in ("kategorija", "bar_kod"):
        if k in izmene and not izmene[k]:
            izmene[k] = None   # prazno polje se čuva kao NULL
    if not izmene:
        return JSONResponse(status_code=400, content="Nema izmena.")

    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        if "tarifa_id" in izmene:
            _postojeca_tarifa(konekcija, izmene["tarifa_id"])
        if izmeni_artikal(konekcija, sifra, izmene) == 0:
            return JSONResponse(status_code=404, content=f"Artikal sa šifrom {sifra} ne postoji.")
        konekcija.commit()
        return jedan_artikal(konekcija, sifra)
    except Exception as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        traceback.print_exc()
        raise
    finally:
        konekcija.close()

def unesi_racun(kupovina: Kupovina, korisnik="kasir"):
    # Cena i nabavna cena se uzimaju iz baze, ne sa stranice (da se ne bi mogle podmetnuti)
    if len(kupovina.stavke) == 0:
        return JSONResponse(status_code=400, content="Korpa je prazna.")
    for s in kupovina.stavke:
        if s.kolicina <= 0:
            return JSONResponse(status_code=400, content=f"Količina za šifru {s.sifra} mora biti veća od 0.")

    try:
        konekcija = konektuj_se()
        racun_id, datum_vreme = sacuvaj_racun(konekcija, korisnik, kupovina.nacin_placanja)

        stavke_racuna = []
        for s in kupovina.stavke:
            artikal = vrati_artikal_za_racun(konekcija, s.sifra)
            if not artikal:
                konekcija.rollback()
                return JSONResponse(status_code=404, content=f"Artikal sa šifrom {s.sifra} ne postoji.")
            sifra, naziv, jedinica_mere, prodajna_cena, nabavna_cena, aktivan = artikal
            if not aktivan:
                # Npr. vlasnik ga je isključio dok je već bio u korpi
                konekcija.rollback()
                return JSONResponse(status_code=409, content=f"Artikal „{naziv}“ (šifra {sifra}) više nije aktivan. Izbaci ga iz korpe.")
            sacuvaj_stavka_racuna(konekcija, racun_id, sifra, naziv, jedinica_mere, s.kolicina, prodajna_cena, nabavna_cena)
            azuriraj_stanje(konekcija, -s.kolicina, sifra)   # prodato se skida sa stanja
            stavke_racuna.append({
                "sifra": sifra,
                "naziv": naziv,
                "jedinica_mere": jedinica_mere,
                "kolicina": s.kolicina,
                "cena_po_komadu": prodajna_cena,
            })

        konekcija.commit()
    except Exception as e:
        konekcija.rollback()
        print(type(e).__name__, e)
        traceback.print_exc()
        raise
    finally:
        konekcija.close()

    # Račun je već sačuvan u bazi; ako PDF ne uspe, to ne poništava prodaju
    try:
        putanja = izdaj_racun(racun_id, datum_vreme, korisnik, stavke_racuna, kupovina.nacin_placanja)
        pdf = putanja.name
    except Exception as e:
        print(type(e).__name__, e)
        traceback.print_exc()
        pdf = None

    return {"racun_id": racun_id, "pdf": pdf, "pdf_adresa": f"/racuni/{racun_id}/pdf",
            "nacin_placanja": kupovina.nacin_placanja,
            "ukupno": round(sum(s["kolicina"] * s["cena_po_komadu"] for s in stavke_racuna), 2)}

# TEKST

def normalizuj(tekst):
    if tekst is None:
        return ""
    tekst = tekst.lower().replace("đ", "dj")   # đ nema razlaganje, mora ručno
    razlozeno = unicodedata.normalize("NFD", tekst)
    return "".join(c for c in razlozeno if not unicodedata.combining(c))

def za_like(tekst):
    tekst = normalizuj(tekst)
    return tekst.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")