import traceback

from fastapi import Cookie, Depends, FastAPI, File, Form, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
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
                   lista_ulaza, jedan_ulaz, izmeni_zaglavlje, izmeni_stavku)
from artikli import prikazi_artikle, azuriraj_stanje
from artikli import svi_artikli, jedan_artikal, izmeni_artikal, dodaj_jedan_artikal
from lozinke import hash_password, verifikuj
from sesije import napravi_sesiju, sesija_gotova, proveri_kolacic_vrati_rolu
from racuni import sacuvaj_racun, vrati_artikal_za_racun, sacuvaj_stavka_racuna
from racun_pdf import izdaj_racun
import asistent


class Dobavljac(BaseModel):
    naziv: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

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

class IzmenaArtikla(BaseModel):
    # Šalje se samo polje koje se menja; ostala ostaju kakva jesu.
    naziv: TekstObavezan | None = None
    kategorija: TekstNeobavezan | None = None
    bar_kod: TekstNeobavezan | None = None
    jedinica_mere: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)] | None = None
    minimalno_stanje: Annotated[float, Field(ge=0)] | None = None
    aktivan: bool | None = None

# ---------- Ulaz robe ----------

NAJRANIJI_DATUM = date(2000, 1, 1)
KratakTekst = Annotated[str, StringConstraints(max_length=100)]
Kolicina = Annotated[float, Field(gt=0, le=1_000_000, allow_inf_nan=False)]
Cena = Annotated[float, Field(ge=0, le=100_000_000, allow_inf_nan=False)]
Pdv = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]


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
    nabavna_cena: Cena
    pdv: Pdv = 20
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
    nabavna_cena: Cena
    pdv: Pdv

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


app = FastAPI()
app.frontend("/", directory="static", check_dir=True, fallback=None)


origins = [
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    print("USAO U ULAZ")
    if korisnik == 'vlasnik':
        return FileResponse("static/pocetna.html", headers={"Cache-Control": "no-store"})
    elif korisnik == 'kasir':
        return FileResponse("kasa/kasa.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE VLASNIK")

@app.get("/kasa/kasa.html")
async def stranica_kasa(korisnik = Depends(trenutni_korisnik)):
    print("USAO U ULAZ")
    if korisnik == 'kasir':
        return FileResponse("kasa/kasa.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE KASIR")
# RUTE

@app.get("/dobavljaci")
async def lista_dobavljaca(korisnik = Depends(samo_vlasnik)):
    return citaj_iz_baze(lambda k: [dict(r) for r in k.execute(
        "SELECT dobavljac_id, naziv FROM dobavljac ORDER BY naziv COLLATE NOCASE").fetchall()])

@app.post("/dobavljaci")
async def kreiraj_dobavljaca(dobavljac: Dobavljac, korisnik = Depends(samo_vlasnik)):
    proveri_duplikat(dobavljac)
    unesi_dobavljaca(dobavljac)
    return "Dobavljac sacuvan!"

# Stranica Dobavljači (samo vlasnik)

@app.get("/dobavljaci/pregled")
async def pregled_svih_dobavljaca(korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return citaj_iz_baze(pregled_dobavljaca)

@app.patch("/dobavljaci/{dobavljac_id}")
async def promeni_dobavljaca(dobavljac_id: int, dobavljac: Dobavljac, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    return sacuvaj_naziv_dobavljaca(dobavljac_id, dobavljac.naziv)

@app.get("/dobavljaci/{dobavljac_id}/artikli")
async def artikli_jednog_dobavljaca(dobavljac_id: int, korisnik = Depends(trenutni_korisnik)):
    if korisnik != 'vlasnik':
        raise ForbiddenAccess()
    dobavljac = citaj_iz_baze(jedan_dobavljac, dobavljac_id)
    if not dobavljac:
        return JSONResponse(status_code=404, content="Taj dobavljač ne postoji.")
    return {"dobavljac": dobavljac, "artikli": citaj_iz_baze(artikli_dobavljaca, dobavljac_id)}

# Ulaz robe (samo vlasnik). Rute sa stalnim imenom idu PRE /ulazi/{ulaz_id}.

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
async def pretrazi_artikle(request: Request, korisnik = Depends(trenutni_korisnik)):
    return vrati_artikle(request.query_params['q'], request.query_params['limit'])

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
    return unesi_racun(kupovina)

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
            secure=True
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
    "kolicina": "količina", "nabavna_cena": "nabavna cena", "pdv": "PDV", "novi_artikal": "novi artikal",
    "naziv": "naziv", "jedinica_mere": "jedinica mere", "prodajna_cena": "prodajna cena",
    "minimalno_stanje": "minimalno stanje", "kategorija": "kategorija", "bar_kod": "bar kod", "q": "pretraga",
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

def proveri_duplikat(podatak: object):
    konekcija = konektuj_se()
    veza = konekcija.cursor()
    if (type(podatak) == Dobavljac):
        upit = "SELECT * FROM dobavljac WHERE naziv=?"
        vrednosti = (podatak.naziv,)
        rezultat = veza.execute(upit, vrednosti).fetchone()
    else:
        print("NIJE DOBAR PODATAK")
    if rezultat:
        raise DuplicateInputError()

def punoletan(datum_rodjenja: date):
    now = datetime.now()
    godine = now.year - datum_rodjenja.year
    if godine < 18:
        raise NotAdultError()
    elif godine == 18 and (datum_rodjenja.month, datum_rodjenja.day) > (now.month, now.day):
        raise NotAdultError()
    else:
        return True

def unesi_dobavljaca(d: Dobavljac):
    try:
        konekcija = konektuj_se()
        sacuvaj_dobavljaca(konekcija, d.naziv) # iz DOBAVLJACI.py
        konekcija.commit()
    except Exception as e:
        print(e)
    finally:
        konekcija.close()

def korisnik_postoji(k):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        rezultat = proveri_korisnika(konekcija, k)
        if len(rezultat) > 0 and verifikuj(k.password, rezultat[0][1]):
            sesija_id = secrets.token_urlsafe(64)
            print(sesija_id)
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
        print(trenutna_sesija)
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
        print(artikli)
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

def sacuvaj_naziv_dobavljaca(dobavljac_id, naziv):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        if naziv_zauzet(konekcija, naziv, dobavljac_id):
            raise DuplicateInputError(f"Dobavljač „{naziv}“ već postoji!")
        if promeni_naziv_dobavljaca(konekcija, dobavljac_id, naziv) == 0:
            return JSONResponse(status_code=404, content="Taj dobavljač ne postoji.")
        konekcija.commit()
        return jedan_dobavljac(konekcija, dobavljac_id)
    except Exception:
        konekcija.rollback()
        raise
    finally:
        konekcija.close()

def vrati_sve_artikle():
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        return svi_artikli(konekcija)
    finally:
        konekcija.close()

def unesi_jedan_artikal(a: NoviArtikal):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        sifra = dodaj_jedan_artikal(
            konekcija, a.naziv, a.kategorija or None, a.bar_kod or None,
            a.prodajna_cena, a.jedinica_mere, 1 if a.aktivan else 0, a.minimalno_stanje
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
    izmene = {k: v for k, v in izmene.items() if not (v is None and k in ("naziv", "jedinica_mere", "minimalno_stanje", "aktivan"))}
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

def unesi_racun(kupovina: Kupovina):
    # Cena i nabavna cena se uzimaju iz baze, ne sa stranice (da se ne bi mogle podmetnuti)
    if len(kupovina.stavke) == 0:
        return JSONResponse(status_code=400, content="Korpa je prazna.")
    for s in kupovina.stavke:
        if s.kolicina <= 0:
            return JSONResponse(status_code=400, content=f"Količina za šifru {s.sifra} mora biti veća od 0.")

    try:
        konekcija = konektuj_se()
        korisnik = "kasir"   # TODO: kasnije uzeti iz sesije
        racun_id, datum_vreme = sacuvaj_racun(konekcija, korisnik)

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
        putanja = izdaj_racun(racun_id, datum_vreme, korisnik, stavke_racuna)
        pdf = putanja.name
    except Exception as e:
        print(type(e).__name__, e)
        traceback.print_exc()
        pdf = None

    return {"racun_id": racun_id, "pdf": pdf}

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