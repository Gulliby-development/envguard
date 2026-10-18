#!/usr/bin/env node

process.argv.splice(2, 0, "--github", "--strict");
await import("./cli");

export {};
