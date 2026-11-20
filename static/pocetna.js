document.getElementById('odjava').addEventListener('click', async (event) => {
    event.preventDefault();
    const response = await fetch('/logout');
    window.location.href = '/login.html'
});