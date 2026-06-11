import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, generateKeyPairSync } from "node:crypto";
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const b64urlJson = (obj) => b64url(JSON.stringify(obj));
const fromB64urlJson = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
export function loadSigner(){
  const skB64 = process.env.STALL_TOKEN_SK;
  if (skB64) {
    const privateKey = createPrivateKey({ key: Buffer.from(skB64,"base64"), format:"der", type:"pkcs8" });
    const publicKey = createPublicKey(privateKey);
    return { privateKey, publicKey };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey, ephemeral: true };
}
export function mintToken({ privateKey }, { payer, plan, scope, windowSeconds, jti }){
  const now = Math.floor(Date.now()/1000);
  const header = { alg:"EdDSA", typ:"JWT" };
  const payload = { iss:"the-stall.intuitek.ai", sub:payer, plan, scope, jti, iat:now, nbf:now, exp:now+windowSeconds };
  const signingInput = b64urlJson(header) + "." + b64urlJson(payload);
  const sig = edSign(null, Buffer.from(signingInput), privateKey);
  return signingInput + "." + b64url(sig);
}
export function verifyToken({ publicKey }, token, { requiredScope } = {}){
  const parts = String(token||"").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h,p,s] = parts;
  const signingInput = h + "." + p;
  const ok = edVerify(null, Buffer.from(signingInput), publicKey, Buffer.from(s,"base64url"));
  if (!ok) throw new Error("bad signature");
  const payload = fromB64urlJson(p);
  const now = Math.floor(Date.now()/1000);
  if (payload.exp && now >= payload.exp) throw new Error("expired");
  if (payload.nbf && now < payload.nbf) throw new Error("not yet valid");
  if (requiredScope){ const scopes = Array.isArray(payload.scope)?payload.scope:[]; if(!scopes.includes(requiredScope)) throw new Error("insufficient scope"); }
  return payload;
}
