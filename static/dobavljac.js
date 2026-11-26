// ---------- Jedan dobavljač (vlasnik) ----------
//
// Adresa: /vlasnik/dobavljac.html?id=<dobavljac_id>
// Server: GET /dobavljaci/<id>          -> svi podaci + kontakti, racuni, jedinice, broj_artikala, broj_ulaza, poslednji_ulaz
//         GET /dobavljaci/<id>/artikli  -> { dobavljac, artikli: [{ sifra, naziv, sifra_dobavljac, jedinica_mere, stanje,
//                                          prodajna_cena, aktivan, nabavna_cena, pdv, nabavna_cena_pdv, poslednji_ulaz,
//                                          poslednji_dokument, ukupno_nabavljeno, broj_ulaza }] }
//         Izmene: dobavljac-forma.js (Dobavljaci.otvoriFormu / otvoriPodstavku / obrisiPodstavku)

const telo = document.getElementById('artikli-telo');
const sablon = document.getElementById('red-sablon');
const sablonKartica = document.getElementById('kartica-sablon');
const poruka = document.getElementById('poruka');
const nema = document.getElementById('nema-artikala');
const pretraga = document.getElementById('pretraga');
const dugmeIzmeni = document.getElementById('izmeni-dobavljaca');

const TEKSTUALNE = new Set(['naziv', 'sifra_dobavljac', 'jedinica_mere', 'poslednji_ulaz']);
const dobavljacId = Number(new URLSearchParams(location.search).get('id'));

let dobavljac = null;      // svi podaci (GET /dobavljaci/<id>)
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
    return String(tekst ?? '').toLowerCase().replaceAll('đ', 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Marža u % u odnosu na nabavnu cenu sa PDV (prodajna cena već sadrži PDV).
function marza(a) {
    if (!(a.nabavna_cena_pdv > 0)) return null;
    return (a.prodajna_cena - a.nabavna_cena_pdv) / a.nabavna_cena_pdv * 100;
}

function javi(tekst, vrsta = '') {
    poruka.textContent = tekst;
    poruka.className = vrsta;
    if (vrsta === 'uspeh') {
        clearTimeout(javi.tajmer);
        javi.tajmer = setTimeout(() => { if (poruka.textContent === tekst) javi(''); }, 4000);
    }
}

function porukaGreske(greska) {
    return greska.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : greska.message;
}

async function procitaj(odgovor, podrazumevanaGreska) {
    if (odgovor.status === 401) {
        window.location.href = '/login.html?greska=korisnik';
        throw new Error('Nisi prijavljen.');
    }
    if (odgovor.status === 403) throw new Error('Nemaš pravo da vidiš ove podatke.');
    const podaci = await odgovor.json().catch(() => null);
    if (!odgovor.ok) throw new Error(typeof podaci === 'string' ? podaci : podrazumevanaGreska);
    return podaci;
}

// Telefon/e-mail/web kao veza (href samo iz bezbednih šema; tekst ide kroz textContent)
function veza(vrsta, vrednost) {
    if (!vrednost) return document.createTextNode('—');
    const a = document.createElement('a');
    a.textContent = vrednost;
    if (vrsta === 'tel') a.href = `tel:${vrednost.replace(/[^\d+]/g, '')}`;
    else if (vrsta === 'mail') a.href = `mailto:${vrednost}`;
    else if (vrsta === 'web') {
        a.href = /^https?:\/\//i.test(vrednost) ? vrednost : `https://${vrednost}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
    }
    return a;
}


// ---------- Osnovni podaci ----------

function prikaziPodatke() {
    const d = dobavljac;
    document.getElementById('naziv-dobavljaca').textContent = d.naziv;
    document.title = `${d.naziv} – Dobavljač`;
    document.getElementById('dugi-naziv').textContent = d.dugi_naziv && d.dugi_naziv !== d.naziv ? d.dugi_naziv : '';
    document.getElementById('tip-dobavljaca').textContent = Dobavljaci.TIPOVI[d.tip] || 'Dobavljač';

    const znacke = document.getElementById('znacke');
    const znacka = (tekst, boja) => {
        const s = document.createElement('span');
        s.className = `znacka ${boja}`;
        s.textContent = tekst;
        return s;
    };
    znacke.replaceChildren(
        znacka(d.aktivan ? 'Aktivan' : 'Neaktivan', d.aktivan ? 'zelena' : 'siva'),
        znacka(d.pdv_obveznik ? 'PDV obveznik' : 'Nije PDV obveznik', d.pdv_obveznik ? 'plava' : 'siva'),
        ...(d.pib ? [] : [znacka('Nema PIB – dopuni podatke', 'narandzasta')])
    );

    const upisi = (ime, sadrzaj) => {
        const dd = document.querySelector(`.podaci-dobavljaca [data-polje="${ime}"]`);
        if (sadrzaj instanceof Node) dd.replaceChildren(sadrzaj);
        else dd.textContent = sadrzaj === null || sadrzaj === undefined || sadrzaj === '' ? '—' : sadrzaj;
        dd.classList.toggle('prazno', dd.textContent === '—');
    };
    ['pib', 'maticni_broj', 'registarski_broj', 'sifra_delatnosti', 'broj_gazdinstva', 'vlasnik', 'adresa', 'opstina', 'zemlja']
        .forEach((ime) => upisi(ime, d[ime]));
    upisi('mesto_ptt', [d.ptt_broj, d.mesto].filter(Boolean).join(' '));
    upisi('pdv_zona', Dobavljaci.PDV_ZONE[String(d.pdv_zona)] || d.pdv_zona);
    upisi('pdv_obveznik', d.pdv_obveznik ? 'Da' : 'Ne');
    upisi('e_faktura', d.e_faktura ? 'Da' : 'Ne');
    upisi('telefon', veza('tel', d.telefon));
    upisi('fax', d.fax);
    upisi('email', veza('mail', d.email));
    upisi('web', veza('web', d.web));
    upisi('el_dostava', d.el_dostava ? 'Da' : 'Ne');

    document.getElementById('k-ulaza').textContent = d.broj_ulaza;
    document.getElementById('k-poslednji').textContent = formatDatum(d.poslednji_ulaz);
    for (const vrsta of ['kontakti', 'racuni', 'jedinice']) {
        document.getElementById(`n-${vrsta}`).textContent = d[vrsta].length;
        nacrtajKartice(vrsta);
    }
    dugmeIzmeni.disabled = false;
}


// ---------- Kontakti, tekući računi, radne jedinice (kartice) ----------

const OPIS_KARTICA = {
    kontakti: {
        prazno: 'Još nema kontakata. Dodaj osobu ili centralu dobavljača.',
        naslov: (s) => s.naziv,
        podnaslov: (s) => [s.funkcija, s.sluzba].filter(Boolean).join(' · '),
        detalji: (s) => [['Telefon', veza('tel', s.telefon)], ['Mobilni', veza('tel', s.mobilni)], ['Fax', s.fax],
                         ['E-mail', veza('mail', s.email)], ['Web', veza('web', s.web)]],
    },
    racuni: {
        prazno: 'Još nema tekućih računa.',
        naslov: (s) => s.valuta === 'RSD' ? `${s.banka_sifra}-${s.broj_racuna}-${s.kontrolni_broj}` : s.broj_racuna,
        podnaslov: (s) => [s.banka_naziv, s.valuta].filter(Boolean).join(' · '),
        detalji: (s) => [['Dug konto', s.dug_konto], ['Pot konto', s.pot_konto]],
    },
    jedinice: {
        prazno: 'Još nema radnih jedinica (prodavnice, magacini…).',
        naslov: (s) => s.naziv,
        podnaslov: (s) => [s.adresa, [s.ptt_broj, s.mesto].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        detalji: (s) => [['GLN', s.gln], ['E-mail', veza('mail', s.email)], ['Dostava', s.dostava ? 'Da' : 'Ne'],
                         ['Status', s.aktivan ? 'Aktivna' : 'Neaktivna']],
    },
};

function nacrtajKartice(vrsta) {
    const lista = document.getElementById(`lista-${vrsta}`);
    const opis = OPIS_KARTICA[vrsta];
    const stavke = dobavljac[vrsta];
    if (stavke.length === 0) {
        const p = document.createElement('p');
        p.className = 'nema';
        p.textContent = opis.prazno;
        lista.replaceChildren(p);
        return;
    }
    lista.replaceChildren(...stavke.map((s) => {
        const k = sablonKartica.content.firstElementChild.cloneNode(true);
        k.dataset.id = s.id;
        k.dataset.vrsta = vrsta;
        if (s.aktivan === 0) k.classList.add('neaktivna');
        k.querySelector('[data-polje="naslov"]').textContent = opis.naslov(s);
        k.querySelector('[data-polje="podnaslov"]').textContent = opis.podnaslov(s);
        const dl = k.querySelector('[data-polje="detalji"]');
        opis.detalji(s).forEach(([oznaka, vrednost]) => {
            const div = document.createElement('div');
            const dt = document.createElement('dt');
            dt.textContent = oznaka;
            const dd = document.createElement('dd');
            if (vrednost instanceof Node) dd.append(vrednost); else dd.textContent = vrednost || '—';
            div.append(dt, dd);
            dl.append(div);
        });
        return k;
    }));
}

document.querySelector('main').addEventListener('click', async (event) => {
    const dodaj = event.target.closest('[data-dodaj]');
    const kartica = event.target.closest('.mala-kartica');
    try {
        if (dodaj) {
            const d = await Dobavljaci.otvoriPodstavku(dodaj.dataset.dodaj, dobavljacId, null);
            if (d) { dobavljac = d; prikaziPodatke(); javi('Sačuvano.', 'uspeh'); }
        } else if (kartica && event.target.closest('.izmeni')) {
            const vrsta = kartica.dataset.vrsta;
            const stavka = dobavljac[vrsta].find((s) => String(s.id) === kartica.dataset.id);
            const d = await Dobavljaci.otvoriPodstavku(vrsta, dobavljacId, stavka);
            if (d) { dobavljac = d; prikaziPodatke(); javi('Izmene su sačuvane.', 'uspeh'); }
        } else if (kartica && event.target.closest('.obrisi')) {
            const naslov = kartica.querySelector('[data-polje="naslov"]').textContent;
            if (!window.confirm(`Obrisati „${naslov}“? Ovo ne može da se vrati.`)) return;
            dobavljac = await Dobavljaci.obrisiPodstavku(kartica.dataset.vrsta, dobavljacId, kartica.dataset.id);
            prikaziPodatke();
            javi(`„${naslov}“ je obrisano.`, 'uspeh');
        }
    } catch (greska) {
        javi(porukaGreske(greska), 'greska');
    }
});

dugmeIzmeni.addEventListener('click', async () => {
    try {
        const d = await Dobavljaci.otvoriFormu(dobavljac);
        if (d) { dobavljac = d; prikaziPodatke(); javi('Podaci dobavljača su sačuvani.', 'uspeh'); }
    } catch (greska) {
        javi(porukaGreske(greska), 'greska');
    }
});


// ---------- Jezičci ----------

const jezicci = [...document.querySelectorAll('.jezicci [role="tab"]')];

function izaberiJezicak(tab, fokus = false) {
    jezicci.forEach((t) => {
        const izabran = t === tab;
        t.setAttribute('aria-selected', String(izabran));
        t.tabIndex = izabran ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !izabran;
    });
    if (fokus) tab.focus();
    try { sessionStorage.setItem('dobavljac-jezicak', tab.id); } catch { /* nije bitno */ }
}

document.querySelector('.jezicci').addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) izaberiJezicak(tab);
});
document.querySelector('.jezicci').addEventListener('keydown', (event) => {
    const i = jezicci.indexOf(document.activeElement);
    if (i < 0) return;
    if (event.key === 'ArrowRight') izaberiJezicak(jezicci[(i + 1) % jezicci.length], true);
    else if (event.key === 'ArrowLeft') izaberiJezicak(jezicci[(i - 1 + jezicci.length) % jezicci.length], true);
});
try {
    const zapamcen = document.getElementById(sessionStorage.getItem('dobavljac-jezicak') || '');
    if (zapamcen) izaberiJezicak(zapamcen);
} catch { /* nije bitno */ }


// ---------- Artikli ----------

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
        polje('poslednji_racun').textContent = a.poslednji_dokument || '';
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
    document.getElementById('n-artikli').textContent = artikli.length;
    document.getElementById('k-vrednost').textContent = `${formatBroj(vrednost)} RSD`;
}

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


// ---------- Učitavanje ----------

async function ucitaj() {
    if (!Number.isInteger(dobavljacId) || dobavljacId <= 0) {
        document.getElementById('naziv-dobavljaca').textContent = 'Dobavljač nije izabran';
        javi('Vrati se na spisak dobavljača i izaberi jednog.', 'greska');
        return;
    }
    try {
        const [ceo, podaci] = await Promise.all([
            procitaj(await fetch(`/dobavljaci/${dobavljacId}`), 'Podaci dobavljača ne mogu da se učitaju.'),
            fetch(`/dobavljaci/${dobavljacId}/artikli`).then((o) => procitaj(o, 'Artikli ne mogu da se učitaju.')),
            Dobavljaci.ucitajSifarnike().catch(() => null)
        ]);
        dobavljac = ceo;
        prikaziPodatke();
        artikli = podaci.artikli.map((a) => ({ ...a, marza: marza(a) }));
        popuniKartice();
        nacrtaj();
    } catch (greska) {
        document.getElementById('naziv-dobavljaca').textContent = 'Dobavljač';
        javi(porukaGreske(greska), 'greska');
    }
}

ucitaj();
