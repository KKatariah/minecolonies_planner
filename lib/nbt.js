// Binary reader for Java/Minecraft NBT - MineColonies colony saves
// (colony<ID>.dat), region-file chunks and .blueprint files. Parses gzip-
// compressed or raw NBT into plain JS values: compounds become null-prototype
// objects, lists/arrays become arrays, TAG_Byte booleans stay 0/1 numbers.
//
// Every input is treated as hostile (these are files from other players and
// servers): lengths are checked against the bytes actually remaining before
// allocating, nesting depth is capped, compound keys can't reach
// Object.prototype, and decompression output is capped.
//
// Has no DOM dependencies, so it also runs in the terrain Web Worker and
// under Node (scripts/generate_rooftop_renders.js, unit tests).
//
// Format reference: https://wiki.vg/NBT

export const NBT_TAG = {
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

// The fewest bytes one element of each tag type can occupy on disk. A length
// read from the file is rejected if the remaining bytes couldn't possibly
// hold that many elements, so a 2-billion length in a 4KB file can't force a
// huge allocation.
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

// Real files nest a few dozen levels at most. Nesting costs only a few bytes
// per level, so without a cap a small crafted file overflows the stack.
const MAX_NBT_DEPTH = 512;

// Shared: constructing a TextDecoder per string is measurably slower, and a
// decoder holds no state between decode() calls.
const UTF8_DECODER = new TextDecoder("utf-8");

class NbtReader {
	constructor(buffer, { bigIntLongArrays = false } = {}) {
		this.view = new DataView(buffer);
		this.offset = 0;
		this.depth = 0;
		this.bigIntLongArrays = bigIntLongArrays;
	}

	// Throws before allocating if `len` couldn't be backed by the bytes left.
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
		const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
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
				// Null prototype: key names come from the file, and assigning a
				// key named "__proto__" on a plain object would replace its
				// prototype instead of adding a property (CWE-1321).
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
				// heightmaps): converting every long is over half the parse time
				// of a chunk, and region parsing reads only a few hundred of its
				// thousands of longs.
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

// A Number when it's exactly representable, otherwise a decimal string -
// keeps the parsed tree JSON-friendly without silently losing precision.
function longToNumber(big) {
	if (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)) {
		return Number(big);
	}
	return big.toString();
}

// options.bigIntLongArrays: return LongArray tags as a BigInt64Array of the
// raw signed values instead of Numbers/strings. Faster for bulk data, but
// not a plain-JSON value tree.
export function parseNbtBuffer(buffer, options) {
	const reader = new NbtReader(buffer, options);
	const rootType = reader.ubyte();
	if (rootType !== NBT_TAG.Compound) {
		throw new Error("NBT root tag is not a compound — not a valid NBT file.");
	}
	const rootName = reader.string();
	const value = reader.readValue(NBT_TAG.Compound);
	return { name: rootName, value };
}

// Reads a byte stream to the end, throwing as soon as it passes maxBytes
// rather than buffering everything first - Response.arrayBuffer() has no
// size limit, so a small compressed "zip bomb" could otherwise exhaust memory.
export async function readCapped(stream, maxBytes) {
	const reader = stream.getReader();
	const parts = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error(`Decompressed data exceeds ${maxBytes} bytes - refusing to continue (likely a corrupt or malicious file).`);
		}
		parts.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

function looksLikeGzip(buffer) {
	if (buffer.byteLength < 2) return false;
	const bytes = new Uint8Array(buffer, 0, 2);
	return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

// Real colony saves are a few MB uncompressed at most.
const MAX_INFLATED_FILE_BYTES = 256 * 1024 * 1024;

async function gunzip(buffer) {
	const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
	const bytes = await readCapped(stream, MAX_INFLATED_FILE_BYTES);
	return bytes.buffer;
}

export async function readNbtFile(file) {
	const rawBuffer = await file.arrayBuffer();
	const buffer = looksLikeGzip(rawBuffer) ? await gunzip(rawBuffer) : rawBuffer;
	return parseNbtBuffer(buffer);
}
