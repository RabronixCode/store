document.getElementById('odjava').addEventListener('click', (event) => {
    event.preventDefault();
    const response = fetch('/logout');
    window.location.href = '/login.html'
});