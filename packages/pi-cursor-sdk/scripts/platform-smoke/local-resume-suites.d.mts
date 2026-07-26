export const LOCAL_RESUME_SUITES: readonly {
	key: string;
	flag?: string;
	suite: string;
	script: string;
	marker: string;
	stderrPattern: RegExp;
	description: string;
	cursorCalls: number;
}[];
export const LOCAL_RESUME_SUITE_NAMES: string[];
export const LOCAL_RESUME_SUITE_BY_NAME: Map<
	string,
	(typeof LOCAL_RESUME_SUITES)[number]
>;
