import { Agent, type AgentMessage } from "@cursor/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCursorTranscriptWebToolCalls, countCursorAgentMessages } from "../src/cursor-agent-message-web-tools.js";

const fakeAgentMessage: AgentMessage = {
	type: "assistant",
	uuid: "agent-1:0",
	agent_id: "agent-1",
	message: {},
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("countCursorAgentMessages", () => {
	it("counts local Cursor messages beyond the old 4096-message fallback cap", async () => {
		const messageCount = 5000;
		const list = vi.spyOn(Agent.messages, "list").mockImplementation(async (_agentId, options) => {
			const offset = options?.offset ?? 0;
			return offset < messageCount ? [fakeAgentMessage] : [];
		});

		await expect(countCursorAgentMessages("agent-1", "/repo")).resolves.toBe(messageCount);
		expect(list).toHaveBeenCalledWith("agent-1", { runtime: "local", cwd: "/repo", limit: 1, offset: 4096 });
	});
});

describe("collectCursorTranscriptWebToolCalls", () => {
	it("extracts protobuf-style Cursor WebSearch calls from local agent messages", () => {
		const calls = collectCursorTranscriptWebToolCalls([
			{
				type: "user",
				uuid: "agent-1:7",
				agent_id: "agent-1",
				message: {
					turn: {
						case: "agentConversationTurn",
						value: {
							steps: [
								{
									message: {
										case: "toolCall",
										value: {
											tool: {
												case: "webSearchToolCall",
												value: {
													args: { searchTerm: "Cursor IDE", toolCallId: "tool-1" },
													result: {
														result: {
															case: "success",
															value: {
																references: [
																	{
																		title: "Web search results",
																		url: "",
																		chunk: "Links:\n1. [Cursor — Build Software with AI Agents](https://cursor.com/product)",
																	},
																],
															},
														},
													},
												},
											},
										},
									},
								},
							],
						},
					},
				},
			},
		]);

		expect(calls).toHaveLength(1);
		expect(calls[0].identity).toBe("cursor-transcript:agent-1:7:webSearch:tool-1");
		expect(calls[0].toolCall).toEqual({
			name: "webSearch",
			args: { searchTerm: "Cursor IDE", toolCallId: "tool-1" },
			result: {
				status: "success",
				value: {
					content: [
						{
							type: "text",
							text: "Links:\n1. [Cursor — Build Software with AI Agents](https://cursor.com/product)",
						},
					],
				},
			},
		});
	});

	it("extracts protobuf-style Cursor WebFetch calls from local agent messages", () => {
		const calls = collectCursorTranscriptWebToolCalls([
			{
				type: "assistant",
				uuid: "agent-1:8",
				agent_id: "agent-1",
				message: {
					turn: {
						case: "agentConversationTurn",
						value: {
							steps: [
								{
									message: {
										case: "toolCall",
										value: {
											tool: {
												case: "webFetchToolCall",
												value: {
													args: { url: "https://example.com", toolCallId: "tool-fetch-1" },
													result: {
														result: {
															case: "success",
															value: {
																content: [{ type: "text", text: "<title>Example Domain</title>" }],
															},
														},
													},
												},
											},
										},
									},
								},
							],
						},
					},
				},
			},
		]);

		expect(calls).toHaveLength(1);
		expect(calls[0].identity).toBe("cursor-transcript:agent-1:8:webFetch:tool-fetch-1");
		expect(calls[0].toolCall).toEqual({
			name: "webFetch",
			args: { url: "https://example.com", toolCallId: "tool-fetch-1" },
			result: {
				status: "success",
				value: {
					content: [
						{
							type: "text",
							text: "<title>Example Domain</title>",
						},
					],
				},
			},
		});
	});
});
