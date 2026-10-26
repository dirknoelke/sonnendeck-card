// The card has to be one file: Home Assistant loads exactly one URL.
// tsc compiles src/art.ts (the embedded pictures) and src/sonnendeck-card.ts
// separately; this puts the pictures in front of the card and drops art.js.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const art = readFileSync(new URL('art.js', dist), 'utf8');
const card = readFileSync(new URL('sonnendeck-card.js', dist), 'utf8');
writeFileSync(new URL('sonnendeck-card.js', dist), `${art}\n${card}`);
rmSync(new URL('art.js', dist));
