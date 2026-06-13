import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIrDeduper } from './irDedup.js';

describe('createIrDeduper', () => {
  it("accepts a shooter's first shot", () => {
    const d = createIrDeduper();
    assert.equal(d.isNewShot(5, 1), true);
  });

  it('rejects an exact repeat (same shooter, same counter)', () => {
    const d = createIrDeduper();
    d.isNewShot(5, 1);
    assert.equal(d.isNewShot(5, 1), false);
  });

  it('accepts the same shooter once its counter advances', () => {
    const d = createIrDeduper();
    d.isNewShot(5, 1);
    assert.equal(d.isNewShot(5, 2), true);
  });

  // Regression test for the single-global-counter bug: two different shooters
  // that happen to share a 3-bit shot counter must BOTH register. A shared
  // counter would treat the second shooter's hit as a duplicate and drop it.
  it('accepts two different shooters that share a shot counter', () => {
    const d = createIrDeduper();
    assert.equal(d.isNewShot(5, 3), true);
    assert.equal(d.isNewShot(9, 3), true); // would be dropped by a global counter
  });

  it('tracks shooters independently when interleaved', () => {
    const d = createIrDeduper();
    assert.equal(d.isNewShot(1, 1), true); // A first
    assert.equal(d.isNewShot(2, 1), true); // B first
    assert.equal(d.isNewShot(1, 1), false); // A repeat
    assert.equal(d.isNewShot(1, 2), true); // A advances
    assert.equal(d.isNewShot(2, 1), false); // B repeat (unaffected by A)
  });

  it('treats a 3-bit counter wrap (7 -> 0) as a new shot', () => {
    const d = createIrDeduper();
    d.isNewShot(5, 7);
    assert.equal(d.isNewShot(5, 0), true);
  });

  it('forgets all shooters after reset()', () => {
    const d = createIrDeduper();
    d.isNewShot(5, 1);
    d.reset();
    assert.equal(d.isNewShot(5, 1), true); // same shot is new again post-reset
  });
});
