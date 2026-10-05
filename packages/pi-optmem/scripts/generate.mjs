#!/usr/bin/env node
// Build OptMem memory from past Pi sessions. Run with --help for usage.
// Needs Node 22.18+ (TypeScript type stripping on by default).
import { main } from "../src/generate/cli.ts";

process.exitCode = await main(process.argv.slice(2));
