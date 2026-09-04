import { timingSafeEqual } from 'node:crypto';

function constantTimeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue ?? ''), 'utf8');
  const right = Buffer.from(String(rightValue ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parseBasicAuthorization(header) {
  const value = String(header || '');
  if (!value.toLowerCase().startsWith('basic ')) return null;
  const token = value.slice(6).trim();
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function reject(res) {
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Basic realm="God\'s Eye View", charset="UTF-8"');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.end('Authentication required');
}

export function siteAuthPlugin() {
  return {
    name: 'hosted-site-basic-auth',
    configurePreviewServer(server) {
      const username = String(process.env.SITE_AUTH_USER || '').trim() || 'viewer';
      const password = String(process.env.SITE_AUTH_PASSWORD || '');

      if (!password) {
        console.warn('[site-auth] SITE_AUTH_PASSWORD is not set; hosted site remains public.');
        return;
      }

      console.log('[site-auth] HTTP Basic Auth enabled for hosted preview.');
      server.middlewares.use((req, res, next) => {
        const credentials = parseBasicAuthorization(req.headers.authorization);
        const valid = credentials
          && constantTimeEqual(credentials.username, username)
          && constantTimeEqual(credentials.password, password);

        if (!valid) {
          reject(res);
          return;
        }

        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        next();
      });
    },
  };
}

export default siteAuthPlugin;
