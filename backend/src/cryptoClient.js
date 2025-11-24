const WRAPPER_BASE_URL =
  process.env.WRAPPER_BASE_URL || "http://app-wrapper-java:8080";

async function getFetch() {
  const mod = await import("node-fetch");
  return mod.default;
}

async function encryptField(userId, field, plaintext) {
  if (!plaintext) return null;

  const fetch = await getFetch();

  const res = await fetch(`${WRAPPER_BASE_URL}/crypto/encrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      field,
      plaintext
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Encrypt error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.ciphertext;
}

async function decryptField(userId, field, ciphertext) {
  if (!ciphertext) return null;

  const fetch = await getFetch();

  const res = await fetch(`${WRAPPER_BASE_URL}/crypto/decrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      field,
      ciphertext,
      key_id: "stub-key-1"
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Decrypt error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.plaintext;
}

async function signAccessOperation(userId, roleName, action = "GRANT_ROLE") {
  const fetch = await getFetch();

  const res = await fetch(`${WRAPPER_BASE_URL}/crypto/access-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      role_name: roleName,
      action
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Access-sign error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.hmac; // base64 подпись
}

async function rotateMasterKey() {
  const fetch = await getFetch();

  const res = await fetch(`${WRAPPER_BASE_URL}/crypto/rotate-master`, {
    method: "POST"
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rotate master key error: ${res.status} ${text}`);
  }

  return await res.text();
}



module.exports = {
  encryptField,
  decryptField,
  signAccessOperation,
  rotateMasterKey
};
