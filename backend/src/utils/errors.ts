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

/**
 * Raised when a field enumerator signs in while another phone still has a live
 * session. The client turns it into a confirmation; retrying with `takeover` signs
 * the other phone out.
 */
export class SessionActiveElsewhereError extends AppError {
  public errors: any[];

  constructor(lastActiveAt: Date) {
    super(
      'You are already signed in on another phone. Continuing will sign that phone out.',
      409,
      'SESSION_ACTIVE_ELSEWHERE'
    );
    this.errors = [{ lastActiveAt: lastActiveAt.toISOString() }];
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}
