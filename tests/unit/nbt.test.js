// nbt.js - the binary NBT reader behind the Colony Inspector, World Viewer,
// planner world background, and the rooftop render generator.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const NBT = require("../../lib/nbt.js");
const W = require("../helpers/nbt-writer.js");
const { REPO_ROOT } = require("../helpers/repo-root.js");

// Compounds come back as null-prototype objects; compare by value.
const plain = (v) => JSON.parse(JSON.stringify(v));

// A fake File-like object for readNbtFile (only .arrayBuffer() is used).
const fakeFile = (buffer) => ({ arrayBuffer: async () => buffer });

test("exports the tag table matching the NBT spec", () => {
	assert.deepEqual(NBT.NBT_TAG, W.TAG);
});

test("parses every scalar tag type", () => {
	const buf = W.encodeNbt(
		W.compound({
			b: W.byte(-5),
			s: W.short(-1234),
			i: W.int(123456789),
			l: W.long(9007199254740991n),
			f: W.float(1.5),
			d: W.double(Math.PI),
			str: W.str("hello"),
		}),
		"root",
	);
	const { name, value } = NBT.parseNbtBuffer(buf);
	assert.equal(name, "root");
	assert.deepEqual(plain(value), {
		b: -5,
		s: -1234,
		i: 123456789,
		l: 9007199254740991,
		f: 1.5,
		d: Math.PI,
		str: "hello",
	});
});

test("parses arrays, lists and nested compounds", () => {
	const buf = W.encodeNbt(
		W.compound({
			bytes: W.byteArray([1, -1, 127]),
			ints: W.intArray([0, -7, 2147483647]),
			longs: W.longArray([1n, -2n]),
			names: W.list(W.TAG.String, ["a", "b"]),
			empty: W.list(W.TAG.End, []),
			nested: W.compound({ inner: W.compound({ deep: W.int(42) }) }),
			listOfCompounds: W.list(W.TAG.Compound, [
				[["id", W.int(1)]],
				[["id", W.int(2)]],
			]),
		}),
	);
	const { value } = NBT.parseNbtBuffer(buf);
	assert.deepEqual(plain(value), {
		bytes: [1, -1, 127],
		ints: [0, -7, 2147483647],
		longs: [1, -2],
		names: ["a", "b"],
		empty: [],
		nested: { inner: { deep: 42 } },
		listOfCompounds: [{ id: 1 }, { id: 2 }],
	});
});

test("longs outside the safe-integer range come back as exact strings", () => {
	const big = 2n ** 62n + 7n;
	const buf = W.encodeNbt(
		W.compound({ a: W.long(big), b: W.long(-big), arr: W.longArray([big]) }),
	);
	const { value } = NBT.parseNbtBuffer(buf);
	assert.equal(value.a, big.toString());
	assert.equal(value.b, (-big).toString());
	assert.deepEqual(plain(value.arr), [big.toString()]);
});

test("decodes multi-byte UTF-8 strings and key names", () => {
	const buf = W.encodeNbt(W.compound({ "ключ": W.str("Grüße ⛏️ 🐝") }));
	const { value } = NBT.parseNbtBuffer(buf);
	assert.equal(value["ключ"], "Grüße ⛏️ 🐝");
});

test("a compound key named __proto__ is stored as a plain key, not a prototype write", () => {
	const buf = W.encodeNbt(
		W.compound([
			["__proto__", W.compound({ polluted: W.byte(1) })],
			["constructor", W.str("x")],
		]),
	);
	const { value } = NBT.parseNbtBuffer(buf);
	assert.equal(Object.getPrototypeOf(value), null);
	assert.ok(Object.hasOwn(value, "__proto__"));
	assert.equal(value.__proto__.polluted, 1);
	assert.equal(value.constructor, "x");
	assert.equal({}.polluted, undefined, "Object.prototype must not be polluted");
});

test("rejects a root tag that is not a compound", () => {
	const w = new W.ByteWriter();
	w.u8(W.TAG.List);
	w.string("");
	assert.throws(() => NBT.parseNbtBuffer(w.toArrayBuffer()), /root tag is not a compound/);
});

test("rejects unknown tag types", () => {
	const w = new W.ByteWriter();
	w.u8(W.TAG.Compound);
	w.string("");
	w.u8(99); // bogus child tag
	w.string("x");
	assert.throws(() => NBT.parseNbtBuffer(w.toArrayBuffer()), /Unknown NBT tag type: 99/);
});

test("rejects truncated input instead of returning partial data", () => {
	const full = new Uint8Array(W.encodeNbt(W.compound({ n: W.int(5), s: W.str("abcdef") })));
	for (let cut = 1; cut < full.length; cut++) {
		assert.throws(
			() => NBT.parseNbtBuffer(full.slice(0, cut).buffer),
			undefined,
			`expected a throw when truncated to ${cut} bytes`,
		);
	}
});

test("rejects absurd array/list lengths before allocating", () => {
	for (const tag of [W.TAG.ByteArray, W.TAG.IntArray, W.TAG.LongArray]) {
		const w = new W.ByteWriter();
		w.u8(W.TAG.Compound);
		w.string("");
		w.u8(tag);
		w.string("arr");
		w.i32(2_000_000_000);
		assert.throws(() => NBT.parseNbtBuffer(w.toArrayBuffer()), /exceeds what the remaining file data/);
	}
	const w = new W.ByteWriter();
	w.u8(W.TAG.Compound);
	w.string("");
	w.u8(W.TAG.List);
	w.string("list");
	w.u8(W.TAG.Int);
	w.i32(1_000_000_000);
	assert.throws(() => NBT.parseNbtBuffer(w.toArrayBuffer()), /exceeds what the remaining file data/);
});

test("rejects negative array lengths", () => {
	const w = new W.ByteWriter();
	w.u8(W.TAG.Compound);
	w.string("");
	w.u8(W.TAG.IntArray);
	w.string("arr");
	w.i32(-1);
	assert.throws(() => NBT.parseNbtBuffer(w.toArrayBuffer()), /negative length/);
});

test("caps nesting depth with a clear error instead of a stack overflow", () => {
	const depth = 5000;
	const w = new W.ByteWriter();
	w.u8(W.TAG.Compound);
	w.string("");
	for (let i = 0; i < depth; i++) {
		w.u8(W.TAG.Compound);
		w.string("c");
	}
	for (let i = 0; i <= depth; i++) w.u8(W.TAG.End);
	assert.throws(() => NBT.parseNbtBuffer(w.toArrayBuffer()), /nests more than 512 levels/);
});

test("allows reasonably deep (but legal) nesting", () => {
	let node = W.compound({ leaf: W.int(1) });
	for (let i = 0; i < 100; i++) node = W.compound({ c: node });
	const { value } = NBT.parseNbtBuffer(W.encodeNbt(node));
	let cursor = value;
	for (let i = 0; i < 100; i++) cursor = cursor.c;
	assert.equal(cursor.leaf, 1);
});

test("readNbtFile handles both raw and gzip-compressed input", async () => {
	const raw = W.encodeNbt(W.compound({ hello: W.str("world") }), "r");
	const gz = zlib.gzipSync(Buffer.from(raw));
	const gzBuffer = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);

	const fromRaw = await NBT.readNbtFile(fakeFile(raw));
	const fromGz = await NBT.readNbtFile(fakeFile(gzBuffer));
	assert.equal(fromRaw.value.hello, "world");
	assert.equal(fromGz.value.hello, "world");
	assert.equal(fromGz.name, "r");
});

test("readNbtFile rejects garbage input", async () => {
	await assert.rejects(NBT.readNbtFile(fakeFile(new Uint8Array([1, 2, 3]).buffer)));
	await assert.rejects(NBT.readNbtFile(fakeFile(new ArrayBuffer(0))));
});

test("parses the bundled example colony save", async () => {
	const file = fs.readFileSync(path.join(REPO_ROOT, "sample-data/example-colony.dat"));
	const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
	const { value } = await NBT.readNbtFile(fakeFile(buffer));
	assert.equal(typeof value, "object");
	assert.ok(Object.keys(value).length > 0, "example colony should have top-level tags");
});
