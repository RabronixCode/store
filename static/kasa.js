// ---------- Odjava ----------

document.getElementById('odjava').addEventListener('click', async (event) => {
    event.preventDefault();
    await fetch('/logout');
    window.location.href = '/login.html';
});


// ---------- Elementi i stanje ----------

const polje = document.getElementById('pretraga');
const lista = document.getElementById('rezultati');
const sablonRezultat = document.getElementById('rezultat-sablon');
const sablonNema = document.getElementById('nema-rezultata-sablon');
const poruka = document.getElementById('poruka');

const forma = document.getElementById('forma-kasa');
const korpaOkvir = document.getElementById('korpa-okvir');
const korpaTelo = document.getElementById('korpa');
const sablonKorpa = document.getElementById('stavka-korpe-sablon');
const praznaKorpa = document.getElementById('prazna-korpa');
const ukupnoPolje = document.getElementById('ukupno');
const brojStavki = document.getElementById('broj-stavki');
const dugmeKupi = document.getElementById('kupi');
const dugmeObrisiIzabrano = document.getElementById('obrisi-izabrano');

const MAX_REZULTATA = 50;   // koliko najviše tražimo od servera
const KASNJENJE_MS = 200;   // koliko se čeka posle poslednjeg slova pre slanja zahteva

// Korpa: šifra -> { sifra, naziv, stanje, jedinica_mere, cena, kolicina }
// Map čuva redosled dodavanja, pa se redovi prikazuju redom kojim su dodati.
const korpa = new Map();
let izabranaSifra = null;   // šifra izabranog reda u korpi (null = nijedan)

let rezultati = [];         // artikli koji su trenutno u listi
let prikazanoZa = null;     // tekst pretrage za koji je lista napravljena
let aktivan = -1;           // izabrani predlog (strelicama), -1 = nijedan
let tajmer = null;          // tajmer za kašnjenje (debounce)
let kontroler = null;       // AbortController poslednjeg zahteva
let cekaEnter = false;      // Enter je pritisnut dok lista nije bila osvežena
let uToku = false;          // zahtev je poslat, a odgovor još nije stigao
let kupovinaUToku = false;


// ---------- Pomoćne ----------

function formatCena(broj) {
    return Number(broj).toLocaleString('sr-RS', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatKolicina(broj) {
    return Number(broj).toLocaleString('sr-RS', { maximumFractionDigits: 3 });
}

// Zaokruživanje na 3 decimale, da 0.1 + 0.2 ne bude 0.30000000000000004
function zaokruzi(broj) {
    return Math.round(broj * 1000) / 1000;
}

function javi(tekst, vrsta = '') {
    poruka.textContent = tekst;
    poruka.className = vrsta;
}


// ---------- Pretraga artikala (combobox) ----------
//
// GET /artikli?q=<tekst>&limit=<broj>  ->  [{ sifra, naziv, stanje, jedinica_mere, prodajna_cena }]

function otvori() {
    lista.hidden = false;
    polje.setAttribute('aria-expanded', 'true');
}

function zatvori() {
    lista.hidden = true;
    polje.setAttribute('aria-expanded', 'false');
    polje.removeAttribute('aria-activedescendant');
    aktivan = -1;
    cekaEnter = false;
}

function prikazi(artikli, tekst) {
    rezultati = artikli;
    prikazanoZa = tekst;
    aktivan = -1;
    polje.removeAttribute('aria-activedescendant');
    lista.replaceChildren();

    if (artikli.length === 0) {
        lista.appendChild(sablonNema.content.cloneNode(true));
    } else {
        artikli.forEach((artikal, i) => {
            const klon = sablonRezultat.content.cloneNode(true);
            const red = klon.querySelector('.rezultat');
            red.id = `rezultat-${i}`;
            red.dataset.indeks = i;
            // textContent (ne innerHTML): naziv iz baze se prikazuje kao običan tekst
            klon.querySelector('[data-polje="sifra"]').textContent = artikal.sifra;
            klon.querySelector('[data-polje="naziv"]').textContent = artikal.naziv;
            klon.querySelector('[data-polje="stanje"]').textContent = formatKolicina(artikal.stanje);
            klon.querySelector('[data-polje="jedinica_mere"]').textContent = artikal.jedinica_mere;
            klon.querySelector('[data-polje="cena"]').textContent = formatCena(artikal.prodajna_cena);
            if (artikal.stanje <= 0) klon.querySelector('.stanje').classList.add('malo');
            lista.appendChild(klon);
        });
    }
    otvori();
}

async function ucitaj(tekst) {
    // Ako je prethodni zahtev još u toku, otkazujemo ga, da stariji odgovor
    // ne bi stigao posle novijeg i prepisao listu.
    if (kontroler) kontroler.abort();
    const moj = new AbortController();
    kontroler = moj;
    uToku = true;

    try {
        const params = new URLSearchParams({ q: tekst, limit: MAX_REZULTATA });
        const odgovor = await fetch(`/artikli?${params}`, { signal: moj.signal });

        if (odgovor.status === 401) {
            window.location.href = '/login.html?greska=korisnik';
            return;
        }
        if (odgovor.status === 403) throw new Error('Nemate pravo da pretražujete artikle.');
        if (!odgovor.ok) throw new Error('Pretraga trenutno ne radi.');
        const artikli = await odgovor.json();
        prikazi(artikli, tekst);

        if (cekaEnter) {
            cekaEnter = false;
            if (rezultati.length > 0) izaberi(0);
        }
    } catch (greska) {
        if (greska.name === 'AbortError') return;   // zastareo zahtev, ignoriši
        zatvori();
        javi(greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message, 'greska');
    } finally {
        if (kontroler === moj) uToku = false;
    }
}

function postaviAktivan(i) {
    const redovi = lista.querySelectorAll('.rezultat');
    if (redovi.length === 0) return;

    if (aktivan >= 0) redovi[aktivan].setAttribute('aria-selected', 'false');
    aktivan = (i + redovi.length) % redovi.length;   // kruži: posle poslednjeg ide prvi
    redovi[aktivan].setAttribute('aria-selected', 'true');
    polje.setAttribute('aria-activedescendant', redovi[aktivan].id);
    redovi[aktivan].scrollIntoView({ block: 'nearest' });
}

function izaberi(i) {
    const artikal = rezultati[i];
    if (!artikal) return;
    dodajUKorpu(artikal);

    polje.value = '';
    zatvori();
    polje.focus();   // kasir odmah može da kuca sledeći artikal
}


// ---------- Korpa ----------

function dodajUKorpu(artikal) {
    const sifra = Number(artikal.sifra);
    if (korpa.has(sifra)) {
        korpa.get(sifra).kolicina = zaokruzi(korpa.get(sifra).kolicina + 1);
    } else {
        korpa.set(sifra, {
            sifra,
            naziv: artikal.naziv,
            stanje: artikal.stanje,
            jedinica_mere: artikal.jedinica_mere,
            cena: Number(artikal.prodajna_cena),
            kolicina: 1
        });
    }
    javi('');
    nacrtajKorpu();
}

function postaviKolicinu(sifra, kolicina) {
    if (!korpa.has(sifra)) return;
    if (!(kolicina > 0)) {
        obrisiIzKorpe(sifra);
        return;
    }
    korpa.get(sifra).kolicina = zaokruzi(kolicina);
    nacrtajKorpu();
}

function obrisiIzKorpe(sifra) {
    korpa.delete(sifra);
    if (izabranaSifra === sifra) izabranaSifra = null;
    nacrtajKorpu();
}

function izaberiRed(sifra) {
    izabranaSifra = (izabranaSifra === sifra) ? null : sifra;   // drugi klik poništava izbor
    korpaTelo.querySelectorAll('.stavka-korpe').forEach((red) => {
        red.setAttribute('aria-selected', String(Number(red.dataset.sifra) === izabranaSifra));
    });
    dugmeObrisiIzabrano.disabled = izabranaSifra === null;
}

// Pravi sve redove korpe iz Map-e i osvežava zbir.
function nacrtajKorpu() {
    korpaTelo.replaceChildren();

    korpa.forEach((stavka) => {
        const klon = sablonKorpa.content.cloneNode(true);
        const red = klon.querySelector('.stavka-korpe');
        red.dataset.sifra = stavka.sifra;
        red.setAttribute('aria-selected', String(stavka.sifra === izabranaSifra));

        klon.querySelector('[data-polje="sifra"]').textContent = stavka.sifra;
        klon.querySelector('[data-polje="naziv"]').textContent = stavka.naziv;
        klon.querySelector('[data-polje="stanje"]').textContent = formatKolicina(stavka.stanje);
        klon.querySelector('[data-polje="jedinica_mere"]').textContent = stavka.jedinica_mere;
        klon.querySelector('[data-polje="cena"]').textContent = formatCena(stavka.cena);
        klon.querySelector('[data-polje="ukupno"]').textContent = formatCena(stavka.cena * stavka.kolicina);
        klon.querySelector('input.kolicina').value = stavka.kolicina;
        if (stavka.stanje <= 0) klon.querySelector('.stanje').classList.add('malo');

        korpaTelo.appendChild(klon);
    });

    const prazna = korpa.size === 0;
    praznaKorpa.hidden = !prazna;
    korpaOkvir.hidden = prazna;
    dugmeKupi.disabled = prazna || kupovinaUToku;
    dugmeObrisiIzabrano.disabled = izabranaSifra === null;
    brojStavki.textContent = korpa.size;
    osveziZbir();
}

// Zbir računa. Dok se kuca u polje količine, uzima se ono što piše u polju (uživo).
function osveziZbir() {
    let zbir = 0;
    korpaTelo.querySelectorAll('.stavka-korpe').forEach((red) => {
        const stavka = korpa.get(Number(red.dataset.sifra));
        const upisano = parseFloat(red.querySelector('input.kolicina').value);
        const kolicina = Number.isFinite(upisano) && upisano >= 0 ? upisano : stavka.kolicina;
        const iznos = stavka.cena * kolicina;
        red.querySelector('[data-polje="ukupno"]').textContent = formatCena(iznos);
        zbir += iznos;
    });
    ukupnoPolje.textContent = formatCena(zbir);
}


// ---------- Kupovina ----------

forma.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (korpa.size === 0 || kupovinaUToku) return;

    // Ako je kasir upisao količinu pa odmah kliknuo KUPI, change je već okinut
    // pre submit-a (blur ide pre klika), pa je korpa ažurna.
    const stavke = [...korpa.values()].map((s) => ({ sifra: s.sifra, kolicina: s.kolicina }));

    kupovinaUToku = true;
    dugmeKupi.disabled = true;
    dugmeKupi.textContent = 'Obrada…';
    javi('');

    try {
        const odgovor = await fetch('/racuni', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stavke })
        });

        if (odgovor.status === 401) {
            window.location.href = '/login.html?greska=korisnik';
            return;
        }
        if (odgovor.status === 403) throw new Error('Nemate pravo da izdajete račune.');
        if (!odgovor.ok) {
            const tekst = await odgovor.json().catch(() => null);
            throw new Error(typeof tekst === 'string' ? tekst : 'Račun nije sačuvan. Pokušaj ponovo.');
        }

        const rezultat = await odgovor.json();
        korpa.clear();
        izabranaSifra = null;
        javi(rezultat.pdf
            ? `Račun br. ${rezultat.racun_id} je izdat (${rezultat.pdf}).`
            : `Račun br. ${rezultat.racun_id} je sačuvan, ali PDF nije napravljen.`,
            'uspeh');
        polje.focus();
    } catch (greska) {
        javi(greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message, 'greska');
    } finally {
        kupovinaUToku = false;
        dugmeKupi.textContent = 'KUPI';
        nacrtajKorpu();
    }
});


// ---------- Događaji: pretraga ----------

// Prvi klik (fokus) prikazuje prvih 50 po šifri, a lista pokazuje 5 i skroluje.
polje.addEventListener('focus', () => ucitaj(polje.value.trim()));

// Ako je lista zatvorena (Escape), klik na polje je ponovo otvara.
polje.addEventListener('click', () => {
    if (lista.hidden && !uToku) ucitaj(polje.value.trim());
});

// Svako slovo: čekamo kratko da kasir prestane da kuca, pa šaljemo jedan zahtev.
polje.addEventListener('input', () => {
    clearTimeout(tajmer);
    tajmer = setTimeout(() => ucitaj(polje.value.trim()), KASNJENJE_MS);
});

polje.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (lista.hidden) ucitaj(polje.value.trim());
        else postaviAktivan(aktivan + 1);

    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!lista.hidden) postaviAktivan(aktivan <= 0 ? -1 : aktivan - 1);

    } else if (event.key === 'Enter') {
        event.preventDefault();

        if (lista.hidden && polje.value.trim() === '') return;

        if (prikazanoZa !== polje.value.trim()) {
            // Lista još ne odgovara onome što je ukucano: čekamo svež odgovor,
            // inače bi se izabrao prvi predlog STARE liste.
            clearTimeout(tajmer);
            cekaEnter = true;
            ucitaj(polje.value.trim());
        } else if (rezultati.length > 0) {
            izaberi(aktivan >= 0 ? aktivan : 0);
        }

    } else if (event.key === 'Escape') {
        zatvori();
    }
});

// mousedown na listi ne sme da oduzme fokus polju, inače blur zatvori listu
// pre nego što klik stigne da se izvrši.
lista.addEventListener('mousedown', (event) => event.preventDefault());

lista.addEventListener('click', (event) => {
    const red = event.target.closest('.rezultat');
    if (red) izaberi(Number(red.dataset.indeks));
});

// Tab ili klik van polja zatvara listu.
polje.addEventListener('blur', zatvori);


// ---------- Događaji: korpa ----------

korpaTelo.addEventListener('click', (event) => {
    const red = event.target.closest('.stavka-korpe');
    if (!red) return;
    const sifra = Number(red.dataset.sifra);
    const stavka = korpa.get(sifra);

    if (event.target.closest('.vise')) {
        postaviKolicinu(sifra, stavka.kolicina + 1);
    } else if (event.target.closest('.manje')) {
        postaviKolicinu(sifra, stavka.kolicina - 1);   // na 0 se briše
    } else if (event.target.closest('.obrisi')) {
        obrisiIzKorpe(sifra);
    } else if (!event.target.closest('input')) {
        izaberiRed(sifra);
    }
});

// Dok se kuca: samo osvežavamo iznose (bez ponovnog crtanja, da polje ne izgubi fokus).
korpaTelo.addEventListener('input', (event) => {
    if (event.target.matches('input.kolicina')) osveziZbir();
});

// Klik negde drugde (ili Enter): upisana količina se pamti. 0 briše artikal,
// a prazno ili neispravno vraća prethodnu količinu.
korpaTelo.addEventListener('change', (event) => {
    if (!event.target.matches('input.kolicina')) return;
    const sifra = Number(event.target.closest('.stavka-korpe').dataset.sifra);
    const upisano = parseFloat(event.target.value);

    if (!Number.isFinite(upisano) || upisano < 0) {
        nacrtajKorpu();   // vrati staru vrednost
        return;
    }
    postaviKolicinu(sifra, upisano);
});

korpaTelo.addEventListener('keydown', (event) => {
    if (event.target.matches('input.kolicina')) {
        // Enter u polju količine NE sme da pošalje formu (kupi). Samo potvrdi količinu.
        if (event.key === 'Enter') {
            event.preventDefault();
            event.target.blur();
        }
        return;
    }
    // Enter ili razmak na redu (tastatura) bira red, kao klik.
    const red = event.target.closest('.stavka-korpe');
    if (red && event.target === red && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        izaberiRed(Number(red.dataset.sifra));
    }
});

dugmeObrisiIzabrano.addEventListener('click', () => {
    if (izabranaSifra !== null) obrisiIzKorpe(izabranaSifra);
});

// Tasteri za izabrani red (osim dok se kuca u nekom polju):
//   Delete  briše red
//   + / -   povećava / smanjuje količinu za 1 (radi i na numeričkom delu tastature);
//           kad količina padne na 0, red se briše
document.addEventListener('keydown', (event) => {
    if (izabranaSifra === null) return;
    if (event.target.matches('input, textarea')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;   // npr. Ctrl + / Ctrl - (zum) ostaje pregledaču

    const stavka = korpa.get(izabranaSifra);
    if (event.key === 'Delete') {
        event.preventDefault();
        obrisiIzKorpe(izabranaSifra);
    } else if (event.key === '+') {
        event.preventDefault();
        postaviKolicinu(izabranaSifra, stavka.kolicina + 1);
    } else if (event.key === '-') {
        event.preventDefault();
        postaviKolicinu(izabranaSifra, stavka.kolicina - 1);
    }
});

nacrtajKorpu();
