import { Request, Response } from 'express';
import { digipinService } from './digipin.service';
import { z } from 'zod';

const encodeSchema = z.object({
  latitude: z.number().min(2.5).max(38.5),
  longitude: z.number().min(63.5).max(99.5),
});

const decodeSchema = z.object({
  digipin: z.string().length(10),
});

export const digipinController = {
  encode: (req: Request, res: Response) => {
    try {
      const data = encodeSchema.parse(req.body);
      const result = digipinService.encode(data.latitude, data.longitude);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Invalid parameters' });
    }
  },

  decode: (req: Request, res: Response) => {
    try {
      const data = decodeSchema.parse(req.body);
      const result = digipinService.decode(data.digipin);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Invalid parameters' });
    }
  },
};
