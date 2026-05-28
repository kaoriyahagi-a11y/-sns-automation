// Twitter API v2 への POST /2/tweets を OAuth 1.0a（User Context）で叩く
// Web Crypto API で HMAC-SHA1 署名を作るため Node 依存なし = Cloudflare Workers でそのまま動く

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function hmacSha1Base64(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  let binary = '';
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function generateNonce() {
  // 英数字のみのランダム文字列（OAuth推奨）
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * 単一ツイートを投稿する。body は JSON のため OAuth 署名対象には含めない（これが v2 の正）
 * @param {string} text - 本文（280字以内）
 * @param {{TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET}} env
 * @returns {Promise<{id:string, text:string, url:string}>}
 */
export async function postTweet(text, env) {
  const url = 'https://api.twitter.com/2/tweets';
  const method = 'POST';

  const oauthParams = {
    oauth_consumer_key: env.TWITTER_API_KEY,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // Signature Base String
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join('&');

  const baseString = [
    method,
    percentEncode(url),
    percentEncode(paramString),
  ].join('&');

  const signingKey =
    `${percentEncode(env.TWITTER_API_SECRET)}&${percentEncode(env.TWITTER_ACCESS_TOKEN_SECRET)}`;

  oauthParams.oauth_signature = await hmacSha1Base64(signingKey, baseString);

  const authHeader =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
      .join(', ');

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    throw new Error(`Twitter API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return {
    id: data.data.id,
    text: data.data.text,
    url: `https://twitter.com/i/web/status/${data.data.id}`,
  };
}
