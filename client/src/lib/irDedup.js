// Per-shooter IR shot de-duplication.
//
// Each gun stamps a 3-bit shot counter into the IR packets it transmits, and
// that counter is independent per gun. A telemetry frame can also carry the
// same shot in both of its two IR-event slots. So a received hit is a duplicate
// only when THIS shooter's counter is unchanged from the last hit we accepted
// for that same shooter. Keying on a single shared counter (across all shooters
// and both slots) silently drops a hit whenever two simultaneous attackers'
// 3-bit counters happen to coincide.
export function createIrDeduper() {
  const lastShotByShooter = new Map();
  return {
    // Forget all shooters (call on (re)connect so a stale counter from a
    // previous session can't mask the first hit of a new one).
    reset() {
      lastShotByShooter.clear();
    },
    // True if (shooterID, shotCount) is a hit we haven't seen yet. Records it.
    isNewShot(shooterID, shotCount) {
      if (lastShotByShooter.get(shooterID) === shotCount) return false;
      lastShotByShooter.set(shooterID, shotCount);
      return true;
    },
  };
}
