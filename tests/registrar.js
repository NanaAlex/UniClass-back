// Carrega ts-node para a suíte (node --test). A checagem de tipos roda
// separadamente em `npm run typecheck`; aqui só transpila, por velocidade.
const path = require('path');

process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || path.join(__dirname, 'tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
require('ts-node/register');
