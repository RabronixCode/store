// ---------- Stranica Dobavljači (vlasnik) ----------
//
// Ugovor sa serverom:
//   GET   /dobavljaci/pregled   -> [{ dobavljac_id, naziv, broj_artikala, broj_ulaza, poslednji_ulaz }]
//   POST  /dobavljaci           telo: { naziv }  -> poruka
//   PATCH /dobavljaci/<id>      telo: { naziv }  -> { dobavljac_id, naziv }

const form = document.getElementById('forma-dobavljac');
const poljeNaziv = document.getElementById('naziv');
const poruka = document.getElementById('poruka');
const telo = document.getElementById('dobavljaci-telo');
const sablon = document.getElementById('dobavljac-sablon');
const brojac = document.getElementById('brojac');
const nema = document.getElementById('nema-dobavljaca');
const pretraga = document.getElementById('pretraga');

const BROJCANE = new Set(['broj_artikala', 'broj_ulaza']);

let dobavljaci = [];
let sort = { kolona: 'naziv', smer: 'asc' };
let noviId = null;   // upravo dodat dobavljač (da se istakne)


// ---------- Pomoćne ----------

function javi(tekst, vrsta = '') {
    poruka.textContent = tekst;
    poruka.className = vrsta;
    if (vrsta === 'uspeh') {
        clearTimeout(javi.tajmer);
        javi.tajmer = setTimeout(() => { if (poruka.textContent === tekst) javi(''); }, 4000);
    }
}

function normalizuj(tekst) {
    return String(tekst ?? '')
        .toLowerCase()
        .replaceAll('đ', 'dj')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

// "2026-11-24" -> "24.11.2026."
function formatDatum(datum) {
    if (!datum) return '—';
    const [g, m, d] = String(datum).slice(0, 10).split('-');
    return d && m && g ? `${d}.${m}.${g}.` : datum;
}

async function procitaj(odgovor, podrazumevanaGreska) {
    if (odgovor.status === 401) {
        window.location.href = '/login.html?greska=korisnik';
        throw new Error('Nisi prijavljen.');
    }
    if (odgovor.status === 403) throw new Error('Nemaš pravo na ovu radnju. Prijavi se ponovo kao vlasnik.');
    if (odgovor.status === 422) throw new Error('Naziv mora imati bar jedno slovo.');
    const podaci = await odgovor.json().catch(() => null);
    if (!odgovor.ok) throw new Error(typeof podaci === 'string' ? podaci : podrazumevanaGreska);
    return podaci;
}

function porukaGreske(greska) {
    return greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message;
}


// ---------- Spisak ----------

function uporedi(a, b) {
    const { kolona, smer } = sort;
    const x = a[kolona], y = b[kolona];
    if (!x && !y) return a.naziv.localeCompare(b.naziv, 'sr');
    if (x === null || x === undefined) return 1;   // bez ulaza: uvek na kraj
    if (y === null || y === undefined) return -1;
    const r = BROJCANE.has(kolona)
        ? x - y
        : String(x).localeCompare(String(y), 'sr', { numeric: true, sensitivity: 'base' });
    return (smer === 'desc' ? -r : r) || a.naziv.localeCompare(b.naziv, 'sr');
}

function nacrtaj() {
    const trazi = normalizuj(pretraga.value.trim());
    const lista = dobavljaci
        .filter((d) => normalizuj(d.naziv).includes(trazi))
        .sort(uporedi);

    telo.replaceChildren(...lista.map((d) => {
        const red = sablon.content.firstElementChild.cloneNode(true);
        red.dataset.id = d.dobavljac_id;
        const veza = red.querySelector('.dobavljac-veza');
        veza.textContent = d.naziv;
        veza.href = `/vlasnik/dobavljac.html?id=${d.dobavljac_id}`;
        red.querySelector('[data-polje="broj_artikala"]').textContent = d.broj_artikala;
        red.querySelector('[data-polje="broj_ulaza"]').textContent = d.broj_ulaza;
        red.querySelector('[data-polje="poslednji_ulaz"]').textContent = formatDatum(d.poslednji_ulaz);
        if (d.dobavljac_id === noviId) red.classList.add('novo');
        return red;
    }));

    nema.hidden = lista.length > 0;
    nema.textContent = dobavljaci.length === 0
        ? 'Još nema dobavljača. Dodaj prvog gore desno.'
        : 'Nijedan dobavljač ne odgovara pretrazi.';
    brojac.textContent = trazi
        ? `Prikazano ${lista.length} od ${dobavljaci.length} dobavljača`
        : `Ukupno ${dobavljaci.length} dobavljača`;

    document.querySelectorAll('tr.naslovi th[data-kolona]').forEach((th) => {
        const aktivna = th.dataset.kolona === sort.kolona;
        th.setAttribute('aria-sort', aktivna ? (sort.smer === 'asc' ? 'ascending' : 'descending') : 'none');
    });
}

async function ucitaj() {
    try {
        dobavljaci = await procitaj(await fetch('/dobavljaci/pregled'), 'Dobavljači trenutno ne mogu da se učitaju.');
        nacrtaj();
    } catch (greska) {
        brojac.textContent = '';
        javi(porukaGreske(greska), 'greska');
    }
}


// ---------- Izmena naziva ----------

let uIzmeni = false;

function zapocniIzmenu(red) {
    if (uIzmeni) return;
    const id = Number(red.dataset.id);
    const dobavljac = dobavljaci.find((d) => d.dobavljac_id === id);
    const celija = red.querySelector('.naziv-celija');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'izmena-polje';
    input.value = dobavljac.naziv;
    input.maxLength = 100;
    input.setAttribute('aria-label', 'Novi naziv dobavljača');

    uIzmeni = true;
    red.classList.add('menja-se');
    celija.replaceChildren(input);
    input.focus();
    input.select();

    let zavrseno = false;
    const zavrsi = async (sacuvaj) => {
        if (zavrseno) return;
        zavrseno = true;
        uIzmeni = false;
        const nov = input.value.trim();

        if (!sacuvaj || nov === dobavljac.naziv) { nacrtaj(); return; }
        if (nov === '') {
            javi('Naziv dobavljača ne može biti prazan.', 'greska');
            nacrtaj();
            return;
        }
        input.disabled = true;
        try {
            const odgovor = await fetch(`/dobavljaci/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ naziv: nov })
            });
            const izmenjen = await procitaj(odgovor, 'Naziv nije sačuvan.');
            dobavljac.naziv = izmenjen.naziv;
            javi(`Naziv je promenjen u „${izmenjen.naziv}“.`, 'uspeh');
        } catch (greska) {
            javi(porukaGreske(greska), 'greska');
        }
        nacrtaj();
    };

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); zavrsi(true); }
        else if (event.key === 'Escape') { event.preventDefault(); zavrsi(false); }
    });
    input.addEventListener('blur', () => zavrsi(true));
}

telo.addEventListener('click', (event) => {
    const red = event.target.closest('tr.red-dobavljac');
    if (!red || red.classList.contains('menja-se')) return;

    if (event.target.closest('.izmeni')) {
        zapocniIzmenu(red);
        return;
    }
    // Klik bilo gde u redu (ne samo na naziv) otvara artikle dobavljača
    if (!event.target.closest('a')) {
        window.location.href = red.querySelector('.dobavljac-veza').href;
    }
});


// ---------- Sortiranje i pretraga ----------

document.querySelector('tr.naslovi').addEventListener('click', (event) => {
    const th = event.target.closest('th[data-kolona]');
    if (!th || !event.target.closest('.sortiraj')) return;
    const kolona = th.dataset.kolona;
    sort = (sort.kolona === kolona)
        ? { kolona, smer: sort.smer === 'asc' ? 'desc' : 'asc' }
        : { kolona, smer: BROJCANE.has(kolona) || kolona === 'poslednji_ulaz' ? 'desc' : 'asc' };
    nacrtaj();
});

pretraga.addEventListener('input', nacrtaj);


// ---------- Novi dobavljač ----------

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const naziv = poljeNaziv.value.trim();
    if (!naziv) {
        javi('Morate uneti bar jedno slovo za dobavljača!', 'greska');
        return;
    }
    const dugme = form.querySelector('button');
    dugme.disabled = true;
    try {
        const odgovor = await fetch('/dobavljaci', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ naziv })
        });
        if (odgovor.status === 409) throw new Error(`Dobavljač „${naziv}“ već postoji!`);
        await procitaj(odgovor, 'Dobavljač nije sačuvan.');
        form.reset();
        await ucitaj();
        const novi = dobavljaci.find((d) => d.naziv === naziv);
        noviId = novi ? novi.dobavljac_id : null;
        nacrtaj();
        javi(`Dobavljač „${naziv}“ je sačuvan.`, 'uspeh');
    } catch (greska) {
        javi(porukaGreske(greska), 'greska');
    } finally {
        dugme.disabled = false;
    }
});


ucitaj();
