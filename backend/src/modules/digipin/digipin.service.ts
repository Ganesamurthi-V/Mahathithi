import { getDigiPin, getLatLngFromDigiPin } from '../../utils/digipin';

export class DigipinService {
  encode(latitude: number, longitude: number): { digipin: string } {
    const digipin = getDigiPin(latitude, longitude);
    return { digipin };
  }

  decode(digipin: string): { latitude: number; longitude: number } {
    return getLatLngFromDigiPin(digipin);
  }
}

export const digipinService = new DigipinService();
