package dev.corral.nativebits

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** An Ed25519 SSH key, its private half in OpenSSH's own file format (what sshj and `ssh` read). */
class SshIdentity(val privateKeyPem: String, val publicKeyLine: String) {
  val fingerprint: String get() = fingerprintOf(Base64.decode(publicKeyLine.split(" ")[1], Base64.DEFAULT))

  companion object {
    private const val TYPE = "ssh-ed25519"

    fun generate(comment: String, random: SecureRandom = SecureRandom()): SshIdentity {
      val pair = Ed25519KeyPairGenerator().apply { init(Ed25519KeyGenerationParameters(random)) }.generateKeyPair()
      val seed = (pair.private as Ed25519PrivateKeyParameters).encoded
      val pub = (pair.public as Ed25519PublicKeyParameters).encoded
      val pubBlob = sshString(TYPE.toByteArray()) + sshString(pub)

      val check = random.nextInt()
      val private = ByteArrayOutputStream().apply {
        DataOutputStream(this).apply {
          writeInt(check)
          writeInt(check)
          write(sshString(TYPE.toByteArray()))
          write(sshString(pub))
          write(sshString(seed + pub))
          write(sshString(comment.toByteArray()))
        }
        var pad = 1
        while (size() % 8 != 0) write(pad++)
      }.toByteArray()

      val body = ByteArrayOutputStream().apply {
        write("openssh-key-v1".toByteArray())
        write(0)
        write(sshString("none".toByteArray())) // cipher: the file is sealed by the Keystore instead
        write(sshString("none".toByteArray())) // kdf
        write(sshString(ByteArray(0)))
        DataOutputStream(this).writeInt(1)
        write(sshString(pubBlob))
        write(sshString(private))
      }.toByteArray()

      val b64 = Base64.encodeToString(body, Base64.NO_WRAP).chunked(70).joinToString("\n")
      val pem = "-----BEGIN OPENSSH PRIVATE KEY-----\n$b64\n-----END OPENSSH PRIVATE KEY-----\n"
      return SshIdentity(pem, "$TYPE ${Base64.encodeToString(pubBlob, Base64.NO_WRAP)} $comment")
    }

    /** OpenSSH-style "SHA256:..." fingerprint of a public key blob. */
    fun fingerprintOf(blob: ByteArray): String =
      "SHA256:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(blob), Base64.NO_WRAP or Base64.NO_PADDING)

    private fun sshString(b: ByteArray): ByteArray {
      val out = ByteArrayOutputStream()
      DataOutputStream(out).apply {
        writeInt(b.size)
        write(b)
      }
      return out.toByteArray()
    }
  }
}

/**
 * This device's SSH key. The private key is stored encrypted with an AES key that lives in the
 * Android Keystore and, when the device has a screen lock, only works for a few minutes after a
 * fingerprint/PIN check. The decrypted key is only ever held in memory.
 */
class IdentityVault(private val context: Context) {
  private val encFile = File(context.filesDir, "identity.enc")
  private val pubFile = File(context.filesDir, "identity.pub")

  @Volatile
  var cached: SshIdentity? = null
    private set

  class NeedsUnlock : Exception("Unlock needed")

  /** The public key line, without unlocking anything; null before the key exists. */
  val publicKeyLine: String? get() = pubFile.takeIf { it.exists() }?.readText()?.trim()

  private val requiresUserAuth: Boolean
    get() = (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

  /** The identity, created on first use. Throws [NeedsUnlock] when a fingerprint/PIN check is due. */
  @Synchronized
  fun identity(comment: String): SshIdentity {
    cached?.let { return it }
    val id = if (encFile.exists() && pubFile.exists()) decrypt(comment) else create(comment)
    cached = id
    return id
  }

  private fun create(comment: String): SshIdentity {
    val cipher = Cipher.getInstance(TRANSFORM)
    try {
      try {
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(recreate = false))
      } catch (_: KeyPermanentlyInvalidatedException) {
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(recreate = true))
      }
    } catch (_: UserNotAuthenticatedException) {
      throw NeedsUnlock()
    }
    val id = SshIdentity.generate(comment)
    val sealed = cipher.doFinal(id.privateKeyPem.toByteArray())
    encFile.writeBytes(byteArrayOf(cipher.iv.size.toByte()) + cipher.iv + sealed)
    pubFile.writeText(id.publicKeyLine + "\n")
    return id
  }

  private fun decrypt(comment: String): SshIdentity {
    val blob = encFile.readBytes()
    val ivLen = blob[0].toInt()
    val cipher = Cipher.getInstance(TRANSFORM)
    val pem = try {
      cipher.init(Cipher.DECRYPT_MODE, wrappingKey(recreate = false), GCMParameterSpec(128, blob, 1, ivLen))
      String(cipher.doFinal(blob, 1 + ivLen, blob.size - 1 - ivLen))
    } catch (_: UserNotAuthenticatedException) {
      throw NeedsUnlock()
    } catch (_: KeyPermanentlyInvalidatedException) {
      return startOver(comment) // the screen lock was removed, which destroys the Keystore key
    } catch (_: AEADBadTagException) {
      return startOver(comment) // sealed by a Keystore key this device doesn't have (restored from a backup)
    }
    return SshIdentity(pem, pubFile.readText().trim())
  }

  /** The old key can't be opened any more: make a new one (the computer needs it added again). */
  private fun startOver(comment: String): SshIdentity {
    encFile.delete()
    pubFile.delete()
    wrappingKey(recreate = true)
    return create(comment)
  }

  private fun wrappingKey(recreate: Boolean): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!recreate) (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
    if (requiresUserAuth) {
      spec.setUserAuthenticationRequired(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        spec.setUserAuthenticationParameters(UNLOCK_VALIDITY_SEC, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
      } else {
        @Suppress("DEPRECATION")
        spec.setUserAuthenticationValidityDurationSeconds(UNLOCK_VALIDITY_SEC)
      }
    }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(spec.build())
      generateKey()
    }
  }

  companion object {
    private const val ALIAS = "corral-identity-wrap"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val UNLOCK_VALIDITY_SEC = 300
  }
}
