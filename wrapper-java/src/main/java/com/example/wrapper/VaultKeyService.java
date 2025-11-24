package com.example.wrapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;

@Service
public class VaultKeyService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final String vaultAddr;
    private final String vaultToken;

    // ---------- AES (профиль) ----------

    // Текущий мастер-ключ профиля
    private volatile SecretKeySpec cachedAesCurrentKey;
    private volatile String cachedAesCurrentKeyId = "master-v1";

    // Предыдущий мастер-ключ профиля (для расшифровки старых данных)
    private volatile SecretKeySpec cachedAesPrevKey;
    private volatile String cachedAesPrevKeyId = null;

    // ---------- HMAC (роли/доступ) ----------

    private volatile byte[] cachedHmacKey;
    private volatile String cachedHmacKeyId = "access-hmac-v1";

    public VaultKeyService() {
        this.vaultAddr = System.getenv().getOrDefault("VAULT_ADDR", "http://app-vault:8200");
        this.vaultToken = System.getenv().getOrDefault("VAULT_TOKEN", "root");
    }

    // ================= AES: публичные методы =================

    public SecretKeySpec getAesKey() {
        ensureAesKeysLoaded();
        return cachedAesCurrentKey;
    }

    public SecretKeySpec getPrevAesKeyOrNull() {
        ensureAesKeysLoaded();
        return cachedAesPrevKey;
    }

    public String getKeyId() {
        ensureAesKeysLoaded();
        return cachedAesCurrentKeyId;
    }

    /**
     * Ротация мастер-ключа профиля:
     * prev <- current, current <- new.
     */
    public synchronized void rotateAesMasterKey() throws Exception {
        ensureAesKeysLoaded();

        // старый current станет prev
        SecretKeySpec oldCurrent = cachedAesCurrentKey;
        String oldCurrentId = cachedAesCurrentKeyId;

        // генерируем новый current
        byte[] newKeyBytes = new byte[32]; // 256 bit
        SecureRandom random = new SecureRandom();
        random.nextBytes(newKeyBytes);

        String newKeyHex = bytesToHex(newKeyBytes);
        String newKeyId = nextVersionId(oldCurrentId);

        // готовим JSON для Vault
        ObjectNode dataInner = objectMapper.createObjectNode();
        dataInner.put("current_key_hex", newKeyHex);
        dataInner.put("current_key_id", newKeyId);

        if (oldCurrent != null) {
            dataInner.put("prev_key_hex", bytesToHex(oldCurrent.getEncoded()));
            dataInner.put("prev_key_id", oldCurrentId);
        }

        // для совместимости оставим старые поля
        dataInner.put("key_hex", newKeyHex);
        dataInner.put("key_id", newKeyId);
        dataInner.put("algo", "AES-256-GCM");

        ObjectNode outer = objectMapper.createObjectNode();
        outer.set("data", dataInner);

        String body = objectMapper.writeValueAsString(outer);

        String url = vaultAddr + "/v1/secret/data/crypto/master-key";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("X-Vault-Token", vaultToken)
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() / 100 != 2) {
            System.out.println("VaultKeyService: Vault AES rotate write error, status=" +
                    response.statusCode() + " body=" + response.body());
            throw new RuntimeException("Vault AES rotate write error: " + response.statusCode());
        }

        // обновляем кэш
        cachedAesPrevKey = oldCurrent;
        cachedAesPrevKeyId = oldCurrentId;

        cachedAesCurrentKey = new SecretKeySpec(newKeyBytes, "AES");
        cachedAesCurrentKeyId = newKeyId;

        System.out.println("VaultKeyService: rotated AES master key, new current_id=" + newKeyId +
                ", prev_id=" + oldCurrentId);
    }

    // ================= AES: внутренняя загрузка =================

    private void ensureAesKeysLoaded() {
        if (cachedAesCurrentKey != null) {
            return;
        }
        synchronized (this) {
            if (cachedAesCurrentKey != null) {
                return;
            }
            try {
                loadAesKeysFromVaultOrGenerate();
            } catch (Exception e) {
                throw new RuntimeException("Failed to load AES keys from Vault", e);
            }
        }
    }

    private void loadAesKeysFromVaultOrGenerate() throws Exception {
        String url = vaultAddr + "/v1/secret/data/crypto/master-key";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("X-Vault-Token", vaultToken)
                .GET()
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 404) {
            System.out.println("VaultKeyService: AES master key not found in Vault (404), generating new");
            generateAndStoreInitialAesKey();
            return;
        }

        if (response.statusCode() / 100 != 2) {
            System.out.println("VaultKeyService: Vault AES read error, status=" +
                    response.statusCode() + " body=" + response.body());
            throw new RuntimeException("Vault AES read error: " + response.statusCode());
        }

        JsonNode root = objectMapper.readTree(response.body());
        JsonNode dataNode = root.path("data").path("data");

        // Новый формат: current_key_hex / prev_key_hex
        String currentKeyHex = dataNode.path("current_key_hex").asText(null);
        String currentKeyId = dataNode.path("current_key_id").asText(null);

        String prevKeyHex = dataNode.path("prev_key_hex").asText(null);
        String prevKeyId = dataNode.path("prev_key_id").asText(null);

        // Старый формат: key_hex / key_id
        String legacyKeyHex = dataNode.path("key_hex").asText(null);
        String legacyKeyId = dataNode.path("key_id").asText("master-v1");

        if (currentKeyHex != null && !currentKeyHex.isEmpty()) {
            byte[] currentBytes = hexToBytes(currentKeyHex);
            cachedAesCurrentKey = new SecretKeySpec(currentBytes, "AES");
            cachedAesCurrentKeyId = (currentKeyId != null && !currentKeyId.isEmpty())
                    ? currentKeyId
                    : "master-v1";

            if (prevKeyHex != null && !prevKeyHex.isEmpty()) {
                byte[] prevBytes = hexToBytes(prevKeyHex);
                cachedAesPrevKey = new SecretKeySpec(prevBytes, "AES");
                cachedAesPrevKeyId = prevKeyId;
            }

            System.out.println("VaultKeyService: loaded AES keys from Vault, current_id=" +
                    cachedAesCurrentKeyId + ", prev_id=" + cachedAesPrevKeyId);
        } else if (legacyKeyHex != null && !legacyKeyHex.isEmpty()) {
            // Совместимость со старым форматом (один ключ)
            byte[] keyBytes = hexToBytes(legacyKeyHex);
            cachedAesCurrentKey = new SecretKeySpec(keyBytes, "AES");
            cachedAesCurrentKeyId = legacyKeyId;

            cachedAesPrevKey = null;
            cachedAesPrevKeyId = null;

            System.out.println("VaultKeyService: loaded AES legacy key from Vault, key_id=" +
                    cachedAesCurrentKeyId);
        } else {
            System.out.println("VaultKeyService: no AES key data in Vault, generating new");
            generateAndStoreInitialAesKey();
        }
    }

    private void generateAndStoreInitialAesKey() throws Exception {
        byte[] keyBytes = new byte[32]; // 256 bit
        SecureRandom random = new SecureRandom();
        random.nextBytes(keyBytes);

        String keyHex = bytesToHex(keyBytes);
        cachedAesCurrentKeyId = "master-v1";

        String url = vaultAddr + "/v1/secret/data/crypto/master-key";

        ObjectNode dataInner = objectMapper.createObjectNode();
        dataInner.put("current_key_hex", keyHex);
        dataInner.put("current_key_id", cachedAesCurrentKeyId);

        // Для совместимости
        dataInner.put("key_hex", keyHex);
        dataInner.put("key_id", cachedAesCurrentKeyId);
        dataInner.put("algo", "AES-256-GCM");

        ObjectNode outer = objectMapper.createObjectNode();
        outer.set("data", dataInner);

        String body = objectMapper.writeValueAsString(outer);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("X-Vault-Token", vaultToken)
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() / 100 != 2) {
            System.out.println("VaultKeyService: Vault AES initial write error, status=" +
                    response.statusCode() + " body=" + response.body());
            throw new RuntimeException("Vault AES initial write error: " + response.statusCode());
        }

        cachedAesCurrentKey = new SecretKeySpec(keyBytes, "AES");
        cachedAesPrevKey = null;
        cachedAesPrevKeyId = null;

        System.out.println("VaultKeyService: generated initial AES master key, id=" + cachedAesCurrentKeyId);
    }

    private static String nextVersionId(String currentId) {
        if (currentId == null || currentId.isEmpty()) {
            return "master-v1";
        }
        int idx = currentId.lastIndexOf("-v");
        if (idx == -1) {
            return currentId + "-v2";
        }
        String prefix = currentId.substring(0, idx);
        String numStr = currentId.substring(idx + 2);
        try {
            int n = Integer.parseInt(numStr);
            return prefix + "-v" + (n + 1);
        } catch (NumberFormatException e) {
            return currentId + "-v2";
        }
    }

    // ================= HMAC: публичные методы =================

    public byte[] getHmacKey() {
        if (cachedHmacKey != null) {
            return cachedHmacKey;
        }

        synchronized (this) {
            if (cachedHmacKey != null) {
                return cachedHmacKey;
            }
            try {
                byte[] key = loadHmacKeyFromVault();
                if (key == null) {
                    key = generateAndStoreHmacKeyInVault();
                }
                cachedHmacKey = key;
                return key;
            } catch (Exception e) {
                throw new RuntimeException("Failed to obtain HMAC key from Vault", e);
            }
        }
    }

    public String getHmacKeyId() {
        return cachedHmacKeyId;
    }

    private byte[] loadHmacKeyFromVault() throws Exception {
        String url = vaultAddr + "/v1/secret/data/crypto/access-hmac-key";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("X-Vault-Token", vaultToken)
                .GET()
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 404) {
            System.out.println("VaultKeyService: HMAC key not found in Vault (404)");
            return null;
        }

        if (response.statusCode() / 100 != 2) {
            System.out.println("VaultKeyService: Vault HMAC read error, status=" +
                    response.statusCode() + " body=" + response.body());
            throw new RuntimeException("Vault HMAC read error: " + response.statusCode());
        }

        JsonNode root = objectMapper.readTree(response.body());
        JsonNode dataNode = root.path("data").path("data");

        String keyHex = dataNode.path("key_hex").asText(null);
        String keyId = dataNode.path("key_id").asText("access-hmac-v1");

        if (keyHex == null || keyHex.isEmpty()) {
            System.out.println("VaultKeyService: HMAC key_hex is missing");
            return null;
        }

        byte[] keyBytes = hexToBytes(keyHex);
        cachedHmacKeyId = keyId;

        System.out.println("VaultKeyService: loaded HMAC key from Vault, key_id=" + cachedHmacKeyId);
        return keyBytes;
    }

    private byte[] generateAndStoreHmacKeyInVault() throws Exception {
        byte[] keyBytes = new byte[32]; // 256 bit HMAC key
        SecureRandom random = new SecureRandom();
        random.nextBytes(keyBytes);

        String keyHex = bytesToHex(keyBytes);

        String url = vaultAddr + "/v1/secret/data/crypto/access-hmac-key";

        ObjectNode dataInner = objectMapper.createObjectNode();
        dataInner.put("key_hex", keyHex);
        dataInner.put("algo", "HMAC-SHA256");
        dataInner.put("key_id", cachedHmacKeyId);

        ObjectNode outer = objectMapper.createObjectNode();
        outer.set("data", dataInner);

        String body = objectMapper.writeValueAsString(outer);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("X-Vault-Token", vaultToken)
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(body))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() / 100 != 2) {
            System.out.println("VaultKeyService: Vault HMAC write error, status=" +
                    response.statusCode() + " body=" + response.body());
            throw new RuntimeException("Vault HMAC write error: " + response.statusCode());
        }

        System.out.println("VaultKeyService: generated new HMAC key and stored in Vault, key_id=" + cachedHmacKeyId);
        return keyBytes;
    }

    // ================= Вспомогательные методы =================

    private static byte[] hexToBytes(String hex) {
        if (hex == null) {
            throw new IllegalArgumentException("hex is null");
        }
        if (hex.length() % 2 != 0) {
            throw new IllegalArgumentException("Hex string length must be even");
        }
        int len = hex.length() / 2;
        byte[] out = new byte[len];
        for (int i = 0; i < len; i++) {
            int hi = Character.digit(hex.charAt(2 * i), 16);
            int lo = Character.digit(hex.charAt(2 * i + 1), 16);
            if (hi == -1 || lo == -1) {
                throw new IllegalArgumentException("Invalid hex char");
            }
            out[i] = (byte) ((hi << 4) + lo);
        }
        return out;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            int v = b & 0xFF;
            if (v < 16) sb.append('0');
            sb.append(Integer.toHexString(v));
        }
        return sb.toString();
    }
}
