import { allocateEqualSplit } from '../src/utils/work-split';

const BIG = 1_000_000;
const caps = (...names: string[]) => names.map((district) => ({ district, cap: BIG }));
const obj = (m: Map<string, number>) => Object.fromEntries(m);
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('allocateEqualSplit', () => {
  it('gives a single district the whole quota', () => {
    expect(obj(allocateEqualSplit(caps('A'), 5000))).toEqual({ A: 5000 });
  });

  it('splits two districts 50/50', () => {
    expect(obj(allocateEqualSplit(caps('A', 'B'), 5000))).toEqual({ A: 2500, B: 2500 });
  });

  it('splits three districts 33/33/34 with the remainder on the last', () => {
    expect(obj(allocateEqualSplit(caps('A', 'B', 'C'), 5000))).toEqual({ A: 1666, B: 1666, C: 1668 });
  });

  it('splits four and five districts evenly', () => {
    expect(obj(allocateEqualSplit(caps('A', 'B', 'C', 'D'), 5000))).toEqual({ A: 1250, B: 1250, C: 1250, D: 1250 });
    expect(Object.values(obj(allocateEqualSplit(caps('A', 'B', 'C', 'D', 'E'), 5000)))).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it('always allocates exactly the quota when every district has room', () => {
    for (let n = 1; n <= 12; n++) {
      const names = Array.from({ length: n }, (_, i) => `D${String(i).padStart(2, '0')}`);
      expect(sum(allocateEqualSplit(caps(...names), 5000))).toBe(5000);
    }
  });

  it('is independent of input order', () => {
    const a = allocateEqualSplit(caps('C', 'A', 'B'), 5000);
    const b = allocateEqualSplit(caps('A', 'B', 'C'), 5000);
    expect(obj(a)).toEqual(obj(b));
  });

  it('holds a thin district at its cap and gives the surplus to the others equally', () => {
    const out = allocateEqualSplit(
      [{ district: 'A', cap: 300 }, { district: 'B', cap: BIG }, { district: 'C', cap: BIG }],
      5000,
    );
    expect(obj(out)).toEqual({ A: 300, B: 2350, C: 2350 });
  });

  it('cascades when the surplus pushes another district over its cap', () => {
    const out = allocateEqualSplit(
      [{ district: 'A', cap: 100 }, { district: 'B', cap: 2000 }, { district: 'C', cap: BIG }],
      5000,
    );
    expect(obj(out)).toEqual({ A: 100, B: 2000, C: 2900 });
  });

  it('allocates only what exists when every district is thin', () => {
    const out = allocateEqualSplit(
      [{ district: 'A', cap: 200 }, { district: 'B', cap: 300 }],
      5000,
    );
    expect(obj(out)).toEqual({ A: 200, B: 300 });
  });

  it('never exceeds a cap and never goes negative', () => {
    const out = allocateEqualSplit(
      [{ district: 'A', cap: 0 }, { district: 'B', cap: 10 }, { district: 'C', cap: BIG }],
      5000,
    );
    for (const v of out.values()) expect(v).toBeGreaterThanOrEqual(0);
    expect(out.get('A')).toBe(0);
    expect(out.get('B')).toBe(10);
    expect(out.get('C')).toBe(4990);
  });

  it('handles no districts', () => {
    expect(allocateEqualSplit([], 5000).size).toBe(0);
  });
});
