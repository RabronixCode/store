import traceback

from fastapi import Cookie, Depends, FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, StringConstraints
from typing import Annotated
import sqlite3
from datetime import date, datetime, timedelta
import secrets

from Errors.NotAdultError import NotAdultError
from Errors.DuplicateInputError import DuplicateInputError
from Errors.BadCredentials import BadCredentials
from Errors.ForbiddenAccess import ForbiddenAccess

from db import konektuj_se
from dobavljaci import sacuvaj_dobavljaca
from korisnici import proveri_korisnika
from ulazi import sacuvaj_ulaz, proveri_postojanje, sacuvaj_stavka_ulaza
from artikli import sacuvaj_artikal, sacuvaj_dobavljac_artikal, azuriraj_ponderisanu_cenu
from lozinke import hash_password, verifikuj
from sesije import napravi_sesiju, proveri_kolacic, vrati_rolu


class Dobavljac(BaseModel):
    naziv: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

class Ulaz(BaseModel):
    dobavljac_id: int
    racun_broj: str
    racun_poziv_na_broj: str
    datum_vreme: date | None = None
    stavke: list

class Stavka(BaseModel):
    stavke: list

class Artikal(BaseModel):
    naziv: str
    kategorija: str
    bar_kod: str
    prodajna_cena: float
    jedinica_mere: str
    nabavna_cena: float
    dobavljac_id: int
    pdv: float
    sifra_dobavljac: int

class Korisnik(BaseModel):
    username: str
    password: str


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
    konekcija = konektuj_se()
    kolacic = proveri_kolacic(konekcija, trenutna_sesija, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    print(kolacic, "KOLACIC")
    if kolacic:
        rola = vrati_rolu(konekcija, trenutna_sesija)
        print(rola, "ROLA")
        if rola:
            return rola
        else:
            raise ForbiddenAccess()
    else:
        # TODO Ovde treba raise i neki redirect na login.
        raise ForbiddenAccess()



# PREUSMERAVANJE

@app.get("/vlasnik/dobavljaci.html")
async def stranica_dobavljaci(korisnik = Depends(trenutni_korisnik)):
    print("USAO U DOBAVLJACE")
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/dobavljaci.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE VLASNIK")

@app.get("/vlasnik/ulaz.html")
async def stranica_ulazi(korisnik = Depends(trenutni_korisnik)):
    print("USAO U ULAZ")
    if korisnik == 'vlasnik':
        return FileResponse("vlasnik/ulaz.html", headers={"Cache-Control": "no-store"})
    else:
        print("OVO NIJE VLASNIK")

# RUTE

@app.get("/dobavljaci")
async def lista_dobavljaca():
    konekcija = konektuj_se()
    konekcija.row_factory = sqlite3.Row
    veza = konekcija.cursor()
    dobavljaci = veza.execute("SELECT * FROM dobavljac").fetchall()
    return dobavljaci

@app.post("/dobavljaci")
async def kreiraj_dobavljaca(dobavljac: Dobavljac, korisnik = Depends(trenutni_korisnik)):
    print(korisnik)
    proveri_duplikat(dobavljac)
    unesi_dobavljaca(dobavljac)
    return "Dobavljac sacuvan!"

@app.post("/ulazi")
async def kreiraj_ulaz(ulaz: Ulaz):
    unesi_ulaz(ulaz)
    return "Ulaz uspesno unet!"

@app.post("/provera-stavki")
async def proveri_stavke(stavke: Stavka):
    stavke_fale = ne_postoji(stavke.stavke)
    return stavke_fale

@app.post('/novi-artikli')
async def kreiraj_artikal(artikli: list[Artikal]):
    print(artikli)
    unesi_artikle(artikli)
    return "Novi artikli uspesno uneti!"

@app.get('/provera-broj-racuna')
async def proveri_broj_racuna(dobavljac_id: str, racun_broj: str):
    return broj_racuna_postoji(dobavljac_id, racun_broj)

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

# @app.get('/ja')
# async def autentikacija(request: Request):
#     proveri_autentikaciju(request)

# EXCEPTION-i

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

def unesi_ulaz(u: Ulaz):
    try:
        konekcija = konektuj_se()
        ulaz_id = sacuvaj_ulaz(konekcija, u.dobavljac_id, u.racun_broj, u.racun_poziv_na_broj, u.datum_vreme)
        for stavka in u.stavke:
            sifra_artikal = proveri_postojanje(konekcija, stavka['sifra'], stavka['dobavljac_id'])
            sacuvaj_stavka_ulaza(konekcija, ulaz_id, u.dobavljac_id, stavka, sifra_artikal[0])
            azuriraj_ponderisanu_cenu(konekcija, sifra_artikal[0], stavka['kolicina'], stavka['nabavna_cena'])
        konekcija.commit()
    except sqlite3.IntegrityError as e:
        err_code = e.sqlite_errorcode
        if err_code == sqlite3.SQLITE_CONSTRAINT_UNIQUE:
            konekcija.rollback()
            raise DuplicateInputError()
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise  
    finally:
        konekcija.close()


def ne_postoji(stavke):
    try:
        konekcija = konektuj_se()
        stavke_fale = []
        for stavka in stavke:
            provera = proveri_postojanje(konekcija, stavka['sifra'], stavka['dobavljac_id'])
            if not provera:
                stavke_fale.append(stavka)
        return stavke_fale
    except sqlite3.Error as e:
        print(type(e).__name__, e.sqlite_errorcode, e.sqlite_errorname)
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise  
    finally:
        konekcija.close()

def unesi_artikle(artikli: list[Artikal]):
    try:
        konekcija = konektuj_se()
        for a in artikli:
            sifra = sacuvaj_artikal(konekcija, a)
            sacuvaj_dobavljac_artikal(konekcija, sifra, a.sifra_dobavljac, a.dobavljac_id, a.naziv, a.nabavna_cena, a.pdv)
        konekcija.commit()
    except sqlite3.Error as e:
        print(type(e).__name__, e.sqlite_errorcode, e.sqlite_errorname)
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise
    finally:
        konekcija.close()
    
def broj_racuna_postoji(dobavljac_id, broj_racuna):
    try:
        konekcija = konektuj_se()
        konekcija.row_factory = sqlite3.Row
        veza = konekcija.cursor()
        upit = "SELECT * FROM ulaz WHERE dobavljac_id = ? AND racun_broj = ?"
        vrednosti = (dobavljac_id, broj_racuna)
        rezultat = veza.execute(upit, vrednosti).fetchall()
        print(rezultat, "REZULTAT")
        if len(rezultat) > 0:
            raise DuplicateInputError("Racun/otpremnica sa tim brojem vec postoji!")
        else:
            return False
    except Exception as e:
        print(type(e).__name__, e)          # tip + poruka
        traceback.print_exc()               # ceo trag, sa linijom gde je pukla
        raise
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

# def proveri_autentikaciju(request):
#     try:
#         konekcija = konektuj_se()
#         konekcija.row_factory = sqlite3.Row
#         if ('cookie' not in request.headers):
#             raise ForbiddenAccess()
#         else:
#             proveri_sesiju(konekcija, request.headers['cookie'])
#             return 
#         #print(request.query_params)
#         #print(request.headers['cookie'])
#         #print(request.client.host)
#         #print(request.body())
#     except Exception:
#         raise