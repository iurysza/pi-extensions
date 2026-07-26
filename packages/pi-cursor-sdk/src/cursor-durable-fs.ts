import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync } from "node:fs";

function sameFileIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

export function noFollowFlag(): number {
	return process.platform !== "win32" && typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

export function openExistingRegularFileNoFollow(path: string, flags: number): number {
	const before = lstatSync(path);
	if (!before.isFile()) throw new Error("path is not a regular file");
	let fd: number | undefined;
	try {
		fd = openSync(path, flags | noFollowFlag());
		const opened = fstatSync(fd);
		const after = lstatSync(path);
		if (!opened.isFile() || !after.isFile() || !sameFileIdentity(before, opened) || !sameFileIdentity(opened, after)) {
			throw new Error("path changed while opening regular file");
		}
		return fd;
	} catch (error) {
		if (fd !== undefined) {
			try { closeSync(fd); } catch {}
		}
		throw error;
	}
}

/** Opens a read-write descriptor (required for Windows FlushFileBuffers) so fsync applies to the real file, not a swapped-in symlink target. */
export function fsyncExistingRegularFile(path: string): boolean {
	let fd: number | undefined;
	try {
		fd = openExistingRegularFileNoFollow(path, constants.O_RDWR);
		fsyncSync(fd);
		return true;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// fsync already established the durability decision.
			}
		}
	}
}
