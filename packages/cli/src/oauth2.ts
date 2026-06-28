/**
 * OAuth2 Authorization Utilities — supports Gmail / Outlook and all OAuth2-based email providers
 *
 * Local callback authorization flow:
 * 1. User provides their own clientId / clientSecret (obtained from Google Cloud Console / Azure portal)
 * 2. Starts a local HTTP server listening on 127.0.0.1 for the callback
 * 3. Outputs the authorization URL; user authorizes in browser
 * 4. OAuth provider callbacks to the local server with the authorization code
 * 5. Exchange the authorization code for refreshToken + accessToken
 * 6. Return OAuth2Credentials for saving to credentials.yaml
 *
 * Automatic token refresh:
 * - SMTP (nodemailer): built-in automatic refresh
 * - IMAP (imapflow): automatically refreshes accessToken using refreshToken before connection
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import type { OAuth2Credentials } from '@mail-agent/core'

// ── OAuth2 Provider Configurations ──

export interface OAuth2ProviderConfig {
  name: string // display name
  authUrl: string
  tokenUrl: string
  scope: string
  /** Guide text for registering the application */
  registerGuide: string
  /** Whether clientSecret is required (Google desktop apps optional, Microsoft requires it) */
  requiresClientSecret: boolean
  /** Additional token request parameters */
  extraTokenParams?: Record<string, string>
}

const OAUTH2_PROVIDERS: Record<string, OAuth2ProviderConfig> = {
  gmail: {
    name: 'Google (Gmail)',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://mail.google.com/',
    requiresClientSecret: false,
    registerGuide: [
      '📝 Google Cloud Console Setup Steps:',
      '',
      '1. Open https://console.cloud.google.com/apis/credentials',
      '2. Create a project (or select an existing one)',
      '3. Enable Gmail API → https://console.cloud.google.com/apis/library/gmail.googleapis.com',
      '4. Configure consent screen → https://console.cloud.google.com/apis/credentials/consent',
      '   Select "External" for user type, keep publish status as "Testing"',
      '5. Create credentials → "OAuth client ID" → Application type "Web application"',
      '6. Add redirect URI: http://127.0.0.1:18291/callback',
      '7. Copy the "Client ID" and "Client Secret"',
    ].join('\n'),
  },
  outlook: {
    name: 'Microsoft (Outlook)',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'https://outlook.office365.com/IMAP.AccessAsUser.All https://outlook.office365.com/SMTP.Send offline_access',
    requiresClientSecret: true,
    registerGuide: [
      '📝 Please register an application in the Azure portal first to obtain OAuth2 credentials:',
      '',
      '1. Open https://entra.microsoft.com',
      '2. Go to "App registrations" → "New registration"',
      '3. Name: mail-agent, Account type: "Accounts in any organizational directory and personal Microsoft accounts"',
      '4. Redirect URI: "Web" with value http://127.0.0.1:18292/callback',
      '5. After registration, copy the "Application (client) ID"',
      '6. Go to "Certificates & secrets" → "New client secret" → copy the secret value',
      '7. Go to "API permissions" → "Add a permission" → "Microsoft Graph" → "Delegated permissions"',
      '   Add: IMAP.AccessAsUser.All, SMTP.Send',
      '8. Click "Grant admin consent for ..."',
    ].join('\n'),
  },
}

export function getOAuth2ProviderConfig(provider: string): OAuth2ProviderConfig | null {
  return OAUTH2_PROVIDERS[provider] || null
}

// ── Dynamic Port Allocation ──

const DEFAULT_PORTS: Record<string, number> = {
  gmail: 18291,
  outlook: 18292,
}

function findAvailablePort(preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address()
      server.close(() => {
        resolve(typeof addr === 'object' && addr ? addr.port : preferredPort)
      })
    })
    server.on('error', () => {
      // Port occupied, try +1
      if (preferredPort < 65535) {
        findAvailablePort(preferredPort + 1)
          .then(resolve)
          .catch(reject)
      } else {
        reject(new Error('Unable to find an available port'))
      }
    })
  })
}

// ── OAuth2 Authorization Result ──

export interface OAuth2TokenResult {
  clientId: string
  clientSecret: string
  refreshToken: string
  accessToken: string
  expires: number
}

/**
 * Execute the full OAuth2 authorization flow
 *
 * @param provider     Email provider type (gmail / outlook)
 * @param userEmail    User's email address
 * @param clientId     OAuth2 client ID
 * @param clientSecret OAuth2 client secret
 */
export async function performOAuth2Auth(
  provider: string,
  userEmail: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuth2TokenResult> {
  const providerConfig = getOAuth2ProviderConfig(provider)
  if (!providerConfig) {
    throw new Error(`Unsupported OAuth2 email provider: ${provider}`)
  }

  // Find an available port
  const port = await findAvailablePort(DEFAULT_PORTS[provider] || 18290)
  const redirectUri = `http://127.0.0.1:${port}/callback`

  // Generate state to prevent CSRF
  const state = randomBytes(16).toString('hex')

  // Construct authorization URL
  const authUrl = new URL(providerConfig.authUrl)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', providerConfig.scope)
  authUrl.searchParams.set('state', state)

  // Google-specific parameters: ensure refreshToken is obtained
  if (provider === 'gmail') {
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('login_hint', userEmail)
  }

  // Microsoft-specific parameters
  if (provider === 'outlook') {
    authUrl.searchParams.set('login_hint', userEmail)
    authUrl.searchParams.set('response_mode', 'query')
  }

  // Start local server to wait for callback
  console.log(`\n🔐 Starting local authorization server (127.0.0.1:${port})...`)
  const { code } = await waitForCallback(port, state, authUrl.toString(), providerConfig.name)

  // Exchange authorization code for token
  console.log('🔄 Exchanging authorization code for tokens...')
  const tokenResult = await exchangeCodeForToken(providerConfig, clientId, clientSecret, redirectUri, code)

  return {
    clientId,
    clientSecret,
    refreshToken: tokenResult.refresh_token,
    accessToken: tokenResult.access_token,
    expires: Date.now() + tokenResult.expires_in * 1000,
  }
}

/**
 * Start a local HTTP server to wait for OAuth2 callback
 */
function waitForCallback(
  port: number,
  expectedState: string,
  authUrl: string,
  providerName: string,
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    let resolved = false

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)

      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const error = url.searchParams.get('error')
      const errorDesc = url.searchParams.get('error_description')
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:50px">
          <h1>❌ Authorization Failed</h1>
          <p>${errorDesc || error}</p>
          <p>Please return to the terminal to view error details.</p>
        </body></html>`)
        if (!resolved) {
          resolved = true
          server.close()
          reject(new Error(`OAuth2 authorization denied: ${errorDesc || error}`))
        }
        return
      }

      if (returnedState !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>❌ State Verification Failed</h1><p>Please retry.</p>')
        if (!resolved) {
          resolved = true
          server.close()
          reject(new Error('OAuth2 state mismatch, possible CSRF attack'))
        }
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>❌ No Authorization Code Received</h1><p>Please retry.</p>')
        if (!resolved) {
          resolved = true
          server.close()
          reject(new Error('No OAuth2 authorization code received'))
        }
        return
      }

      // Authorization successful
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:50px">
        <h1>✅ ${providerName} Authorization Successful!</h1>
        <p>Please return to the terminal to continue.</p>
        <script>setTimeout(()=>window.close(),2000)</script>
      </body></html>`)
      if (!resolved) {
        resolved = true
        server.close()
        resolve({ code })
      }
    })

    server.listen(port, '127.0.0.1', () => {
      console.log(`\n${'═'.repeat(60)}`)
      console.log(`🔗 Please click or copy the link below to complete authorization in your browser:`)
      console.log(`${'═'.repeat(60)}`)
      console.log(authUrl)
      console.log(`${'═'.repeat(60)}`)
      console.log(`\n⏳ Waiting for browser authorization... (5 minute timeout)\n`)
    })

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true
        reject(new Error(`Local authorization server failed to start: ${err.message}`))
      }
    })

    // 5-minute timeout
    setTimeout(
      () => {
        if (!resolved) {
          resolved = true
          server.close()
          reject(new Error('OAuth2 authorization timed out (5 minutes), please run ma account add again'))
        }
      },
      5 * 60 * 1000,
    )
  })
}

/**
 * Exchange authorization code for refreshToken + accessToken
 */
async function exchangeCodeForToken(
  providerConfig: OAuth2ProviderConfig,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const bodyParams: Record<string, string> = {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }

  // Microsoft requires client_secret, Google desktop apps can optionally provide it
  if (clientSecret) {
    bodyParams.client_secret = clientSecret
  }

  const body = new URLSearchParams(bodyParams)

  const response = await fetch(providerConfig.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    let hint = ''
    try {
      const errJson = JSON.parse(errorText)
      if (errJson.error === 'redirect_uri_mismatch') {
        hint =
          '\n\n💡 Tip: redirect_uri mismatch. Please confirm the redirect URI was added in the OAuth2 app settings: ' +
          redirectUri
      } else if (errJson.error === 'invalid_client') {
        hint = '\n\n💡 Tip: clientId or clientSecret is incorrect, please check.'
      }
    } catch {}
    throw new Error(`OAuth2 token exchange failed (${response.status}): ${errorText}${hint}`)
  }

  const data = (await response.json()) as any

  if (!data.refresh_token) {
    throw new Error(
      'OAuth2 authorization succeeded but refreshToken was not returned. ' +
        (providerConfig === OAUTH2_PROVIDERS.gmail
          ? 'Please confirm the Google OAuth2 consent screen is configured, and the authorization URL includes prompt=consent and access_type=offline.'
          : 'Please rerun the authorization flow.'),
    )
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in || DEFAULT_TOKEN_EXPIRY_SECONDS,
  }
}

// ── Token Refresh ──

import {
  TOKEN_ENDPOINTS,
  isTokenExpired as sharedIsTokenExpired,
  DEFAULT_TOKEN_EXPIRY_SECONDS,
  refreshAccessToken as coreRefreshAccessToken,
} from '@mail-agent/core'

/**
 * Refresh accessToken using refreshToken
 * Called before IMAP connection (imapflow does not support automatic refresh)
 *
 * Core implementation is in @mail-agent/core, this function signature remains backward-compatible
 */
export async function refreshAccessToken(oauth2: OAuth2Credentials, provider: string): Promise<OAuth2Credentials> {
  return coreRefreshAccessToken(oauth2, provider)
}

/**
 * Check if accessToken is about to expire (within 5 minutes) and needs refreshing
 */
export function isTokenExpired(oauth2: OAuth2Credentials): boolean {
  return sharedIsTokenExpired(oauth2)
}
