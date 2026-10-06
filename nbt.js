// Minimal binary reader for Java/Minecraft NBT (the format MineColonies uses
// for colony<ID>.dat save files). Parses gzip-compressed or raw NBT into a
// plain JS value tree — compounds become objects, lists/arrays become JS
// arrays, TAG_Byte booleans stay as 0/1 numbers for the caller to interpret.
//
// Format reference: https://wiki.vg/NBT

const NBT_TAG = {
	End: 0,
	Byte: 1,
	Short: 2,
	Int: 3,
	Long: 4,
	Float: 5,
	Double: 6,
	ByteArray: 7,
	String: 8,
	List: 9,
	Compound: 10,
	IntArray: 11,
	LongArray: 12,
};

// Conservative lower bound on how many bytes a single element of this tag
// type must occupy on disk - used to sanity-check a length field read from
// the file itself before trusting it enough to `new Array(len)`. A crafted
// or corrupted file can claim a length of ~2 billion while the file is only
// a few KB; without this check that's an attacker-controlled allocation
// size (client-side DoS - hang/crash the tab) before the per-element reads
// below would ever get far enough to hit DataView's own bounds check.
const TAG_MIN_SIZE = {
	[NBT_TAG.End]: 1,
	[NBT_TAG.Byte]: 1,
	[NBT_TAG.Short]: 2,
	[NBT_TAG.Int]: 4,
	[NBT_TAG.Long]: 8,
	[NBT_TAG.Float]: 4,
	[NBT_TAG.Double]: 8,
	[NBT_TAG.ByteArray]: 4,
	[NBT_TAG.String]: 2,
	[NBT_TAG.List]: 5,
	[NBT_TAG.Compound]: 1,
	[NBT_TAG.IntArray]: 4,
	[NBT_TAG.LongArray]: 8,
};

// List/Compound nesting recurses through readValue() with no depth limit of
// its own - a real colony/blueprint/chunk file rarely nests past a few dozen
// levels, but a crafted file chaining thousands of nested Lists/Compounds
// costs only a handful of bytes per level and drives the parser to a stack
// overflow (confirmed: a ~200KB file nesting 50,000 Compounds deep threw
// "Maximum call stack size exceeded"). Every current caller already catches
// parse errors, so this was never a hang or a crash - just an unfriendly
// engine-internal error message - but capping it here turns that into a
// clear, on-purpose error instead of relying on hitting the engine's own
// limit.
const MAX_NBT_DEPTH = 512;

// Every Compound key name and String tag goes through string(), and a real
// colony/blueprint/chunk file has thousands of both - profiled `new
// TextDecoder("utf-8")` per call against reusing one shared instance
// (benchmark: 2M decodes of a short string, 296ms vs 208ms) and a fresh
// decoder every call was the slower of the two purely from construction
// overhead, with identical decoded output either way (a TextDecoder holds no
// per-call state to reset between decode() calls).
const UTF8_DECODER = new TextDecoder("utf-8");

class NbtReader {
	constructor(buffer, { bigIntLongArrays = false } = {}) {
		this.view = new DataView(buffer);
		this.offset = 0;
		this.depth = 0;
		this.bigIntLongArrays = bigIntLongArrays;
	}

	// Throws before allocating if `len` (attacker/file-controlled) couldn't
	// possibly be backed by the bytes actually remaining in the buffer.
	assertPlausibleLength(len, minBytesPerElement) {
		if (len < 0) throw new Error("NBT array/list has a negative length.");
		const remaining = this.view.byteLength - this.offset;
		if (len > remaining / minBytesPerElement) {
			throw new Error(
				`NBT array/list length (${len}) exceeds what the remaining file data (${remaining} bytes) could hold.`,
			);
		}
	}

	byte() {
		const v = this.view.getInt8(this.offset);
		this.offset += 1;
		return v;
	}

	ubyte() {
		const v = this.view.getUint8(this.offset);
		this.offset += 1;
		return v;
	}

	short() {
		const v = this.view.getInt16(this.offset);
		this.offset += 2;
		return v;
	}

	int() {
		const v = this.view.getInt32(this.offset);
		this.offset += 4;
		return v;
	}

	long() {
		const v = this.view.getBigInt64(this.offset);
		this.offset += 8;
		return v;
	}

	float() {
		const v = this.view.getFloat32(this.offset);
		this.offset += 4;
		return v;
	}

	double() {
		const v = this.view.getFloat64(this.offset);
		this.offset += 8;
		return v;
	}

	string() {
		const len = this.view.getUint16(this.offset);
		this.offset += 2;
		const bytes = new Uint8Array(
			this.view.buffer,
			this.view.byteOffset + this.offset,
			len,
		);
		this.offset += len;
		return UTF8_DECODER.decode(bytes);
	}

	readValue(tagType) {
		this.depth++;
		if (this.depth > MAX_NBT_DEPTH) {
			throw new Error(`NBT structure nests more than ${MAX_NBT_DEPTH} levels deep - too deep to be a real file.`);
		}
		try {
			return this.readValueInner(tagType);
		} finally {
			this.depth--;
		}
	}

	readValueInner(tagType) {
		switch (tagType) {
			case NBT_TAG.Byte:
				return this.byte();
			case NBT_TAG.Short:
				return this.short();
			case NBT_TAG.Int:
				return this.int();
			case NBT_TAG.Long:
				return longToNumber(this.long());
			case NBT_TAG.Float:
				return this.float();
			case NBT_TAG.Double:
				return this.double();
			case NBT_TAG.ByteArray: {
				const len = this.int();
				this.assertPlausibleLength(len, TAG_MIN_SIZE[NBT_TAG.Byte]);
				const arr = new Array(len);
				for (let i = 0; i < len; i++) arr[i] = this.byte();
				return arr;
			}
			case NBT_TAG.String:
				return this.string();
			case NBT_TAG.List: {
				const listType = this.ubyte();
				const len = this.int();
				this.assertPlausibleLength(len, TAG_MIN_SIZE[listType] ?? 1);
				const items = new Array(len);
				for (let i = 0; i < len; i++) items[i] = this.readValue(listType);
				return items;
			}
			case NBT_TAG.Compound: {
				// A null prototype, not a plain {} object literal: a
				// compound's key names come straight from the untrusted
				// file, and `obj[name] = value` on a normal object treats a
				// key literally named "__proto__" as a request to overwrite
				// the object's prototype instead of setting a regular
				// property (CWE-1321). Nothing in this app currently walks
				// these objects with for-in or deep-merges them into
				// something shared, so this hasn't been an exploitable bug
				// here, but the whole point of this reader is to open save
				// files from other people/servers, which is exactly the
				// untrusted-deserialization scenario this pattern is
				// dangerous for - Object.create(null) makes "__proto__" and
				// friends land as ordinary own properties like any other
				// key, same as every other tag name.
				const obj = Object.create(null);
				for (;;) {
					const childType = this.ubyte();
					if (childType === NBT_TAG.End) break;
					const name = this.string();
					obj[name] = this.readValue(childType);
				}
				return obj;
			}
			case NBT_TAG.IntArray: {
				const len = this.int();
				this.assertPlausibleLength(len, TAG_MIN_SIZE[NBT_TAG.Int]);
				const arr = new Array(len);
				for (let i = 0; i < len; i++) arr[i] = this.int();
				return arr;
			}
			case NBT_TAG.LongArray: {
				const len = this.int();
				this.assertPlausibleLength(len, TAG_MIN_SIZE[NBT_TAG.Long]);
				// Opt-in raw form for bulk packed data (chunk block states,
				// heightmaps): converting every long to a Number/string is over
				// half the parse time of a chunk, and region parsing only ever
				// reads a few hundred of its thousands of longs.
				if (this.bigIntLongArrays) {
					const raw = new BigInt64Array(len);
					for (let i = 0; i < len; i++) raw[i] = this.long();
					return raw;
				}
				const arr = new Array(len);
				for (let i = 0; i < len; i++) arr[i] = longToNumber(this.long());
				return arr;
			}
			default:
				throw new Error(`Unknown NBT tag type: ${tagType}`);
		}
	}
}

function longToNumber(big) {
	if (
		big >= BigInt(Number.MIN_SAFE_INTEGER) &&
		big <= BigInt(Number.MAX_SAFE_INTEGER)
	) {
		return Number(big);
	}
	return big.toString();
}

// options.bigIntLongArrays: return LongArray tags as a BigInt64Array of the
// raw signed values instead of plain Numbers (or decimal strings, past the
// safe-integer range). Faster for bulk data; not a plain-JSON value tree.
function parseNbtBuffer(buffer, options) {
	const reader = new NbtReader(buffer, options);
	const rootType = reader.ubyte();
	if (rootType !== NBT_TAG.Compound) {
		throw new Error("NBT root tag is not a compound — not a valid NBT file.");
	}
	const rootName = reader.string();
	const value = reader.readValue(NBT_TAG.Compound);
	return { name: rootName, value };
}

function looksLikeGzip(buffer) {
	if (buffer.byteLength < 2) return false;
	const bytes = new Uint8Array(buffer, 0, 2);
	return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(buffer) {
	const stream = new Blob([buffer])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return new Response(stream).arrayBuffer();
}

async function readNbtFile(file) {
	const rawBuffer = await file.arrayBuffer();
	const buffer = looksLikeGzip(rawBuffer) ? await gunzip(rawBuffer) : rawBuffer;
	return parseNbtBuffer(buffer);
}

// Everything above is plain ArrayBuffer/DataView code with no browser-only
// APIs except readNbtFile itself (File.arrayBuffer(), DecompressionStream) -
// parseNbtBuffer/NbtReader work identically under Node, which the rooftop
// render generator (scripts/generate_rooftop_renders.js) needs: it reads a
// .blueprint file via fs + zlib.gunzipSync itself and calls parseNbtBuffer()
// directly, the same hardened parser (prototype-pollution guard, allocation/
// recursion limits) the browser app uses, rather than a second copy that
// could drift out of sync with it.
const NBT_API = { readNbtFile, parseNbtBuffer, NBT_TAG };
if (typeof window !== "undefined") window.NBT = NBT_API;
if (typeof module !== "undefined" && module.exports) module.exports = NBT_API;
