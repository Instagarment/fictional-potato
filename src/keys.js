// The key pair the app uses to get access to stores that installed it.
// If you don't provide one, the app makes its own the first time it starts and
// keeps it in DATA_DIR (Render's private disk). The public half is shown on the
// Setup page so you can paste it into the Shopify Dev Dashboard.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function loadOrCreateSigningKey({ dataDir, privateKeyPem, keyId }) {
  let pem = privateKeyPem;
  let kid = keyId;

  if (!pem) {
    const keyFile = path.join(dataDir, 'signing-key.pem');
    const metaFile = path.join(dataDir, 'signing-key.json');
    if (fs.existsSync(keyFile)) {
      pem = fs.readFileSync(keyFile, 'utf8');
      kid = JSON.parse(fs.readFileSync(metaFile, 'utf8')).kid;
    } else {
      fs.mkdirSync(dataDir, { recursive: true });
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
      pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      kid = `instagarment-${new Date().toISOString().slice(0, 10)}`;
      fs.writeFileSync(keyFile, pem, { mode: 0o600 });
      fs.writeFileSync(metaFile, JSON.stringify({ kid }));
      console.log(`Created a new signing key (${kid}). Add its public key in the Shopify Dev Dashboard — see /admin/setup.`);
    }
  }
  if (!kid) throw new Error('Set SHOPIFY_KEY_ID to match the key you added in the Dev Dashboard.');

  const publicKey = crypto.createPublicKey(pem);
  const alg = publicKey.asymmetricKeyType === 'ec' ? 'ES256' : 'RS256';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' };
  return { privateKey: pem, keyId: kid, jwk };
}
