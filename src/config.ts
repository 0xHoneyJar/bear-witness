import fs from 'fs';
import path from 'path';

const configPath = path.join(__dirname, '..', 'config', 'default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

export const GRAPHQL_ENDPOINT = config.GRAPHQL_ENDPOINT;
export const IRYS_GRAPHQL_ENDPOINT = config.IRYS_GRAPHQL_ENDPOINT;
export const OWNER_ADDRESS = config.OWNER_ADDRESS;