const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const window = {};
vm.runInNewContext(fs.readFileSync("web/ai.js", "utf8"), { window });
const make = () => window.createLinuxAIPlaybackHealth();
const frame = (i, active, dropRate = .25, time = i * 1.6) => ({
  wall: i * 1600, time, active, readyState: 4, total: i * 40, dropped: i * 40 * dropRate,
});

// A high-resolution compositor's steady drop rate is not an AI-induced stall.
const steady = make();
for (let i = 0; i < 6; i++) steady(frame(i, false));
for (let i = 6; i < 15; i++) assert.notEqual(steady(frame(i, true)), false);

// If started without a baseline, guard once, then recover when the clock advances.
const cold = make(), changes = [];
for (let i = 0; i < 15; i++) {
  const value = cold(frame(i, true));
  if (value !== null) changes.push(value);
}
assert.deepEqual(changes, [false, true]);

// Genuine stalls suspend inference and healthy playback releases it.
const stall = make();
stall(frame(0, true));
stall({ ...frame(1, true, 0, 0), readyState: 2 });
assert.equal(stall({ ...frame(2, true, 0, 0), readyState: 2 }), false);
assert.equal(stall(frame(3, true, 0, 1.6)), null);
assert.equal(stall(frame(4, true, 0, 3.2)), null);
assert.equal(stall(frame(5, true, 0, 4.8)), true);

// Counter resets, seeking and a hidden window cannot trigger a false suspension.
const reset = make();
reset(frame(10, true));
assert.equal(reset(frame(0, true)), null);
assert.equal(reset(null), null);
assert.equal(reset(frame(12, true)), null);
console.log("Linux playback: stable compositor drops, recovery, stalls and counter resets verified.");
