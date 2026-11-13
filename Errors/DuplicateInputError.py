class DuplicateInputError(Exception):
    def __init__(self, message="Korisnik vec postoji!"):
        self.message = message
        super().__init__(self.message)
    