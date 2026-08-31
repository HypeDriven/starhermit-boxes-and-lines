/* Boxes & Lines — content tests, backed by tools/validate-content.js. */
'use strict';
var H = require('./helpers.js');
var Content = require('../js/content.js');
var validator = require('../tools/validate-content.js');
var test = H.test, eq = H.eq, ok = H.ok;

test('offline content validator reports zero errors', function () {
  var r = validator.validate();
  if (r.errors.length) throw new Error('validator errors:\n  ' + r.errors.join('\n  '));
  ok(r.notes.length >= 4, 'validator produced a report');
});

test('journey has at least 40 levels with unique ids', function () {
  ok(Content.JOURNEY.length >= 40, 'journey >= 40');
  var ids = {};
  Content.JOURNEY.forEach(function (l) { ok(!ids[l.id], 'dup ' + l.id); ids[l.id] = true; });
});

test('dailyConfig immutable per date; utcDateString epoch', function () {
  eq(Content.dailyConfig('2026-01-15'), Content.dailyConfig('2026-01-15'));
  eq(Content.utcDateString(0), '1970-01-01');
});

test('practiceConfig fallback, unranked, undo allowed', function () {
  var fb = Content.practiceConfig('bogus', 'hard', 9);
  eq(fb.id, 'p-sketch');
  eq(fb.ranked, false);
  eq(fb.mechanics.undo, true);
});

test('themes: 5, unique, full palettes', function () {
  eq(Content.THEMES.length, 5);
  var ids = {};
  Content.THEMES.forEach(function (t) {
    ok(!ids[t.id]); ids[t.id] = true;
    eq(Object.keys(t.palette).length, 8);
    ok(t.unlockStars >= 0);
  });
});

test('lessons expose valid goal events', function () {
  var valid = ['draw', 'draw-safe', 'box', 'extra-turn', 'over'];
  var lessons = Content.tutorialLessons();
  ok(lessons.length >= 5, 'at least 5 lessons');
  lessons.forEach(function (l) { ok(valid.indexOf(l.goal.event) >= 0, l.id + ' goal event'); });
});
