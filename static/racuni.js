// ---------- Pregled izdatih računa (kasir) ----------
//
// Ugovor sa serverom:
//   GET  /racuni?od=YYYY-MM-DDTHH:MM&do=...  -> { racuni: [{ racun_id, datum_vreme, korisnik, nacin_placanja, status,
//                                                broj_stavki, iznos, stornirano, neto }],
//                                                zbir: { gotovina, kartica, cek, ukupno, bruto, stornirano, broj_racuna } }
//   GET  /racuni/<id>        -> račun + stavke [{ stavka_id, sifra, naziv, jedinica_mere, kolicina, cena_po_komadu,
//                               iznos, stornirano, preostalo, stornirano_iznos }] + storna [{ storno_id, datum_vreme, iznos }]
//   POST /storna             telo: { racuni: [id...] } ili { stavke: [{ stavka_id, kolicina }] }
//                            -> { storno_id, pdf, ukupno, po_nacinu, broj_stavki, racuni }
//   PDF: /racuni/<id>/pdf, /storna/<id>/pdf

const NAZIV_NACINA = { gotovina: 'Gotovina', kartica: 'Kartica', cek: 'Ček' };
const NAZIV_STATUSA = { izdat: 'Izdat', delimicno_storniran: 'Delimično storniran', storniran: 'Storniran' };

const formaPeriod = document.getElementById('period');
const telo = document.getElementById('racuni-telo');
const sablonRacun = document.getElementById('racun-sablon');
const poruka = document.getElementById('poruka');
const filterStatus = document.getElementById('filter-status');

let podaci = null;          // poslednji odgovor GET /racuni
let otvorenRacun = null;    // račun u dijalogu


// ---------- Pomoćne ----------

const formatCena = (b) => Number(b).toLocaleString('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatKolicina = (b) => Number(b).toLocaleString('sr-RS', { maximumFractionDigits: 3 });
const dvocifreno = (n) => String(n).padStart(2, '0');

// Date -> "YYYY-MM-DDTHH:MM" (lokalno vreme, za input datetime-local)
function zaPolje(d) {
    return `${d.getFullYear()}-${dvocifreno(d.getMonth() + 1)}-${dvocifreno(d.getDate())}T${dvocifreno(d.getHours())}:${dvocifreno(d.getMinutes())}`;
}

// "2026-11-26 14:05:09" -> "26.11.2026. 14:05"
function formatDatumVreme(tekst) {
    const [d, v = ''] = String(tekst).split(' ');
    const [g, m, dan] = d.split('-');
    return `${dan}.${m}.${g}. ${v.slice(0, 5)}`.trim();
}

function javi(el, tekst, vrsta = '') {
    el.textContent = tekst;
    el.className = vrsta;
}

async function procitaj(odgovor, podrazumevanaGreska) {
    if (odgovor.status === 401) {
        window.location.href = '/login.html?greska=korisnik';
        throw new Error('Nisi prijavljen.');
    }
    if (odgovor.status === 403) throw new Error('Nemaš pravo na ovu radnju.');
    const telo = await odgovor.json().catch(() => null);
    if (!odgovor.ok) throw new Error(typeof telo === 'string' ? telo : podrazumevanaGreska);
    return telo;
}

const porukaGreske = (g) => (g.message === 'Failed to fetch' ? 'Nema veze sa serverom.' : g.message);

function vezaPdf(adresa, tekst) {
    const a = document.createElement('a');
    a.href = adresa;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = tekst;
    return a;
}

async function posaljiStorno(telo) {
    return procitaj(await fetch('/storna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telo)
    }), 'Storno nije uspeo.');
}

// Poruka posle storna: šta je urađeno i link na PDF
function porukaStorna(rezultat) {
    poruka.className = 'uspeh';
    poruka.replaceChildren(
        `Storno br. ${rezultat.storno_id}: stornirano ${rezultat.broj_stavki} stavki sa računa br. ${rezultat.racuni.join(', ')}, `
        + `ukupno ${formatCena(rezultat.ukupno)} RSD. Količine su vraćene na zalihe. `,
        vezaPdf(rezultat.pdf, '📄 Otvori PDF storna'));
}


// ---------- Period ----------

function postaviPeriod(vrsta) {
    const sada = new Date();
    let od = new Date(sada.getFullYear(), sada.getMonth(), sada.getDate(), 0, 0);
    let doo = new Date(sada.getFullYear(), sada.getMonth(), sada.getDate(), 23, 59);
    if (vrsta === 'juce') {
        od.setDate(od.getDate() - 1);
        doo.setDate(doo.getDate() - 1);
    } else if (vrsta === 'mesec') {
        od = new Date(sada.getFullYear(), sada.getMonth(), 1, 0, 0);
    }
    formaPeriod.elements.od.value = zaPolje(od);
    formaPeriod.elements.do.value = zaPolje(doo);
}

async function ucitaj() {
    const od = formaPeriod.elements.od.value, doo = formaPeriod.elements.do.value;
    if (!od || !doo) return javi(poruka, 'Upiši datum i vreme „od“ i „do“.', 'greska');
    if (od > doo) return javi(poruka, '„Od“ je posle „do“. Proveri period.', 'greska');
    try {
        podaci = await procitaj(await fetch(`/racuni?${new URLSearchParams({ od, do: doo })}`),
                                'Računi ne mogu da se učitaju.');
        nacrtaj();
    } catch (greska) {
        javi(poruka, porukaGreske(greska), 'greska');
    }
}

function nacrtaj() {
    const z = podaci.zbir;
    document.getElementById('z-gotovina').textContent = `${formatCena(z.gotovina)} RSD`;
    document.getElementById('z-kartica').textContent = `${formatCena(z.kartica)} RSD`;
    document.getElementById('z-cek').textContent = `${formatCena(z.cek)} RSD`;
    document.getElementById('z-ukupno').textContent = `${formatCena(z.ukupno)} RSD`;
    document.getElementById('z-broj').textContent = `${z.broj_racuna} računa`;
    document.getElementById('z-stornirano').textContent = z.stornirano ? `−${formatCena(z.stornirano)} RSD` : '0,00 RSD';
    document.getElementById('opis-perioda').textContent =
        `Period: ${formatDatumVreme(podaci.od)} – ${formatDatumVreme(podaci.do)}`;

    const status = filterStatus.value;
    const lista = podaci.racuni.filter((r) => !status || r.status === status);
    telo.replaceChildren(...lista.map((r) => {
        const red = sablonRacun.content.firstElementChild.cloneNode(true);
        const p = (ime) => red.querySelector(`[data-polje="${ime}"]`);
        red.dataset.id = r.racun_id;
        red.classList.toggle('storniran', r.status === 'storniran');
        p('racun_id').textContent = r.racun_id;
        p('datum_vreme').textContent = formatDatumVreme(r.datum_vreme);
        p('korisnik').textContent = r.korisnik;
        p('nacin_placanja').textContent = NAZIV_NACINA[r.nacin_placanja];
        p('nacin_placanja').classList.add(r.nacin_placanja);
        p('broj_stavki').textContent = r.broj_stavki;
        p('iznos').textContent = formatCena(r.iznos);
        p('stornirano').textContent = r.stornirano ? `−${formatCena(r.stornirano)}` : '';
        p('neto').textContent = formatCena(r.neto);
        p('status').textContent = NAZIV_STATUSA[r.status];
        p('status').classList.add(r.status);
        return red;
    }));
    const nema = document.getElementById('nema-racuna');
    nema.hidden = lista.length > 0;
    nema.textContent = podaci.racuni.length ? 'Nijedan račun sa tim statusom u ovom periodu.' : 'Nema izdatih računa u ovom periodu.';
}

formaPeriod.addEventListener('submit', (event) => {
    event.preventDefault();
    javi(poruka, '');
    ucitaj();
});
formaPeriod.querySelector('.brzo').addEventListener('click', (event) => {
    const dugme = event.target.closest('[data-period]');
    if (!dugme) return;
    postaviPeriod(dugme.dataset.period);
    javi(poruka, '');
    ucitaj();
});
filterStatus.addEventListener('change', () => podaci && nacrtaj());


// ---------- Jedan račun ----------

const dijalogRacun = document.getElementById('dijalog-racun');
const stavkeTelo = document.getElementById('stavke-telo');
const sablonStavka = document.getElementById('stavka-sablon');
const formaStornoArtikla = document.getElementById('storno-artikla');
const drPoruka = document.getElementById('dr-poruka');
let stavkaZaStorno = null;

async function otvoriRacun(id) {
    try {
        otvorenRacun = await procitaj(await fetch(`/racuni/${id}`), 'Račun ne može da se učita.');
    } catch (greska) {
        return javi(poruka, porukaGreske(greska), 'greska');
    }
    nacrtajRacun();
    javi(drPoruka, '');
    if (!dijalogRacun.open) dijalogRacun.showModal();
}

function nacrtajRacun() {
    const r = otvorenRacun;
    document.getElementById('racun-naslov').textContent = `Račun br. ${r.racun_id}`;
    document.getElementById('racun-podaci').textContent =
        `${formatDatumVreme(r.datum_vreme)} · kasir: ${r.korisnik} · plaćanje: ${NAZIV_NACINA[r.nacin_placanja]} · ${NAZIV_STATUSA[r.status]}`;
    stavkeTelo.replaceChildren(...r.stavke.map((s) => {
        const red = sablonStavka.content.firstElementChild.cloneNode(true);
        const p = (ime) => red.querySelector(`[data-polje="${ime}"]`);
        red.dataset.id = s.stavka_id;
        red.classList.toggle('storniran', s.preostalo <= 0);
        p('sifra').textContent = s.sifra;
        p('naziv').textContent = s.naziv;
        p('kolicina').textContent = `${formatKolicina(s.kolicina)} ${s.jedinica_mere}`;
        p('cena_po_komadu').textContent = formatCena(s.cena_po_komadu);
        p('iznos').textContent = formatCena(s.iznos);
        p('stornirano').textContent = s.stornirano
            ? `${formatKolicina(s.stornirano)} ${s.jedinica_mere} (−${formatCena(s.stornirano_iznos)})` : '';
        const dugme = red.querySelector('.storniraj-artikal');
        dugme.hidden = s.preostalo <= 0;
        dugme.setAttribute('aria-label', `Storniraj ${s.naziv}`);
        return red;
    }));
    document.getElementById('dr-iznos').textContent = `${formatCena(r.iznos)} RSD`;
    document.getElementById('dr-stornirano').textContent = r.stornirano ? `−${formatCena(r.stornirano)} RSD` : '—';
    document.getElementById('dr-neto').textContent = `${formatCena(r.neto)} RSD`;
    document.getElementById('dr-pdf').href = `/racuni/${r.racun_id}/pdf`;
    document.getElementById('dr-storniraj-ceo').hidden = r.status === 'storniran';
    const storna = document.getElementById('dr-storna');
    storna.replaceChildren();
    if (r.storna.length) {
        storna.append('Storna ovog računa: ');
        r.storna.forEach((st, i) => {
            if (i) storna.append(', ');
            storna.append(vezaPdf(`/storna/${st.storno_id}/pdf`,
                `br. ${st.storno_id} (${formatDatumVreme(st.datum_vreme)}, −${formatCena(st.iznos)} RSD)`));
        });
    }
    zatvoriStornoArtikla();
}

function zatvoriStornoArtikla() {
    stavkaZaStorno = null;
    formaStornoArtikla.hidden = true;
    stavkeTelo.querySelectorAll('tr.izabran').forEach((r) => r.classList.remove('izabran'));
}

function osveziIznosStorna() {
    const k = parseFloat(formaStornoArtikla.elements.kolicina.value);
    document.getElementById('sa-iznos').textContent =
        formatCena(Number.isFinite(k) && stavkaZaStorno ? k * stavkaZaStorno.cena_po_komadu : 0);
}

telo.addEventListener('click', (event) => {
    const red = event.target.closest('tr.red-racun');
    if (red) otvoriRacun(red.dataset.id);
});
telo.addEventListener('keydown', (event) => {
    const red = event.target.closest('tr.red-racun');
    if (red && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        otvoriRacun(red.dataset.id);
    }
});

stavkeTelo.addEventListener('click', (event) => {
    const dugme = event.target.closest('.storniraj-artikal');
    if (!dugme) return;
    const red = dugme.closest('tr');
    zatvoriStornoArtikla();
    stavkaZaStorno = otvorenRacun.stavke.find((s) => String(s.stavka_id) === red.dataset.id);
    red.classList.add('izabran');
    document.getElementById('sa-naziv').textContent = `${stavkaZaStorno.sifra} – ${stavkaZaStorno.naziv}`;
    document.getElementById('sa-max').textContent = `${formatKolicina(stavkaZaStorno.preostalo)} ${stavkaZaStorno.jedinica_mere}`;
    formaStornoArtikla.elements.kolicina.value = stavkaZaStorno.preostalo;
    formaStornoArtikla.elements.kolicina.max = stavkaZaStorno.preostalo;
    javi(document.getElementById('sa-greska'), '', 'greska-tekst');
    osveziIznosStorna();
    formaStornoArtikla.hidden = false;
    formaStornoArtikla.elements.kolicina.select();
});

formaStornoArtikla.elements.kolicina.addEventListener('input', osveziIznosStorna);
document.getElementById('sa-odustani').addEventListener('click', zatvoriStornoArtikla);

formaStornoArtikla.addEventListener('submit', async (event) => {
    event.preventDefault();
    const greska = document.getElementById('sa-greska');
    const k = parseFloat(formaStornoArtikla.elements.kolicina.value);
    if (!Number.isFinite(k) || k <= 0) return javi(greska, 'Upiši količinu veću od 0.', 'greska-tekst');
    if (k > stavkaZaStorno.preostalo + 1e-9) {
        return javi(greska, `Najviše ${formatKolicina(stavkaZaStorno.preostalo)} ${stavkaZaStorno.jedinica_mere}.`, 'greska-tekst');
    }
    const dugme = formaStornoArtikla.querySelector('button[type="submit"]');
    dugme.disabled = true;
    try {
        const rezultat = await posaljiStorno({ stavke: [{ stavka_id: stavkaZaStorno.stavka_id, kolicina: k }] });
        porukaStorna(rezultat);
        await otvoriRacun(otvorenRacun.racun_id);
        drPoruka.className = 'uspeh';
        drPoruka.replaceChildren(`Stornirano: ${formatCena(rezultat.ukupno)} RSD. `, vezaPdf(rezultat.pdf, '📄 PDF storna'));
        ucitaj();
    } catch (g) {
        javi(greska, porukaGreske(g), 'greska-tekst');
    } finally {
        dugme.disabled = false;
    }
});

document.getElementById('dr-storniraj-ceo').addEventListener('click', async () => {
    const r = otvorenRacun;
    if (!window.confirm(`Stornirati CEO račun br. ${r.racun_id} (${formatCena(r.neto)} RSD)?\n`
        + 'Sve količine se vraćaju na zalihe i pravi se PDF storna.')) return;
    try {
        const rezultat = await posaljiStorno({ racuni: [r.racun_id] });
        porukaStorna(rezultat);
        await otvoriRacun(r.racun_id);
        drPoruka.className = 'uspeh';
        drPoruka.replaceChildren(`Račun je storniran: ${formatCena(rezultat.ukupno)} RSD. `, vezaPdf(rezultat.pdf, '📄 PDF storna'));
        ucitaj();
    } catch (g) {
        javi(drPoruka, porukaGreske(g), 'greska');
    }
});

document.querySelectorAll('[data-zatvori]').forEach((d) => d.addEventListener('click', () => d.closest('dialog').close()));


// ---------- Storno više računa ----------

const dijalogStorno = document.getElementById('dijalog-storno');
const formaStorno = document.getElementById('forma-storno');
const stornoTelo = document.getElementById('storno-telo');
const izaberiSve = document.getElementById('izaberi-sve');
const stornoPotvrdi = document.getElementById('storno-potvrdi');
let zaStorno = [];          // računi u dijalogu koji mogu da se storniraju

async function ucitajZaStorno() {
    const od = formaStorno.elements.od.value, doo = formaStorno.elements.do.value;
    const greska = document.getElementById('storno-greska');
    javi(greska, '', 'greska-tekst');
    if (!od || !doo || od > doo) return javi(greska, 'Proveri period „od“ – „do“.', 'greska-tekst');
    try {
        const odgovor = await procitaj(await fetch(`/racuni?${new URLSearchParams({ od, do: doo })}`),
                                       'Računi ne mogu da se učitaju.');
        zaStorno = odgovor.racuni.filter((r) => r.status !== 'storniran');
    } catch (g) {
        return javi(greska, porukaGreske(g), 'greska-tekst');
    }
    stornoTelo.replaceChildren(...zaStorno.map((r) => {
        const red = document.createElement('tr');
        const celija = (tekst, klasa = '') => {
            const td = document.createElement('td');
            td.textContent = tekst;
            td.className = klasa;
            return td;
        };
        const izbor = document.createElement('td');
        const cek = document.createElement('input');
        cek.type = 'checkbox';
        cek.value = r.racun_id;
        cek.setAttribute('aria-label', `Storniraj račun br. ${r.racun_id}`);
        izbor.append(cek);
        const placanje = celija('');
        placanje.append(Object.assign(document.createElement('span'),
            { className: `znacka-placanja ${r.nacin_placanja}`, textContent: NAZIV_NACINA[r.nacin_placanja] }));
        red.append(izbor, celija(r.racun_id, 'desno jako'), celija(formatDatumVreme(r.datum_vreme)), placanje,
                   celija(formatCena(r.neto), 'desno'), celija(NAZIV_STATUSA[r.status]));
        return red;
    }));
    document.getElementById('storno-nema').hidden = zaStorno.length > 0;
    izaberiSve.checked = false;
    osveziIzbor();
}

function izabrani() {
    return [...stornoTelo.querySelectorAll('input:checked')].map((c) => zaStorno.find((r) => String(r.racun_id) === c.value));
}

function osveziIzbor() {
    const lista = izabrani();
    const iznos = lista.reduce((z, r) => z + r.neto, 0);
    document.getElementById('storno-broj').textContent = lista.length;
    document.getElementById('storno-iznos').textContent = formatCena(iznos);
    stornoPotvrdi.disabled = lista.length === 0;
    stornoPotvrdi.textContent = lista.length ? `↩ Storniraj izabrane (${lista.length}): ${formatCena(iznos)} RSD` : '↩ Storniraj izabrane';
    const svi = stornoTelo.querySelectorAll('input');
    izaberiSve.checked = svi.length > 0 && lista.length === svi.length;
    stornoTelo.querySelectorAll('tr').forEach((red) => red.classList.toggle('izabran', red.querySelector('input').checked));
}

document.getElementById('otvori-storno').addEventListener('click', () => {
    formaStorno.elements.od.value = formaPeriod.elements.od.value;
    formaStorno.elements.do.value = formaPeriod.elements.do.value;
    dijalogStorno.showModal();
    ucitajZaStorno();
});
document.getElementById('storno-prikazi').addEventListener('click', ucitajZaStorno);
izaberiSve.addEventListener('change', () => {
    stornoTelo.querySelectorAll('input').forEach((c) => { c.checked = izaberiSve.checked; });
    osveziIzbor();
});
stornoTelo.addEventListener('change', osveziIzbor);
stornoTelo.addEventListener('click', (event) => {   // klik bilo gde u redu menja izbor
    const red = event.target.closest('tr');
    if (!red || event.target.matches('input')) return;
    const cek = red.querySelector('input');
    cek.checked = !cek.checked;
    osveziIzbor();
});

formaStorno.addEventListener('submit', async (event) => {
    event.preventDefault();
    const lista = izabrani();
    if (!lista.length) return;
    const iznos = lista.reduce((z, r) => z + r.neto, 0);
    if (!window.confirm(`Stornirati ${lista.length} računa (br. ${lista.map((r) => r.racun_id).join(', ')}), `
        + `ukupno ${formatCena(iznos)} RSD?\nSve količine se vraćaju na zalihe i pravi se PDF storna.`)) return;
    stornoPotvrdi.disabled = true;
    try {
        const rezultat = await posaljiStorno({ racuni: lista.map((r) => r.racun_id) });
        dijalogStorno.close();
        porukaStorna(rezultat);
        ucitaj();
    } catch (g) {
        javi(document.getElementById('storno-greska'), porukaGreske(g), 'greska-tekst');
        stornoPotvrdi.disabled = false;
    }
});


// ---------- Odjava i početak ----------


postaviPeriod('danas');
ucitaj();
