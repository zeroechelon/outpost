/**
 * Custom error classes for Outpost V2 Control Plane
 */

export abstract class OutpostError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class ValidationError extends OutpostError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;
}

export class AuthenticationError extends OutpostError {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly statusCode = 401;
}

export class AuthorizationError extends OutpostError {
  readonly code = 'AUTHORIZATION_ERROR';
  readonly statusCode = 403;
}

export class NotFoundError extends OutpostError {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;
}

export class ConflictError extends OutpostError {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;
}

export class RateLimitError extends OutpostError {
  readonly code = 'RATE_LIMIT_EXCEEDED';
  readonly statusCode = 429;
}

export class ServiceUnavailableError extends OutpostError {
  readonly code = 'SERVICE_UNAVAILABLE';
  readonly statusCode = 503;
}

export class InternalError extends OutpostError {
  readonly code = 'INTERNAL_ERROR';
  readonly statusCode = 500;
}

export class JobExecutionError extends OutpostError {
  readonly code = 'JOB_EXECUTION_ERROR';
  readonly statusCode = 500;
  readonly jobId: string;

  constructor(jobId: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.jobId = jobId;
  }
}

export class WorkspaceError extends OutpostError {
  readonly code = 'WORKSPACE_ERROR';
  readonly statusCode = 500;
  readonly workspaceId: string;

  constructor(workspaceId: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.workspaceId = workspaceId;
  }
}

export class AgentError extends OutpostError {
  readonly code = 'AGENT_ERROR';
  readonly statusCode = 500;
  readonly agentType: string;

  constructor(agentType: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.agentType = agentType;
  }
}

/**
 * Type guard to check if error is an OutpostError
 */
export function isOutpostError(error: unknown): error is OutpostError {
  return error instanceof OutpostError;
}
