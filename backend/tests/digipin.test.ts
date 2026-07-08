import { getDigiPin, getLatLngFromDigiPin } from '../src/utils/digipin';

describe('DIGIPIN Util', () => {
  it('encodes and decodes coordinates correctly', () => {
    const lat = 28.6139;
    const lon = 77.2090;

    const digipin = getDigiPin(lat, lon);
    expect(digipin).toBeDefined();
    expect(digipin.length).toBe(10);
    expect(/^[23456789CJKLMPFT]{10}$/.test(digipin)).toBe(true);

    const decoded = getLatLngFromDigiPin(digipin);
    
    // Decoding has some precision loss because it returns the center of the bounding box
    expect(Math.abs(decoded.latitude - lat)).toBeLessThan(0.001);
    expect(Math.abs(decoded.longitude - lon)).toBeLessThan(0.001);
  });

  it('throws error for out of bounds coordinates', () => {
    expect(() => getDigiPin(1, 70)).toThrow('Latitude out of range');
    expect(() => getDigiPin(40, 70)).toThrow('Latitude out of range');
    expect(() => getDigiPin(20, 60)).toThrow('Longitude out of range');
    expect(() => getDigiPin(20, 100)).toThrow('Longitude out of range');
  });

  it('throws error for invalid digipin string', () => {
    expect(() => getLatLngFromDigiPin('INVALID')).toThrow('continuous 10-character string');
    expect(() => getLatLngFromDigiPin('1234567890')).toThrow('Only approved DIGIPIN characters');
  });
});
