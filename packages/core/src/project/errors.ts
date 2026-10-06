export class ImportError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Fehler einer Projektoperation mit verständlicher Meldung für die Oberfläche. */
export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}
