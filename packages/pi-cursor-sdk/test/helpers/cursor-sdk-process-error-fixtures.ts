export function makeNodeClosedPipeWriteError(): Error & NodeJS.ErrnoException {
	const error = new Error("write EPIPE") as Error & NodeJS.ErrnoException;
	error.code = "EPIPE";
	error.syscall = "write";
	error.errno = -32;
	error.stack =
		"Error: write EPIPE\n" +
		"    at WriteWrap.onWriteComplete [as oncomplete] (node:internal/stream_base_commons:87:19)";
	return error;
}
