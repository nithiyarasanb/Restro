// Domain errors carry a stable machine code and an HTTP status. Route
// handlers map them to {code, message, requestId, details}.

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STALE_STATE"
  | "INVALID_TRANSITION"
  | "ITEM_UNAVAILABLE"
  | "BRANCH_NOT_ACCEPTING"
  | "QR_INVALID"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "PAYMENT_NOT_ALLOWED"
  | "PAYMENT_MISMATCH"
  | "INVALID_SIGNATURE"
  | "PROVIDER_ERROR"
  | "REFUND_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "CSRF_REJECTED"
  | "FEATURE_DISABLED"
  | "DATA_SOURCE_UNAVAILABLE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE_STATE: 409,
  INVALID_TRANSITION: 422,
  ITEM_UNAVAILABLE: 422,
  BRANCH_NOT_ACCEPTING: 422,
  QR_INVALID: 404,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  PAYMENT_NOT_ALLOWED: 422,
  PAYMENT_MISMATCH: 422,
  INVALID_SIGNATURE: 401,
  PROVIDER_ERROR: 502,
  REFUND_NOT_ALLOWED: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  CSRF_REJECTED: 403,
  FEATURE_DISABLED: 422,
  DATA_SOURCE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = "Resource") => new DomainError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have permission to do this") => new DomainError("FORBIDDEN", message);

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
