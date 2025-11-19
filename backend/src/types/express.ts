import { Request, Response } from 'express';
import { UserWithoutDates } from './user';

export interface AuthenticatedRequest extends Request {
  user: UserWithoutDates;
}

export type AsyncRequestHandler = (req: AuthenticatedRequest, res: Response) => Promise<void | any>;
export type RequestHandler = (req: AuthenticatedRequest, res: Response) => void | any; 