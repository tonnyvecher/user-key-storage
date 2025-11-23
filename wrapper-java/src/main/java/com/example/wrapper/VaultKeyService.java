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

    // AES key (для шифрования профиля)
    private volatile SecretKeySpec cachedAesKey;
    private volatile String cachedAesKeyId = "master-v1";

    // HMAC key (для подписи операций доступа)
    private volatile byte[] cachedHmacKey;
    private volatile String cachedHmacKeyId = "access-hmac-v1";

    public VaultKeyService() {
        this.vaultAddr = System.getenv().getOrDefault("VAULT_ADDR", "http://app-vault:8200");
        this.vaultToken = System.getenv().getOrDefault("VAULT_TOKEN", "root");
    }

    // ---------- AES-ключ ----------

    public SecretKeySpec getAesKey() {
        if (cachedAesKey != null) {
            return cachedAesKey;
        }

        synchronized (this) {
            if (cachedAesKey != null) {
                return cachedAesKey;
            }
            try {
                SecretKeySpec key = loadAesKeyFromVault();
                if (key == null) {
                    key = generateAndStoreAesKeyInVault();
                }
                cachedAesKey = key;
                return key;
            } catch (Exception e) {
                throw new RuntimeException("Failed to obtain AES key from Vault", e);
            }
        }
    }

    public String getKeyId() {
        return cachedAesKeyId;
    }

    private SecretKeySpec loadAesKeyFromVault() throws Exception {
        String url = vaultAddr + "/v1/secret/data/crypto/master-key";

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("X-Vault-Token", vaultToken)
                .GET()
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() == 404) {
            System.out.println("VaultKeyService: AES master key not found in Vault (404)");
            return null;
        }

        if (response.statusCode() / 100 != 2) {
            System.out.println("VaultKeyService: Vault AES read error, status=" +
                    response.statusCode() + " body=" + response.body());
            throw new RuntimeException("Vault AES read error: " + response.statusCode());
        }

        JsonNode root = objectMapper.readTree(response.body());
        JsonNode dataNode = root.path("data").path("data");

        String keyHex = dataNode.path("key_hex").asText(null);
        String keyId = dataNode.path("key_id").asText("master-v1");

        if (keyHex == null || keyHex.isEmpty()) {
            System.out.println("VaultKeyService: AES key_hex is missing");
            return null;
        }

        byte[] keyBytes = hexToBytes(keyHex);
        cachedAesKeyId = keyId;

        System.out.println("VaultKeyService: loaded AES key from Vault, key_id=" + cachedAesKeyId);
        return new SecretKeySpec(keyBytes, "AES");
    }

    private SecretKeySpec generateAndStoreAesKeyInVault() throws Exception {
        byte[] keyBytes = new byte[32]; // 256 bit
        SecureRandom random = new SecureRandom();
        random.nextBytes(keyBytes);

        String keyHex = bytesToHex(keyBytes);

        String url = vaultAddr + "/v1/secret/data/crypto/master-key";

        ObjectNode dataInner = objectMapper.createObjectNode();
        dataInner.put("key_hex", keyHex);
        dataInner.put("algo", "AES-256-GCM");
        dataInner.put("key_id", cachedAesKeyId);

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
            System.out.println("VaultKeyService: Vault AES write error, status=" +
                    response.statusCode() + " body=" + response.body());
            throw new RuntimeException("Vault AES write error: " + response.statusCode());
        }

        System.out.println("VaultKeyService: generated new AES key and stored in Vault, key_id=" + cachedAesKeyId);
        return new SecretKeySpec(keyBytes, "AES");
    }

    // ---------- HMAC-ключ ----------

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

    // ---------- Вспомогательные методы ----------

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
