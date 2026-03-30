import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

const KEYS_DIR = "keys";
const PUBLIC_KEY_FILE = "public.pem";
const PRIVATE_KEY_FILE = "private.pem";

export function ensureKeypair(agentDir: string): KeyPair {
  const keysDir = join(agentDir, ".kern", KEYS_DIR);
  const pubPath = join(keysDir, PUBLIC_KEY_FILE);
  const privPath = join(keysDir, PRIVATE_KEY_FILE);

  if (existsSync(pubPath) && existsSync(privPath)) {
    return {
      publicKey: readFileSync(pubPath, "utf-8"),
      privateKey: readFileSync(privPath, "utf-8"),
    };
  }

  mkdirSync(keysDir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  writeFileSync(pubPath, publicKey);
  writeFileSync(privPath, privateKey, { mode: 0o600 });

  return { publicKey, privateKey };
}

export function sign(privateKey: string, data: string): string {
  return cryptoSign(null, Buffer.from(data), privateKey).toString("base64");
}

export function verify(publicKey: string, data: string, signature: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(data), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
