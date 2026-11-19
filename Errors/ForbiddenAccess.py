class ForbiddenAccess(Exception):
    def __init__(self, message="Nemate pristup ovoj stranici, za vise informacija obratite se adminu!"):
        self.message = message
        super().__init__(self.message)
    