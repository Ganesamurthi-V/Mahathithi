import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public code: string;

  constructor(message: string, statusCode: number, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/**
 * The account was deactivated by an admin. Its own code, so the phone can tell it
 * apart from an ordinary expired session and wipe the cached data.
 */
export class AccountDeactivatedError extends AppError {
  constructor() {
    super('Account has been deactivated', 401, 'ACCOUNT_DEACTIVATED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ValidationError extends AppError {
  public errors: any[];

  constructor(message: string = 'Validation failed', errors: any[] = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

/** Fields of an existing stakeholder that a duplicate-name refusal can point at. */
export interface DuplicateStakeholderMatch {
  id?: string;
  name: string | null;
  district: string | null;
  city: string | null;
  pinCode?: string | null;
  status?: string | null;
}

/**
 * Creating or renaming a stakeholder would duplicate another business name in the same district.
 *
 * Its own code (not ConflictError's 'CONFLICT') so clients can recognise it and offer to open the
 * existing record. The message is a complete sentence for clients that only print it. `existing`
 * carries the record for the admin panel; a field enumerator gets only the name, district and city,
 * so a closed or unassigned record's id and status are not exposed to them.
 */
export class DuplicateStakeholderError extends AppError {
  public errors: any[];

  constructor(existing: DuplicateStakeholderMatch, revealDetails: boolean) {
    const where = existing.district ? ` in ${existing.district}` : '';
    const city = existing.city ? ` (${existing.city})` : '';
    const message = `A business named "${existing.name ?? ''}" already exists${where}${city}`;
    super(message, 409, 'DUPLICATE_STAKEHOLDER');
    this.errors = [
      {
        field: 'companyNameStandardized',
        message,
        existing: revealDetails
          ? {
              id: existing.id,
              name: existing.name,
              district: existing.district,
              city: existing.city,
              pinCode: existing.pinCode ?? null,
              status: existing.status ?? null,
            }
          : { name: existing.name, district: existing.district, city: existing.city },
      },
    ];
  }
}
