# Serve the teleprompter over localhost (required for voice + service worker).
# Usage:  ./serve.ps1   then open the printed URL.
$port = 8080
$root = $PSScriptRoot

# Prefer python if present (simplest static server), else fall back to a tiny
# .NET HttpListener so this works with no extra install.
$py = (Get-Command python -ErrorAction SilentlyContinue)
if ($py) {
  Write-Host "Serving $root at http://localhost:$port  (Ctrl+C to stop)"
  Start-Process "http://localhost:$port/index.html"
  python -m http.server $port --directory $root
  return
}

Add-Type -AssemblyName System.Net.Http | Out-Null
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$port  (Ctrl+C to stop)"
Start-Process "http://localhost:$port/index.html"

$mime = @{ '.html'='text/html'; '.js'='text/javascript'; '.css'='text/css';
  '.json'='application/json'; '.webmanifest'='application/manifest+json';
  '.png'='image/png'; '.txt'='text/plain'; '.svg'='image/svg+xml' }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($rel -eq '') { $rel = 'index.html' }
  $file = Join-Path $root $rel
  if (Test-Path $file -PathType Leaf) {
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ext = [System.IO.Path]::GetExtension($file).ToLower()
    if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
