/* Boxes & Lines — test runner: `node tests/run.js` (Node 24, zero deps). */
'use strict';
var H = require('./helpers.js');

[['rules.test.js', './rules.test.js'],
 ['session.test.js', './session.test.js'],
 ['content.test.js', './content.test.js'],
 ['store.test.js', './store.test.js']
].forEach(function (f) {
  H.beginFile(f[0]);
  require(f[1]);
});

H.run();
