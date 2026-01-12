/**
 * Request validation middleware using Zod schemas
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodTypeDef } from 'zod';

export interface ValidationSchemas {
  body?: ZodSchema<unknown, ZodTypeDef, unknown>;
  query?: ZodSchema<unknown, ZodTypeDef, unknown>;
  params?: ZodSchema<unknown, ZodTypeDef, unknown>;
}

export function validateRequest(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.body !== undefined) {
        req.body = schemas.body.parse(req.body);
      }

      if (schemas.query !== undefined) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }

      if (schemas.params !== undefined) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
