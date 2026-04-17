---
name: matrix-signup
description: Register yourself on a Matrix homeserver and wire the credentials into .kern/.env
---

# Matrix Signup

Get yourself onto a Matrix homeserver so the operator can DM you and invite you to rooms.

## Prerequisites

Ask the operator for:
- **Homeserver URL** — e.g. `https://matrix.example.com` or tailnet-local `http://matrix:8008`
- **Desired username** — e.g. `myagent` (your local part, not the full `@myagent:example.com`)
- **Password** — pick one, or ask the operator

Optional, depending on the homeserver:
- **Registration token** (for invite-only public servers)
- **Shared registration secret** (for admin-locked homelab Synapse/Dendrite)

If the operator says "I'll just create the account for you" — skip to the **Fallback** section at the bottom.

## Step 1: probe the homeserver

Figure out what registration flows the server accepts:

```bash
curl -s -X POST "$HOMESERVER/_matrix/client/v3/register" \
  -H 'Content-Type: application/json' -d '{}' | jq .
```

Look at the `flows` array in the response. Pick the first matching path below.

## Step 2: register

### Path A — open registration (`m.login.dummy`)

Simplest case. Just register with username + password:

```bash
curl -s -X POST "$HOMESERVER/_matrix/client/v3/register" \
  -H 'Content-Type: application/json' \
  -d '{
    "auth": {"type": "m.login.dummy"},
    "username": "myagent",
    "password": "...",
    "inhibit_login": false
  }' | jq .
```

Response includes `user_id` and `access_token`. Skip to Step 3.

### Path B — registration token (`m.login.registration_token`)

Operator gave you a token:

```bash
curl -s -X POST "$HOMESERVER/_matrix/client/v3/register" \
  -H 'Content-Type: application/json' \
  -d '{
    "auth": {"type": "m.login.registration_token", "token": "TOKEN_FROM_OPERATOR"},
    "username": "myagent",
    "password": "..."
  }' | jq .
```

### Path C — shared-secret admin registration

Used when `POST /v3/register` fails with `M_FORBIDDEN` or asks for recaptcha. Requires `MATRIX_REGISTRATION_SHARED_SECRET` from operator.

Endpoint depends on the homeserver:
- Synapse: `/_synapse/admin/v1/register`
- Dendrite: `/_dendrite/admin/v1/register`

Probe both if unsure — one will 404.

```bash
SECRET='...'  # from operator
USER='myagent'
PASS='...'
ADMIN='false'  # true only if the operator explicitly wants you to be admin

NONCE=$(curl -s "$HOMESERVER/_synapse/admin/v1/register" | jq -r .nonce)

MAC=$(printf '%s\x00%s\x00%s\x00%s' "$NONCE" "$USER" "$PASS" "$ADMIN" | \
  openssl dgst -sha1 -hmac "$SECRET" | awk '{print $2}')

curl -s -X POST "$HOMESERVER/_synapse/admin/v1/register" \
  -H 'Content-Type: application/json' \
  -d "{
    \"nonce\": \"$NONCE\",
    \"username\": \"$USER\",
    \"password\": \"$PASS\",
    \"admin\": $ADMIN,
    \"mac\": \"$MAC\"
  }" | jq .
```

The HMAC input is NUL-separated: `nonce\0user\0pass\0admin` where admin is the literal string `true` or `false`.

If Synapse 404s, retry with `/_dendrite/admin/v1/register`.

## Step 3: log in to get an access token

If the register response didn't already give you one (or you want a fresh one):

```bash
curl -s -X POST "$HOMESERVER/_matrix/client/v3/login" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "m.login.password",
    "identifier": {"type": "m.id.user", "user": "myagent"},
    "password": "..."
  }' | jq .
```

Grab `user_id` (looks like `@myagent:example.com`) and `access_token` (looks like `syt_...`).

## Step 4: write credentials to .kern/.env

Append — don't overwrite — these three lines:

```
MATRIX_HOMESERVER=https://matrix.example.com
MATRIX_USER_ID=@myagent:example.com
MATRIX_ACCESS_TOKEN=syt_...
```

Use `edit` or a small `bash` append with `>>`. Don't commit `.kern/.env` — it's gitignored.

## Step 5: ask the operator to restart

The Matrix interface is only initialized on startup — it won't pick up the new env vars until the agent restarts.

Tell the operator:

> I'm signed up as `@myagent:example.com`. Type `/restart` and I'll connect to Matrix. Then invite me to a room from your client.

## Fallback — operator creates the account

If all registration paths fail (locked-down server, no secret, no token), ask the operator to do it themselves:

On Synapse: `register_new_matrix_user -c homeserver.yaml`
On Dendrite: `create-account --config dendrite.yaml --username myagent --password ...` then hit `/v3/login` yourself to get a token.

Or ask them to log in as the new user once in Element and copy the access token from `Settings → Help & About → Advanced`.

Either way, you end up with `MATRIX_USER_ID` + `MATRIX_ACCESS_TOKEN`. Go to Step 4.

## Troubleshooting

- **`M_USER_IN_USE`** — pick a different username
- **`M_FORBIDDEN` on open register** — registration is disabled; fall back to shared-secret or ask operator
- **`M_UNKNOWN_TOKEN` after restart** — token was revoked or server re-keyed; log in again to get a fresh one
- **Homeserver URL vs server name** — `MATRIX_HOMESERVER` is the HTTP base URL (with scheme + port). `MATRIX_USER_ID` uses the server's declared `server_name`, which may differ. Use whatever the login response returns.
