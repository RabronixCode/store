// Početna vlasnika: pozdrav prema dobu dana i današnji datum.
(() => {
    const sat = new Date().getHours();
    const pozdrav = sat < 10 ? 'Dobro jutro' : sat < 18 ? 'Dobar dan' : 'Dobro veče';
    document.getElementById('pozdrav').textContent = pozdrav;
    const datum = new Date().toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('danasnji-datum').textContent = datum.charAt(0).toUpperCase() + datum.slice(1);
})();
