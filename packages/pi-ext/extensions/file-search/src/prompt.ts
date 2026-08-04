export const FD_DESCRIPTION = "Discover files and directories by name with fd. Git ignore files are respected unless hidden entries are explicitly requested.";
export const RG_DESCRIPTION = "Search file contents with ripgrep. Uses smart case and respects ignore files by default.";

export const FD_SNIPPET = "fd — fast typed file-name discovery with ignore-aware defaults";
export const RG_SNIPPET = "rg — fast typed content search with smart case and ignore-aware defaults";

export const FD_GUIDELINES = [
	"Use fd for file-name or directory discovery; omit pattern to list entries.",
	"Use rg instead when searching file contents.",
	"Use bash only when a pipeline or post-processing is required.",
];

export const RG_GUIDELINES = [
	"Use rg for content search; use fd for file-name discovery.",
	"Set literal=true when the pattern contains regex metacharacters that should be matched literally.",
	"Use bash only when a pipeline or post-processing is required.",
];
