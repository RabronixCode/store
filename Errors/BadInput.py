class BadInput(Exception):
    """Neispravan zahtev sa jasnom porukom za korisnika.

    status: 400 (neispravan unos), 404 (ne postoji) ili 409 (sukob sa postojećim podacima).
    """
    def __init__(self, message="Neispravan unos.", status=400):
        self.message = message
        self.status = status
        super().__init__(self.message)
