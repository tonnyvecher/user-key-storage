package com.example.wrapper;

import org.springframework.web.bind.annotation.*;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

@RestController
public class CryptoController {

    private final VaultKeyService vaultKeyService;

    private static final int GCM_TAG_LENGTH_BITS = 128; // 16 байт тега
    private static final int IV_LENGTH_BYTES = 12;       // стандарт для GCM
    private static final SecureRandom RANDOM = new SecureRandom();

    public CryptoController(VaultKeyService vaultKeyService) {
        this.vaultKeyService = vaultKeyService;
    }

    // ----- DTO для /crypto/encrypt -----

    public static class EncryptRequest {
        public String user_id;
        public String field;
        public String plaintext;

        public EncryptRequest() {
        }

        public EncryptRequest(String user_id, String field, String plaintext) {
            this.user_id = user_id;
            this.field = field;
            this.plaintext = plaintext;
        }
    }

    public static class EncryptResponse {
        public String ciphertext;
        public String algo;
        public String key_id;

        public EncryptResponse() {
        }

        public EncryptResponse(String ciphertext, String algo, String key_id) {
            this.ciphertext = ciphertext;
            this.algo = algo;
            this.key_id = key_id;
        }
    }

    // ----- DTO для /crypto/decrypt -----

    public static class DecryptRequest {
        public String user_id;
        public String field;
        public String ciphertext;
        public String key_id;

        public DecryptRequest() {
        }

        public DecryptRequest(String user_id, String field, String ciphertext, String key_id) {
            this.user_id = user_id;
            this.field = field;
            this.ciphertext = ciphertext;
            this.key_id = key_id;
        }
    }

    public static class DecryptResponse {
        public String plaintext;

        public DecryptResponse() {
        }

        public DecryptResponse(String plaintext) {
            this.plaintext = plaintext;
        }
    }

    // ----- DTO для подписи операций доступа -----

    public static class AccessSignRequest {
        public String user_id;
        public String role_name;
        public String action;

        public AccessSignRequest() {}
    }

    public static class AccessSignResponse {
        public String hmac;
        public String algo;
        public String key_id;

        public AccessSignResponse() {}

        public AccessSignResponse(String hmac, String algo, String key_id) {
            this.hmac = hmac;
            this.algo = algo;
            this.key_id = key_id;
        }
    }

    // ----- Эндпоинты -----

    @GetMapping("/health")
    public String health() {
        return "wrapper-java-aes-gcm-vault-per-user-ok";
    }

    /**
     * Шифрование чувствительного поля профиля.
     * Ключ = HKDF(master_key, info = "profile:" + user_id + ":" + field).
     */
    @PostMapping("/crypto/encrypt")
    public EncryptResponse encrypt(@RequestBody EncryptRequest req) {
        if (req.plaintext == null) {
            return new EncryptResponse(null, "AES-256-GCM", vaultKeyService.getKeyId());
        }

        if (req.user_id == null || req.field == null) {
            throw new IllegalArgumentException("user_id and field are required for per-user key derivation");
        }

        try {
            // 1) мастер-ключ из Vault
            SecretKeySpec masterKey = vaultKeyService.getAesKey();
            byte[] masterBytes = masterKey.getEncoded();

            // 2) derive per-user ключ через HKDF (HMAC-SHA256)
            String infoStr = "profile:" + req.user_id + ":" + req.field;
            byte[] info = infoStr.getBytes(StandardCharsets.UTF_8);
            byte[] userKeyBytes = hkdfExpand(masterBytes, info, 32); // 32 байта = 256 бит

            SecretKeySpec userKey = new SecretKeySpec(userKeyBytes, "AES");

            byte[] plaintextBytes = req.plaintext.getBytes(StandardCharsets.UTF_8);

            // Случайный IV (nonce) для GCM
            byte[] iv = new byte[IV_LENGTH_BYTES];
            RANDOM.nextBytes(iv);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv);
            cipher.init(Cipher.ENCRYPT_MODE, userKey, spec);

            byte[] cipherBytes = cipher.doFinal(plaintextBytes);

            // Склеиваем IV + ciphertext+tag
            byte[] combined = new byte[iv.length + cipherBytes.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(cipherBytes, 0, combined, iv.length, cipherBytes.length);

            String ciphertextB64 = Base64.getEncoder().encodeToString(combined);

            return new EncryptResponse(ciphertextB64, "AES-256-GCM", vaultKeyService.getKeyId());
        } catch (Exception e) {
            throw new RuntimeException("AES-GCM encrypt error: " + e.getMessage(), e);
        }
    }

    /**
     * Расшифровка чувствительного поля профиля.
     * Используем тот же derive-процесс HKDF(master_key, "profile:user_id:field").
     */
    @PostMapping("/crypto/decrypt")
    public DecryptResponse decrypt(@RequestBody DecryptRequest req) {
        if (req.ciphertext == null) {
            return new DecryptResponse(null);
        }

        if (req.user_id == null || req.field == null) {
            throw new IllegalArgumentException("user_id and field are required for per-user key derivation");
        }

        try {
            SecretKeySpec masterKey = vaultKeyService.getAesKey();
            byte[] masterBytes = masterKey.getEncoded();

            String infoStr = "profile:" + req.user_id + ":" + req.field;
            byte[] info = infoStr.getBytes(StandardCharsets.UTF_8);
            byte[] userKeyBytes = hkdfExpand(masterBytes, info, 32);

            SecretKeySpec userKey = new SecretKeySpec(userKeyBytes, "AES");

            byte[] combined = Base64.getDecoder().decode(req.ciphertext);

            if (combined.length < IV_LENGTH_BYTES + 16) {
                throw new IllegalArgumentException("ciphertext too short");
            }

            byte[] iv = new byte[IV_LENGTH_BYTES];
            byte[] cipherBytes = new byte[combined.length - IV_LENGTH_BYTES];

            System.arraycopy(combined, 0, iv, 0, IV_LENGTH_BYTES);
            System.arraycopy(combined, IV_LENGTH_BYTES, cipherBytes, 0, cipherBytes.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv);
            cipher.init(Cipher.DECRYPT_MODE, userKey, spec);

            byte[] plaintextBytes = cipher.doFinal(cipherBytes);
            String plaintext = new String(plaintextBytes, StandardCharsets.UTF_8);

            return new DecryptResponse(plaintext);
        } catch (Exception e) {
            throw new RuntimeException("AES-GCM decrypt error: " + e.getMessage(), e);
        }
    }

    /**
     * Подпись операций назначения ролей:
     * HMAC-SHA256(master_access_key, user_id|role_name|action)
     */
    @PostMapping("/crypto/access-sign")
    public AccessSignResponse accessSign(@RequestBody AccessSignRequest req) {
        try {
            String action = (req.action == null || req.action.isEmpty())
                    ? "GRANT_ROLE"
                    : req.action;

            if (req.user_id == null || req.role_name == null) {
                throw new IllegalArgumentException("user_id and role_name are required");
            }

            // Что подписываем: user_id | role_name | action
            String dataToSign = req.user_id + "|" + req.role_name + "|" + action;

            byte[] hmacKey = vaultKeyService.getHmacKey();

            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec keySpec =
                    new SecretKeySpec(hmacKey, "HmacSHA256");
            mac.init(keySpec);
            byte[] macBytes = mac.doFinal(dataToSign.getBytes(StandardCharsets.UTF_8));

            String hmacB64 = Base64.getEncoder().encodeToString(macBytes);

            return new AccessSignResponse(hmacB64, "HMAC-SHA256", vaultKeyService.getHmacKeyId());
        } catch (Exception e) {
            throw new RuntimeException("HMAC access-sign error: " + e.getMessage(), e);
        }
    }

    // ----- HKDF (HMAC-SHA256) для derive per-user ключей -----

    /**
     * Упрощённый HKDF-Expand с HMAC-SHA256 без явного salt (salt = нули),
     * основной сценарий: derive из мастер-ключа 32 байта на конкретного пользователя/поле.
     */
    private static byte[] hkdfExpand(byte[] ikm, byte[] info, int length) throws Exception {
        // Для простоты: используем ikm как PRK (без отдельного Extract с солью)
        // В дипломе можно описать это как HKDF(ikm, info) на базе HMAC-SHA256.
        byte[] prk = ikm;

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(prk, "HmacSHA256"));

        byte[] result = new byte[length];
        byte[] t = new byte[0];

        int offset = 0;
        byte counter = 1;

        while (offset < length) {
            mac.reset();
            mac.update(t);
            mac.update(info);
            mac.update(counter);

            t = mac.doFinal();

            int toCopy = Math.min(t.length, length - offset);
            System.arraycopy(t, 0, result, offset, toCopy);
            offset += toCopy;
            counter++;
        }

        return result;
    }
}
