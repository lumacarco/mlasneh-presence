# MLA & SNEH Presence

Servizio Node.js/WebSocket separato per la presenza online di **https://mlasneh.it**.

## Architettura

```text
Browser su mlasneh.it
  |-- heartbeat --> PHP /api/presence.php
  |                   |
  |                   `-- HMAC --> Fly.io POST /presence
  |
  `-- WebSocket -----------------> Fly.io WSS /presence
```

Fly conserva esclusivamente in RAM `id`, `name`, `avatar` e `lastSeen`.

Non riceve password, sessioni PHP, cookie o messaggi della chat.

## Avvio locale

```powershell
npm install
$env:PRESENCE_SECRET = "un-segreto-locale-lungo-almeno-32-caratteri"
$env:ALLOWED_ORIGINS = "http://localhost"
npm start
```

Test:

```powershell
Invoke-RestMethod http://localhost:8080/health
```

## Nuovo repository GitHub

Crea un repository GitHub vuoto, ad esempio:

```text
mlasneh-presence
```

Poi:

```powershell
.\github-push.ps1 -RepositoryUrl "https://github.com/TUO-ACCOUNT/mlasneh-presence.git"
```

## Deploy Fly.io

```powershell
fly auth login
fly launch --no-deploy
```

Il nome `app = "mlasneh-presence"` in `fly.toml` deve essere unico.

Genera un segreto:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$secret = [Convert]::ToBase64String($bytes)
$secret
```

Salvalo su Fly:

```powershell
fly secrets set PRESENCE_SECRET="$secret"
```

Deploy:

```powershell
fly deploy
fly status
fly logs
```

Test:

```powershell
Invoke-RestMethod https://NOME-APP.fly.dev/health
```

WebSocket:

```text
wss://NOME-APP.fly.dev/presence
```

## Server PHP

Configura:

```text
PRESENCE_URL=https://NOME-APP.fly.dev
PRESENCE_WS_URL=wss://NOME-APP.fly.dev/presence
PRESENCE_SECRET=LO-STESSO-SEGRETO-DI-FLY
```

Non inserire mai il segreto in JavaScript, HTML o GitHub.

## Origins già configurate

```text
https://mlasneh.it
https://www.mlasneh.it
```

## Firma HMAC

```text
HMAC-SHA256(PRESENCE_SECRET, timestamp + "." + raw_json_body)
```

Header:

```text
X-SNEH-Timestamp
X-SNEH-Signature
```

Un utente viene rimosso dopo 45 secondi senza heartbeat.
