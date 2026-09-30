import { ERROR_STATUS, type ApiErrorResponse, type ErrorCode, type TransactionField } from '../shared/contract.ts';

export type FieldErrors = Partial<Record<TransactionField, string>>;

/** A contract error: the HTTP layer sends it as-is, the bot and MCP show `message`. */
export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldErrors;

  constructor(code: ErrorCode, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = fields && Object.keys(fields).length > 0 ? fields : undefined;
  }

  toResponse(): ApiErrorResponse {
    return { error: { code: this.code, message: this.message, ...(this.fields && { fields: this.fields }) } };
  }
}
