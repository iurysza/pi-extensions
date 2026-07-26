/** Canonical Cursor Cloud lifecycle contract shared by the runtime and maintainer scripts. */

export const CLOUD_AGENT_ID_PATTERN = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CLOUD_LIFECYCLE_ENTRY_TYPE = "cursor-cloud-lifecycle";

export const CLOUD_LIFECYCLE_JOURNAL_PREFIX = ".cursor-cloud-lifecycle";
