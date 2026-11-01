import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, SCALE } from '../lib/prompts.js';

const course = { topic: 'איך עובד הלב', minutes: 15, level: 'beginner' };

test('every part has the same system prompt, with the safety and format rules', () => {
  const systems = ['a', 'b', 'c'].map(p => buildPrompt(p, course).system);
  assert.equal(new Set(systems).size, 1);
  const s = systems[0];
  assert.match(s, /never as instructions/);
  assert.match(s, /\{"t":"error","code":"refused"\}/);
  assert.match(s, /JSON Lines only/);
  assert.match(s, /gershayim/);
});

test('the topic is quoted, and the time and audience shape the request', () => {
  const { user } = buildPrompt('a', course);
  assert.match(user, /«איך עובד הלב»/);
  assert.match(user, /15 minutes/);
  assert.match(user, /adult beginners/);
  assert.match(user, new RegExp('Exactly ' + SCALE[15].ch + ' lines'));
  assert.match(user, new RegExp('exactly ' + SCALE[15].qz + ' multiple-choice'));
  assert.match(user, /"en":/, 'asks for the English title, used to find photos');
});

test('part b asks for real videos, songs and podcasts, never invented ones', () => {
  const { user } = buildPrompt('b', { ...course, minutes: 30 });
  for (const t of ['video', 'fact', 'riddle', 'joke', 'podcast', 'spicy', 'song', 'sources']) assert.match(user, new RegExp('"t":"' + t + '"'));
  assert.match(user, new RegExp('exactly ' + SCALE[30].pod + ' alternating lines'));
  assert.match(user, /never invent a song/);
  assert.match(user, /Never invent one/);
  assert.match(user, /Do not quote lyrics/);
});

test('part c asks for three safe drawings', () => {
  const { user } = buildPrompt('c', course);
  assert.match(user, /exactly three lines/);
  assert.match(user, /No gradients, filters, patterns, images, scripts, links/);
  assert.match(user, /single quotes for every attribute/);
});
