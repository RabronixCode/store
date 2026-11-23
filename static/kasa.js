// ---------- Odjava (tvoj kod, nepromenjen) ----------

document.getElementById('odjava').addEventListener('click', async (event) => {
    event.preventDefault();
    const response = await fetch('/logout');
    window.location.href = '/login.html'
});


// ---------- Pretraga artikala (combobox) ----------
//
// Ugovor sa serverom (ovo ti pravi Python):
//   GET /artikli?q=<tekst>&limit=<broj>
//   odgovor: JSON niz, sortiran po šifri, svaki element:
//     { sifra, naziv, prodajna_cena, jedinica_mere }
//   q prazan  -> prvih `limit` artikala po šifri (to se vidi pri prvom kliku na polje)
//   q neprazan -> artikli kojima q odgovara šifri ili nazivu
// Server NE vraća sve artikle: vraća najviše `limit`, a lista na stranici
// prikazuje 5 redova odjednom i skroluje ostatak (visina je u kasa.css).

const polje = document.getElementById('pretraga');
const lista = document.getElementById('rezultati');
const sablonRezultat = document.getElementById('rezultat-sablon');
const sablonNema = document.getElementById('nema-rezultata-sablon');
const poruka = document.getElementById('poruka');

const MAX_REZULTATA = 50;   // koliko najviše tražimo od servera
const KASNJENJE_MS = 200;   // koliko se čeka posle poslednjeg slova pre slanja zahteva

let rezultati = [];         // artikli koji su trenutno u listi
let prikazanoZa = null;     // tekst pretrage za koji je lista napravljena
let aktivan = -1;           // izabrani predlog (strelicama), -1 = nijedan
let tajmer = null;          // tajmer za kašnjenje (debounce)
let kontroler = null;       // AbortController poslednjeg zahteva
let cekaEnter = false;      // Enter je pritisnut dok lista nije bila osvežena
let uToku = false;          // zahtev je poslat, a odgovor još nije stigao


function formatCena(broj) {
    return Number(broj).toLocaleString('sr-RS', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

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
            klon.querySelector('[data-polje="stanje"]').textContent = artikal.stanje;
            klon.querySelector('[data-polje="jedinica_mere"]').textContent = artikal.jedinica_mere;
            klon.querySelector('[data-polje="cena"]').textContent = formatCena(artikal.prodajna_cena);
            lista.appendChild(klon);
        });
    }
    otvori();
}

async function ucitaj(tekst) {
    // Ako je prethodni zahtev još u toku, otkazujemo ga. Inače bi sporiji, stariji
    // odgovor mogao da stigne posle novijeg i prepiše listu pogrešnim rezultatima.
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
        console.log(greska.stack);
        if (greska.name === 'AbortError') return;   // zastareo zahtev, ignoriši
        zatvori();
        poruka.textContent = greska.message === 'Failed to fetch'
            ? 'Nema veze sa serverom.'
            : greska.message;
    } finally {
        // uToku gasimo samo ako je ovo poslednji zahtev (stariji su otkazani)
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

function dodajUKorpu(artikal) {
    // TODO (tvoj deo): dodaj artikal u korpu.
    //  - ako artikal sa istom šifrom već postoji u korpi, povećaj količinu za 1,
    //    umesto da praviš novi red
    //  - inače napravi red iz šablona #stavka-korpe-sablon, sakrij #prazna-korpa,
    //    omogući dugme #kupi i preračunaj #ukupno
    // Privremeno, da vidiš da izbor radi (obriši kad napraviš korpu):
    poruka.textContent = `Izabrano: ${artikal.sifra} ${artikal.naziv}`;
}


// ---------- Događaji ----------

// Prvi klik (fokus) prikazuje prvih 50 po šifri, a lista pokazuje 5 i skroluje.
polje.addEventListener('focus', () => ucitaj(polje.value.trim()));

// Ako je lista zatvorena (Escape), klik na polje je ponovo otvara.
// Pri prvom kliku fokus je već pokrenuo zahtev, pa tada ne šaljemo drugi.
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
            // Lista još ne odgovara onome što je ukucano (kasir je stigao do Enter-a
            // pre nego što je zahtev poslat ili završen). Bez ovoga bi se izabrao
            // prvi predlog STARE liste, tj. pogrešan artikal. Zato čekamo svež odgovor.
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
