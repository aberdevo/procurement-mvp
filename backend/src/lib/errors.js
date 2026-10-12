export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Forwards rejected promises from async route handlers to the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const conflict = (message = 'This request was just changed by someone else. Refresh and try again.') =>
  new HttpError(409, message);
