#!/usr/bin/env bun
// `bunx blendx` resolves the package named blendx, so the CLI's bin lives here.
import { main } from '@blendx/cli';

process.exitCode = await main(process.argv.slice(2));
