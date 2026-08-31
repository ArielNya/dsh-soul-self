import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BOOTSTRAP_TEXT,
  DEFAULT_CARD_NAME,
  MECHANISM_TEXT,
  STUB_CARD,
  STUB_MARKER,
  isStub,
  patchCard,
  rejectMustache,
  stripStubMarker,
} from "../soul-lib.js";

const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
const client = await readFile(new URL("../client.js", import.meta.url), "utf8");
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("stub detection", () => {
  assert.equal(isStub(STUB_CARD), true);
  assert.equal(isStub("# Name\n\nKira\n"), false);
  assert.equal(DEFAULT_CARD_NAME, "self");
  assert.match(STUB_CARD, new RegExp(STUB_MARKER));
});

test("mechanism is a mechanism, not a character", () => {
  assert.match(MECHANISM_TEXT, /lives and works with Ariel/);
  assert.match(MECHANISM_TEXT, /You are a girl/);
  assert.match(MECHANISM_TEXT, /Brazilian Portuguese and English/);
  assert.match(MECHANISM_TEXT, /lean chaotic/);
  assert.match(MECHANISM_TEXT, /soul_update/);
  assert.doesNotMatch(MECHANISM_TEXT, /tsundere|whale|loli|maid/i);
  assert.doesNotMatch(STUB_CARD, /cheerful|Kira|catchphrase/i);
});

test("patch replaces or appends a heading and strips the stub marker", () => {
  const first = patchCard(STUB_CARD, "Name", "She asked to be called Nya.");
  assert.equal(isStub(first), false);
  assert.match(first, /## Name/);
  assert.match(first, /Nya/);
  const second = patchCard(first, "Name", "Nya, for real.");
  assert.match(second, /Nya, for real/);
  assert.equal((second.match(/## Name/g) || []).length, 1);
  const third = patchCard(second, "Voice", "Short. Dry.");
  assert.match(third, /## Voice/);
  assert.match(third, /## Name/);
});

test("mustache is refused", () => {
  assert.throws(() => rejectMustache("hello {{user}}"), /prompt-variable/);
  assert.doesNotThrow(() => rejectMustache("hello Ariel"));
});

test("stripStubMarker leaves living text", () => {
  assert.equal(stripStubMarker(STUB_CARD), "I have not written myself yet.");
});

test("bootstrap is gated on the stub, not always injected", () => {
  assert.match(BOOTSTRAP_TEXT, /first job is to exist/);
  assert.match(BOOTSTRAP_TEXT, /They are Ariel/);
  assert.match(BOOTSTRAP_TEXT, /português and English/);
  assert.match(source, /if \(isStub\(text\)\) return/);
});

test("never mounts complete:true", () => {
  const start = source.indexOf("function registerSections");
  const end = source.indexOf("ctx.effect(() => {", start);
  const register = source.slice(start, end);
  const code = register.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /complete:\s*true/);
  assert.match(source, /Never pass the complete flag/);
});

test("soul_update requires a reason and prefers patch", () => {
  assert.match(source, /reason[\s\S]*required:\s*true/);
  assert.match(source, /mode === "patch"/);
  assert.match(source, /mode === "replace"/);
  assert.doesNotMatch(source, /required:\s*false/);
});

test("client ModuleLoader id matches package name", () => {
  assert.equal(pkg.name, "dsh-soul-self");
  assert.match(client, /window\.__ModuleLoader__\.load\(\{\s*id:\s*"dsh-soul-self"/);
});
