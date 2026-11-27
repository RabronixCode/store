// ---------- Zaglavlje aplikacije (isto na svim stranicama) ----------
//
// Upotreba: <body data-uloga="vlasnik"> (ili "kasir"; bez uloge = samo naziv radnje, npr. prijava)
// i odmah na početku body-ja: <script src="/zaglavlje.js"></script>
// Skripta sama ubaci zaglavlje sa nazivom radnje, menijem i dugmetom za odjavu.
// Izgled (boje, veličine) je u tema.css i style.css (deo "Zaglavlje aplikacije").

(() => {
    // ---- Podešavanja: naziv radnje i stavke menija ----
    const NAZIV_RADNJE = 'Prodavnica';
    const MENI = {
        vlasnik: [
            { href: '/pocetna.html', tekst: 'Početna', ikona: 'kuca' },
            { href: '/vlasnik/artikli.html', tekst: 'Artikli', ikona: 'kutija' },
            { href: '/vlasnik/dobavljaci.html', tekst: 'Dobavljači', ikona: 'kamion', i: ['/vlasnik/dobavljac.html'] },
            { href: '/vlasnik/ulaz.html', tekst: 'Ulaz robe', ikona: 'ulaz' },
            { href: '/vlasnik/ulazi.html', tekst: 'Svi ulazi', ikona: 'spisak' },
            { href: '/vlasnik/finansije.html', tekst: 'Finansije', ikona: 'grafik' },
        ],
        kasir: [
            { href: '/kasa/kasa.html', tekst: 'Kasa', ikona: 'korpa' },
            { href: '/kasa/racuni.html', tekst: 'Izdati računi', ikona: 'racun' },
        ],
    };
    const NAZIV_ULOGE = { vlasnik: 'Vlasnik', kasir: 'Kasir' };

    // Jednostavne ikonice (linije, 24×24)
    const IKONE = {
        radnja: 'M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6',
        kuca: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
        kutija: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
        kamion: 'M2 6h11v10H2zM13 9h5l3 3v4h-8M5 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
        ulaz: 'M12 3v11M7 9l5 5 5-5M4 15v5h16v-5',
        spisak: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
        grafik: 'M4 20V11M10 20V5M16 20v-8M21 20H3',
        korpa: 'M3 4h2l2.4 11h11.2L21 7H6.2M8 20a1 1 0 1 0 2 0a1 1 0 1 0-2 0M17 20a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
        racun: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
        odjava: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
        meni: 'M4 6h16M4 12h16M4 18h16',
        zatvori: 'M6 6l12 12M18 6L6 18',
    };
    const ikona = (ime) =>
        `<svg class="ikona-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${IKONE[ime]}"/></svg>`;
    const zastiti = (t) => String(t).replace(/[&<>"]/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));

    const uloga = document.body.dataset.uloga || '';
    const stavke = MENI[uloga] || [];
    const putanja = window.location.pathname;
    const pocetna = stavke[0]?.href || '/login.html';

    const zaglavlje = document.createElement('header');
    zaglavlje.className = 'app-zaglavlje';
    zaglavlje.innerHTML = `
      <a class="preskoci" href="#sadrzaj">Preskoči na sadržaj</a>
      <div class="app-zaglavlje-unutra">
        <a class="app-naziv" href="${pocetna}">${ikona('radnja')}<span>${zastiti(NAZIV_RADNJE)}</span></a>
        ${stavke.length ? `
        <button type="button" class="meni-dugme" aria-expanded="false" aria-controls="app-meni">
          <span class="meni-otvori">${ikona('meni')} Meni</span>
          <span class="meni-zatvori">${ikona('zatvori')} Zatvori</span>
        </button>
        <nav id="app-meni" class="app-meni" aria-label="Glavni meni">
          <ul>
            ${stavke.map((s) => {
                const aktivna = putanja === s.href || (s.i || []).includes(putanja);
                return `<li><a href="${s.href}"${aktivna ? ' aria-current="page"' : ''}>${ikona(s.ikona)}<span>${zastiti(s.tekst)}</span></a></li>`;
            }).join('')}
          </ul>
          <div class="app-korisnik">
            <span class="app-uloga">${zastiti(NAZIV_ULOGE[uloga] || uloga)}</span>
            <button type="button" class="app-odjava">${ikona('odjava')}<span>Odjavi se</span></button>
          </div>
        </nav>` : ''}
      </div>`;
    document.body.prepend(zaglavlje);

    // Sadržaj stranice: cilj za "Preskoči na sadržaj"
    const postaviSadrzaj = () => {
        const main = document.querySelector('main');
        if (main && !main.id) main.id = 'sadrzaj';
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postaviSadrzaj);
    else postaviSadrzaj();

    if (!stavke.length) return;

    // Meni na telefonu i tabletu: otvara se i zatvara dugmetom
    const dugme = zaglavlje.querySelector('.meni-dugme');
    const meni = zaglavlje.querySelector('.app-meni');
    const postavi = (otvoren) => {
        dugme.setAttribute('aria-expanded', String(otvoren));
        zaglavlje.classList.toggle('otvoren', otvoren);
    };
    dugme.addEventListener('click', () => postavi(dugme.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && zaglavlje.classList.contains('otvoren')) { postavi(false); dugme.focus(); }
    });
    document.addEventListener('click', (e) => {
        if (zaglavlje.classList.contains('otvoren') && !zaglavlje.contains(e.target)) postavi(false);
    });
    meni.addEventListener('click', (e) => { if (e.target.closest('a')) postavi(false); });

    zaglavlje.querySelector('.app-odjava').addEventListener('click', async () => {
        try { await fetch('/logout'); } finally { window.location.href = '/login.html'; }
    });
})();
