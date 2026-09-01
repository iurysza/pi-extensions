import type { ModelListItem } from "@cursor/sdk";

// Generated with @cursor/sdk@1.0.23 from 21 Cursor models.
// Refresh with: npm run refresh:cursor-snapshots -- --write
// Do not add secrets; this file stores public model metadata only.
export const FALLBACK_MODEL_ITEMS = [
	{
		id: "auto-smart",
		displayName: "Auto",
		parameters: [
			{
				id: "optimize_for",
				displayName: "Optimize For",
				values: [
					{
						value: "intelligence",
						displayName: "Intelligence"
					},
					{
						value: "balanced",
						displayName: "Balance"
					},
					{
						value: "cost",
						displayName: "Cost"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "optimize_for",
						value: "intelligence"
					}
				],
				displayName: "Auto Intelligence"
			},
			{
				params: [
					{
						id: "optimize_for",
						value: "balanced"
					}
				],
				displayName: "Auto Balance",
				isDefault: true
			},
			{
				params: [
					{
						id: "optimize_for",
						value: "cost"
					}
				],
				displayName: "Auto Cost"
			}
		]
	},
	{
		id: "claude-fable-5",
		displayName: "Claude Fable 5",
		aliases: [
			"fable",
			"fable-5",
			"fable-5"
		],
		parameters: [
			{
				id: "thinking",
				displayName: "Thinking",
				values: [
					{
						value: "false"
					},
					{
						value: "true"
					}
				]
			},
			{
				id: "context",
				displayName: "Context",
				values: [
					{
						value: "300k",
						displayName: "300K"
					},
					{
						value: "1m",
						displayName: "1M"
					}
				]
			},
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					},
					{
						value: "xhigh",
						displayName: "Extra High"
					},
					{
						value: "max",
						displayName: "Max"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "xhigh"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "max"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "xhigh"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "max"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "xhigh"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "max"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Fable 5",
				isDefault: true
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "xhigh"
					}
				],
				displayName: "Claude Fable 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "max"
					}
				],
				displayName: "Claude Fable 5"
			}
		]
	},
	{
		id: "claude-haiku-4-5",
		displayName: "Claude Haiku 4.5",
		aliases: [
			"haiku-latest",
			"haiku",
			"haiku-4.5",
			"haiku-4-5"
		],
		parameters: [
			{
				id: "thinking",
				displayName: "Thinking",
				values: [
					{
						value: "false"
					},
					{
						value: "true"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "thinking",
						value: "false"
					}
				],
				displayName: "Claude Haiku 4.5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					}
				],
				displayName: "Claude Haiku 4.5",
				isDefault: true
			}
		]
	},
	{
		id: "claude-opus-4-8",
		displayName: "Claude Opus 4.8",
		aliases: [
			"opus-latest",
			"opus",
			"opus-4.8",
			"opus-4-8"
		],
		parameters: [
			{
				id: "thinking",
				displayName: "Thinking",
				values: [
					{
						value: "false"
					},
					{
						value: "true"
					}
				]
			},
			{
				id: "context",
				displayName: "Context",
				values: [
					{
						value: "300k",
						displayName: "300K"
					}
				]
			},
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 4.8"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 4.8"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 4.8"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 4.8"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 4.8",
				isDefault: true
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 4.8"
			}
		]
	},
	{
		id: "claude-opus-5",
		displayName: "Claude Opus 5",
		aliases: [
			"opus-latest",
			"opus",
			"opus-5"
		],
		parameters: [
			{
				id: "thinking",
				displayName: "Thinking",
				values: [
					{
						value: "false"
					},
					{
						value: "true"
					}
				]
			},
			{
				id: "context",
				displayName: "Context",
				values: [
					{
						value: "300k",
						displayName: "300K"
					}
				]
			},
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 5"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 5"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 5"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 5"
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 5",
				isDefault: true
			},
			{
				params: [
					{
						id: "cyber",
						value: "false"
					},
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Claude Opus 5"
			}
		]
	},
	{
		id: "claude-sonnet-5",
		displayName: "Claude Sonnet 5",
		aliases: [
			"sonnet-latest",
			"sonnet-5"
		],
		parameters: [
			{
				id: "thinking",
				displayName: "Thinking",
				values: [
					{
						value: "false"
					},
					{
						value: "true"
					}
				]
			},
			{
				id: "context",
				displayName: "Context",
				values: [
					{
						value: "300k",
						displayName: "300K"
					},
					{
						value: "1m",
						displayName: "1M"
					}
				]
			},
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "false"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "300k"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Claude Sonnet 5"
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Claude Sonnet 5",
				isDefault: true
			},
			{
				params: [
					{
						id: "thinking",
						value: "true"
					},
					{
						id: "context",
						value: "1m"
					},
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Claude Sonnet 5"
			}
		]
	},
	{
		id: "composer-2.5",
		displayName: "Composer 2.5",
		aliases: [
			"composer-latest",
			"composer",
			"composer-2-5"
		],
		parameters: [
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Composer 2.5",
				isDefault: true
			},
			{
				params: [
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Composer 2.5"
			}
		]
	},
	{
		id: "default",
		displayName: "Auto",
		aliases: [
			"auto"
		],
		variants: [
			{
				params: [],
				displayName: "Auto",
				isDefault: true
			}
		]
	},
	{
		id: "gemini-3.1-pro",
		displayName: "Gemini 3.1 Pro",
		aliases: [
			"gemini-latest",
			"gemini-pro-latest",
			"gemini",
			"gemini-pro"
		],
		variants: [
			{
				params: [],
				displayName: "Gemini 3.1 Pro",
				isDefault: true
			}
		]
	},
	{
		id: "gemini-3.7-flash",
		displayName: "Gemini 3.7 Flash",
		aliases: [
			"gemini-flash-latest",
			"gemini-flash"
		],
		parameters: [
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "effort",
						value: "low"
					}
				],
				displayName: "Gemini 3.7 Flash"
			},
			{
				params: [
					{
						id: "effort",
						value: "medium"
					}
				],
				displayName: "Gemini 3.7 Flash"
			},
			{
				params: [
					{
						id: "effort",
						value: "high"
					}
				],
				displayName: "Gemini 3.7 Flash",
				isDefault: true
			}
		]
	},
	{
		id: "glm-5.2",
		displayName: "GLM 5.2",
		parameters: [
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "high",
						displayName: "High"
					},
					{
						value: "max",
						displayName: "Max"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "reasoning",
						value: "high"
					}
				],
				displayName: "GLM 5.2",
				isDefault: true
			},
			{
				params: [
					{
						id: "reasoning",
						value: "max"
					}
				],
				displayName: "GLM 5.2"
			}
		]
	},
	{
		id: "gpt-5.3-codex",
		displayName: "Codex 5.3",
		aliases: [
			"codex-latest",
			"codex",
			"codex-5.3"
		],
		parameters: [
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					},
					{
						value: "extra-high",
						displayName: "Extra High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Codex 5.3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Codex 5.3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Codex 5.3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Codex 5.3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Codex 5.3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Codex 5.3",
				isDefault: true
			},
			{
				params: [
					{
						id: "reasoning",
						value: "extra-high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Codex 5.3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "extra-high"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Codex 5.3"
			}
		]
	},
	{
		id: "gpt-5.4-mini",
		displayName: "GPT-5.4 Mini",
		aliases: [
			"gpt-mini-latest",
			"gpt-mini"
		],
		parameters: [
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "none",
						displayName: "None"
					},
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					},
					{
						value: "xhigh",
						displayName: "Extra High"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "reasoning",
						value: "none"
					}
				],
				displayName: "GPT-5.4 Mini"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "low"
					}
				],
				displayName: "GPT-5.4 Mini"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "medium"
					}
				],
				displayName: "GPT-5.4 Mini",
				isDefault: true
			},
			{
				params: [
					{
						id: "reasoning",
						value: "high"
					}
				],
				displayName: "GPT-5.4 Mini"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "xhigh"
					}
				],
				displayName: "GPT-5.4 Mini"
			}
		]
	},
	{
		id: "gpt-5.4-nano",
		displayName: "GPT-5.4 Nano",
		aliases: [
			"gpt-nano-latest",
			"gpt-nano"
		],
		parameters: [
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "none",
						displayName: "None"
					},
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					},
					{
						value: "xhigh",
						displayName: "Extra High"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "reasoning",
						value: "none"
					}
				],
				displayName: "GPT-5.4 Nano"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "low"
					}
				],
				displayName: "GPT-5.4 Nano"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "medium"
					}
				],
				displayName: "GPT-5.4 Nano",
				isDefault: true
			},
			{
				params: [
					{
						id: "reasoning",
						value: "high"
					}
				],
				displayName: "GPT-5.4 Nano"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "xhigh"
					}
				],
				displayName: "GPT-5.4 Nano"
			}
		]
	},
	{
		id: "gpt-5.6-luna",
		displayName: "GPT-5.6 Luna",
		aliases: [
			"gpt-5-6-luna"
		],
		parameters: [
			{
				id: "context",
				displayName: "Context",
				values: [
					{
						value: "272k",
						displayName: "272K"
					},
					{
						value: "1m",
						displayName: "1M"
					}
				]
			},
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "none",
						displayName: "None"
					},
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna",
				isDefault: true
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Luna"
			}
		]
	},
	{
		id: "gpt-5.6-sol",
		displayName: "GPT-5.6 Sol",
		aliases: [
			"gpt-latest",
			"gpt",
			"gpt-5-6-sol",
			"gpt-5.6"
		],
		parameters: [
			{
				id: "context",
				displayName: "Context",
				values: [
					{
						value: "272k",
						displayName: "272K"
					},
					{
						value: "1m",
						displayName: "1M"
					}
				]
			},
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "none",
						displayName: "None"
					},
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol",
				isDefault: true
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Sol"
			}
		]
	},
	{
		id: "gpt-5.6-terra",
		displayName: "GPT-5.6 Terra",
		aliases: [
			"gpt-5-6-terra"
		],
		parameters: [
			{
				id: "context",
				displayName: "Context",
				values: [
					{
						value: "272k",
						displayName: "272K"
					},
					{
						value: "1m",
						displayName: "1M"
					}
				]
			},
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "none",
						displayName: "None"
					},
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "272k"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "none"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra"
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra",
				isDefault: true
			},
			{
				params: [
					{
						id: "context",
						value: "1m"
					},
					{
						id: "reasoning",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "GPT-5.6 Terra"
			}
		]
	},
	{
		id: "grok-4.5",
		displayName: "Cursor Grok 4.5",
		parameters: [
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast​"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Cursor Grok 4.5"
			},
			{
				params: [
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Cursor Grok 4.5"
			},
			{
				params: [
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Cursor Grok 4.5"
			},
			{
				params: [
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Cursor Grok 4.5"
			},
			{
				params: [
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Cursor Grok 4.5"
			},
			{
				params: [
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Cursor Grok 4.5",
				isDefault: true
			}
		]
	},
	{
		id: "grok-4.6",
		displayName: "Cursor Grok 4.6",
		parameters: [
			{
				id: "effort",
				displayName: "Effort",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "medium",
						displayName: "Medium"
					},
					{
						value: "high",
						displayName: "High"
					},
					{
						value: "xhigh",
						displayName: "Extra High"
					}
				]
			},
			{
				id: "fast",
				displayName: "Fast",
				values: [
					{
						value: "false"
					},
					{
						value: "true",
						displayName: "Fast​​"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Cursor Grok 4.6"
			},
			{
				params: [
					{
						id: "effort",
						value: "low"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Cursor Grok 4.6"
			},
			{
				params: [
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Cursor Grok 4.6"
			},
			{
				params: [
					{
						id: "effort",
						value: "medium"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Cursor Grok 4.6"
			},
			{
				params: [
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Cursor Grok 4.6"
			},
			{
				params: [
					{
						id: "effort",
						value: "high"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Cursor Grok 4.6",
				isDefault: true
			},
			{
				params: [
					{
						id: "effort",
						value: "xhigh"
					},
					{
						id: "fast",
						value: "false"
					}
				],
				displayName: "Cursor Grok 4.6"
			},
			{
				params: [
					{
						id: "effort",
						value: "xhigh"
					},
					{
						id: "fast",
						value: "true"
					}
				],
				displayName: "Cursor Grok 4.6"
			}
		]
	},
	{
		id: "kimi-k2.7-code",
		displayName: "Kimi K2.7 Code",
		aliases: [
			"kimi-latest",
			"kimi"
		],
		variants: [
			{
				params: [],
				displayName: "Kimi K2.7 Code",
				isDefault: true
			}
		]
	},
	{
		id: "kimi-k3",
		displayName: "Kimi K3",
		parameters: [
			{
				id: "reasoning",
				displayName: "Reasoning",
				values: [
					{
						value: "low",
						displayName: "Low"
					},
					{
						value: "high",
						displayName: "High"
					},
					{
						value: "max",
						displayName: "Max"
					}
				]
			}
		],
		variants: [
			{
				params: [
					{
						id: "reasoning",
						value: "low"
					}
				],
				displayName: "Kimi K3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "high"
					}
				],
				displayName: "Kimi K3"
			},
			{
				params: [
					{
						id: "reasoning",
						value: "max"
					}
				],
				displayName: "Kimi K3",
				isDefault: true
			}
		]
	}
] satisfies ModelListItem[];
