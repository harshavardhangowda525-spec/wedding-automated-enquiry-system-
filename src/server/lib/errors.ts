export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "app_error",
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found`, "not_found", 404);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that") {
    super(message, "forbidden", 403);
  }
}
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, "validation", 422);
  }
}
export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again later.") {
    super(message, "rate_limited", 429);
  }
}
