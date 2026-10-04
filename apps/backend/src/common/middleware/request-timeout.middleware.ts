import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const TIMEOUT_MS = 10_000;

@Injectable()
export class RequestTimeoutMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setTimeout(TIMEOUT_MS, () => {
      res.status(503).json({ error: "timeout", message: "Request timed out" });
    });
    next();
  }
}
