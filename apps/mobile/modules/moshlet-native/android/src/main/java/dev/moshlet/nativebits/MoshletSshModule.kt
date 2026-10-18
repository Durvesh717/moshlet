package dev.moshlet.nativebits

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.keepalive.KeepAliveRunner
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.method.AuthKeyboardInteractive
import net.schmizz.sshj.userauth.method.AuthPassword
import net.schmizz.sshj.userauth.method.PasswordResponseProvider
import net.schmizz.sshj.userauth.password.PasswordFinder
import net.schmizz.sshj.userauth.password.Resource
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.PublicKey
import java.security.Security
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * SSH to the computer running herdr: herdr API calls and event streams run as commands over it,
 * and it starts the mosh-servers the terminals use. JavaScript holds connections by id; the
 * phone's own key never leaves this module.
 */
class MoshletSshModule : Module() {
  private class Conn(val client: SSHClient, val address: String)
  private class Stream(val session: Session)
  private class HostKeyChanged(val expected: String, val actual: String) : RuntimeException("host key changed")

  private val conns = ConcurrentHashMap<Int, Conn>()
  private val streams = ConcurrentHashMap<String, Stream>()
  private val nextId = AtomicInteger(1)
  private val timers = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "moshlet-ssh-timer").apply { isDaemon = true } }
  private val vault by lazy { IdentityVault(appContext.reactContext!!.applicationContext) }

  override fun definition() = ModuleDefinition {
    Name("MoshletSsh")

    Events("onSshClosed", "onSshLine", "onSshStreamEnd")

    OnCreate { useFullBouncyCastle() }

    /** This device's public key line, without unlocking anything; null before the key exists. */
    Function("publicKey") { vault.publicKeyLine }

    /** Unlocks (creating on first use) this device's key. Rejects with ERR_NEEDS_UNLOCK when a fingerprint/PIN check is due. */
    AsyncFunction("loadIdentity") Coroutine { comment: String ->
      withContext(Dispatchers.IO) {
        val id = try {
          vault.identity(comment)
        } catch (_: IdentityVault.NeedsUnlock) {
          throw CodedException("ERR_NEEDS_UNLOCK", "Unlock the device to use its key.", null)
        }
        mapOf("publicKey" to id.publicKeyLine, "fingerprint" to id.fingerprint)
      }
    }

    /** Drops the unlocked key from memory: the next use decrypts it again, asking for fingerprint/PIN if due. */
    Function("forgetIdentity") { vault.forget() }

    /**
     * Opens the connection up to (not including) login, checking the computer's host key against
     * the one seen before (when given). Returns its id, the key it presented, and the IP it
     * resolved to (mosh needs an address, not a name); or, when the key isn't the one seen before,
     * `changed` with the key it presented instead.
     */
    AsyncFunction("connect") Coroutine { host: String, port: Int, knownHostKey: String?, knownKeyType: String? ->
      withContext(Dispatchers.IO) {
        var seen = ""
        var seenType = ""
        val client = SSHClient(DefaultConfig().apply { keepAliveProvider = KeepAliveProvider.KEEP_ALIVE })
        client.addHostKeyVerifier(object : HostKeyVerifier {
          override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
            seen = SshIdentity.fingerprintOf(Buffer.PlainBuffer().putPublicKey(key).compactData)
            seenType = KeyType.fromKey(key).toString()
            if (knownHostKey != null && knownHostKey != seen) throw HostKeyChanged(knownHostKey, seen)
            return true
          }

          override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = listOfNotNull(knownKeyType)
        })
        client.connectTimeout = 10_000
        client.timeout = 30_000
        try {
          client.connect(host, port)
        } catch (e: Exception) {
          runCatching { client.disconnect() }
          // Not an error to JavaScript but an answer: the key it presented, so the user can choose to trust exactly that one.
          generateSequence<Throwable>(e) { it.cause }.filterIsInstance<HostKeyChanged>().firstOrNull()?.let {
            return@withContext mapOf("changed" to mapOf("expected" to it.expected, "hostKey" to it.actual, "keyType" to seenType))
          }
          throw networkError(e, host)
        }
        val id = nextId.getAndIncrement()
        conns[id] = Conn(client, client.remoteAddress.hostAddress ?: host)
        client.transport.setDisconnectListener { _, message ->
          if (conns.remove(id) != null) sendEvent("onSshClosed", mapOf("id" to id, "reason" to (message ?: "connection closed")))
        }
        mapOf("id" to id, "hostKey" to seen, "keyType" to seenType, "address" to conns[id]!!.address)
      }
    }

    /** Logs in with this device's key (loadIdentity first). False when the computer doesn't accept it. */
    AsyncFunction("authKey") Coroutine { id: Int, user: String ->
      withContext(Dispatchers.IO) {
        val c = conn(id)
        val identity = vault.cached ?: throw CodedException("ERR_NEEDS_UNLOCK", "Unlock the device to use its key.", null)
        try {
          c.client.authPublickey(user, c.client.loadKeys(identity.privateKeyPem, null, null))
          keepAlive(c.client)
          true
        } catch (_: UserAuthException) {
          false
        }
      }
    }

    /** Logs in with a password (or the keyboard-interactive prompt macOS uses). False when it's refused. */
    AsyncFunction("authPassword") Coroutine { id: Int, user: String, password: String ->
      withContext(Dispatchers.IO) {
        val c = conn(id)
        val finder = object : PasswordFinder {
          override fun reqPassword(resource: Resource<*>?) = password.toCharArray()
          override fun shouldRetry(resource: Resource<*>?) = false
        }
        try {
          c.client.auth(user, AuthPassword(finder), AuthKeyboardInteractive(PasswordResponseProvider(finder)))
          keepAlive(c.client)
          true
        } catch (_: UserAuthException) {
          false
        }
      }
    }

    /** Runs a command to completion: stdin is written and closed, stdout and stderr collected. */
    AsyncFunction("exec") Coroutine { id: Int, command: String, stdin: String?, timeoutMs: Int ->
      withContext(Dispatchers.IO) {
        val c = conn(id)
        val session = try {
          c.client.startSession()
        } catch (e: IOException) {
          throw CodedException("ERR_CLOSED", "The connection to the computer dropped.", e)
        }
        var timedOut = false
        val timer = timers.schedule({
          timedOut = true
          runCatching { session.close() }
        }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        try {
          val cmd = session.exec(command)
          if (stdin != null) cmd.outputStream.write(stdin.toByteArray())
          cmd.outputStream.close()
          val (out, err) = coroutineScope {
            val err = async(Dispatchers.IO) { cmd.errorStream.readBytes() }
            cmd.inputStream.readBytes() to err.await()
          }
          cmd.join(5, TimeUnit.SECONDS)
          mapOf("status" to cmd.exitStatus, "stdout" to String(out), "stderr" to String(err))
        } catch (e: Exception) {
          if (timedOut) throw CodedException("ERR_TIMEOUT", "The computer didn't answer in time.", e)
          throw CodedException("ERR_CLOSED", "The connection to the computer dropped.", e)
        } finally {
          timer.cancel(false)
          runCatching { session.close() }
        }
      }
    }

    /**
     * Starts a long-running command under the caller's stream id, writes stdin (left open), then
     * sends each line it prints as onSshLine, and onSshStreamEnd when it stops.
     */
    AsyncFunction("stream") Coroutine { id: Int, streamId: String, command: String, stdin: String ->
      withContext(Dispatchers.IO) {
        val c = conn(id)
        val session = try {
          c.client.startSession()
        } catch (e: IOException) {
          throw CodedException("ERR_CLOSED", "The connection to the computer dropped.", e)
        }
        val cmd = session.exec(command)
        cmd.outputStream.write(stdin.toByteArray())
        cmd.outputStream.flush()
        streams[streamId] = Stream(session)
        thread(name = "moshlet-ssh-stream", isDaemon = true) {
          var reason = "ended"
          try {
            cmd.inputStream.bufferedReader().forEachLine { sendEvent("onSshLine", mapOf("stream" to streamId, "line" to it)) }
          } catch (e: Exception) {
            reason = e.message ?: "ended"
          }
          streams.remove(streamId)?.let { runCatching { it.session.close() } }
          sendEvent("onSshStreamEnd", mapOf("stream" to streamId, "reason" to reason))
        }
        Unit
      }
    }

    Function("closeStream") { streamId: String ->
      streams.remove(streamId)?.let { s -> timers.execute { runCatching { s.session.close() } } }
    }

    Function("disconnect") { id: Int ->
      conns.remove(id)?.let { c -> timers.execute { runCatching { c.client.disconnect() } } }
    }

    OnDestroy {
      for (s in streams.values) runCatching { s.session.close() }
      streams.clear()
      for (c in conns.values) runCatching { c.client.disconnect() }
      conns.clear()
    }
  }

  private fun conn(id: Int): Conn {
    val c = conns[id] ?: throw CodedException("ERR_CLOSED", "The connection to the computer dropped.", null)
    if (!c.client.isConnected) {
      conns.remove(id)
      throw CodedException("ERR_CLOSED", "The connection to the computer dropped.", null)
    }
    return c
  }

  /** Notice a dead link in about half a minute, rather than when TCP gives up. */
  private fun keepAlive(client: SSHClient) {
    (client.connection.keepAlive as? KeepAliveRunner)?.maxAliveCount = 3
    client.connection.keepAlive.keepAliveInterval = 10
  }

  /** Android wraps socket errors a few levels deep (ConnectException around "ECONNREFUSED"): look through all of them. */
  private fun networkError(e: Exception, host: String): CodedException {
    val chain = generateSequence<Throwable>(e) { it.cause }.toList()
    fun says(errno: String) = chain.any { it.message?.contains(errno) == true }
    val message = when {
      chain.any { it is UnknownHostException } -> "Couldn't find $host. Check the name, and that Tailscale is on."
      says("ECONNREFUSED") -> "$host refused the connection. Is SSH turned on there, on that port?"
      chain.any { it is NoRouteToHostException } || says("EHOSTUNREACH") || says("ENETUNREACH") -> "No route to $host. Is Tailscale on?"
      chain.any { it is SocketTimeoutException } || says("ETIMEDOUT") -> "$host didn't answer. Is it awake and on Tailscale?"
      chain.any { it is ConnectException } -> "Couldn't connect to $host. Is SSH turned on there?"
      else -> chain.last().message ?: chain.last().javaClass.simpleName
    }
    return CodedException("ERR_NETWORK", message, e)
  }

  companion object {
    /** Android's built-in BouncyCastle is cut down; sshj needs the full one (Ed25519, curve25519). */
    @Volatile
    private var bcReady = false

    @Synchronized
    fun useFullBouncyCastle() {
      if (bcReady) return
      Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
      Security.addProvider(BouncyCastleProvider())
      bcReady = true
    }
  }
}
