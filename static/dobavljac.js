// ---------- Artikli jednog dobavljača (vlasnik) ----------
//
// Adresa: /vlasnik/dobavljac.html?id=<dobavljac_id>
// Server: GET /dobavljaci/<id>/artikli -> { dobavljac: { dobavljac_id, naziv },
//           artikli: [{ sifra, naziv, sifra_dobavljac, jedinica_mere, stanje, prodajna_cena,
//                       aktivan, nabavna_cena, pdv, nabavna_cena_pdv, poslednji_ulaz,
//                       poslednji_racun, ukupno_nabavljeno, broj_ulaza }] }

const telo = document.getElementById('artikli-telo');
const sablon = document.getElementById('red-sablon');
const poruka = document.getElementById('poruka');
const nema = document.getElementById('nema-artikala');
const pretraga = document.getElementById('pretraga');

const TEKSTUALNE = new Set(['naziv', 'sifra_dobavljac', 'jedinica_mere', 'poslednji_ulaz']);

let artikli = [];
let sort = { kolona: 'sifra', smer: 'asc' };


// ---------- Pomoćne ----------

function formatBroj(broj, decimala = 2) {
    return Number(broj).toLocaleString('sr-RS', { minimumFractionDigits: decimala, maximumFractionDigits: decimala });
}

function formatKolicina(broj) {
    return Number(broj).toLocaleString('sr-RS', { maximumFractionDigits: 3 });
}

function formatDatum(datum) {
    if (!datum) return '—';
    const [g, m, d] = String(datum).slice(0, 10).split('-');
    return d && m && g ? `${d}.${m}.${g}.` : datum;
}

function normalizuj(tekst) {
    return String(tekst ?? '')
        .toLowerCase()
        .replaceAll('đ', 'dj')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

// Marža u % u odnosu na nabavnu cenu sa PDV (prodajna cena već sadrži PDV).
// null kad nema nabavne cene (deljenje nulom nema smisla).
function marza(a) {
    if (!(a.nabavna_cena_pdv > 0)) return null;
    return (a.prodajna_cena - a.nabavna_cena_pdv) / a.nabavna_cena_pdv * 100;
}

function javi(tekst, vrsta = '') {
    poruka.textContent = tekst;
    poruka.className = vrsta;
}


// ---------- Crtanje ----------

function uporedi(a, b) {
    const { kolona, smer } = sort;
    const x = a[kolona], y = b[kolona];
    const praznoX = x === null || x === '', praznoY = y === null || y === '';
    if (praznoX && praznoY) return a.sifra - b.sifra;
    if (praznoX) return 1;
    if (praznoY) return -1;
    const r = TEKSTUALNE.has(kolona)
        ? String(x).localeCompare(String(y), 'sr', { numeric: true, sensitivity: 'base' })
        : x - y;
    return (smer === 'desc' ? -r : r) || a.sifra - b.sifra;
}

function nacrtaj() {
    const trazi = normalizuj(pretraga.value.trim());
    const lista = artikli
        .filter((a) => !trazi
            || normalizuj(a.naziv).includes(trazi)
            || String(a.sifra).includes(trazi)
            || normalizuj(a.sifra_dobavljac).includes(trazi))
        .sort(uporedi);

    telo.replaceChildren(...lista.map((a) => {
        const red = sablon.content.firstElementChild.cloneNode(true);
        red.classList.toggle('neaktivan', !a.aktivan);
        const polje = (ime) => red.querySelector(`[data-polje="${ime}"]`);

        polje('sifra').textContent = a.sifra;
        polje('naziv').textContent = a.naziv || '—';
        polje('sifra_dobavljac').textContent = a.sifra_dobavljac ?? '—';
        polje('jedinica_mere').textContent = a.jedinica_mere || '—';
        // * = cena još nije potvrđena nijednim ulazom robe
        polje('nabavna_cena').textContent = formatBroj(a.nabavna_cena) + (a.broj_ulaza === 0 ? ' *' : '');
        polje('pdv').textContent = `${formatKolicina(a.pdv)}%`;
        polje('nabavna_cena_pdv').textContent = formatBroj(a.nabavna_cena_pdv);
        polje('prodajna_cena').textContent = formatBroj(a.prodajna_cena);

        const m = polje('marza');
        if (a.marza === null) {
            m.textContent = '—';
            m.classList.add('prigusen');
        } else {
            m.textContent = `${formatBroj(a.marza, 1)}%`;
            m.classList.add(a.marza < 0 ? 'minus' : 'pozitivno');
        }

        const s = polje('stanje');
        s.textContent = formatKolicina(a.stanje);
        if (a.stanje < 0) s.classList.add('minus');

        polje('ukupno_nabavljeno').textContent = `${formatKolicina(a.ukupno_nabavljeno)} ${a.jedinica_mere || ''}`.trim();
        polje('poslednji_ulaz').textContent = formatDatum(a.poslednji_ulaz);
        polje('poslednji_racun').textContent = a.poslednji_racun ? `račun ${a.poslednji_racun}` : '';
        return red;
    }));

    nema.hidden = lista.length > 0;
    nema.textContent = artikli.length === 0
        ? 'Ovaj dobavljač još nema nijedan artikal. Artikli se povezuju kroz ulaz robe.'
        : 'Nijedan artikal ne odgovara pretrazi.';

    document.querySelectorAll('tr.naslovi th[data-kolona]').forEach((th) => {
        const aktivna = th.dataset.kolona === sort.kolona;
        th.setAttribute('aria-sort', aktivna ? (sort.smer === 'asc' ? 'ascending' : 'descending') : 'none');
    });
}

function popuniKartice() {
    const vrednost = artikli
        .filter((a) => a.stanje > 0)
        .reduce((zbir, a) => zbir + a.stanje * a.nabavna_cena_pdv, 0);
    document.getElementById('k-artikala').textContent = artikli.length;
    document.getElementById('k-aktivnih').textContent = artikli.filter((a) => a.aktivan).length;
    document.getElementById('k-vrednost').textContent = `${formatBroj(vrednost)} RSD`;
}

async function ucitaj() {
    const id = Number(new URLSearchParams(location.search).get('id'));
    if (!Number.isInteger(id) || id <= 0) {
        document.getElementById('naziv-dobavljaca').textContent = 'Dobavljač nije izabran';
        javi('Vrati se na spisak dobavljača i izaberi jednog.', 'greska');
        return;
    }

    try {
        const odgovor = await fetch(`/dobavljaci/${id}/artikli`);
        if (odgovor.status === 401) {
            window.location.href = '/login.html?greska=korisnik';
            return;
        }
        if (odgovor.status === 403) throw new Error('Nemaš pravo da vidiš ove podatke.');
        const podaci = await odgovor.json().catch(() => null);
        if (!odgovor.ok) throw new Error(typeof podaci === 'string' ? podaci : 'Podaci trenutno ne mogu da se učitaju.');

        document.getElementById('naziv-dobavljaca').textContent = podaci.dobavljac.naziv;
        document.title = `${podaci.dobavljac.naziv} – Dobavljač`;
        artikli = podaci.artikli.map((a) => ({ ...a, marza: marza(a) }));
        popuniKartice();
        nacrtaj();
    } catch (greska) {
        document.getElementById('naziv-dobavljaca').textContent = 'Dobavljač';
        javi(greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message, 'greska');
    }
}


// ---------- Događaji ----------

document.querySelector('tr.naslovi').addEventListener('click', (event) => {
    const th = event.target.closest('th[data-kolona]');
    if (!th || !event.target.closest('.sortiraj')) return;
    const kolona = th.dataset.kolona;
    sort = (sort.kolona === kolona)
        ? { kolona, smer: sort.smer === 'asc' ? 'desc' : 'asc' }
        : { kolona, smer: 'asc' };
    nacrtaj();
});

pretraga.addEventListener('input', nacrtaj);

ucitaj();
