/* Boxes & Lines — tiny zero-dependency test harness.
 * Installs an in-memory localStorage shim, collects tests per file,
 * and prints a final summary. Used by tests/run.js.
 */
'use strict';

// ---------- in-memory localStorage shim ----------
(function installLocalStorage() {
  var data = {};
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[String(k)] = String(v); },
    removeItem: function (k) { delete data[k]; },
    clear: function () { data = {}; },
    get length() { return Object.keys(data).length; },
    key: function (i) { return Object.keys(data)[i]; },
    __data: data
  };
})();

var suites = []; // [{file, name, fn}]
var currentFile = '(unknown)';

function beginFile(name) { currentFile = name; }

function test(name, fn) { suites.push({ file: currentFile, name: name, fn: fn }); }

function deepEq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
}

function fmt(v) {
  try { var s = JSON.stringify(v); return s && s.length > 120 ? s.slice(0, 120) + '…' : s; }
  catch (e) { return String(v); }
}

function eq(a, b, msg) {
  if (!deepEq(a, b)) throw new Error((msg || 'eq failed') + ': expected ' + fmt(b) + ', got ' + fmt(a));
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'ok failed');
}

function run() {
  var passed = 0, failed = 0, byFile = {};
  suites.forEach(function (t) {
    try {
      t.fn();
      passed++;
      byFile[t.file] = byFile[t.file] || { pass: 0, fail: 0 };
      byFile[t.file].pass++;
    } catch (e) {
      failed++;
      byFile[t.file] = byFile[t.file] || { pass: 0, fail: 0 };
      byFile[t.file].fail++;
      console.log('FAIL [' + t.file + '] ' + t.name + '\n  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e));
    }
  });
  Object.keys(byFile).forEach(function (f) {
    console.log(f + ': ' + byFile[f].pass + ' passed, ' + byFile[f].fail + ' failed');
  });
  console.log('TESTS PASSED: ' + passed + ', FAILED: ' + failed);
  if (failed > 0) process.exitCode = 1;
  return failed === 0;
}

module.exports = { test: test, eq: eq, ok: ok, run: run, beginFile: beginFile };
