class NotLoggedIn(Exception):
    def __init__(self, message="Niste prijavljeni, molimo Vas da se prijavite!"):
        self.message = message
        super().__init__(self.message)
    