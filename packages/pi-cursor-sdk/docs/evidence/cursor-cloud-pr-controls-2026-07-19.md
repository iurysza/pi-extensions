# Cursor Cloud PR-control live evidence — 2026-07-19

## Contract

- Installed package: `@cursor/sdk@1.0.23`.
- Type contract: `node_modules/@cursor/sdk/dist/esm/options.d.ts:181-188` exposes `autoCreatePR?: boolean` and `skipReviewerRequest?: boolean` on cloud agent options.
- Installed runtime contract: `node_modules/@cursor/sdk/dist/esm/642.js` forwards both values in the initial cloud `createAgent(...)` request.

## One-run throwaway-repository probe

- Timestamp: `2026-07-19T18:49:00Z`.
- Model: `cursor/composer-2-5`.
- Repository: private throwaway `fitchmultz/pi-cursor-sdk-p14-probe-20260719t184900z`, created with a clean pushed `main` branch and deleted after the probe.
- Extension controls: `--cursor-cloud-auto-create-pr` and `--cursor-cloud-skip-reviewer-request`, with explicit cloud runtime, acknowledgement, repository, and `main` starting ref.
- Result: process exit `0`; final marker `P14_PR_CONTROLS_OK`; the cloud agent read and edited `README.md` and created commit `df4e22f` in its workspace.
- Cloud agent ID: `bc-5e88ddf0-5bb6-45a4-ab00-397ed4e8c459`.
- Cloud run ID: `run-a23c4cf4-a03b-4285-8790-42c389cbc67d` (`finished`).

The installed SDK and Cloud API accepted the create request with both controls. The completed run did not report a pushed branch or PR, and GitHub showed no PR after a bounded settle check, so this evidence does not claim account-backed PR/reviewer side effects beyond request acceptance. The official [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints) defines `skipReviewerRequest` as applying only when `autoCreatePR` produces a PR.

## Cleanup

- `Agent.archive(...)` completed and `Agent.get(...)` returned `archived: true`.
- `Agent.delete(...)` completed; follow-up `Agent.get(...)` returned code `agent_not_found`, and `Agent.list({ runtime: "cloud", includeArchived: true })` no longer contained the exact ID.
- The throwaway GitHub repository was deleted and `gh repo view` confirmed it absent.
- Raw temporary session/debug artifacts were removed. No API key, auth header, cookie, or raw credential material is retained here.
