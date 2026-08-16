// These are replaced with real string literals at BUILD TIME by esbuild's --define flag.
// Do not add dotenv or process.env here — extensions have no filesystem/Node process to read from.
declare const __API_BASE_URL__: string;
declare const __API_AUTH_TOKEN__: string;

export const API_BASE_URL = __API_BASE_URL__;
export const API_AUTH_TOKEN = __API_AUTH_TOKEN__;