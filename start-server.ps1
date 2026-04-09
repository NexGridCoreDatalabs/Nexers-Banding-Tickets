param(
  [int]$Port = 3000,
  [string]$Root = "."
)

$ErrorActionPreference = "Stop"

if (-not $Root.EndsWith("\")) { $Root += "\" }
$Root = (Resolve-Path $Root).Path + "\"

function Get-ContentType([string]$path) {
  $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
  switch ($ext) {
    ".html" { return "text/html; charset=utf-8" }
    ".js"   { return "application/javascript; charset=utf-8" }
    ".css"  { return "text/css; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".png"  { return "image/png" }
    ".jpg"  { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".gif"  { return "image/gif" }
    ".svg"  { return "image/svg+xml" }
    ".ico"  { return "image/x-icon" }
    ".woff" { return "font/woff" }
    ".woff2"{ return "font/woff2" }
    ".ttf"  { return "font/ttf" }
    default { return "application/octet-stream" }
  }
}

function Write-HttpResponse($stream, [int]$statusCode, [string]$statusText, [byte[]]$body, [string]$contentType) {
  $headers = @(
    "HTTP/1.1 $statusCode $statusText",
    "Content-Type: $contentType",
    "Content-Length: $($body.Length)",
    "Cache-Control: no-cache, no-store, must-revalidate",
    "Pragma: no-cache",
    "Expires: 0",
    "Connection: close",
    ""
  ) -join "`r`n"
  $headBytes = [Text.Encoding]::ASCII.GetBytes($headers + "`r`n")
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($body.Length -gt 0) {
    $stream.Write($body, 0, $body.Length)
  }
}

function Start-Listener([int]$PreferredPort) {
  $candidates = @($PreferredPort, 3001, 5173, 8080, 5500, 8888) | Select-Object -Unique
  foreach ($p in $candidates) {
    try {
      $l = [System.Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p)
      $l.Start()
      return @{ Listener = $l; Port = $p }
    } catch {
      continue
    }
  }
  throw "Could not bind any candidate port: $($candidates -join ', ')"
}

$started = Start-Listener -PreferredPort $Port
$listener = $started.Listener
$Port = [int]$started.Port

Write-Host "Serving $Root at http://localhost:$Port/"
Write-Host "Press Ctrl+C to stop."
try { Start-Process ("http://localhost:{0}/index.html" -f $Port) | Out-Null } catch {}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) {
      $client.Close()
      continue
    }

    # Drain remaining request headers
    while ($true) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($line)) { break }
    }

    $parts = $requestLine.Split(" ")
    if ($parts.Length -lt 2) {
      $body = [Text.Encoding]::UTF8.GetBytes("Bad Request")
      Write-HttpResponse $stream 400 "Bad Request" $body "text/plain; charset=utf-8"
      $client.Close()
      continue
    }

    $method = $parts[0].ToUpperInvariant()
    $urlPath = $parts[1]
    if ($method -ne "GET" -and $method -ne "HEAD") {
      $body = [Text.Encoding]::UTF8.GetBytes("Method Not Allowed")
      Write-HttpResponse $stream 405 "Method Not Allowed" $body "text/plain; charset=utf-8"
      $client.Close()
      continue
    }

    if ($urlPath -eq "/") { $urlPath = "/index.html" }
    if ($urlPath.Contains("?")) { $urlPath = $urlPath.Split("?")[0] }
    $safePath = [Uri]::UnescapeDataString($urlPath).TrimStart("/").Replace("/", "\")
    $file = Join-Path $Root $safePath
    if ((Test-Path $file) -and (Get-Item $file).PSIsContainer) {
      $file = Join-Path $file "index.html"
    }

    if (-not (Test-Path $file)) {
      $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
      Write-HttpResponse $stream 404 "Not Found" $body "text/plain; charset=utf-8"
      $client.Close()
      continue
    }

    $contentType = Get-ContentType $file
    $body = if ($method -eq "HEAD") { [byte[]]@() } else { [IO.File]::ReadAllBytes($file) }
    Write-HttpResponse $stream 200 "OK" $body $contentType
  } catch {
    try {
      $body = [Text.Encoding]::UTF8.GetBytes("500 Internal Server Error")
      Write-HttpResponse $stream 500 "Internal Server Error" $body "text/plain; charset=utf-8"
    } catch {}
  } finally {
    try { $client.Close() } catch {}
  }
}
