export const dynamic = 'force-dynamic'

export async function GET() {
  const html = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="1;url=/upload-entry?reset=1" />
    <title>Resetting login</title>
  </head>
  <body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px;">
    <p>Resetting HealthKeep login state...</p>
    <script>
      try {
        localStorage.clear();
        sessionStorage.clear();
        if ('caches' in window) {
          caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(key) { return caches.delete(key); }));
          }).finally(function() {
            setTimeout(function() { window.location.replace('/upload-entry?reset=1'); }, 600);
          });
        } else {
          setTimeout(function() { window.location.replace('/upload-entry?reset=1'); }, 600);
        }
      } catch (err) {
        setTimeout(function() { window.location.replace('/upload-entry?reset=1'); }, 600);
      }
    </script>
  </body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Clear-Site-Data': '"cache", "cookies", "storage"',
    },
  })
}
