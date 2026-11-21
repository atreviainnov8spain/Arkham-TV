const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const window = {};
vm.runInNewContext(fs.readFileSync("web/ai.js", "utf8"), { window });
const rows = [
  { id: 1, start: 0, end: 4, text: "Una frase que" },
  { id: 2, start: 4, end: 8, text: "continúa en el siguiente fragmento." },
  { gap: true, start: 8, end: 10, reason: "source-audio" },
  { id: 3, start: 10, end: 14, text: "Otra intervención." },
  { id: 4, start: 14, end: 18, text: "— Habla otra persona." },
];
const groups = window.groupTranscriptParagraphs(rows);
assert.equal(groups.length, 4);
assert.equal(groups[0].rows.length, 2);
assert.equal(groups[1].gap.reason, "source-audio");
assert.equal(groups[3].rows[0].id, 4);
const all = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, start: i * 4, end: i * 4 + 4, text: "Palabras del fragmento " + i }));
const text = window.groupTranscriptParagraphs(all).flatMap(group => group.rows || []);
assert.equal(text.length, 150);
assert.equal(text.map(row => row.text).join(" "), all.map(row => row.text).join(" "));
assert.equal(text[0].id, 1);
assert.equal(text.at(-1).id, 150);
console.log("Lectura: une frases sin alterar palabras, conserva huecos, intervenciones y 150 fragmentos.");
